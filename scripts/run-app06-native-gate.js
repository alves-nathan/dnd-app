#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listAndroidDevices, resolveAdb, resolveMaestro, runTool } = require('./lib/mobile-tools');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const allowBlocked = args.has('--allow-blocked');
const execute = args.has('--execute');
const generatedAt = new Date().toISOString();
const reportPath = path.join(root, 'artifacts/app06-native-gate.json');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const expectedAndroid = {
  packageName: appConfig.android?.package || 'com.nalves.dndcombatmathmvp',
  versionName: String(appConfig.version || ''),
  versionCode: String(appConfig.android?.versionCode || '')
};
const flows = [
  '.maestro/flows/08-progression-recovery-commit.yaml',
  '.maestro/flows/09-progression-recovery-discard.yaml',
  '.maestro/flows/10-progression-recovery-conflict.yaml',
  '.maestro/flows/11-progression-rollback.yaml',
  '.maestro/flows/12-remediation-plan-create.yaml',
  '.maestro/flows/13-remediation-plan-discard.yaml',
  '.maestro/flows/14-remediation-plan-commit.yaml',
  '.maestro/flows/15-remediation-plan-rollback.yaml',
  '.maestro/flows/16-catalog-impact-preview.yaml',
  '.maestro/flows/17-catalog-impact-cancel.yaml',
  '.maestro/flows/18-catalog-impact-remediation.yaml',
  '.maestro/flows/19-catalog-history-view.yaml',
  '.maestro/flows/20-catalog-history-restore-cancel.yaml',
  '.maestro/flows/21-catalog-history-restore-commit.yaml',
  '.maestro/flows/22-catalog-history-plan-revalidation.yaml',
  '.maestro/flows/23-portable-backup-export.yaml',
  '.maestro/flows/24-portable-backup-import-preview.yaml',
  '.maestro/flows/25-portable-backup-import-cancel.yaml',
  '.maestro/flows/26-portable-backup-conflict.yaml',
  '.maestro/flows/27-portable-restore-session-preview-discard.yaml',
  '.maestro/flows/28-portable-restore-session-resume.yaml',
  '.maestro/flows/29-portable-restore-session-commit.yaml',
  '.maestro/flows/30-portable-restore-session-rollback.yaml',
  '.maestro/flows/31-portable-restore-verification-divergence.yaml',
  '.maestro/flows/32-portable-restore-verification-correction.yaml',
  '.maestro/flows/33-portable-restore-verification-accept.yaml',
  '.maestro/flows/34-portable-restore-receipt-reopen-rollback.yaml',
  '.maestro/flows/35-evidence-center-import.yaml',
  '.maestro/flows/36-evidence-center-tampering.yaml',
  '.maestro/flows/37-evidence-center-comparison.yaml',
  '.maestro/flows/38-evidence-center-cleanup.yaml',
  '.maestro/flows/39-catalog-update-preview.yaml',
  '.maestro/flows/40-catalog-update-cancel.yaml',
  '.maestro/flows/41-catalog-update-commit.yaml',
  '.maestro/flows/42-catalog-update-rollback.yaml',
  '.maestro/flows/43-catalog-signature-valid.yaml',
  '.maestro/flows/44-catalog-signature-invalid.yaml',
  '.maestro/flows/45-catalog-key-revoked.yaml',
  '.maestro/flows/46-catalog-trust-rollback.yaml',
  '.maestro/flows/47-catalog-transparency-inconsistency.yaml',
  '.maestro/flows/48-catalog-transparency-omission.yaml',
  '.maestro/flows/49-catalog-trust-quorum-recovery.yaml',
  '.maestro/flows/50-catalog-secure-update-manifest.yaml',
  '.maestro/flows/51-catalog-download-interruption.yaml',
  '.maestro/flows/52-catalog-download-resume.yaml',
  '.maestro/flows/53-catalog-mirror-conflict.yaml',
  '.maestro/flows/54-catalog-offline-update.yaml',
  '.maestro/flows/55-catalog-channel-migration.yaml',
  '.maestro/flows/56-catalog-rollout-eligibility.yaml',
  '.maestro/flows/57-catalog-publication-paused.yaml',
  '.maestro/flows/58-catalog-publication-withdrawn.yaml',
  '.maestro/flows/59-rollout-health-opt-in.yaml',
  '.maestro/flows/60-rollout-health-unhealthy.yaml',
  '.maestro/flows/61-rollout-health-promotion.yaml',
  '.maestro/flows/62-rollout-health-rollback.yaml',
  '.maestro/flows/63-rollout-aggregation-export.yaml',
  '.maestro/flows/64-rollout-aggregation-anonymity.yaml',
  '.maestro/flows/65-rollout-quorum-pending.yaml',
  '.maestro/flows/66-rollout-quorum-approved.yaml',
  '.maestro/flows/67-operational-authorization-import.yaml',
  '.maestro/flows/68-operational-executor-confirmation.yaml',
  '.maestro/flows/69-operational-human-confirmation.yaml',
  '.maestro/flows/70-operational-replay-protection.yaml',
  '.maestro/flows/71-operational-interrupted-recovery.yaml',
  '.maestro/flows/72-operational-reconciliation-drift.yaml',
  '.maestro/flows/73-operational-recovery-authorization.yaml',
  '.maestro/flows/74-operational-journal-close-archive.yaml',
  '.maestro/flows/75-operational-audit-export.yaml',
  '.maestro/flows/76-operational-audit-tampering.yaml',
  '.maestro/flows/77-operational-audit-missing-segment.yaml',
  '.maestro/flows/78-operational-audit-approved.yaml',
  '.maestro/flows/79-operational-federation-approved.yaml',
  '.maestro/flows/80-operational-federation-quorum-missing.yaml',
  '.maestro/flows/81-operational-federation-fork.yaml',
  '.maestro/flows/82-operational-federation-compare.yaml',
  '.maestro/flows/83-release-candidate-overview.yaml',
  '.maestro/flows/84-release-candidate-migrations.yaml',
  '.maestro/flows/85-release-candidate-performance-security.yaml',
  '.maestro/flows/86-release-candidate-app28-block.yaml',
  '.maestro/flows/87-production-release-overview.yaml',
  '.maestro/flows/88-production-release-gates.yaml',
  '.maestro/flows/89-production-release-build.yaml',
  '.maestro/flows/90-production-release-publication.yaml'
];
const checks = [];
const add = (id, status, detail, metadata) => checks.push({ id, status, detail, ...(metadata ? { metadata } : {}) });

