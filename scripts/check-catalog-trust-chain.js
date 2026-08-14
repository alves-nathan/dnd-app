#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'src/catalog/catalogTrust.ts',
  'src/catalog/catalogTrustDefaults.ts',
  'src/store/catalogTrustStore.ts',
  'app/catalog-trust.tsx',
  'scripts/sign-catalog-bundle.js',
  'scripts/catalog-key-admin.js',
  'scripts/generate-catalog-key.js',
  'src/tests/catalogTrust.test.ts'
];
const issues = [];
for (const file of required) if (!fs.existsSync(path.join(root, file))) issues.push(`Arquivo obrigatório ausente: ${file}`);
const transaction = fs.readFileSync(path.join(root, 'src/catalog/catalogUpdateTransaction.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/store/catalogUpdateSessionStore.ts'), 'utf8');
const updateScreen = fs.readFileSync(path.join(root, 'app/catalog-update.tsx'), 'utf8');
const trustScreen = fs.readFileSync(path.join(root, 'app/catalog-trust.tsx'), 'utf8');
for (const token of ['dnd-signed-catalog-bundle.v1', 'ECDSA_P256_SHA256', 'verifyP256Signature', 'applyCatalogKeyRotation', 'applyCatalogKeyRevocation']) {
  const trust = fs.readFileSync(path.join(root, 'src/catalog/catalogTrust.ts'), 'utf8');
  if (!trust.includes(token)) issues.push(`Contrato de confiança ausente: ${token}`);
}
if (!transaction.includes('parseAndValidateTrustedCatalogCandidate')) issues.push('A atualização não usa o parser de catálogo confiável.');
if (!transaction.includes('provenance?: CatalogTrustVerification')) issues.push('O recibo não preserva a proveniência criptográfica.');
if (!store.includes('useCatalogTrustStore')) issues.push('O coordenador não persiste a cadeia de confiança.');
if (!store.includes('replaceRegistry(session.checkpoint.trustRegistry)')) issues.push('O rollback não restaura o registro de confiança.');
if (!updateScreen.includes('catalog-update-trust-status')) issues.push('A tela de atualização não exibe a assinatura validada.');
if (!trustScreen.includes('catalog-trust-add-community') || !trustScreen.includes('catalog-trust-revoke')) issues.push('A tela de publicadores não cobre aprovação e revogação.');
const productionFiles = ['app/catalog-update.tsx', 'src/catalog/catalogUpdateTransaction.ts'];
for (const file of productionFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.startsWith('app/') && content.includes('trustBypassForInternalFixture')) issues.push(`Bypass de confiança exposto na interface: ${file}`);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['catalog:sign', 'catalog:key:generate', 'catalog:key:admin', 'catalog:trust:check', 'catalog:trust:harness']) if (!packageJson.scripts?.[script]) issues.push(`Script npm ausente: ${script}`);
const result = { schemaVersion: 'dnd-combat-app18-contracts.v1', status: issues.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), files: required.length, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-18-contracts.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`[catalog:trust:check] ${result.status}`);
if (issues.length) { for (const issue of issues) console.error(`- ${issue}`); process.exit(1); }
