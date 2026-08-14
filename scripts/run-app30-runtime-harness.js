#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp30Evidence,
  getGitSha,
  sha256File,
  withEvidenceDigest
} = require('./lib/app30-production-release-evidence');
const { withEvidenceDigest: withApp29Digest } = require('./lib/app29-release-candidate-evidence');
const { withEvidenceDigest: withApp28Digest } = require('./lib/app28-integral-gate-evidence');
const root = path.resolve(__dirname, '..');
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(message); };
const dir = path.join(root, 'artifacts/app30-harness');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, value); return file; };
const files = {
  junit: write('junit.xml', '<testsuites tests="83" failures="0" errors="0"></testsuites>'),
  logcat: write('logcat.txt', 'clean logcat\n'),
  screenshot: write('screen.png', Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('app30')])),
  maestroLog: write('maestro.log', '83/83 PASS\n'),
  security: write('security.json', '{"status":"PASS"}'),
  migrations: write('migrations.json', '{"status":"PASS"}'),
  rehearsal: write('rehearsal.json', '{"status":"PASS"}'),
  performance: write('performance.json', '{"status":"PASS"}'),
  docs: write('docs.json', '{"status":"PASS"}'),
  privateScan: write('private-scan.json', '{"status":"PASS"}'),
  deliveryReport: write('delivery.json', '{"status":"PASS"}'),
  deliveryPackage: write('delivery.zip', 'synthetic delivery package')
};
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const artifactFile = write('dnd-combat-release.aab', 'synthetic-aab-content');
const artifactRelative = path.relative(root, artifactFile);
const artifactSha = sha256File(artifactFile);
const buildMetadataFile = write('build-metadata.json', JSON.stringify({
  schemaVersion: 'dnd-combat-production-build-metadata.v1',
  platform: 'android',
  profile: 'production',
  buildId: 'build-app30-harness',
  completedAt: new Date().toISOString(),
  version: app.version,
  versionCode: app.android.versionCode,
  applicationId: app.android.package,
  artifactSha256: artifactSha,
  e2eSeedEnabled: false
}));
const publicationReceiptFile = write('publication-receipt.json', JSON.stringify({
  schemaVersion: 'dnd-combat-store-publication-receipt.v1',
  platform: 'android',
  store: 'google-play',
  status: 'available',
  applicationId: app.android.package,
  versionName: app.version,
  versionCode: app.android.versionCode,
  artifactSha256: artifactSha,
  consoleReference: 'synthetic-console-reference',
  confirmedBy: 'release-owner',
  confirmedAt: new Date().toISOString()
}));
const source = computeSourceFingerprint(root);
const sourceRecord = { ...source, gitSha: getGitSha(root), packageLockSha256: sha256File(path.join(root, 'package-lock.json')) };
const app28 = withApp28Digest({
  schemaVersion: 'dnd-combat-app28-integral-gate.v1', status: 'PASS', generatedAt: new Date().toISOString(), source: sourceRecord,
  steps: ['dependency-install','dependency-lock','app27-regression','full-typecheck','full-jest','native-gate'].map((id) => ({ id, status: 'PASS' })),
  nativeEvidence: { status: 'PASS', flowCount: 83, appVersionMatches: true, artifacts: Object.fromEntries(['junit','logcat','screenshot','maestroLog'].map((key) => [key, artifactDescriptor(root, path.relative(root, files[key]))])) }
});
const app29 = withApp29Digest({
  schemaVersion: 'dnd-combat-app29-release-candidate.v1', status: 'PASS', generatedAt: new Date().toISOString(), source: sourceRecord,
  steps: ['source-shape','accessibility-contracts','security-hardening','migration-contracts','install-upgrade-rehearsal','performance-budget','release-readiness','app28-integral-gate'].map((id) => ({ id, status: 'PASS' })),
  app28Evidence: app28,
  artifacts: Object.fromEntries(['security','migrations','rehearsal','performance'].map((key) => [key, artifactDescriptor(root, path.relative(root, files[key]))]))
});
const steps = ['app30-contracts','operational-docs','production-identity','private-material-scan','app28-integral-gate','app29-release-candidate','production-build-artifact','store-publication-receipt','delivery-package'].map((id) => ({ id, status: 'PASS' }));
const base = {
  schemaVersion: 'dnd-combat-app30-production-release.v1', status: 'PASS', generatedAt: new Date().toISOString(), source: sourceRecord,
  app: { version: app.version, androidPackage: app.android.package }, steps, app28Evidence: app28, app29Evidence: app29,
  build: { artifact: artifactDescriptor(root, artifactRelative), metadata: artifactDescriptor(root, path.relative(root, buildMetadataFile)) },
  publication: { receipt: artifactDescriptor(root, path.relative(root, publicationReceiptFile)) },
  artifacts: {
    operationalDocs: artifactDescriptor(root, path.relative(root, files.docs)),
    privateScan: artifactDescriptor(root, path.relative(root, files.privateScan)),
    deliveryReport: artifactDescriptor(root, path.relative(root, files.deliveryReport)),
    deliveryPackage: artifactDescriptor(root, path.relative(root, files.deliveryPackage))
  },
  closure: { automaticPublication: false, humanConfirmed: true, confirmedBy: 'release-owner', confirmedAt: new Date().toISOString() },
  remediation: []
};
const report = withEvidenceDigest(base);
let result = evaluateApp30Evidence(report, { root, requireGitMatch: false, minimumMaestroFlows: 83 });
assert(result.valid, `Evidência válida rejeitada: ${result.errors.join('; ')}`);
assert(report.evidenceSha256.length === 64, 'Digest APP-30 inválido.');
assert(report.app29Evidence.evidenceSha256.length === 64, 'Digest APP-29 inválido.');
assert(report.app28Evidence.evidenceSha256.length === 64, 'Digest APP-28 inválido.');
assert(report.steps.length === 9, 'Quantidade de etapas APP-30 inválida.');
assert(report.closure.automaticPublication === false, 'Publicação automática foi habilitada.');
assert(report.build.artifact.sha256 === artifactSha, 'Checksum do AAB inválido.');
assert(report.app28Evidence.nativeEvidence.flowCount === 83, 'Quantidade de fluxos inválida.');
const blocked = withEvidenceDigest({ ...base, status: 'BLOCKED' });
assert(!evaluateApp30Evidence(blocked, { root, requireGitMatch: false }).valid, 'Status BLOCKED foi aceito.');
const missingStep = withEvidenceDigest({ ...base, steps: steps.slice(1) });
assert(!evaluateApp30Evidence(missingStep, { root, requireGitMatch: false }).valid, 'Etapa ausente foi aceita.');
const failedStep = withEvidenceDigest({ ...base, steps: steps.map((entry) => entry.id === 'operational-docs' ? { ...entry, status: 'FAIL' } : entry) });
assert(!evaluateApp30Evidence(failedStep, { root, requireGitMatch: false }).valid, 'Etapa FAIL foi aceita.');
const stale = withEvidenceDigest({ ...base, generatedAt: new Date(Date.now() - 100 * 3600 * 1000).toISOString() });
assert(!evaluateApp30Evidence(stale, { root, requireGitMatch: false, maxAgeHours: 72 }).valid, 'Evidência expirada foi aceita.');
const wrongLock = withEvidenceDigest({ ...base, source: { ...base.source, packageLockSha256: '0'.repeat(64) } });
assert(!evaluateApp30Evidence(wrongLock, { root, requireGitMatch: false }).valid, 'Lockfile divergente foi aceito.');
const badDigest = { ...report, status: 'FAIL' };
assert(!evaluateApp30Evidence(badDigest, { root, requireGitMatch: false }).valid, 'Digest adulterado foi aceito.');
const fewFlowsApp28 = withApp28Digest({ ...app28, nativeEvidence: { ...app28.nativeEvidence, flowCount: 82 } });
const fewFlowsApp29 = withApp29Digest({ ...app29, app28Evidence: fewFlowsApp28 });
const fewFlows = withEvidenceDigest({ ...base, app28Evidence: fewFlowsApp28, app29Evidence: fewFlowsApp29 });
assert(!evaluateApp30Evidence(fewFlows, { root, requireGitMatch: false, minimumMaestroFlows: 83 }).valid, '82 fluxos foram aceitos.');
const noHuman = withEvidenceDigest({ ...base, closure: { ...base.closure, humanConfirmed: false, confirmedBy: null } });
assert(!evaluateApp30Evidence(noHuman, { root, requireGitMatch: false }).valid, 'Encerramento sem confirmação humana foi aceito.');
const automatic = withEvidenceDigest({ ...base, closure: { ...base.closure, automaticPublication: true } });
assert(!evaluateApp30Evidence(automatic, { root, requireGitMatch: false }).valid, 'Publicação automática foi aceita.');
const metadataOriginal = fs.readFileSync(buildMetadataFile, 'utf8');
const metadataWrongVersion = { ...JSON.parse(metadataOriginal), version: '9.9.9' };
fs.writeFileSync(buildMetadataFile, JSON.stringify(metadataWrongVersion));
const wrongVersionBase = { ...base, build: { ...base.build, metadata: artifactDescriptor(root, path.relative(root, buildMetadataFile)) } };
assert(!evaluateApp30Evidence(withEvidenceDigest(wrongVersionBase), { root, requireGitMatch: false }).valid, 'Build de outra versão foi aceito.');
fs.writeFileSync(buildMetadataFile, metadataOriginal);
const seedMetadata = { ...JSON.parse(metadataOriginal), e2eSeedEnabled: true };
fs.writeFileSync(buildMetadataFile, JSON.stringify(seedMetadata));
const seedBase = { ...base, build: { ...base.build, metadata: artifactDescriptor(root, path.relative(root, buildMetadataFile)) } };
assert(!evaluateApp30Evidence(withEvidenceDigest(seedBase), { root, requireGitMatch: false }).valid, 'Build com seed E2E foi aceito.');
fs.writeFileSync(buildMetadataFile, metadataOriginal);
const receiptOriginal = fs.readFileSync(publicationReceiptFile, 'utf8');
fs.writeFileSync(publicationReceiptFile, JSON.stringify({ ...JSON.parse(receiptOriginal), status: 'submitted' }));
const submittedBase = { ...base, publication: { receipt: artifactDescriptor(root, path.relative(root, publicationReceiptFile)) } };
assert(!evaluateApp30Evidence(withEvidenceDigest(submittedBase), { root, requireGitMatch: false }).valid, 'Upload ainda não disponível foi aceito.');
fs.writeFileSync(publicationReceiptFile, receiptOriginal);
fs.appendFileSync(files.deliveryPackage, 'tampered');
assert(!evaluateApp30Evidence(report, { root, requireGitMatch: false }).valid, 'Pacote de entrega adulterado foi aceito.');
assert(app.version === '1.0.0', 'Versão de produção esperada não está configurada.');
assert(app.runtimeVersion.policy === 'appVersion', 'runtimeVersion não acompanha appVersion.');
assert(app.extra.release.e2eSeedEnabled === false, 'Seed E2E público está habilitado.');
assert(source.fingerprint.length === 64, 'Fingerprint inválida.');
assert(steps.every((entry) => entry.status === 'PASS'), 'Fixture possui etapa não aprovada.');
const output = { schemaVersion: 'dnd-combat-app30-runtime-harness.v1', status: 'PASS', generatedAt: new Date().toISOString(), assertions, requiredMaestroFlows: 83 };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-runtime-harness.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
