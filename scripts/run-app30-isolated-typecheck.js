#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-app30-typecheck-'));
fs.mkdirSync(path.join(temp, 'empty-types'));
fs.copyFileSync(path.join(root, 'src/releaseDelivery/productionReleaseDelivery.ts'), path.join(temp, 'productionReleaseDelivery.ts'));
fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', moduleResolution: 'node', strict: true, noImplicitReturns: true, types: [], typeRoots: [path.join(temp, 'empty-types')], noEmit: true }, include: ['*.ts'] }, null, 2));
const result = spawnSync('tsc', ['-p', path.join(temp, 'tsconfig.json')], { cwd: temp, encoding: 'utf8' });
const report = { schemaVersion: 'dnd-combat-app30-isolated-typecheck.v1', status: result.status === 0 ? 'PASS' : 'FAIL', generatedAt: new Date().toISOString(), stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-isolated-typecheck.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
fs.rmSync(temp, { recursive: true, force: true });
if (result.status !== 0) process.exit(1);
