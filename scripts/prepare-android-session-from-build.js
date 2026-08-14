#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateBuildArtifactManifest } = require('./lib/eas-beta-build');

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

try {
  const buildArg = option('build');
  const device = option('device');
  if (!buildArg || !device) throw new Error('--build e --device são obrigatórios.');
  const manifestPath = path.resolve(root, buildArg);
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifesto não encontrado: ${buildArg}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const validation = validateBuildArtifactManifest(manifest);
  if (!validation.valid) throw new Error(`Manifesto inválido:\n- ${validation.issues.join('\n- ')}`);
  const binary = path.isAbsolute(manifest.binary.location) ? manifest.binary.location : path.join(root, manifest.binary.location);
  if (!fs.existsSync(binary)) throw new Error(`APK não encontrado: ${manifest.binary.location}`);

  const command = [
    'scripts/prepare-native-beta-session.js',
    'android',
    '--device', device,
    '--binary', binary,
    '--build-id', manifest.buildId,
    '--build-number', manifest.buildNumber,
    '--git-sha', manifest.gitSha
  ];
  const runId = option('run-id');
  if (runId) command.push('--run-id', runId);
  const result = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || 'Falha ao preparar sessão.').trim());
  process.stdout.write(result.stdout);
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  console.error('Uso: npm run beta:android:session:from-build -- --build artifacts/.../build-artifact.json --device "Pixel 8"');
  process.exit(1);
}
