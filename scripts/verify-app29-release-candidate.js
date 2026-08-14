#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { evaluateApp29Evidence } = require('./lib/app29-release-candidate-evidence');
const root = path.resolve(__dirname, '..');
const input = process.argv[2] || 'artifacts/app29-release-candidate.json';
const absolute = path.resolve(root, input);
if (!fs.existsSync(absolute)) { console.error(`Evidência ausente: ${input}`); process.exit(1); }
const result = evaluateApp29Evidence(JSON.parse(fs.readFileSync(absolute, 'utf8')), { root, minimumMaestroFlows: 83 });
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exit(1);
