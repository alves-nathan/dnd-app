#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const inherited = spawnSync(process.execPath, [path.join(root, 'scripts/scan-app29-private-material.js')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const suspiciousNames = [];
const patterns = [/\.jks$/i,/\.keystore$/i,/\.p8$/i,/\.p12$/i,/\.mobileprovision$/i,/service-account.*\.json$/i,/google-services\.json$/i,/GoogleService-Info\.plist$/i];
const walk = (dir, relative = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','artifacts','reports'].includes(entry.name)) continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
    else if (patterns.some((pattern) => pattern.test(next))) suspiciousNames.push(next.replaceAll(path.sep, '/'));
  }
};
walk(root);
const status = inherited.status === 0 && suspiciousNames.length === 0 ? 'PASS' : 'FAIL';
const report = { schemaVersion: 'dnd-combat-app30-private-material-scan.v1', status, generatedAt: new Date().toISOString(), inheritedScannerStatus: inherited.status === 0 ? 'PASS' : 'FAIL', suspiciousNames, inheritedOutput: String(inherited.stdout || inherited.stderr || '').trim().slice(-4000) };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-private-material-scan.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== 'PASS') process.exit(1);
