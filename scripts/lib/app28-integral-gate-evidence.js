const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  computeSourceFingerprint,
  getGitSha,
  sha256,
  withEvidenceDigest,
  validateEvidenceDigest
} = require('./app07-release-evidence');

const REQUIRED_STEPS = [
  'dependency-install',
  'dependency-lock',
  'app27-regression',
  'full-typecheck',
  'full-jest',
  'native-gate'
];

const sha256File = (file) => sha256(fs.readFileSync(file));

const sanitizeRegistry = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value).replace(/\/\/(?:[^/@]+)@/, '//***@').replace(/\/$/, '');
  }
};

const sanitizeOutput = (value) => String(value || '')
  .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/g, '$1***:***@')
  .replace(/(_authToken|_auth|password)(\s*[=:]\s*)[^\s]+/gi, '$1$2***');

const classifyInstallOutput = ({ status, signal, errorCode, output }) => {
  const text = String(output || '');
  if (status === 0) return { status: 'PASS', classification: 'INSTALLED', remediation: null };
  if (errorCode === 'ETIMEDOUT' || signal === 'SIGTERM' || /timed?\s*out/i.test(text)) {
    return {
      status: 'BLOCKED',
      classification: 'REGISTRY_TIMEOUT',
      remediation: 'O registry não respondeu dentro do limite configurado.'
    };
  }
  if (/\bE404\b|404 Not Found/i.test(text)) {
    return {
      status: 'BLOCKED',
      classification: 'REGISTRY_PACKAGE_MISSING',
      remediation: 'O registry consultado não disponibiliza uma ou mais versões fixadas no lockfile.'
    };
  }
  if (/EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(text)) {
    return {
      status: 'BLOCKED',
      classification: 'REGISTRY_UNREACHABLE',
      remediation: 'O registry não pôde ser alcançado. Verifique DNS, proxy e política de rede.'
    };
  }
  if (/Exit handler never called/i.test(text)) {
    return {
      status: 'BLOCKED',
      classification: 'NPM_CLIENT_FAILURE',
      remediation: 'O cliente npm encerrou internamente após a tentativa de acesso ao registry; use outro ambiente, registry ou cache npm.'
    };
  }
  if (/ERESOLVE/i.test(text)) {
    return {
      status: 'FAIL',
      classification: 'DEPENDENCY_RESOLUTION_FAILED',
      remediation: 'O lockfile possui conflito real de resolução; não use --force ou --legacy-peer-deps para aprovar o gate.'
    };
  }
  if (/EINTEGRITY|integrity checksum failed/i.test(text)) {
    return {
      status: 'FAIL',
      classification: 'INTEGRITY_FAILED',
      remediation: 'Um pacote divergiu da integridade fixada no package-lock.json.'
    };
  }
  return {
    status: 'FAIL',
    classification: 'COMMAND_FAILED',
    remediation: 'A instalação falhou por motivo não classificado; consulte o log sem alterar o lockfile.'
  };
};

const artifactDescriptor = (root, relativePath) => {
  if (!relativePath) return null;
  const absolute = path.resolve(root, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  return {
    path: relativePath.replaceAll(path.sep, '/'),
    bytes: fs.statSync(absolute).size,
    sha256: sha256File(absolute)
  };
};

const validateArtifactDescriptor = (root, descriptor, label, errors) => {
  if (!descriptor?.path || !descriptor?.sha256 || !Number.isFinite(descriptor?.bytes)) {
    errors.push(`Descritor de artefato inválido: ${label}.`);
    return;
  }
  const absolute = path.resolve(root, descriptor.path);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`Artefato ausente: ${label}.`);
    return;
  }
  const content = fs.readFileSync(absolute);
  if (content.length !== descriptor.bytes || sha256(content) !== descriptor.sha256) {
    errors.push(`Artefato alterado após a execução: ${label}.`);
  }
};

