#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const exists = (file) => fs.existsSync(path.join(root, file));
const issues = [];

const fail = (code, message) => issues.push({ severity: 'error', code, message });
const warn = (code, message) => issues.push({ severity: 'warning', code, message });

let packageJson;
let appJson;
let easJson;
try {
  packageJson = readJson('package.json');
} catch (error) {
  fail('PACKAGE_JSON_INVALID', `package.json inválido: ${error.message}`);
}
try {
  appJson = readJson('app.json');
} catch (error) {
  fail('APP_JSON_INVALID', `app.json inválido: ${error.message}`);
}
try {
  easJson = readJson('eas.json');
} catch (error) {
  fail('EAS_JSON_INVALID', `eas.json inválido ou ausente: ${error.message}`);
}

if (packageJson) {
  const requiredScripts = [
    'validate',
    'release:check',
    'release:validate',
    'build:dev:android',
    'build:preview:android',
    'build:production:android',
    'build:production:ios',
    'build:beta:android',
    'build:beta:ios',
    'beta:check'
  ];
  for (const script of requiredScripts) {
    if (!packageJson.scripts || !packageJson.scripts[script]) fail('RELEASE_SCRIPT_MISSING', `Script ausente: ${script}`);
  }
  if (!packageJson.dependencies || !packageJson.dependencies['expo-dev-client']) fail('EXPO_DEV_CLIENT_MISSING', 'expo-dev-client é necessário para developmentClient builds.');
  const localEasCli = packageJson.devDependencies?.['eas-cli'] || packageJson.dependencies?.['eas-cli'];
  if (localEasCli) fail('EAS_CLI_LOCAL_DEPENDENCY', 'Remova eas-cli das dependências e use instalação global ou npx.');
  const easCliVersion = packageJson.config?.easCliVersion;
  if (!easCliVersion) warn('EAS_CLI_NPX_VERSION_NOT_PINNED', 'Defina config.easCliVersion para tornar os comandos npx reproduzíveis.');
  else if (/[~^*xX><=| ]/.test(easCliVersion)) warn('EAS_CLI_NPX_VERSION_NOT_EXACTLY_PINNED', `config.easCliVersion deve ser exata; valor atual: ${easCliVersion}.`);
}

if (appJson && appJson.expo) {
  const expo = appJson.expo;
  if (!expo.name) fail('APP_NAME_MISSING', 'expo.name ausente.');
  if (!expo.slug) fail('APP_SLUG_MISSING', 'expo.slug ausente.');
  if (!expo.version) fail('APP_VERSION_MISSING', 'expo.version ausente.');
  if (!expo.android || !expo.android.package) fail('ANDROID_PACKAGE_MISSING', 'expo.android.package ausente.');
  if (!expo.android || !Number.isInteger(expo.android.versionCode) || expo.android.versionCode <= 0) fail('ANDROID_VERSION_CODE_INVALID', 'expo.android.versionCode deve ser inteiro positivo.');
  if (!expo.ios || !expo.ios.bundleIdentifier) fail('IOS_BUNDLE_IDENTIFIER_MISSING', 'expo.ios.bundleIdentifier ausente.');
  if (!expo.ios || !expo.ios.buildNumber) fail('IOS_BUILD_NUMBER_MISSING', 'expo.ios.buildNumber ausente.');
  if (!expo.extra || !expo.extra.eas || !expo.extra.eas.projectId) warn('EAS_PROJECT_ID_NOT_SET', 'extra.eas.projectId ainda não está configurado. Rode npm run eas:init antes do primeiro build cloud.');
  if (expo.android && Array.isArray(expo.android.permissions) && expo.android.permissions.length > 0) warn('ANDROID_PERMISSIONS_REVIEW', `Revise permissões Android: ${expo.android.permissions.join(', ')}`);
}

if (easJson) {
  const profiles = ['development', 'preview', 'beta', 'production'];
  for (const profile of profiles) {
    if (!easJson.build || !easJson.build[profile]) fail('EAS_PROFILE_MISSING', `Perfil EAS ausente: ${profile}`);
  }
  if (!easJson.build?.development?.developmentClient) fail('EAS_DEVELOPMENT_CLIENT_FALSE', 'Perfil development deve ter developmentClient=true.');
  if (easJson.build?.preview?.distribution !== 'internal') warn('EAS_PREVIEW_NOT_INTERNAL', 'Perfil preview deveria usar distribution=internal para testes.');
  if (easJson.build?.beta?.distribution !== 'internal') fail('EAS_BETA_NOT_INTERNAL', 'Perfil beta deve usar distribution=internal.');
  if (easJson.build?.production?.android?.buildType !== 'app-bundle') warn('EAS_PRODUCTION_ANDROID_NOT_AAB', 'Produção Android geralmente deve gerar app-bundle/AAB.');
}

const requiredDocs = [
  'docs/release/eas-build.md',
  'docs/release/release-checklist.md',
  'docs/release/privacy-and-content.md'
];
for (const doc of requiredDocs) {
  if (!exists(doc)) fail('RELEASE_DOC_MISSING', `Documento de release ausente: ${doc}`);
}

if (issues.length) {
  console.log('Release readiness issues:');
  for (const entry of issues) console.log(`- ${entry.severity.toUpperCase()} ${entry.code}: ${entry.message}`);
  if (issues.some((entry) => entry.severity === 'error')) process.exit(1);
}

console.log(`Release readiness OK${issues.length ? ` with ${issues.length} warning(s)` : ''}`);
