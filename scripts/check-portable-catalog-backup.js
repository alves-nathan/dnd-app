#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const read = (file) => { const target = path.join(root, file); if (!fs.existsSync(target)) { errors.push(`${file}: arquivo ausente`); return ''; } return fs.readFileSync(target, 'utf8'); };
const contracts = [
  ['src/backup/portableCatalogBackup.ts', ['dnd-portable-catalog-audit.v1', 'comparePortableCatalogAudit', 'validatePortableCatalogAuditSection', 'preparePortableRemediationPlanImport', 'sourceHistoryChecksum']],
  ['src/backup/characterBackup.ts', ['dnd-combat-character-backup.v3', 'PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION', 'catalogAudit?: PortableCatalogAuditSection', 'portable-user-data']],
  ['src/catalog/catalogConfigurationHistory.ts', ['CatalogConfigurationPortableImport', 'portableImport?', 'sourceHistory: CatalogConfigurationHistoryEntry[]']],
  ['src/store/catalogStore.ts', ['previewPortableBackupImport', 'portableCatalogImportMetadata', 'portableImport: current.pendingChange.portableImport']],
  ['app/backup.tsx', ['Backup portátil e restauração', 'portable-backup-comparison', 'A configuração do catálogo foi preparada como nova transação']],
  ['app/content-management.tsx', ['portable-catalog-import-preview', 'histórico local não será sobrescrito']],
  ['app/e2e-seed.tsx', ['preparePortableBackupScenario', 'e2e-seed-portable-backup']],
  ['scripts/run-app06-native-gate.js', ['23-portable-backup-export.yaml', '24-portable-backup-import-preview.yaml', '25-portable-backup-import-cancel.yaml', '26-portable-backup-conflict.yaml']]
];
for (const [file, snippets] of contracts) { const content = read(file); for (const snippet of snippets) if (content && !content.includes(snippet)) errors.push(`${file}: contrato ausente (${snippet})`); }
const pkg = JSON.parse(read('package.json') || '{}');
for (const script of ['backup:portable-catalog:check', 'backup:portable-catalog:harness', 'app13:smoke', 'app13:native:gate']) if (!pkg.scripts?.[script]) errors.push(`package.json: script ausente (${script})`);
if (errors.length) { console.error('[backup:portable-catalog:check] FAIL'); errors.forEach((entry) => console.error(`- ${entry}`)); process.exit(1); }
console.log('[backup:portable-catalog:check] PASS');
console.log('backupSchema=dnd-combat-character-backup.v3');
console.log('portableAuditSchema=dnd-portable-catalog-audit.v1');
console.log('nativeGateFlows=19');
