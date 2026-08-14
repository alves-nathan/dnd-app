const fs = require('node:fs');
const path = require('node:path');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp29Evidence,
  getGitSha,
  sha256File,
  withEvidenceDigest
} = require('./app29-release-candidate-evidence');
const { validateEvidenceDigest } = require('./app07-release-evidence');

const REQUIRED_STEPS = [
  'app30-contracts',
  'operational-docs',
  'production-identity',
  'private-material-scan',
  'app28-integral-gate',
  'app29-release-candidate',
  'production-build-artifact',
  'store-publication-receipt',
  'delivery-package'
];

const readAppIdentity = (root) => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo || {};
  return {
    name: app.name || null,
    slug: app.slug || null,
    version: app.version || null,
    runtimeVersionPolicy: app.runtimeVersion?.policy || null,
    androidPackage: app.android?.package || null,
    androidVersionCode: Number(app.android?.versionCode || 0),
    iosBundleIdentifier: app.ios?.bundleIdentifier || null,
    iosBuildNumber: app.ios?.buildNumber || null,
    releaseStage: app.extra?.release?.stage || null,
    releaseProfile: app.extra?.release?.buildProfile || null,
    e2eSeedEnabled: app.extra?.release?.e2eSeedEnabled === true
  };
};

const evaluateProductionIdentity = (root) => {
  const errors = [];
  const app = readAppIdentity(root);
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(app.version || ''))) errors.push('Versão pública não é SemVer estável.');
  if (packageJson.version !== app.version) errors.push('package.json e app.json possuem versões divergentes.');
  if (!app.androidPackage || !app.iosBundleIdentifier) errors.push('Identificadores Android/iOS incompletos.');
  if (app.runtimeVersionPolicy !== 'appVersion') errors.push('runtimeVersion não usa a política appVersion.');
  if (app.e2eSeedEnabled) errors.push('Seed E2E está habilitado na configuração pública.');
  const production = eas.build?.production;
  if (!production || production.android?.buildType !== 'app-bundle') errors.push('Perfil production Android não gera app-bundle.');
  if (production.env?.EXPO_PUBLIC_E2E_SEED_ENABLED !== 'false') errors.push('Perfil production não fixa EXPO_PUBLIC_E2E_SEED_ENABLED=false.');
  if (production.env?.EXPO_PUBLIC_RELEASE_STAGE !== 'production') errors.push('Perfil production não fixa EXPO_PUBLIC_RELEASE_STAGE=production.');
  return { valid: errors.length === 0, errors, app };
};

const validateDescriptor = (root, descriptor, label, errors) => {
  if (!descriptor?.path || !descriptor?.sha256 || !Number.isFinite(descriptor?.bytes)) {
    errors.push(`Descritor inválido: ${label}.`);
    return null;
  }
  const absolute = path.resolve(root, descriptor.path);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`Artefato ausente: ${label}.`);
    return null;
  }
  if (fs.statSync(absolute).size !== descriptor.bytes || sha256File(absolute) !== descriptor.sha256) {
    errors.push(`Artefato adulterado: ${label}.`);
    return null;
  }
  return absolute;
};

const validateBuildEvidence = (root, build, identity, errors) => {
  if (!build) {
    errors.push('Evidência do build de produção ausente.');
    return;
  }
  const artifactPath = validateDescriptor(root, build.artifact, 'build de produção', errors);
  const metadataPath = validateDescriptor(root, build.metadata, 'metadados do build', errors);
  if (!artifactPath || !metadataPath) return;
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')); } catch { errors.push('Metadados do build não são JSON válido.'); return; }
  if (metadata.schemaVersion !== 'dnd-combat-production-build-metadata.v1') errors.push('Schema dos metadados do build inválido.');
  if (metadata.platform !== 'android') errors.push('Somente o build Android está configurado para o encerramento atual.');
  if (metadata.profile !== 'production') errors.push('Build não usa o perfil production.');
  if (metadata.version !== identity.version) errors.push('Versão do build diverge do app.json.');
  if (metadata.applicationId !== identity.androidPackage) errors.push('Application ID do build diverge do app.json.');
  if (metadata.artifactSha256 !== build.artifact.sha256) errors.push('Checksum do artefato diverge dos metadados do build.');
  if (metadata.e2eSeedEnabled !== false) errors.push('Metadados indicam seed E2E habilitado.');
  if (!metadata.buildId || !Number.isFinite(Date.parse(metadata.completedAt || ''))) errors.push('Identidade ou data de conclusão do build ausente.');
  if (!String(artifactPath).toLowerCase().endsWith('.aab')) errors.push('Artefato Android de produção não é AAB.');
};

