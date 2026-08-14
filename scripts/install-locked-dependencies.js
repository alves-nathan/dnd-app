#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeJson } = require('./lib/app07-release-evidence');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const allowBlocked = args.includes('--allow-blocked');
const valueOf = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const registry = valueOf('registry') || process.env.NPM_CONFIG_REGISTRY || null;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const reportPath = path.join(root, 'artifacts/app07-dependency-install.json');
const logPath = path.join(root, 'artifacts/app07-dependency-install.log');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const commandArgs = ['ci', '--no-audit', '--fund=false'];
if (registry) commandArgs.push(`--registry=${registry}`);
const startedAt = Date.now();
const result = spawnSync(npm, commandArgs, {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
  timeout: Number(process.env.APP07_NPM_CI_TIMEOUT_MS || 300000),
  maxBuffer: 100 * 1024 * 1024
});
const output = `${result.stdout || ''}${result.stderr || ''}`;
fs.writeFileSync(logPath, output);

let classification = 'COMMAND_FAILED';
let status = result.status === 0 ? 'PASS' : 'FAIL';
let remediation = null;
const missingPackages = [...output.matchAll(/(?:GET\s+[^\s]+\/|')(@?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)(?:\/-\/|@)/g)]
  .map((match) => match[1])
  .filter((value, index, values) => values.indexOf(value) === index);
if (result.status === 0) classification = 'INSTALLED';
else if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
  classification = 'REGISTRY_TIMEOUT';
  status = 'BLOCKED';
  remediation = 'O registry não respondeu dentro do limite. Verifique DNS, proxy e acesso ao registry configurado.';
} else if (/\bE404\b|404 Not Found/i.test(output)) {
  classification = 'REGISTRY_PACKAGE_MISSING';
  status = 'BLOCKED';
  remediation = 'O registry configurado não espelha uma ou mais versões fixadas. Use um registry npm completo sem alterar o lockfile.';
} else if (/EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(output)) {
  classification = 'REGISTRY_UNREACHABLE';
  status = 'BLOCKED';
  remediation = 'Não foi possível alcançar o registry. Verifique rede, DNS e proxy.';
} else if (/ERESOLVE/i.test(output)) {
  classification = 'DEPENDENCY_RESOLUTION_FAILED';
  remediation = 'O lockfile e as restrições de peer dependency precisam ser corrigidos; não use --force para aprovar o gate.';
}

let lockVerification = null;
if (status === 'PASS') {
  const verification = spawnSync(process.execPath, ['scripts/check-dependency-lock.js'], { cwd: root, encoding: 'utf8' });
  lockVerification = { exitCode: verification.status, output: `${verification.stdout || ''}${verification.stderr || ''}`.trim() };
  if (verification.status !== 0) {
    status = 'FAIL';
    classification = 'INSTALLED_TREE_MISMATCH';
    remediation = 'A árvore instalada diverge do package-lock.json.';
  }
}

const report = {
  schemaVersion: 'dnd-combat-app07-dependency-install.v1',
  status,
  classification,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  registry: registry || 'npm-config-default',
  command: `${npm} ${commandArgs.join(' ')}`,
  exitCode: result.status,
  signal: result.signal || null,
  errorCode: result.error?.code || null,
  logFile: path.relative(root, logPath),
  lockVerification,
  missingPackages,
  remediation
};
writeJson(reportPath, report);
console.log(JSON.stringify(report, null, 2));
if (status === 'FAIL' || (status === 'BLOCKED' && !allowBlocked)) process.exit(1);
