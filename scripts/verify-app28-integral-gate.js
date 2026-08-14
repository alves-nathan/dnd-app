#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { evaluateApp28Evidence } = require('./lib/app28-integral-gate-evidence');
const root = path.resolve(__dirname, '..');
const reportPath = path.resolve(root, process.env.APP28_GATE_REPORT || 'artifacts/app28-integral-gate.json');
const maxAgeHours = Number(process.env.APP28_GATE_MAX_AGE_HOURS || 24);
if (!fs.existsSync(reportPath)) {
  console.error('[app28:gate:verify] FAIL');
  console.error(`- Evidência ausente: ${path.relative(root, reportPath)}`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const result = evaluateApp28Evidence(report, { root, maxAgeHours, minimumMaestroFlows: 83 });
if (!result.valid) {
  console.error('[app28:gate:verify] FAIL');
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log('[app28:gate:verify] PASS');
console.log(`generatedAt=${report.generatedAt}`);
console.log(`fingerprint=${report.source.fingerprint}`);
console.log(`evidenceSha256=${report.evidenceSha256}`);