const validatePublicationEvidence = (root, publication, build, identity, errors) => {
  if (!publication) {
    errors.push('Recibo de publicação ausente.');
    return;
  }
  const receiptPath = validateDescriptor(root, publication.receipt, 'recibo da loja', errors);
  if (!receiptPath) return;
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch { errors.push('Recibo da loja não é JSON válido.'); return; }
  if (receipt.schemaVersion !== 'dnd-combat-store-publication-receipt.v1') errors.push('Schema do recibo da loja inválido.');
  if (receipt.platform !== 'android' || receipt.store !== 'google-play') errors.push('Loja/plataforma do recibo não correspondem ao release Android.');
  if (receipt.applicationId !== identity.androidPackage) errors.push('Application ID do recibo diverge do app.json.');
  if (receipt.versionName !== identity.version) errors.push('Versão publicada diverge do app.json.');
  if (receipt.artifactSha256 !== build?.artifact?.sha256) errors.push('Recibo da loja não corresponde ao artefato verificado.');
  if (receipt.status !== 'available') errors.push(`Publicação ainda não está disponível (${receipt.status || 'UNKNOWN'}).`);
  if (!receipt.consoleReference || !receipt.confirmedBy || !Number.isFinite(Date.parse(receipt.confirmedAt || ''))) errors.push('Confirmação operacional da loja incompleta.');
};

const evaluateApp30Evidence = (report, options) => {
  const { root, now = Date.now(), maxAgeHours = 72, requireGitMatch = true, minimumMaestroFlows = 83 } = options;
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['Evidência APP-30 ausente ou inválida.'] };
  if (report.schemaVersion !== 'dnd-combat-app30-production-release.v1') errors.push('Schema APP-30 inválido.');
  if (!validateEvidenceDigest(report)) errors.push('Digest APP-30 inválido.');
  if (report.status !== 'PASS') errors.push(`APP-30 não está encerrado (${report.status || 'UNKNOWN'}).`);
  const generatedAt = Date.parse(report.generatedAt || '');
  if (!Number.isFinite(generatedAt)) errors.push('generatedAt inválido.');
  else if (generatedAt - now > 5 * 60 * 1000) errors.push('Evidência APP-30 está no futuro.');
  else if (now - generatedAt > maxAgeHours * 3600 * 1000) errors.push(`Evidência APP-30 expirada (${maxAgeHours}h).`);
  const source = computeSourceFingerprint(root);
  if (report.source?.fingerprint !== source.fingerprint) errors.push('Fingerprint da codebase diverge do APP-30.');
  const gitSha = getGitSha(root);
  if (requireGitMatch && gitSha && report.source?.gitSha && gitSha !== report.source.gitSha) errors.push('Commit Git diverge do APP-30.');
  const lockSha = sha256File(path.join(root, 'package-lock.json'));
  if (report.source?.packageLockSha256 !== lockSha) errors.push('package-lock.json diverge do APP-30.');
  for (const id of REQUIRED_STEPS) {
    const step = report.steps?.find((entry) => entry.id === id);
    if (!step || step.status !== 'PASS') errors.push(`Etapa APP-30 não aprovada: ${id}.`);
  }
  const identity = evaluateProductionIdentity(root);
  errors.push(...identity.errors.map((entry) => `Identidade: ${entry}`));
  if (!report.app29Evidence) errors.push('Evidência APP-29 ausente.');
  else {
    const app29 = evaluateApp29Evidence(report.app29Evidence, { root, now, maxAgeHours: 24, requireGitMatch, minimumMaestroFlows });
    if (!app29.valid) errors.push(...app29.errors.map((entry) => `APP-29: ${entry}`));
  }
  validateBuildEvidence(root, report.build, identity.app, errors);
  validatePublicationEvidence(root, report.publication, report.build, identity.app, errors);
  for (const [name, descriptor] of Object.entries(report.artifacts || {})) validateDescriptor(root, descriptor, name, errors);
  if (report.closure?.automaticPublication !== false) errors.push('Encerramento não fixa automaticPublication=false.');
  if (!report.closure?.humanConfirmed || !report.closure?.confirmedBy) errors.push('Confirmação humana do encerramento ausente.');
  return { valid: errors.length === 0, errors, source, gitSha, lockSha, identity: identity.app };
};

module.exports = {
  REQUIRED_STEPS,
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp30Evidence,
  evaluateProductionIdentity,
  getGitSha,
  readAppIdentity,
  sha256File,
  validateBuildEvidence,
  validatePublicationEvidence,
  withEvidenceDigest
};
