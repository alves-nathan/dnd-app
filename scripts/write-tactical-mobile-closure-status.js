#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  listAndroidDevices,
  resolveAdb,
  resolveMaestro,
  resolveXcrun
} = require('./lib/mobile-tools');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const maestro = resolveMaestro();
const adb = resolveAdb();
const xcrun = resolveXcrun();
const latestAndroidRunFile = path.join(root, 'artifacts', 'tactical-mobile-closure', 'android-latest.json');
let latestAndroidRun;
if (fs.existsSync(latestAndroidRunFile)) {
  try { latestAndroidRun = JSON.parse(fs.readFileSync(latestAndroidRunFile, 'utf8')); }
  catch { latestAndroidRun = { status: 'invalid-json' }; }
}
let androidDevices = [];
let androidDeviceError;
if (adb) {
  try { androidDevices = listAndroidDevices(adb); }
  catch (error) { androidDeviceError = error instanceof Error ? error.message : String(error); }
}
const evidence = (platform) => {
  const file = path.join(root, 'artifacts', 'beta-evidence', `${platform}.json`);
  if (!fs.existsSync(file)) return { status: 'missing', path: path.relative(root, file) };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { status: parsed.schemaVersion === 'dnd-combat-beta-native-evidence.v3' ? 'present-v3' : 'present-non-v3', path: path.relative(root, file), schemaVersion: parsed.schemaVersion };
  } catch (error) {
    return { status: 'invalid-json', path: path.relative(root, file), error: error instanceof Error ? error.message : String(error) };
  }
};
const projectId = app?.expo?.extra?.eas?.projectId;
const androidBlockers = [];
if (!maestro) androidBlockers.push('Maestro CLI não encontrado.');
if (!adb) androidBlockers.push('adb não encontrado.');
else if (androidDeviceError) androidBlockers.push(`Falha ao consultar adb: ${androidDeviceError}`);
else if (!androidDevices.some((entry) => entry.status === 'device')) androidBlockers.push('Nenhum dispositivo/emulador Android autorizado e conectado.');
const iosBlockers = [];
if (!maestro) iosBlockers.push('Maestro CLI não encontrado.');
if (process.platform !== 'darwin') iosBlockers.push('Execução iOS local exige macOS.');
if (!xcrun) iosBlockers.push('xcrun não encontrado.');
const report = {
  schemaVersion: 'dnd-combat-tactical-mobile-closure-status.v1',
  generatedAt: new Date().toISOString(),
  localAudit: fs.existsSync(path.join(root, 'artifacts', 'tactical-mobile-closure-audit.json')) ? 'available' : 'not-run',
  easProject: { configured: Boolean(projectId), projectId: projectId || null },
  android: {
    status: androidBlockers.length ? 'blocked' : 'ready-to-run',
    maestro: maestro || null,
    adb: adb || null,
    devices: androidDevices,
    blockers: androidBlockers,
    automatedClosure: latestAndroidRun || { status: 'not-run' },
    evidence: evidence('android')
  },
  ios: {
    status: iosBlockers.length ? 'blocked' : 'ready-to-run',
    hostPlatform: process.platform,
    maestro: maestro || null,
    xcrun: xcrun || null,
    blockers: iosBlockers,
    evidence: evidence('ios')
  },
  betaPromotion: {
    status: 'pending-native-evidence',
    requiredEvidenceSchema: 'dnd-combat-beta-native-evidence.v3'
  }
};
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'tactical-mobile-closure-status.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Tactical mobile closure status written — Android ${report.android.status}; iOS ${report.ios.status}; EAS project ${report.easProject.configured ? 'configured' : 'missing'}.`);