const parsePackageVersion = (output) => {
  const text = String(output || '');
  const versionName = text.match(/\bversionName=([^\s]+)/)?.[1] || null;
  const versionCode = text.match(/\bversionCode=(\d+)/)?.[1] || null;
  return { versionName, versionCode };
};

for (const flow of flows) {
  const exists = fs.existsSync(path.join(root, flow));
  add(`flow:${flow}`, exists ? 'PASS' : 'FAIL', exists ? 'Arquivo encontrado.' : 'Arquivo ausente.');
}

const dependencyFiles = [
  'node_modules/expo/package.json',
  'node_modules/react/package.json',
  'node_modules/react-native/package.json',
  'node_modules/zustand/package.json',
  'node_modules/zod/package.json'
];
const dependenciesReady = dependencyFiles.every((relativePath) => fs.existsSync(path.join(root, relativePath)));
add('dependencies', dependenciesReady ? 'PASS' : 'BLOCKED', dependenciesReady
  ? 'Dependências integrais disponíveis.'
  : 'Dependências integrais ausentes ou incompletas; a build/dev client não pode ser iniciada neste ambiente.');

const adb = resolveAdb();
if (!adb) add('adb', 'BLOCKED', 'adb não encontrado. Configure ADB_PATH ou ANDROID_SDK_ROOT.');
else add('adb', 'PASS', adb);
const maestro = resolveMaestro();
if (!maestro) add('maestro', 'BLOCKED', 'Maestro CLI não encontrado. Configure MAESTRO_PATH.');
else add('maestro', 'PASS', maestro);

let device;
let installedVersion = null;
if (adb) {
  try {
    const devices = listAndroidDevices(adb);
    device = devices.find((entry) => entry.status === 'device');
    add('android-device', device ? 'PASS' : 'BLOCKED', device ? device.serial : 'Nenhum dispositivo ou emulador Android autorizado.');
    if (device) {
      const installed = runTool(adb, ['-s', device.serial, 'shell', 'pm', 'path', expectedAndroid.packageName]);
      const appInstalled = installed.status === 0 && String(installed.stdout).includes('package:');
      add('app-installed', appInstalled ? 'PASS' : 'BLOCKED', installed.status === 0
        ? String(installed.stdout).trim() || 'Pacote não localizado.'
        : String(installed.stderr || installed.stdout).trim());
      if (appInstalled) {
        const packageDump = runTool(adb, ['-s', device.serial, 'shell', 'dumpsys', 'package', expectedAndroid.packageName]);
        installedVersion = packageDump.status === 0 ? parsePackageVersion(packageDump.stdout) : null;
        const versionMatches = Boolean(installedVersion?.versionName && installedVersion?.versionCode)
          && installedVersion.versionName === expectedAndroid.versionName
          && installedVersion.versionCode === expectedAndroid.versionCode;
        add('app-version', versionMatches ? 'PASS' : 'BLOCKED', versionMatches
          ? `${expectedAndroid.packageName} ${installedVersion.versionName} (${installedVersion.versionCode})`
          : `Build instalada ${installedVersion?.versionName || '?'} (${installedVersion?.versionCode || '?'}) diverge da esperada ${expectedAndroid.versionName} (${expectedAndroid.versionCode}).`, {
          expected: expectedAndroid,
          installed: installedVersion
        });
      }
    }
  } catch (error) {
    add('android-device', 'BLOCKED', error instanceof Error ? error.message : String(error));
  }
}

