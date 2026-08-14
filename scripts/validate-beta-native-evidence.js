#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateEvidence } = require('./lib/beta-native-evidence');

const root = process.cwd();
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const requestedPlatform = process.argv[2];
const platforms = requestedPlatform ? [requestedPlatform] : ['android', 'ios'];
if (platforms.some((platform) => !['android', 'ios'].includes(platform))) {
  console.error('Uso: node scripts/validate-beta-native-evidence.js [android|ios]');
  process.exit(1);
}

let blocked = false;
for (const platform of platforms) {
  const file = path.join(root, 'artifacts', 'beta-evidence', `${platform}.json`);
  if (!fs.existsSync(file)) {
    console.log(`BLOCKED ${platform}: ${path.relative(root, file)} ausente.`);
    blocked = true;
    continue;
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    console.log(`BLOCKED ${platform}: JSON inválido (${error.message}).`);
    blocked = true;
    continue;
  }
  const result = validateEvidence(input, {
    root,
    expectedPlatform: platform,
    expectedAppVersion: app.expo.version,
    expectedGitSha: process.env.BETA_EXPECTED_GIT_SHA,
    maxAgeDays: Number(process.env.BETA_EVIDENCE_MAX_AGE_DAYS || 14),
    verifyLocalArtifacts: true
  });
  console.log(`${result.status.toUpperCase()} ${platform}`);
  for (const issue of result.issues) console.log(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  if (!result.promotionReady) blocked = true;
}
if (blocked) process.exit(1);
