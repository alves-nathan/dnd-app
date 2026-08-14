#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listAndroidDevices, resolveAdb } = require('./lib/mobile-tools');
const {
  PERFORMANCE_SCHEMA,
  evaluatePerformance,
  loadJson,
  parseAndroidAmStart,
  parseAndroidGfxInfo,
  parseAndroidMeminfo,
  writeJson
} = require('./lib/mobile-test-session');

const root = process.cwd();
const args = process.argv.slice(2);
const readOption = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const sessionArg = readOption('session');
const serialArg = readOption('serial');

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', ...options });
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(`${command} ${commandArgs.join(' ')} falhou:\n${String(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
};

try {
  if (!sessionArg) throw new Error('--session é obrigatório.');
  const sessionDir = path.resolve(root, sessionArg);
  const sessionFile = path.join(sessionDir, 'session.json');
  const session = loadJson(sessionFile);
  if (session.platform !== 'android') throw new Error('A sessão não é Android.');
  const adb = resolveAdb();
  if (!adb) throw new Error('adb não encontrado. Configure ADB_PATH ou ANDROID_SDK_ROOT.');
  const devices = listAndroidDevices(adb).filter((entry) => entry.status === 'device');
  const serial = serialArg || process.env.ANDROID_SERIAL || devices[0]?.serial;
  if (!serial) throw new Error('Nenhum dispositivo Android autorizado.');
  if (!devices.some((entry) => entry.serial === serial)) throw new Error(`Dispositivo não encontrado: ${serial}`);

  const binary = path.isAbsolute(session.binary.location)
    ? session.binary.location
    : path.join(root, session.binary.location);
  const env = { ...process.env, ANDROID_SERIAL: serial, E2E_ARTIFACT_DIR: path.join(sessionDir, 'maestro') };
  const adbArgs = (...values) => ['-s', serial, ...values];

  run(adb, adbArgs('install', '-r', binary));
  run(adb, adbArgs('logcat', '-c'), { allowFailure: true });
  run(adb, adbArgs('shell', 'am', 'force-stop', session.packageId), { allowFailure: true });
  const start = run(adb, adbArgs('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'dndcombatmath://beta-runtime', session.packageId));
  fs.writeFileSync(path.join(sessionDir, 'performance', 'am-start.txt'), `${start.stdout || ''}\n${start.stderr || ''}`);

  const maestro = spawnSync('bash', ['scripts/e2e/run-maestro-with-artifacts.sh', 'android'], { cwd: root, env, stdio: 'inherit' });
  const meminfo = run(adb, adbArgs('shell', 'dumpsys', 'meminfo', session.packageId), { allowFailure: true });
  const gfxinfo = run(adb, adbArgs('shell', 'dumpsys', 'gfxinfo', session.packageId), { allowFailure: true });
  const deviceInfo = run(adb, adbArgs('shell', 'getprop'), { allowFailure: true });
  fs.writeFileSync(path.join(sessionDir, 'performance', 'meminfo.txt'), String(meminfo.stdout || meminfo.stderr || ''));
  fs.writeFileSync(path.join(sessionDir, 'performance', 'gfxinfo.txt'), String(gfxinfo.stdout || gfxinfo.stderr || ''));
  fs.writeFileSync(path.join(sessionDir, 'performance', 'device-properties.txt'), String(deviceInfo.stdout || deviceInfo.stderr || ''));

  const metrics = {
    coldStartMs: parseAndroidAmStart(start.stdout).totalTimeMs,
    peakMemoryMb: parseAndroidMeminfo(meminfo.stdout).peakMemoryMb,
    droppedFramesPercent: parseAndroidGfxInfo(gfxinfo.stdout).droppedFramesPercent
  };
  const evaluated = evaluatePerformance(metrics);
  const performance = {
    schemaVersion: PERFORMANCE_SCHEMA,
    platform: 'android',
    generatedAt: new Date().toISOString(),
    status: evaluated.status,
    metrics,
    thresholds: evaluated.thresholds,
    issues: evaluated.issues,
    notes: 'Cold start, PSS e gfxinfo coletados automaticamente. O benchmark SQLite interno é validado pelo fluxo Maestro dedicado.'
  };
  writeJson(path.join(sessionDir, 'performance', 'report.json'), performance);

  session.status = maestro.status === 0 && evaluated.status === 'pass' ? 'awaitingManualReview' : 'needsReview';
  session.updatedAt = new Date().toISOString();
  session.deviceSerial = serial;
  session.automated = {
    e2e: maestro.status === 0 ? 'pass' : 'fail',
    performance: evaluated.status
  };
  writeJson(sessionFile, session);
  console.log(`Sessão atualizada: ${path.relative(root, sessionDir)}`);
  if (maestro.status !== 0 || evaluated.status !== 'pass') process.exit(1);
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
