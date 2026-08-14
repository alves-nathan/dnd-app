#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  loadJson,
  parseJUnitSummary,
  validateChecklist,
  writeJson
} = require('./lib/mobile-test-session');
const { sha256Path } = require('./lib/beta-native-evidence');

const root = process.cwd();
const args = process.argv.slice(2);
const index = args.indexOf('--session');
const sessionArg = index >= 0 ? args[index + 1] : undefined;

try {
  if (!sessionArg) throw new Error('--session é obrigatório.');
  const sessionDir = path.resolve(root, sessionArg);
  const sessionFile = path.join(sessionDir, 'session.json');
  const session = loadJson(sessionFile);
  const issues = [];

  const junitFile = path.join(sessionDir, 'maestro', 'junit.xml');
  if (!fs.existsSync(junitFile)) issues.push('Maestro junit.xml ausente.');
  const junit = fs.existsSync(junitFile) ? parseJUnitSummary(fs.readFileSync(junitFile, 'utf8')) : { tests: 0, passed: false };
  if (!junit.passed) issues.push(`Maestro não aprovado: ${junit.tests || 0} teste(s).`);
  if ((junit.tests || 0) < 6) issues.push('Menos de seis fluxos Maestro foram registrados.');

  const performanceFile = path.join(sessionDir, 'performance', 'report.json');
  if (!fs.existsSync(performanceFile)) issues.push('Relatório de performance ausente.');
  const performance = fs.existsSync(performanceFile) ? loadJson(performanceFile) : undefined;
  if (performance?.status !== 'pass') issues.push('Performance não está marcada como pass.');

  const manualFiles = {
    accessibility: ['accessibility', 'accessibility.json'],
    backupRestore: ['backupRestore', 'backup-restore.json'],
    dataSafety: ['dataSafety', 'data-safety.json']
  };
  for (const [label, [kind, fileName]] of Object.entries(manualFiles)) {
    const file = path.join(sessionDir, fileName);
    if (!fs.existsSync(file)) {
      issues.push(`${fileName} ausente.`);
      continue;
    }
    const result = validateChecklist(loadJson(file), kind, session.platform);
    for (const issue of result.issues) issues.push(`${label}: ${issue}`);
  }

  const binary = path.isAbsolute(session.binary.location) ? session.binary.location : path.join(root, session.binary.location);
  if (!fs.existsSync(binary)) issues.push('Binário da sessão não foi encontrado.');
  else if (sha256Path(binary) !== session.binary.sha256) issues.push('Hash do binário diverge do início da sessão.');

  if (issues.length) {
    console.error('Sessão bloqueada:');
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }

  const now = new Date().toISOString();
  const relative = (target) => {
    const absolute = path.resolve(target);
    const value = path.relative(root, absolute);
    return value.startsWith('..') ? absolute : value.split(path.sep).join('/');
  };
  const artifact = (target) => ({ location: relative(target), sha256: sha256Path(target), capturedAt: now });
  const evidence = {
    schemaVersion: 'dnd-combat-beta-native-evidence.v3',
    platform: session.platform,
    generatedAt: now,
    device: session.device,
    appVersion: session.appVersion,
    buildProfile: 'beta-candidate',
    buildId: session.buildId,
    gitSha: session.gitSha,
    binarySha256: session.binary.sha256,
    platformBuildNumber: session.buildNumber,
    testRunId: session.runId,
    e2ePassed: true,
    nativeBenchmarkPassed: true,
    accessibilityAuditPassed: true,
    backupRestorePassed: true,
    dataSafetyRehearsalPassed: true,
    artifacts: {
      maestro: artifact(path.join(sessionDir, 'maestro')),
      performance: artifact(path.join(sessionDir, 'performance')),
      accessibility: artifact(path.join(sessionDir, 'accessibility.json')),
      backupRestore: artifact(path.join(sessionDir, 'backup-restore.json')),
      dataSafety: artifact(path.join(sessionDir, 'data-safety.json'))
    },
    metrics: performance.metrics,
    notes: `Gerada a partir da sessão operacional ${session.runId}, após validações automatizadas e revisão manual explícita.`
  };
  const output = path.join(root, 'artifacts', 'beta-evidence', `${session.platform}.json`);
  writeJson(output, evidence);
  session.status = 'evidenceCaptured';
  session.updatedAt = now;
  session.evidenceFile = relative(output);
  writeJson(sessionFile, session);
  console.log(`Evidência criada: ${relative(output)}`);
  console.log(`Validação seguinte: npm run beta:evidence:validate -- ${session.platform}`);
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
