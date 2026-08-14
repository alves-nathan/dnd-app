const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SOURCE_ROOTS = ['app', 'src', 'scripts', '.maestro'];
const SOURCE_FILES = ['.npmrc', '.easignore', 'package.json', 'package-lock.json', 'app.config.js', 'app.json', 'eas.json', 'tsconfig.json', 'jest.config.js', 'babel.config.js', 'metro.config.js'];
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', 'artifacts', 'reports', 'coverage', '.expo', 'android', 'ios']);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const listFiles = (root, relativePath, output) => {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    output.push(relativePath.replaceAll(path.sep, '/'));
    return;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    listFiles(root, path.join(relativePath, entry.name), output);
  }
};

const collectSourceFiles = (root) => {
  const files = [];
  for (const file of SOURCE_FILES) listFiles(root, file, files);
  for (const directory of SOURCE_ROOTS) listFiles(root, directory, files);
  return [...new Set(files)].sort();
};

const computeSourceFingerprint = (root) => {
  const files = collectSourceFiles(root);
  const hash = crypto.createHash('sha256');
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update('\0');
  }
  return { fingerprint: hash.digest('hex'), files: files.length };
};

const getGitSha = (root) => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout).trim() || null : null;
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const withEvidenceDigest = (report) => {
  const unsigned = { ...report };
  delete unsigned.evidenceSha256;
  return { ...report, evidenceSha256: sha256(JSON.stringify(unsigned)) };
};

const validateEvidenceDigest = (report) => {
  if (!report || typeof report !== 'object' || typeof report.evidenceSha256 !== 'string') return false;
  const unsigned = { ...report };
  delete unsigned.evidenceSha256;
  return sha256(JSON.stringify(unsigned)) === report.evidenceSha256;
};


const evaluateReleaseGateEvidence = (report, options) => {
  const { root, now = Date.now(), maxAgeHours = 24, requireGitMatch = true } = options;
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['Evidência ausente ou inválida.'] };
  if (!validateEvidenceDigest(report)) errors.push('Digest da evidência é inválido.');
  if (report.status !== 'PASS') errors.push(`Gate não está aprovado (${report.status || 'UNKNOWN'}).`);
  const generatedAt = Date.parse(report.generatedAt || '');
  if (!Number.isFinite(generatedAt)) errors.push('generatedAt inválido.');
  else if (now - generatedAt > maxAgeHours * 60 * 60 * 1000) errors.push(`Evidência expirada (limite ${maxAgeHours}h).`);
  else if (generatedAt - now > 5 * 60 * 1000) errors.push('Evidência possui horário futuro inválido.');
  const currentSource = computeSourceFingerprint(root);
  if (report.source?.fingerprint !== currentSource.fingerprint) errors.push('Fingerprint da codebase diverge da evidência.');
  const currentGitSha = getGitSha(root);
  if (requireGitMatch && currentGitSha && report.source?.gitSha && currentGitSha !== report.source.gitSha) errors.push('Commit Git diverge da evidência.');
  const requiredSteps = ['dependency-lock', 'app06-smoke', 'typecheck', 'jest', 'native-gate'];
  for (const id of requiredSteps) {
    const step = report.steps?.find((entry) => entry.id === id);
    if (!step || step.status !== 'PASS') errors.push(`Etapa obrigatória não aprovada: ${id}.`);
  }
  const junitPath = report.nativeEvidence?.junitPath;
  if (!junitPath || !fs.existsSync(path.resolve(root, junitPath))) {
    errors.push('JUnit nativo ausente.');
  } else {
    const junit = fs.readFileSync(path.resolve(root, junitPath), 'utf8');
    const failures = [...junit.matchAll(/\bfailures="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    const testErrors = [...junit.matchAll(/\berrors="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    if (failures > 0 || testErrors > 0) errors.push(`JUnit nativo contém falhas (${failures}) ou erros (${testErrors}).`);
  }
  const logcatPath = report.nativeEvidence?.logcatPath;
  if (!logcatPath || !fs.existsSync(path.resolve(root, logcatPath)) || fs.statSync(path.resolve(root, logcatPath)).size === 0) {
    errors.push('Logcat nativo ausente.');
  }
  const screenshotPath = report.nativeEvidence?.screenshotPath;
  if (!screenshotPath || !fs.existsSync(path.resolve(root, screenshotPath))) {
    errors.push('Screenshot nativo ausente.');
  } else {
    const screenshot = fs.readFileSync(path.resolve(root, screenshotPath));
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (screenshot.length <= 8 || !screenshot.subarray(0, 8).equals(pngSignature)) errors.push('Screenshot nativo não é um PNG válido.');
  }
  for (const [name, descriptor] of Object.entries(report.nativeEvidence?.artifacts || {})) {
    if (!descriptor?.path || !descriptor?.sha256 || !Number.isFinite(descriptor?.bytes)) {
      errors.push(`Descritor de artefato nativo inválido: ${name}.`);
      continue;
    }
    const absolute = path.resolve(root, descriptor.path);
    if (!fs.existsSync(absolute)) continue;
    const content = fs.readFileSync(absolute);
    if (content.length !== descriptor.bytes || sha256(content) !== descriptor.sha256) errors.push(`Artefato nativo alterado após o gate: ${name}.`);
  }
  const requiredArtifactDescriptors = ['junit', 'logcat', 'screenshot'];
  for (const name of requiredArtifactDescriptors) {
    if (!report.nativeEvidence?.artifacts?.[name]) errors.push(`Hash do artefato nativo ausente: ${name}.`);
  }
  if (!report.nativeEvidence?.appVersionMatches) errors.push('Versão Android instalada não foi validada contra app.json.');
  return { valid: errors.length === 0, errors, currentSource, currentGitSha };
};

module.exports = {
  collectSourceFiles,
  computeSourceFingerprint,
  evaluateReleaseGateEvidence,
  getGitSha,
  readJson,
  sha256,
  validateEvidenceDigest,
  withEvidenceDigest,
  writeJson
};
