#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const requirements = [
  { file: 'src/store/buildPresetStore.ts', version: 'BUILD_PRESET_STORE_VERSION = 1', migrate: 'migrateBuildPresetPersistenceState' },
  { file: 'src/store/catalogDistributionStore.ts', version: 'CATALOG_DISTRIBUTION_STORE_VERSION = 2', migrate: 'migrateCatalogDistributionPersistenceState' },
  { file: 'src/store/catalogUpdateSessionStore.ts', version: 'CATALOG_UPDATE_SESSION_STORE_VERSION = 2', migrate: 'migrateCatalogUpdateSessionPersistenceState' },
  { file: 'src/store/catalogOperationalAuthorizationStore.ts', version: 'CATALOG_OPERATIONAL_AUTHORIZATION_STORE_VERSION = 2', migrate: 'migrate:' },
  { file: 'src/store/portableRestoreSessionStore.ts', version: 'PORTABLE_RESTORE_SESSION_STORE_VERSION = 3', migrate: 'migrate:' },
  { file: 'src/store/characterStore.ts', version: 'CHARACTER_STORE_VERSION', migrate: 'migrateCharacterStoreState' },
  { file: 'src/store/combatScenarioStore.ts', version: 'version: 3', migrate: 'migrate:' },
  { file: 'src/storage/sqliteCompendiumMigrations.ts', version: 'COMPENDIUM_SQLITE_SCHEMA_VERSION = 3', migrate: 'currentVersion < 3' }
];
const results = requirements.map((requirement) => {
  const absolute = path.join(root, requirement.file);
  const content = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
  const errors = [];
  if (!content) errors.push('arquivo ausente');
  if (!content.includes(requirement.version)) errors.push(`versão ausente: ${requirement.version}`);
  if (!content.includes(requirement.migrate)) errors.push(`migração ausente: ${requirement.migrate}`);
  return { ...requirement, status: errors.length ? 'FAIL' : 'PASS', errors };
});
const migrationModule = fs.readFileSync(path.join(root, 'src/releaseCandidate/persistenceMigrations.ts'), 'utf8');
const safetyChecks = [
  { id: 'v1-update-session-is-not-resumed', pass: migrationModule.includes('persistedVersion < 2') && migrationModule.includes('activeSession: undefined') },
  { id: 'history-is-preserved', pass: migrationModule.includes('history = arrayOrEmpty') },
  { id: 'preset-array-is-sanitized', pass: migrationModule.includes('presets: arrayOrEmpty') },
  { id: 'distribution-records-are-sanitized', pass: migrationModule.includes('recordOrEmpty(source.manifests)') }
];
const status = results.every((entry) => entry.status === 'PASS') && safetyChecks.every((entry) => entry.pass) ? 'PASS' : 'FAIL';
const report = { schemaVersion: 'dnd-combat-app29-migration-contracts.v1', status, generatedAt: new Date().toISOString(), results, safetyChecks };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-29-migration-contracts.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== 'PASS') process.exit(1);
