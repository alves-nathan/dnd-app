#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp30Evidence,
  evaluateProductionIdentity,
  getGitSha,
  sha256File,
  validateBuildEvidence,
  validatePublicationEvidence,
  withEvidenceDigest
} = require('./lib/app30-production-release-evidence');
const { evaluateApp29Evidence } = require('./lib/app29-release-candidate-evidence');
const { evaluateApp28Evidence } = require('./lib/app28-integral-gate-evidence');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const allowBlocked = flag('--allow-blocked');
const humanConfirmed = flag('--human-confirmed');
const confirmedBy = value('--confirmed-by');
const androidArtifact = value('--android-artifact');
const buildMetadata = value('--build-metadata');
const publicationReceipt = value('--publication-receipt');
const outputDir = path.join(root, 'artifacts/app30-production-release');
fs.mkdirSync(outputDir, { recursive: true });
const runStep = (id, command, commandArgs) => {
  const started = Date.now();
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const log = path.join(outputDir, `${id}.log`);
  fs.writeFileSync(log, `${result.stdout || ''}${result.stderr || ''}`);
  return { id, status: result.status === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started, exitCode: result.status, logFile: path.relative(root, log).replaceAll(path.sep, '/'), detail: result.status === 0 ? 'Etapa aprovada.' : `Comando encerrou com código ${result.status}.` };
};
const steps = [
  runStep('app30-contracts', process.execPath, ['scripts/check-app30-production-release.js']),
  runStep('operational-docs', process.execPath, ['scripts/check-app30-operational-docs.js']),
  runStep('private-material-scan', process.execPath, ['scripts/scan-app30-private-material.js']),
  runStep('delivery-package', process.execPath, ['scripts/create-app30-delivery-package.js'])
];
const identity = evaluateProductionIdentity(root);
steps.push({ id: 'production-identity', status: identity.valid ? 'PASS' : 'FAIL', durationMs: 0, exitCode: identity.valid ? 0 : 1, logFile: null, detail: identity.valid ? `Versão ${identity.app.version} configurada para produção.` : identity.errors.join(' | ') });
const app28Path = path.join(root, 'artifacts/app28-integral-gate.json');
const app29Path = path.join(root, 'artifacts/app29-release-candidate.json');
const app28Evidence = fs.existsSync(app28Path) ? JSON.parse(fs.readFileSync(app28Path, 'utf8')) : null;
const app29Evidence = fs.existsSync(app29Path) ? JSON.parse(fs.readFileSync(app29Path, 'utf8')) : null;
const app28 = app28Evidence ? evaluateApp28Evidence(app28Evidence, { root, requireGitMatch: false, minimumMaestroFlows: 83 }) : { valid: false, errors: ['Evidência APP-28 ausente.'] };
const app29 = app29Evidence ? evaluateApp29Evidence(app29Evidence, { root, requireGitMatch: false, minimumMaestroFlows: 83 }) : { valid: false, errors: ['Evidência APP-29 ausente.'] };
steps.push({ id: 'app28-integral-gate', status: app28.valid ? 'PASS' : app28Evidence?.status === 'FAIL' ? 'FAIL' : 'BLOCKED', durationMs: 0, exitCode: null, logFile: fs.existsSync(app28Path) ? path.relative(root, app28Path) : null, detail: app28.valid ? 'APP-28 aprovado para a fingerprint atual.' : app28.errors.join(' | ') });
steps.push({ id: 'app29-release-candidate', status: app29.valid ? 'PASS' : app29Evidence?.status === 'FAIL' ? 'FAIL' : 'BLOCKED', durationMs: 0, exitCode: null, logFile: fs.existsSync(app29Path) ? path.relative(root, app29Path) : null, detail: app29.valid ? 'APP-29 aprovado para a fingerprint atual.' : app29.errors.join(' | ') });
let build = null;
if (androidArtifact && buildMetadata) {
  const artifactRelative = path.relative(root, path.resolve(root, androidArtifact)).replaceAll(path.sep, '/');
  const metadataRelative = path.relative(root, path.resolve(root, buildMetadata)).replaceAll(path.sep, '/');
  build = { artifact: artifactDescriptor(root, artifactRelative), metadata: artifactDescriptor(root, metadataRelative) };
}
const buildErrors = [];
validateBuildEvidence(root, build, identity.app, buildErrors);
steps.push({ id: 'production-build-artifact', status: buildErrors.length ? (build ? 'FAIL' : 'BLOCKED') : 'PASS', durationMs: 0, exitCode: null, logFile: build?.metadata?.path || null, detail: buildErrors.length ? buildErrors.join(' | ') : 'AAB e metadados de produção verificados.' });
let publication = null;
if (publicationReceipt) {
  const receiptRelative = path.relative(root, path.resolve(root, publicationReceipt)).replaceAll(path.sep, '/');
  publication = { receipt: artifactDescriptor(root, receiptRelative) };
}
const publicationErrors = [];
validatePublicationEvidence(root, publication, build, identity.app, publicationErrors);
steps.push({ id: 'store-publication-receipt', status: publicationErrors.length ? (publication ? 'FAIL' : 'BLOCKED') : 'PASS', durationMs: 0, exitCode: null, logFile: publication?.receipt?.path || null, detail: publicationErrors.length ? publicationErrors.join(' | ') : 'Disponibilidade na loja reconciliada com o artefato.' });
const closureReady = humanConfirmed && Boolean(confirmedBy) && steps.every((entry) => entry.status === 'PASS');
const status = steps.some((entry) => entry.status === 'FAIL') ? 'FAIL' : steps.some((entry) => entry.status === 'BLOCKED') || !closureReady ? 'BLOCKED' : 'PASS';
const deliveryReportPath = path.join(root, 'reports/app-30-delivery-package.json');
const deliveryReport = fs.existsSync(deliveryReportPath) ? JSON.parse(fs.readFileSync(deliveryReportPath, 'utf8')) : null;
const artifactMap = {
  operationalDocs: artifactDescriptor(root, 'reports/app-30-operational-docs.json'),
  privateScan: artifactDescriptor(root, 'reports/app-30-private-material-scan.json'),
  deliveryReport: artifactDescriptor(root, 'reports/app-30-delivery-package.json'),
  deliveryPackage: deliveryReport?.package ? deliveryReport.package : null
};
const source = computeSourceFingerprint(root);
const unsigned = {
  schemaVersion: 'dnd-combat-app30-production-release.v1',
  status,
  generatedAt: new Date().toISOString(),
  source: { ...source, gitSha: getGitSha(root), packageLockSha256: sha256File(path.join(root, 'package-lock.json')) },
  app: identity.app,
  steps,
  app28Evidence,
  app29Evidence,
  build,
  publication,
  artifacts: Object.fromEntries(Object.entries(artifactMap).filter(([, descriptor]) => descriptor)),
  closure: { automaticPublication: false, humanConfirmed: closureReady, confirmedBy: closureReady ? confirmedBy : null, confirmedAt: closureReady ? new Date().toISOString() : null },
  remediation: steps.filter((entry) => entry.status !== 'PASS').map((entry) => ({ id: entry.id, detail: entry.detail }))
};
const report = withEvidenceDigest(unsigned);
const reportPath = path.join(root, 'artifacts/app30-production-release.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const selfValidation = status === 'PASS' ? evaluateApp30Evidence(report, { root, requireGitMatch: false, minimumMaestroFlows: 83 }) : null;
console.log(JSON.stringify({ status, evidenceSha256: report.evidenceSha256, selfValid: selfValidation?.valid ?? false, report: path.relative(root, reportPath), remediation: report.remediation }, null, 2));
if (status === 'FAIL' || (status === 'BLOCKED' && !allowBlocked)) process.exit(1);
