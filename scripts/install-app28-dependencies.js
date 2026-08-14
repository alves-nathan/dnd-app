#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  classifyInstallOutput,
  sanitizeOutput,
  sanitizeRegistry,
  sha256File
} = require('./lib/app28-integral-gate-evidence');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const values = (name) => args.flatMap((value, index) => value === `--${name}` && args[index + 1] ? [args[index + 1]] : []);
const allowBlocked = has('allow-blocked');
const reportPath = path.join(root, 'artifacts/app28-dependency-install.json');
const logDir = path.join(root, 'artifacts/app28-dependency-install');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const timeoutMs = Number(process.env.APP28_NPM_CI_TIMEOUT_MS || 600000);
fs.mkdirSync(logDir, { recursive: true });

const required = [
  'node_modules/expo/package.json',
  'node_modules/react/package.json',
  'node_modules/react-native/package.json',
  'node_modules/zustand/package.json',
  'node_modules/zod/package.json',
  `node_modules/.bin/${process.platform === 'win32' ? 'tsc.cmd' : 'tsc'}`,
  `node_modules/.bin/${process.platform === 'win32' ? 'jest.cmd' : 'jest'}`
];
const dependenciesReady = () => required.every((relative) => fs.existsSync(path.join(root, relative)));

const registryInputs = [
  ...values('registry'),
  ...(process.env.APP28_NPM_REGISTRIES || '').split(',').map((value) => value.trim()).filter(Boolean),
  process.env.NPM_CONFIG_REGISTRY
].filter(Boolean);
const registries = [...new Set(registryInputs.map((value) => value.replace(/\/$/, '')))];
const cache = values('cache')[0] || process.env.APP28_NPM_CACHE || null;
const attempts = [];

const runAttempt = ({ id, registry, offline }) => {
  const commandArgs = ['ci', '--no-audit', '--fund=false', '--ignore-scripts=false', '--fetch-retries=0', '--fetch-timeout=10000', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=2000'];
  if (registry) commandArgs.push(`--registry=${registry}`);
  if (cache) commandArgs.push(`--cache=${path.resolve(cache)}`);
  if (offline) commandArgs.push('--offline');
  const startedAt = Date.now();
  const result = spawnSync(npm, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: timeoutMs,
    maxBuffer: 128 * 1024 * 1024
  });
  const output = sanitizeOutput(`${result.stdout || ''}${result.stderr || ''}`);
  const logPath = path.join(logDir, `${id}.log`);
  fs.writeFileSync(logPath, output);
  const classified = classifyInstallOutput({
    status: result.status,
    signal: result.signal,
    errorCode: result.error?.code,
    output
  });
  const attempt = {
    id,
    mode: offline ? 'offline-cache' : 'registry',
    registry: sanitizeRegistry(registry),
    cache: cache ? path.resolve(cache) : null,
    status: classified.status,
    classification: classified.classification,
    durationMs: Date.now() - startedAt,
    exitCode: result.status,
    signal: result.signal || null,
    errorCode: result.error?.code || null,
    logFile: path.relative(root, logPath),
    remediation: classified.remediation
  };
  attempts.push(attempt);
  return attempt;
};

let finalStatus = 'BLOCKED';
let classification = 'NO_INSTALL_SOURCE';
if (dependenciesReady()) {
  finalStatus = 'PASS';
  classification = 'ALREADY_INSTALLED';
} else {
  if (cache) {
    const attempt = runAttempt({ id: 'offline-cache', registry: registries[0] || null, offline: true });
    if (attempt.status === 'PASS' && dependenciesReady()) {
      finalStatus = 'PASS';
      classification = 'INSTALLED_FROM_CACHE';
    }
  }
  if (finalStatus !== 'PASS') {
    const candidates = registries.length ? registries : ['https://registry.npmjs.org'];
    for (let index = 0; index < candidates.length; index += 1) {
      const attempt = runAttempt({ id: `registry-${index + 1}`, registry: candidates[index], offline: false });
      if (attempt.status === 'PASS' && dependenciesReady()) {
        finalStatus = 'PASS';
        classification = 'INSTALLED_FROM_REGISTRY';
        break;
      }
      if (attempt.status === 'FAIL') {
        finalStatus = 'FAIL';
        classification = attempt.classification;
        break;
      }
      classification = attempt.classification;
    }
  }
}

let lockVerification = null;
if (finalStatus === 'PASS') {
  const result = spawnSync(process.execPath, ['scripts/check-dependency-lock.js'], { cwd: root, encoding: 'utf8' });
  lockVerification = {
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    output: sanitizeOutput(`${result.stdout || ''}${result.stderr || ''}`).trim().slice(-10000)
  };
  if (result.status !== 0) {
    finalStatus = 'FAIL';
    classification = 'INSTALLED_TREE_MISMATCH';
  }
}

const report = {
  schemaVersion: 'dnd-combat-app28-dependency-install.v1',
  status: finalStatus,
  classification,
  generatedAt: new Date().toISOString(),
  node: process.version,
  npm: spawnSync(npm, ['--version'], { encoding: 'utf8' }).stdout?.trim() || null,
  packageLockSha256: sha256File(path.join(root, 'package-lock.json')),
  dependenciesReady: dependenciesReady(),
  requiredFiles: required,
  attempts,
  lockVerification,
  remediation: finalStatus === 'PASS'
    ? null
    : 'Execute este comando em um ambiente com acesso a um registry npm completo ou forneça APP28_NPM_CACHE com um cache previamente aquecido para este package-lock.json.'
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (finalStatus === 'FAIL' || (finalStatus === 'BLOCKED' && !allowBlocked)) process.exit(1);
