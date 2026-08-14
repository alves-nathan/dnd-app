#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  computeSourceFingerprint,
  getGitSha,
  readJson,
  sha256,
  withEvidenceDigest,
  writeJson
} = require('./lib/app07-release-evidence');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const allowBlocked = args.has('--allow-blocked');
const executeNative = args.has('--execute-native');
const generatedAt = new Date().toISOString();
const outputDir = path.join(root, 'artifacts/app07-release-gate');
const reportPath = path.join(root, 'artifacts/app07-release-gate.json');
fs.mkdirSync(outputDir, { recursive: true });

const artifactDescriptor = (relativePath) => {
  if (!relativePath) return null;
  const absolute = path.resolve(root, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const content = fs.readFileSync(absolute);
  return { path: relativePath, bytes: content.length, sha256: sha256(content) };
};

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [];
const requiredInstallFiles = [
  'node_modules/expo/package.json',
  'node_modules/react/package.json',
  'node_modules/react-native/package.json',
  'node_modules/zustand/package.json',
  'node_modules/zod/package.json',
  `node_modules/.bin/${process.platform === 'win32' ? 'tsc.cmd' : 'tsc'}`,
  `node_modules/.bin/${process.platform === 'win32' ? 'jest.cmd' : 'jest'}`
];
const dependenciesReady = requiredInstallFiles.every((relativePath) => fs.existsSync(path.join(root, relativePath)));

const run = ({ id, command, commandArgs, blockedReason, env = {} }) => {
  if (blockedReason) {
    const step = { id, status: 'BLOCKED', exitCode: null, durationMs: 0, logFile: null, detail: blockedReason };
    steps.push(step);
    console.log(`BLOCKED ${id}: ${blockedReason}`);
    return step;
  }
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 100 * 1024 * 1024
  });
  const logFile = path.join(outputDir, `${id}.log`);
  fs.writeFileSync(logFile, `${result.stdout || ''}${result.stderr || ''}`);
  const status = result.status === 0 ? 'PASS' : 'FAIL';
  const step = {
    id,
    status,
    exitCode: result.status,
    signal: result.signal || null,
    durationMs: Date.now() - startedAt,
    logFile: path.relative(root, logFile),
    detail: status === 'PASS' ? 'Etapa aprovada.' : `Comando encerrou com código ${result.status}.`
  };
  steps.push(step);
  console.log(`${status} ${id} (${step.durationMs} ms)`);
  return step;
};

run({ id: 'dependency-lock', command: process.execPath, commandArgs: ['scripts/check-dependency-lock.js'] });
run({ id: 'app06-smoke', command: npm, commandArgs: ['run', 'app06:smoke'] });
run({ id: 'catalog-trust-contracts', command: process.execPath, commandArgs: ['scripts/check-catalog-trust-chain.js'] });
run({ id: 'catalog-trust-harness', command: process.execPath, commandArgs: ['scripts/run-app18-runtime-harness.js'] });
run({
  id: 'typecheck',
  command: npm,
  commandArgs: ['run', 'typecheck'],
  blockedReason: dependenciesReady ? null : 'Dependências integrais ausentes ou incompletas; execute npm run app07:dependencies:install em um registry completo.'
});
run({
  id: 'jest',
  command: npm,
  commandArgs: ['run', 'test:ci'],
  blockedReason: dependenciesReady ? null : 'Jest e dependências da aplicação não estão instalados integralmente.'
});
run({
  id: 'native-gate',
  command: process.execPath,
  commandArgs: ['scripts/run-app06-native-gate.js', ...(executeNative ? ['--execute'] : []), '--allow-blocked']
});

let nativeEvidence = null;
const nativeReportPath = path.join(root, 'artifacts/app06-native-gate.json');
if (fs.existsSync(nativeReportPath)) {
  const nativeReport = readJson(nativeReportPath);
  const nativeStep = steps.find((entry) => entry.id === 'native-gate');
  if (nativeReport.status === 'BLOCKED') {
    nativeStep.status = 'BLOCKED';
    nativeStep.detail = nativeReport.remediation?.join(' | ') || 'Gate nativo bloqueado.';
  } else if (nativeReport.status !== 'PASS') {
    nativeStep.status = nativeReport.status === 'READY' && !executeNative ? 'BLOCKED' : 'FAIL';
    nativeStep.detail = `Gate nativo retornou ${nativeReport.status}.`;
  }
  const nativeArtifacts = nativeReport.execution?.artifacts || {};
  nativeEvidence = {
    reportPath: path.relative(root, nativeReportPath),
    status: nativeReport.status,
    device: nativeReport.checks?.find((entry) => entry.id === 'android-device')?.detail || null,
    appInstalled: nativeReport.checks?.find((entry) => entry.id === 'app-installed')?.status === 'PASS',
    appVersionMatches: nativeReport.checks?.find((entry) => entry.id === 'app-version')?.status === 'PASS',
    installedVersion: nativeReport.installedVersion || null,
    expectedAndroid: nativeReport.expectedAndroid || null,
    maestroExecution: nativeReport.execution || null,
    junitPath: nativeArtifacts.junit || null,
    logcatPath: nativeArtifacts.logcat || null,
    screenshotPath: nativeArtifacts.screenshot || null,
    testOutputPath: nativeArtifacts.testOutput || null,
    artifacts: {
      junit: artifactDescriptor(nativeArtifacts.junit),
      logcat: artifactDescriptor(nativeArtifacts.logcat),
      screenshot: artifactDescriptor(nativeArtifacts.screenshot)
    }
  };
}

const hasFailure = steps.some((entry) => entry.status === 'FAIL');
const hasBlocked = steps.some((entry) => entry.status === 'BLOCKED');
const status = hasFailure ? 'FAIL' : hasBlocked ? 'BLOCKED' : 'PASS';
const source = computeSourceFingerprint(root);
const unsignedReport = {
  schemaVersion: 'dnd-combat-app07-release-gate.v1',
  status,
  generatedAt,
  executeNativeRequested: executeNative,
  source: { ...source, gitSha: getGitSha(root) },
  environment: {
    node: process.version,
    npm: spawnSync(npm, ['--version'], { encoding: 'utf8' }).stdout?.trim() || null,
    platform: process.platform,
    arch: process.arch,
    dependenciesReady
  },
  steps,
  nativeEvidence,
  remediation: steps.filter((entry) => entry.status !== 'PASS').map((entry) => entry.detail)
};
const report = withEvidenceDigest(unsignedReport);
writeJson(reportPath, report);
console.log(`Relatório: ${path.relative(root, reportPath)}`);
console.log(`Status: ${status}`);
if (status === 'FAIL' || (status === 'BLOCKED' && !allowBlocked)) process.exit(1);
