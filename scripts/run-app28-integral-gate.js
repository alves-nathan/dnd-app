#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  artifactDescriptor,
  computeSourceFingerprint,
  getGitSha,
  sha256File,
  withEvidenceDigest
} = require('./lib/app28-integral-gate-evidence');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const values = (name) => args.flatMap((value, index) => value === `--${name}` && args[index + 1] ? [args[index + 1]] : []);
const allowBlocked = has('allow-blocked');
const executeNative = has('execute-native');
const skipInstall = has('skip-install');
const outputDir = path.join(root, 'artifacts/app28-integral-gate');
const reportPath = path.join(root, 'artifacts/app28-integral-gate.json');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
fs.mkdirSync(outputDir, { recursive: true });

const requiredDependencies = [
  'node_modules/expo/package.json',
  'node_modules/react/package.json',
  'node_modules/react-native/package.json',
  'node_modules/zustand/package.json',
  'node_modules/zod/package.json',
  `node_modules/.bin/${process.platform === 'win32' ? 'tsc.cmd' : 'tsc'}`,
  `node_modules/.bin/${process.platform === 'win32' ? 'jest.cmd' : 'jest'}`
];
const dependenciesReady = () => requiredDependencies.every((relative) => fs.existsSync(path.join(root, relative)));
const steps = [];

const run = ({ id, command, commandArgs, blockedReason = null, env = {} }) => {
  if (blockedReason) {
    const step = { id, status: 'BLOCKED', durationMs: 0, exitCode: null, logFile: null, detail: blockedReason };
    steps.push(step);
    console.log(`BLOCKED ${id}: ${blockedReason}`);
    return step;
  }
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 192 * 1024 * 1024
  });
  const logPath = path.join(outputDir, `${id}.log`);
  fs.writeFileSync(logPath, `${result.stdout || ''}${result.stderr || ''}`);
  const status = result.status === 0 ? 'PASS' : 'FAIL';
  const step = {
    id,
    status,
    durationMs: Date.now() - startedAt,
    exitCode: result.status,
    signal: result.signal || null,
    logFile: path.relative(root, logPath),
    detail: status === 'PASS' ? 'Etapa aprovada.' : `Comando encerrou com código ${result.status}.`
  };
  steps.push(step);
  console.log(`${status} ${id} (${step.durationMs} ms)`);
  return step;
};

if (dependenciesReady()) {
  steps.push({ id: 'dependency-install', status: 'PASS', durationMs: 0, exitCode: 0, logFile: null, detail: 'Árvore de dependências já está completa.' });
} else if (skipInstall) {
  const installReportPath = path.join(root, 'artifacts/app28-dependency-install.json');
  if (fs.existsSync(installReportPath)) {
    const installReport = JSON.parse(fs.readFileSync(installReportPath, 'utf8'));
    steps.push({
      id: 'dependency-install',
      status: installReport.status === 'PASS' ? 'PASS' : installReport.status === 'FAIL' ? 'FAIL' : 'BLOCKED',
      durationMs: 0,
      exitCode: null,
      logFile: path.relative(root, installReportPath),
      detail: `${installReport.classification}: ${installReport.remediation || 'Relatório de instalação reutilizado.'}`
    });
  } else {
    steps.push({ id: 'dependency-install', status: 'BLOCKED', durationMs: 0, exitCode: null, logFile: null, detail: 'Instalação ignorada e árvore de dependências ausente.' });
  }
} else {
  const installArgs = ['scripts/install-app28-dependencies.js', '--allow-blocked'];
  for (const registry of values('registry')) installArgs.push('--registry', registry);
  const cache = values('cache')[0];
  if (cache) installArgs.push('--cache', cache);
  const step = run({ id: 'dependency-install', command: process.execPath, commandArgs: installArgs });
  const installReportPath = path.join(root, 'artifacts/app28-dependency-install.json');
  if (fs.existsSync(installReportPath)) {
    const installReport = JSON.parse(fs.readFileSync(installReportPath, 'utf8'));
    step.status = installReport.status;
    step.detail = installReport.status === 'PASS'
      ? installReport.classification
      : `${installReport.classification}: ${installReport.remediation || 'Instalação não concluída.'}`;
  }
}

