const fs = require('node:fs');
const path = require('node:path');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp28Evidence,
  getGitSha,
  sha256File,
  withEvidenceDigest
} = require('./app28-integral-gate-evidence');
const { validateEvidenceDigest } = require('./app07-release-evidence');

const REQUIRED_STEPS = [
  'source-shape',
  'accessibility-contracts',
  'security-hardening',
  'migration-contracts',
  'install-upgrade-rehearsal',
  'performance-budget',
  'release-readiness',
  'app28-integral-gate'
];

const evaluateApp29Evidence = (report, options) => {
  const { root, now = Date.now(), maxAgeHours = 24, requireGitMatch = true, minimumMaestroFlows = 83 } = options;
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['Evidência APP-29 ausente ou inválida.'] };
  if (report.schemaVersion !== 'dnd-combat-app29-release-candidate.v1') errors.push('Schema APP-29 inválido.');
  if (!validateEvidenceDigest(report)) errors.push('Digest APP-29 inválido.');
  if (report.status !== 'PASS') errors.push(`APP-29 não está aprovado (${report.status || 'UNKNOWN'}).`);
  const generatedAt = Date.parse(report.generatedAt || '');
  if (!Number.isFinite(generatedAt)) errors.push('generatedAt inválido.');
  else if (generatedAt - now > 5 * 60 * 1000) errors.push('Evidência APP-29 está no futuro.');
  else if (now - generatedAt > maxAgeHours * 3600 * 1000) errors.push(`Evidência APP-29 expirada (${maxAgeHours}h).`);
  const source = computeSourceFingerprint(root);
  if (report.source?.fingerprint !== source.fingerprint) errors.push('Fingerprint da codebase diverge do APP-29.');
  const gitSha = getGitSha(root);
  if (requireGitMatch && gitSha && report.source?.gitSha && gitSha !== report.source.gitSha) errors.push('Commit Git diverge do APP-29.');
  const lockSha = sha256File(path.join(root, 'package-lock.json'));
  if (report.source?.packageLockSha256 !== lockSha) errors.push('package-lock.json diverge do APP-29.');
  for (const id of REQUIRED_STEPS) {
    const step = report.steps?.find((entry) => entry.id === id);
    if (!step || step.status !== 'PASS') errors.push(`Etapa APP-29 não aprovada: ${id}.`);
  }
  if (!report.app28Evidence) errors.push('Evidência APP-28 não foi incorporada.');
  else {
    const app28 = evaluateApp28Evidence(report.app28Evidence, { root, requireGitMatch, maxAgeHours, minimumMaestroFlows });
    if (!app28.valid) errors.push(...app28.errors.map((entry) => `APP-28: ${entry}`));
  }
  for (const [name, descriptor] of Object.entries(report.artifacts || {})) {
    if (!descriptor?.path || !descriptor?.sha256 || !Number.isFinite(descriptor?.bytes)) {
      errors.push(`Descritor inválido: ${name}.`);
      continue;
    }
    const absolute = path.resolve(root, descriptor.path);
    if (!fs.existsSync(absolute)) errors.push(`Artefato ausente: ${name}.`);
    else if (sha256File(absolute) !== descriptor.sha256 || fs.statSync(absolute).size !== descriptor.bytes) errors.push(`Artefato adulterado: ${name}.`);
  }
  return { valid: errors.length === 0, errors, source, gitSha, lockSha };
};

module.exports = {
  REQUIRED_STEPS,
  artifactDescriptor,
  computeSourceFingerprint,
  evaluateApp29Evidence,
  getGitSha,
  sha256File,
  withEvidenceDigest
};