const evaluateApp28Evidence = (report, options) => {
  const {
    root,
    now = Date.now(),
    maxAgeHours = 24,
    requireGitMatch = true,
    minimumMaestroFlows = 83
  } = options;
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['Evidência APP-28 ausente ou inválida.'] };
  if (report.schemaVersion !== 'dnd-combat-app28-integral-gate.v1') errors.push('Schema da evidência APP-28 inválido.');
  if (!validateEvidenceDigest(report)) errors.push('Digest da evidência APP-28 é inválido.');
  if (report.status !== 'PASS') errors.push(`Gate APP-28 não está aprovado (${report.status || 'UNKNOWN'}).`);

  const generatedAt = Date.parse(report.generatedAt || '');
  if (!Number.isFinite(generatedAt)) errors.push('generatedAt inválido.');
  else if (generatedAt - now > 5 * 60 * 1000) errors.push('Evidência possui horário futuro inválido.');
  else if (now - generatedAt > maxAgeHours * 60 * 60 * 1000) errors.push(`Evidência expirada (limite ${maxAgeHours}h).`);

  const currentSource = computeSourceFingerprint(root);
  if (report.source?.fingerprint !== currentSource.fingerprint) errors.push('Fingerprint da codebase diverge da evidência APP-28.');
  const currentGitSha = getGitSha(root);
  if (requireGitMatch && currentGitSha && report.source?.gitSha && currentGitSha !== report.source.gitSha) {
    errors.push('Commit Git diverge da evidência APP-28.');
  }

  const lockPath = path.join(root, 'package-lock.json');
  const currentLockSha = fs.existsSync(lockPath) ? sha256File(lockPath) : null;
  if (!currentLockSha || report.source?.packageLockSha256 !== currentLockSha) errors.push('package-lock.json diverge da evidência APP-28.');

  for (const id of REQUIRED_STEPS) {
    const step = report.steps?.find((entry) => entry.id === id);
    if (!step || step.status !== 'PASS') errors.push(`Etapa obrigatória não aprovada: ${id}.`);
  }

  if (Number(report.nativeEvidence?.flowCount || 0) < minimumMaestroFlows) {
    errors.push(`Quantidade de fluxos Maestro insuficiente; esperado pelo menos ${minimumMaestroFlows}.`);
  }
  if (report.nativeEvidence?.status !== 'PASS') errors.push('Gate nativo não possui status PASS.');
  if (!report.nativeEvidence?.appVersionMatches) errors.push('Versão Android instalada não foi validada contra app.json.');

  for (const label of ['junit', 'logcat', 'screenshot', 'maestroLog']) {
    validateArtifactDescriptor(root, report.nativeEvidence?.artifacts?.[label], label, errors);
  }

  const junitDescriptor = report.nativeEvidence?.artifacts?.junit;
  if (junitDescriptor?.path) {
    const absolute = path.resolve(root, junitDescriptor.path);
    if (fs.existsSync(absolute)) {
      const junit = fs.readFileSync(absolute, 'utf8');
      const failures = [...junit.matchAll(/\bfailures="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
      const testErrors = [...junit.matchAll(/\berrors="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
      if (failures || testErrors) errors.push(`JUnit contém ${failures} falhas e ${testErrors} erros.`);
    }
  }

  const screenshotDescriptor = report.nativeEvidence?.artifacts?.screenshot;
  if (screenshotDescriptor?.path) {
    const absolute = path.resolve(root, screenshotDescriptor.path);
    if (fs.existsSync(absolute)) {
      const png = fs.readFileSync(absolute);
      const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (png.length <= 8 || !png.subarray(0, 8).equals(signature)) errors.push('Screenshot nativo não é um PNG válido.');
    }
  }

  return { valid: errors.length === 0, errors, currentSource, currentGitSha, currentLockSha };
};

module.exports = {
  REQUIRED_STEPS,
  artifactDescriptor,
  classifyInstallOutput,
  computeSourceFingerprint,
  evaluateApp28Evidence,
  getGitSha,
  sanitizeOutput,
  sanitizeRegistry,
  sha256,
  sha256File,
  withEvidenceDigest
};
