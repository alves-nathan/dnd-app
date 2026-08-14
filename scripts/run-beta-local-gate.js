#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const outputDir = path.join(root, 'artifacts', 'beta-candidate');
fs.mkdirSync(outputDir, { recursive: true });

const commands = [
  { id: 'app07.releaseGate', command: 'npm', args: ['run', 'app07:release:gate:verify'], env: {} },
  { id: 'app28.gate', command: 'npm', args: ['run', 'app28:gate:verify'], env: {} },
  { id: 'release.validate', command: 'npm', args: ['run', 'release:validate'], env: {} },
  { id: 'security.productionAudit', command: 'npm', args: ['run', 'security:audit:production'], env: {} },
  {
    id: 'benchmark.phb',
    command: 'npm',
    args: ['run', 'benchmark:phb'],
    env: { RUN_PHB_BENCHMARK: '1' },
    requiredEnv: ['PHB_IMPORT_PATH']
  },
  {
    id: 'storage.multiBook',
    command: 'npm',
    args: ['run', 'test:multi-book:real'],
    env: { RUN_REAL_MULTI_BOOK: '1' },
    requiredEnv: ['COMPENDIUM_PACKAGE_PATHS']
  }
];

const results = [];
for (const item of commands) {
  const missingEnv = (item.requiredEnv || []).filter((key) => !process.env[key]);
  if (missingEnv.length) {
    results.push({
      id: item.id,
      passed: false,
      exitCode: null,
      durationMs: 0,
      logFile: null,
      reason: `Variáveis obrigatórias ausentes: ${missingEnv.join(', ')}`
    });
    console.log(`FAIL ${item.id}: ${results.at(-1).reason}`);
    break;
  }

  const startedAt = Date.now();
  const result = spawnSync(item.command, item.args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...item.env }
  });
  const passed = result.status === 0;
  const logFile = path.join(outputDir, `${item.id.replace(/[^a-z0-9.-]+/gi, '-')}.log`);
  fs.writeFileSync(logFile, `${result.stdout || ''}\n${result.stderr || ''}`.trim() + '\n');
  results.push({
    id: item.id,
    passed,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    logFile: path.relative(root, logFile)
  });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${item.id} (${results.at(-1).durationMs} ms)`);
  if (!passed) break;
}

const report = {
  schemaVersion: 'dnd-combat-beta-local-gate.v1',
  generatedAt: new Date().toISOString(),
  status: results.length === commands.length && results.every((entry) => entry.passed) ? 'passed' : 'failed',
  requiredInputs: {
    phbImportFile: process.env.PHB_IMPORT_PATH ? path.basename(process.env.PHB_IMPORT_PATH) : null,
    compendiumPackageCount: process.env.COMPENDIUM_PACKAGE_PATHS
      ? process.env.COMPENDIUM_PACKAGE_PATHS.split(path.delimiter).filter(Boolean).length
      : 0
  },
  results
};
const reportPath = path.join(outputDir, 'local-gate.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Relatório: ${path.relative(root, reportPath)}`);
if (report.status !== 'passed') process.exit(1);
