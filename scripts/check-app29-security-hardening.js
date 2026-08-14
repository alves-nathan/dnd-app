#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const issues = [];
const checks = [];
const add = (id, pass, detail) => { checks.push({ id, status: pass ? 'PASS' : 'FAIL', detail }); if (!pass) issues.push(`${id}: ${detail}`); };
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    if (['tests', '__tests__', 'fixtures'].includes(entry.name)) return [];
    return walk(absolute);
  }
  return /\.(ts|tsx|js|jsx|json)$/.test(entry.name) ? [absolute] : [];
});
const runtimeFiles = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))];
const runtimeText = runtimeFiles.map((file) => `\n/* ${path.relative(root, file)} */\n${fs.readFileSync(file, 'utf8')}`).join('\n');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const permissions = appJson.expo?.android?.permissions ?? [];
add('android-permissions', Array.isArray(permissions) && permissions.length === 0, `Permissões Android declaradas: ${JSON.stringify(permissions)}.`);
add('no-private-key-material', !/-----BEGIN (?:EC |RSA )?PRIVATE KEY-----|"d"\s*:\s*"[A-Za-z0-9_-]{30,}"/.test(runtimeText), 'Nenhum material de chave privada pode existir no runtime.');
add('no-runtime-http', !/http:\/\//i.test(runtimeText), 'URLs HTTP sem TLS não são aceitas no runtime.');
add('no-dynamic-code', !/\beval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML/.test(runtimeText), 'Execução dinâmica de código não é aceita.');
add('no-automatic-release-execution', !/automaticExecution\s*:\s*true/.test(runtimeText), 'Operações de release não podem habilitar execução automática.');
add('runtime-version-pinned', appJson.expo?.runtimeVersion?.policy === 'appVersion', 'runtimeVersion deve seguir appVersion.');
add('e2e-seed-disabled-default', appJson.expo?.extra?.release?.e2eSeedEnabled === false, 'Seed E2E deve permanecer desabilitado por padrão.');
const report = { schemaVersion: 'dnd-combat-app29-security-hardening.v1', status: issues.length ? 'FAIL' : 'PASS', generatedAt: new Date().toISOString(), filesScanned: runtimeFiles.length, checks, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-security-hardening.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
