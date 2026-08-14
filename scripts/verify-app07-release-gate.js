#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { evaluateReleaseGateEvidence, readJson } = require('./lib/app07-release-evidence');

const root = path.resolve(__dirname, '..');
const reportPath = path.resolve(root, process.env.APP07_GATE_REPORT || 'artifacts/app07-release-gate.json');
const maxAgeHours = Number(process.env.APP07_GATE_MAX_AGE_HOURS || 24);
if (!fs.existsSync(reportPath)) {
  console.error('[app07:release:gate:verify] FAIL');
  console.error(`- Evidência ausente: ${path.relative(root, reportPath)}`);
  process.exit(1);
}
const report = readJson(reportPath);
const result = evaluateReleaseGateEvidence(report, { root, maxAgeHours });
if (!result.valid) {
  console.error('[app07:release:gate:verify] FAIL');
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[app07:release:gate:verify] PASS');
console.log(`generatedAt=${report.generatedAt}`);
console.log(`fingerprint=${report.source.fingerprint}`);
console.log(`evidenceSha256=${report.evidenceSha256}`);
