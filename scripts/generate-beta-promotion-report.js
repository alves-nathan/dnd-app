#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { gitShaMatches, validateEvidence } = require('./lib/beta-native-evidence');

const root = process.cwd();
const outputDir = path.join(root, 'artifacts', 'beta-promotion');
fs.mkdirSync(outputDir, { recursive: true });

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const readOptionalJson = (file) => fs.existsSync(path.join(root, file)) ? readJson(file) : undefined;
const app = readJson('app.json');
const localGate = readOptionalJson('artifacts/beta-candidate/local-gate.json');
const feedbackPath = process.env.BETA_FEEDBACK_EXPORT_PATH || 'artifacts/beta-feedback/latest.json';
const feedback = readOptionalJson(feedbackPath);
const androidInput = readOptionalJson('artifacts/beta-evidence/android.json');
const iosInput = readOptionalJson('artifacts/beta-evidence/ios.json');
const expectedGitSha = process.env.BETA_EXPECTED_GIT_SHA || androidInput?.gitSha || iosInput?.gitSha;

const validatePlatform = (platform, input) => input
  ? validateEvidence(input, {
      root,
      expectedPlatform: platform,
      expectedAppVersion: app.expo.version,
      expectedGitSha,
      maxAgeDays: Number(process.env.BETA_EVIDENCE_MAX_AGE_DAYS || 14),
      verifyLocalArtifacts: true
    })
  : { status: 'blocked', promotionReady: false, issues: [{ severity: 'error', code: 'EVIDENCE_MISSING', message: `Evidência ${platform} ausente.` }] };

const android = validatePlatform('android', androidInput);
const ios = validatePlatform('ios', iosInput);
const issues = [];
const add = (severity, code, message) => issues.push({ severity, code, message });
const projectId = app?.expo?.extra?.eas?.projectId;

if (!projectId) add('error', 'EAS_PROJECT_ID_MISSING', 'extra.eas.projectId é obrigatório para promoção.');
if (localGate?.status !== 'passed') add('error', 'LOCAL_GATE_NOT_PASSED', 'O gate local da candidata não está aprovado.');
if (!android.promotionReady) add('error', 'ANDROID_EVIDENCE_NOT_READY', 'A evidência Android não está pronta.');
if (!ios.promotionReady) add('error', 'IOS_EVIDENCE_NOT_READY', 'A evidência iOS não está pronta.');
if (androidInput?.gitSha && iosInput?.gitSha && !gitShaMatches(androidInput.gitSha, iosInput.gitSha)) {
  add('error', 'PLATFORM_GIT_SHA_MISMATCH', 'Android e iOS foram testados em commits diferentes.');
}

let feedbackSummary = {
  total: 0,
  unresolvedBlocking: 0,
  unresolvedHigh: 0,
  unresolvedMedium: 0,
  unresolvedLow: 0,
  resolved: 0
};
if (!feedback) {
  add('error', 'FEEDBACK_EXPORT_MISSING', `Exportação de feedback ausente: ${feedbackPath}.`);
} else if (feedback.schemaVersion !== 'dnd-combat-beta-feedback.v1' || !Array.isArray(feedback.entries)) {
  add('error', 'FEEDBACK_EXPORT_INVALID', 'A exportação de feedback precisa usar dnd-combat-beta-feedback.v1.');
} else {
  const unresolved = feedback.entries.filter((entry) => !['resolved', 'wontFix'].includes(entry.status));
  const count = (severity) => unresolved.filter((entry) => entry.severity === severity).length;
  feedbackSummary = {
    total: feedback.entries.length,
    unresolvedBlocking: count('blocking'),
    unresolvedHigh: count('high'),
    unresolvedMedium: count('medium'),
    unresolvedLow: count('low'),
    resolved: feedback.entries.length - unresolved.length
  };
  if (feedbackSummary.unresolvedBlocking) add('error', 'BLOCKING_FEEDBACK_OPEN', `${feedbackSummary.unresolvedBlocking} feedback(s) bloqueante(s) abertos.`);
  if (feedbackSummary.unresolvedHigh) add('error', 'HIGH_FEEDBACK_OPEN', `${feedbackSummary.unresolvedHigh} feedback(s) altos abertos.`);
  if (feedbackSummary.unresolvedMedium || feedbackSummary.unresolvedLow) {
    add('warning', 'NON_BLOCKING_FEEDBACK_OPEN', `${feedbackSummary.unresolvedMedium + feedbackSummary.unresolvedLow} feedback(s) médios/baixos ainda abertos.`);
  }
}

for (const issue of android.issues) if (issue.severity === 'warning') add('warning', `ANDROID_${issue.code}`, issue.message);
for (const issue of ios.issues) if (issue.severity === 'warning') add('warning', `IOS_${issue.code}`, issue.message);

const hasErrors = issues.some((issue) => issue.severity === 'error');
const hasWarnings = issues.some((issue) => issue.severity === 'warning');
const status = hasErrors ? 'blocked' : hasWarnings ? 'needsReview' : 'ready';
const report = {
  schemaVersion: 'dnd-combat-beta-promotion-report.v1',
  generatedAt: new Date().toISOString(),
  status,
  app: {
    version: app.expo.version,
    easProjectId: projectId || null,
    expectedGitSha: expectedGitSha || null
  },
  localGateStatus: localGate?.status || 'missing',
  platforms: {
    android: {
      status: android.status,
      promotionReady: android.promotionReady,
      buildId: androidInput?.buildId || null,
      platformBuildNumber: androidInput?.platformBuildNumber || null,
      gitSha: androidInput?.gitSha || null
    },
    ios: {
      status: ios.status,
      promotionReady: ios.promotionReady,
      buildId: iosInput?.buildId || null,
      platformBuildNumber: iosInput?.platformBuildNumber || null,
      gitSha: iosInput?.gitSha || null
    }
  },
  feedback: { path: feedback ? feedbackPath : null, ...feedbackSummary },
  issues
};

const markdown = [
  `# Relatório de promoção beta — ${app.expo.version}`,
  '',
  `Status: **${status}**`,
  `Gerado em: ${report.generatedAt}`,
  `Commit esperado: ${expectedGitSha || '-'}`,
  '',
  '## Plataformas',
  `- Android: ${android.status} · build ${androidInput?.platformBuildNumber || '-'} · ${androidInput?.buildId || '-'}`,
  `- iOS: ${ios.status} · build ${iosInput?.platformBuildNumber || '-'} · ${iosInput?.buildId || '-'}`,
  '',
  '## Feedback',
  `- Total: ${feedbackSummary.total}`,
  `- Resolvidos: ${feedbackSummary.resolved}`,
  `- Bloqueantes abertos: ${feedbackSummary.unresolvedBlocking}`,
  `- Altos abertos: ${feedbackSummary.unresolvedHigh}`,
  `- Médios abertos: ${feedbackSummary.unresolvedMedium}`,
  `- Baixos abertos: ${feedbackSummary.unresolvedLow}`,
  '',
  '## Pendências',
  ...(issues.length ? issues.map((issue) => `- **${issue.severity.toUpperCase()}** ${issue.code}: ${issue.message}`) : ['- Nenhuma.'])
].join('\n');

fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(outputDir, 'report.md'), markdown + '\n');
console.log(`Beta promotion report: ${status}`);
for (const issue of issues) console.log(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
console.log('Arquivos: artifacts/beta-promotion/report.json e report.md');
if (hasErrors) process.exit(1);
