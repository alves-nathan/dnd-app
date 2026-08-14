#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateEvidence } = require('./lib/beta-native-evidence');
const root = process.cwd();
const jsonMode = process.argv.includes('--json');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const exists = (file) => fs.existsSync(path.join(root, file));
const results = [];
const add = (severity, code, message) => results.push({ severity, code, message });

let pkg; let app; let eas;
try { pkg = readJson('package.json'); } catch (error) { add('error', 'PACKAGE_JSON_INVALID', error.message); }
try { app = readJson('app.json'); } catch (error) { add('error', 'APP_JSON_INVALID', error.message); }
try { eas = readJson('eas.json'); } catch (error) { add('error', 'EAS_JSON_INVALID', error.message); }

const pinned = pkg?.config?.easCliVersion;
if (!pinned || /[~^*xX><=| ]/.test(pinned)) add('error', 'EAS_CLI_NPX_VERSION_NOT_EXACTLY_PINNED', 'config.easCliVersion deve fixar a versão usada por npx.');
if (pkg?.devDependencies?.['eas-cli'] || pkg?.dependencies?.['eas-cli']) add('error', 'EAS_CLI_LOCAL_DEPENDENCY', 'eas-cli não deve estar instalado nas dependências do projeto.');
if (!eas?.build?.beta || eas.build.beta.distribution !== 'internal') add('error', 'EAS_BETA_PROFILE_INVALID', 'build.beta deve existir e usar distribuição interna.');
if (!eas?.build?.['beta-candidate'] || eas.build['beta-candidate'].distribution !== 'internal') add('error', 'EAS_BETA_CANDIDATE_PROFILE_INVALID', 'build.beta-candidate deve existir e usar distribuição interna.');
if (!app?.expo?.extra?.eas?.projectId) add('warning', 'EAS_PROJECT_ID_NOT_SET', 'Configure o projectId antes da build cloud assinada.');

for (const platform of ['android', 'ios']) {
  const file = `artifacts/beta-evidence/${platform}.json`;
  if (!exists(file)) {
    add('warning', `BETA_${platform.toUpperCase()}_EVIDENCE_MISSING`, `Evidência nativa ausente: ${file}.`);
    continue;
  }
  try {
    const validation = validateEvidence(readJson(file), {
      root,
      expectedPlatform: platform,
      expectedAppVersion: app?.expo?.version,
      expectedGitSha: process.env.BETA_EXPECTED_GIT_SHA,
      verifyLocalArtifacts: true,
      maxAgeDays: Number(process.env.BETA_EVIDENCE_MAX_AGE_DAYS || 14)
    });
    for (const issue of validation.issues) add(issue.severity, `BETA_${platform.toUpperCase()}_${issue.code}`, `${file}: ${issue.message}`);
  } catch (error) {
    add('error', `BETA_${platform.toUpperCase()}_EVIDENCE_INVALID`, `${file}: ${error.message}`);
  }
}

const status = results.some((entry) => entry.severity === 'error') ? 'blocked' : results.length ? 'needsReview' : 'ready';
if (jsonMode) console.log(JSON.stringify({ status, results }, null, 2));
else {
  console.log(`Beta readiness: ${status}`);
  for (const entry of results) console.log(`- ${entry.severity.toUpperCase()} ${entry.code}: ${entry.message}`);
}
if (status === 'blocked') process.exit(1);