run({ id: 'dependency-lock', command: process.execPath, commandArgs: ['scripts/check-dependency-lock.js'] });
run({ id: 'app27-regression', command: process.execPath, commandArgs: ['scripts/run-app27-linear-regression.js'] });
run({
  id: 'full-typecheck',
  command: npm,
  commandArgs: ['run', 'typecheck'],
  blockedReason: dependenciesReady() ? null : 'Dependências integrais ausentes; o typecheck completo não pode carregar Expo, React e tipos do projeto.'
});
run({
  id: 'full-jest',
  command: npm,
  commandArgs: ['run', 'test:ci'],
  blockedReason: dependenciesReady() ? null : 'Jest e a árvore completa de dependências não estão instalados.'
});
run({
  id: 'native-gate',
  command: process.execPath,
  commandArgs: ['scripts/run-app06-native-gate.js', ...(executeNative ? ['--execute'] : []), '--allow-blocked']
});

let nativeEvidence = null;
const nativePath = path.join(root, 'artifacts/app06-native-gate.json');
if (fs.existsSync(nativePath)) {
  const native = JSON.parse(fs.readFileSync(nativePath, 'utf8'));
  const nativeStep = steps.find((step) => step.id === 'native-gate');
  if (native.status === 'BLOCKED' || native.status === 'READY') {
    nativeStep.status = 'BLOCKED';
    nativeStep.detail = native.remediation?.join(' | ') || `Gate nativo retornou ${native.status}.`;
  } else if (native.status !== 'PASS') {
    nativeStep.status = 'FAIL';
    nativeStep.detail = `Gate nativo retornou ${native.status}.`;
  }
  const artifacts = native.execution?.artifacts || {};
  nativeEvidence = {
    status: native.status,
    flowCount: Array.isArray(native.flows) ? native.flows.length : 0,
    expectedAndroid: native.expectedAndroid || null,
    installedVersion: native.installedVersion || null,
    appVersionMatches: native.checks?.some((entry) => entry.id === 'app-version' && entry.status === 'PASS') || false,
    device: native.checks?.find((entry) => entry.id === 'android-device')?.detail || null,
    report: artifactDescriptor(root, path.relative(root, nativePath)),
    artifacts: {
      junit: artifactDescriptor(root, artifacts.junit),
      logcat: artifactDescriptor(root, artifacts.logcat),
      screenshot: artifactDescriptor(root, artifacts.screenshot),
      maestroLog: artifactDescriptor(root, artifacts.maestroLog)
    }
  };
}

const hasFailure = steps.some((step) => step.status === 'FAIL');
const hasBlocked = steps.some((step) => step.status === 'BLOCKED');
const source = computeSourceFingerprint(root);
const unsigned = {
  schemaVersion: 'dnd-combat-app28-integral-gate.v1',
  status: hasFailure ? 'FAIL' : hasBlocked ? 'BLOCKED' : 'PASS',
  generatedAt: new Date().toISOString(),
  executeNativeRequested: executeNative,
  source: {
    ...source,
    gitSha: getGitSha(root),
    packageLockSha256: sha256File(path.join(root, 'package-lock.json'))
  },
  environment: {
    node: process.version,
    npm: spawnSync(npm, ['--version'], { encoding: 'utf8' }).stdout?.trim() || null,
    platform: process.platform,
    arch: process.arch,
    dependenciesReady: dependenciesReady()
  },
  steps,
  nativeEvidence,
  remediation: steps.filter((step) => step.status !== 'PASS').map((step) => ({ id: step.id, detail: step.detail }))
};
const report = withEvidenceDigest(unsigned);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, evidenceSha256: report.evidenceSha256, report: path.relative(root, reportPath) }, null, 2));
if (report.status === 'FAIL' || (report.status === 'BLOCKED' && !allowBlocked)) process.exit(1);
