#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listAndroidDevices, resolveAdb, resolveMaestro } = require('./lib/mobile-tools');
const { parseJUnitSummary, writeJson } = require('./lib/mobile-test-session');
const { TACTICAL_MOBILE_CLOSURE_FLOWS, tacticalMobileClosureArtifactRoot } = require('./lib/tactical-mobile-closure');

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const platform = option('platform') || 'android';
const serialArg = option('serial');
const runId = option('run-id') || new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

const fail = (message, details = {}) => {
  const artifactRoot = path.join(root, tacticalMobileClosureArtifactRoot(platform), runId);
  const blocked = {
    schemaVersion: 'dnd-combat-tactical-mobile-closure-native.v1',
    generatedAt: new Date().toISOString(),
    platform,
    runId,
    status: 'blocked',
    message,
    ...details
  };
  writeJson(path.join(artifactRoot, 'result.json'), blocked);
  if (platform === 'android') writeJson(path.join(root, 'artifacts', 'tactical-mobile-closure', 'android-latest.json'), {
    ...blocked,
    artifactDir: path.relative(root, artifactRoot).split(path.sep).join('/')
  });
  console.error(`ERRO: ${message}`);
  process.exit(2);
};

if (platform !== 'android') fail('Este runner desta etapa valida Android. Use a pipeline iOS em macOS para VoiceOver.');
for (const flow of TACTICAL_MOBILE_CLOSURE_FLOWS) {
  if (!fs.existsSync(path.join(root, flow))) fail(`Flow ausente: ${flow}`);
}

const maestro = resolveMaestro();
if (!maestro) fail('Maestro CLI não encontrado. Configure MAESTRO_PATH, PATH ou instale em ~/.maestro/bin.');
const adb = resolveAdb();
if (!adb) fail('adb não encontrado. Configure ADB_PATH/ANDROID_SDK_ROOT ou disponibilize platform-tools.');

let devices;
try { devices = listAndroidDevices(adb); }
catch (error) { fail(`Falha ao consultar adb: ${error.message}`, { maestro, adb }); }
const authorized = devices.filter((entry) => entry.status === 'device');
const serial = serialArg || process.env.ANDROID_SERIAL || authorized[0]?.serial;
if (!serial) fail('Nenhum dispositivo/emulador Android autorizado e conectado.', { maestro, adb, devices });
if (!authorized.some((entry) => entry.serial === serial)) fail(`Dispositivo Android não disponível: ${serial}`, { maestro, adb, devices });

const artifactRoot = path.join(root, tacticalMobileClosureArtifactRoot(platform), runId);
fs.mkdirSync(artifactRoot, { recursive: true });
const env = {
  ...process.env,
  ANDROID_SERIAL: serial,
  E2E_ARTIFACT_DIR: artifactRoot,
  MAESTRO_INCLUDE_TAGS: 'tactical-mobile-closure',
  MAESTRO_PATH: maestro,
  ADB_PATH: adb
};
const execution = spawnSync('bash', ['scripts/e2e/run-maestro-with-artifacts.sh', 'android', '.maestro/flows'], {
  cwd: root,
  env,
  stdio: 'inherit'
});
const junitFile = path.join(artifactRoot, 'junit.xml');
const junit = fs.existsSync(junitFile)
  ? parseJUnitSummary(fs.readFileSync(junitFile, 'utf8'))
  : { tests: 0, failures: 0, errors: 0, skipped: 0, passed: false };
const status = execution.status === 0 && junit.passed && junit.tests >= TACTICAL_MOBILE_CLOSURE_FLOWS.length ? 'pass' : 'fail';
const result = {
  schemaVersion: 'dnd-combat-tactical-mobile-closure-native.v1',
  generatedAt: new Date().toISOString(),
  platform,
  runId,
  status,
  deviceSerial: serial,
  maestro,
  adb,
  maestroHost: process.env.MAESTRO_HOST || null,
  adbServerSocket: process.env.ADB_SERVER_SOCKET || null,
  flows: TACTICAL_MOBILE_CLOSURE_FLOWS,
  junit,
  exitCode: execution.status,
  manualAccessibility: 'pending',
  betaEvidenceV3: 'not-created-by-this-runner'
};
writeJson(path.join(artifactRoot, 'result.json'), result);
writeJson(path.join(root, 'artifacts', 'tactical-mobile-closure', 'android-latest.json'), {
  ...result,
  artifactDir: path.relative(root, artifactRoot).split(path.sep).join('/')
});
console.log(`Tactical mobile closure Android ${status.toUpperCase()} — ${junit.tests} teste(s); artefatos: ${path.relative(root, artifactRoot)}`);
if (status !== 'pass') process.exit(1);
