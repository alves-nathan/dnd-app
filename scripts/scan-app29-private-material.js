#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', '.git']);
const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (fs.statSync(absolute).size <= 20 * 1024 * 1024) files.push(absolute);
  }
};
walk(root);
const findings = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  if (/app29-private-material-scan\.json$/.test(relative)) continue;
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');
  if (/-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push({ file: relative, type: 'PEM_PRIVATE_KEY' });
  if (/"kty"\s*:\s*"EC"[\s\S]{0,1200}"d"\s*:\s*"[A-Za-z0-9_-]{30,}"/.test(text) && !relative.startsWith('src/tests/')) findings.push({ file: relative, type: 'JWK_PRIVATE_COMPONENT' });
  const tokenBearingFile = /(^|\/)(?:\.npmrc|\.env(?:\..*)?|[^/]+\.(?:json|log|txt|md))$/.test(relative);
  if (tokenBearingFile && /(_authToken\s*[=:]\s*[^*\s]|npm_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})/.test(text)) findings.push({ file: relative, type: 'TOKEN_PATTERN' });
}
const report = { schemaVersion: 'dnd-combat-app29-private-material-scan.v1', status: findings.length ? 'FAIL' : 'PASS', generatedAt: new Date().toISOString(), filesScanned: files.length, findings };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-private-material-scan.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exit(1);
