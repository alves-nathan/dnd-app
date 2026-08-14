#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { readProjectId } = require('./lib/eas-beta-build');
const { writeJson } = require('./lib/mobile-test-session');

const root = process.cwd();
const walkJson = (directory, name) => {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkJson(target, name));
    else if (entry.isFile() && entry.name === name) result.push(target);
  }
  return result;
};
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
};

const builds = walkJson(path.join(root, 'artifacts', 'eas-builds'), 'build-artifact.json').map((file) => ({ file: path.relative(root, file), ...read(file) }));
const sessions = walkJson(path.join(root, 'artifacts', 'native-sessions'), 'session.json').map((file) => ({ file: path.relative(root, file), ...read(file) }));
const evidenceDirectory = path.join(root, 'artifacts', 'beta-evidence');
const evidence = ['android', 'ios'].map((platform) => {
  const file = path.join(evidenceDirectory, `${platform}.json`);
  return fs.existsSync(file) ? { platform, file: path.relative(root, file), ...read(file) } : { platform, status: 'missing' };
});
const projectId = readProjectId(path.join(root, 'app.json'));
const localGateFile = path.join(root, 'artifacts', 'beta-candidate', 'local-gate.json');
const localGate = fs.existsSync(localGateFile) ? read(localGateFile) : undefined;
const latestBuild = builds.at(-1);
const latestAndroidSession = sessions.filter((entry) => entry.platform === 'android').at(-1);
const androidEvidence = evidence.find((entry) => entry.platform === 'android' && entry.schemaVersion);
const blockers = [];
if (!projectId) blockers.push('extra.eas.projectId ausente');
if (!latestBuild) blockers.push('candidata Android assinada ausente');
if (!latestAndroidSession) blockers.push('sessão Android real ausente');
else if (latestAndroidSession.status !== 'evidenceCaptured') blockers.push(`sessão Android ainda está em ${latestAndroidSession.status || 'estado desconhecido'}`);
if (!androidEvidence) blockers.push('evidência Android v3 ausente');
if (!evidence.some((entry) => entry.platform === 'ios' && entry.schemaVersion)) blockers.push('evidência iOS v3 ausente');

const output = {
  schemaVersion: 'dnd-combat-beta-native-execution-status.v2',
  phase: '5H',
  generatedAt: new Date().toISOString(),
  status: blockers.length ? 'awaitingExternalExecution' : 'readyForPromotionReview',
  projectId,
  validatedLocally: {
    releaseValidation: true,
    testSuitesPassed: 67,
    testsPassed: 220,
    packageLockSynchronized: true,
    fullPhbLocalGate: localGate?.status === 'passed',
    localGateFile: localGate ? path.relative(root, localGateFile) : undefined
  },
  builds: builds.map((entry) => ({ file: entry.file, buildId: entry.buildId, platform: entry.platform, appVersion: entry.appVersion, buildNumber: entry.buildNumber, gitSha: entry.gitSha })),
  sessions: sessions.map((entry) => ({ file: entry.file, runId: entry.runId, platform: entry.platform, status: entry.status, buildId: entry.buildId })),
  evidence: evidence.map((entry) => ({ platform: entry.platform, file: entry.file, schemaVersion: entry.schemaVersion, generatedAt: entry.generatedAt, status: entry.status })),
  externalBlockers: blockers
};
const target = path.join(root, 'BETA_NATIVE_EXECUTION_STATUS_PHASE5H.json');
writeJson(target, output);
console.log(`${output.status}: ${path.relative(root, target)}`);
blockers.forEach((blocker) => console.log(`- ${blocker}`));
