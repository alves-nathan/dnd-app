#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const requiredFiles = [
  'package.json',
  'app.json',
  'tsconfig.json',
  'app/index.tsx',
  'app/hardening.tsx',
  'app/release.tsx',
  'app/beta-validation.tsx',
  'app/beta-feedback.tsx',
  'app/beta-runtime.tsx',
  'app.config.js',
  'src/release/releaseReadiness.ts',
  'src/release/betaDataSafety.ts',
  'src/release/betaFeedback.ts',
  'src/store/betaFeedbackStore.ts',
  'docs/release/eas-build.md',
  'docs/release/release-checklist.md',
  'docs/release/privacy-and-content.md',
  'docs/release/bundled-compendium.md',
  'docs/release/beta-native-evidence.schema.json',
  'scripts/run-beta-local-gate.js',
  'scripts/generate-beta-candidate-manifest.js',
  'scripts/prepare-native-beta-session.js',
  'scripts/run-android-beta-session.js',
  'scripts/finalize-native-beta-session.js',
  'scripts/lib/mobile-test-session.js',
  'scripts/lib/mobile-tools.js',
  'eas.json',
  'src/types/index.ts',
  'src/hardening/compatibilitySuite.ts',
  'src/diagnostics/globalDiagnostics.ts',
  'src/fixtures/exampleLibrary.ts',
  'src/table/tableMode.ts',
  'docs/hardening/compatibility-suite.md',
  'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json',
  'src/compendium/bundledCompendium.ts',
  'src/storage/bundledCompendiumBootstrap.ts',
  'scripts/check-bundled-compendium.js'
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error('Arquivos obrigatórios ausentes:');
  missing.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const requiredScripts = ['start', 'test', 'typecheck', 'check:shape', 'release:check', 'release:validate', 'beta:local-gate', 'beta:manifest', 'beta:candidate:check', 'beta:session:prepare', 'beta:session:run:android', 'beta:session:finalize', 'compendium:bundled:check', 'compendium:import-v2:release-gate'];
const missingScripts = requiredScripts.filter((script) => !packageJson.scripts || !packageJson.scripts[script]);
if (missingScripts.length) {
  console.error('Scripts obrigatórios ausentes:');
  missingScripts.forEach((script) => console.error(`- ${script}`));
  process.exit(1);
}

console.log('Project shape OK');