let execution;
const blockers = checks.filter((entry) => entry.status === 'BLOCKED' || entry.status === 'FAIL');
if (execute && blockers.length === 0) {
  const artifactDir = path.join(root, 'artifacts/maestro/app06-android');
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  runTool(adb, ['-s', device.serial, 'logcat', '-c']);
  const command = [
    '--platform=android', '--no-ansi', 'test', ...flows,
    '--format=JUNIT', `--output=${path.join(artifactDir, 'junit.xml')}`,
    `--test-output-dir=${path.join(artifactDir, 'test-output')}`,
    '--flatten-debug-output'
  ];
  const result = spawnSync(maestro, command, { cwd: root, encoding: 'utf8', env: process.env });
  const maestroLogPath = path.join(artifactDir, 'maestro.log');
  fs.writeFileSync(maestroLogPath, `${result.stdout || ''}${result.stderr || ''}`);

  const logcatPath = path.join(artifactDir, 'logcat.txt');
  const logcat = runTool(adb, ['-s', device.serial, 'logcat', '-d', '-v', 'threadtime']);
  fs.writeFileSync(logcatPath, `${logcat.stdout || ''}${logcat.stderr || ''}`);
  add('logcat-artifact', logcat.status === 0 ? 'PASS' : 'FAIL', logcat.status === 0 ? path.relative(root, logcatPath) : 'Falha ao capturar logcat.');

  const screenshotPath = path.join(artifactDir, 'final-screen.png');
  const screenshot = spawnSync(adb, ['-s', device.serial, 'exec-out', 'screencap', '-p'], {
    cwd: root,
    encoding: null,
    env: process.env,
    maxBuffer: 25 * 1024 * 1024
  });
  const png = Buffer.isBuffer(screenshot.stdout) ? screenshot.stdout : Buffer.alloc(0);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const screenshotValid = screenshot.status === 0 && png.length > pngSignature.length && png.subarray(0, 8).equals(pngSignature);
  if (screenshotValid) fs.writeFileSync(screenshotPath, png);
  add('screenshot-artifact', screenshotValid ? 'PASS' : 'FAIL', screenshotValid ? path.relative(root, screenshotPath) : 'Falha ao capturar screenshot final.');

  const junitPath = path.join(artifactDir, 'junit.xml');
  const junitExists = fs.existsSync(junitPath) && fs.statSync(junitPath).size > 0;
  add('junit-artifact', junitExists ? 'PASS' : 'FAIL', junitExists ? path.relative(root, junitPath) : 'JUnit não foi gerado.');

  execution = {
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    artifactDir,
    artifacts: {
      junit: junitExists ? path.relative(root, junitPath) : null,
      maestroLog: path.relative(root, maestroLogPath),
      logcat: logcat.status === 0 ? path.relative(root, logcatPath) : null,
      screenshot: screenshotValid ? path.relative(root, screenshotPath) : null,
      testOutput: fs.existsSync(path.join(artifactDir, 'test-output')) ? path.relative(root, path.join(artifactDir, 'test-output')) : null
    }
  };
  add('maestro-execution', execution.status, `exitCode=${result.status}`);
} else if (execute) {
  execution = { status: 'BLOCKED', reason: 'Pré-requisitos nativos indisponíveis.' };
} else {
  execution = { status: 'NOT_RUN', reason: `Use --execute para executar os ${flows.length} fluxos transacionais no dispositivo conectado.` };
}

const finalBlockers = checks.filter((entry) => entry.status === 'BLOCKED' || entry.status === 'FAIL');
const status = checks.some((entry) => entry.status === 'FAIL') || execution.status === 'FAIL'
  ? 'FAIL'
  : finalBlockers.length
    ? 'BLOCKED'
    : execution.status === 'PASS'
      ? 'PASS'
      : 'READY';
const report = {
  schemaVersion: 'dnd-combat-app06-native-gate.v2',
  status,
  generatedAt,
  executeRequested: execute,
  expectedAndroid,
  installedVersion,
  checks,
  flows,
  execution,
  remediation: finalBlockers.map((entry) => entry.detail)
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status === 'FAIL' || (status === 'BLOCKED' && !allowBlocked)) process.exit(1);
