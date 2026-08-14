#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawnEas } = require('./lib/eas-cli-command');
const {
  createBuildArtifactManifest,
  normalizeEasBuild,
  parseJsonOutput,
  safeSegment,
  validateCandidateBuild
} = require('./lib/eas-beta-build');
const { writeJson } = require('./lib/mobile-test-session');

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);
const message = option('message') || `Phase 5H Android beta candidate ${new Date().toISOString()}`;
const outputRoot = path.resolve(root, option('output-dir') || 'artifacts/eas-builds');

const sha256File = (file) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
};

const download = (urlValue, destination, redirects = 0) => new Promise((resolve, reject) => {
  if (redirects > 5) return reject(new Error('Número excessivo de redirects ao baixar o APK.'));
  let url;
  try { url = new URL(urlValue); } catch { return reject(new Error('URL do APK inválida.')); }
  if (url.protocol !== 'https:') return reject(new Error('O APK deve ser baixado por HTTPS.'));
  const request = https.get(url, { headers: { 'User-Agent': 'dnd-combat-beta-operator/1.0' }, timeout: 30000 }, (response) => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      return resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
    }
    if (response.statusCode !== 200) {
      response.resume();
      return reject(new Error(`Download do APK retornou HTTP ${response.statusCode}.`));
    }
    const partial = `${destination}.partial`;
    const file = fs.createWriteStream(partial, { flags: 'w' });
    let received = 0;
    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > 1024 * 1024 * 1024) request.destroy(new Error('APK excede o limite de 1 GiB.'));
    });
    response.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        fs.renameSync(partial, destination);
        resolve();
      });
    });
    file.on('error', (error) => {
      file.close(() => fs.rmSync(partial, { force: true }));
      reject(error);
    });
  });
  request.on('timeout', () => request.destroy(new Error('Timeout ao baixar o APK.')));
  request.on('error', reject);
});

(async () => {
  try {
    const legacyGateVerification = spawnSync(process.execPath, ['scripts/verify-app07-release-gate.js'], { cwd: root, stdio: 'inherit', env: process.env });
    if (legacyGateVerification.status !== 0) throw new Error('Gate APP-07 obrigatório não foi aprovado para esta codebase. Execute npm run app07:release:gate.');
    const legacyGatePath = path.join(root, 'artifacts/app07-release-gate.json');
    const releaseGate = JSON.parse(fs.readFileSync(legacyGatePath, 'utf8'));

    const releaseGateVerification = spawnSync(process.execPath, ['scripts/verify-app28-integral-gate.js'], { cwd: root, stdio: 'inherit', env: process.env });
    if (releaseGateVerification.status !== 0) throw new Error('Gate APP-28 obrigatório não foi aprovado para esta codebase. Execute npm run app28:gate.');
    const releaseGatePath = path.join(root, 'artifacts/app28-integral-gate.json');
    const integralGate = JSON.parse(fs.readFileSync(releaseGatePath, 'utf8'));

    if (!has('skip-preflight')) {
      const preflight = spawnSync(process.execPath, ['scripts/check-native-beta-owner-environment.js'], { cwd: root, stdio: 'inherit', env: process.env });
      if (preflight.status !== 0) throw new Error('Preflight do ambiente do proprietário não foi aprovado.');
    }

    const commandArgs = ['build', '--platform', 'android', '--profile', 'beta-candidate', '--wait', '--json', '--non-interactive', '--message', message];
    if (has('clear-cache')) commandArgs.push('--clear-cache');
    console.error('Iniciando build Android beta-candidate no EAS...');
    const { result } = spawnEas(root, commandArgs, { spawnOptions: { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 } });
    if (result.status !== 0) throw new Error(`EAS Build falhou:\n${String(result.stderr || result.stdout || '').trim()}`);

    const build = normalizeEasBuild(parseJsonOutput(result.stdout));
    const validation = validateCandidateBuild(build);
    if (!validation.valid) throw new Error(`Build retornada é inválida:\n- ${validation.issues.join('\n- ')}`);

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const directory = path.join(outputRoot, `android-${safeSegment(build.appBuildVersion)}-${timestamp}`);
    fs.mkdirSync(directory, { recursive: true });
    const binary = path.join(directory, `dnd-combat-${safeSegment(build.appVersion)}-${safeSegment(build.appBuildVersion)}-beta-candidate.apk`);
    await download(build.artifactUrl, binary);

    const descriptor = fs.openSync(binary, 'r');
    const signature = Buffer.alloc(2);
    try { fs.readSync(descriptor, signature, 0, 2, 0); } finally { fs.closeSync(descriptor); }
    if (signature.toString('binary') !== 'PK') throw new Error('O artefato baixado não possui assinatura ZIP/APK esperada.');
    const binarySha256 = sha256File(binary);
    const legacyGateCopy = path.join(directory, 'app07-release-gate.json');
    fs.copyFileSync(legacyGatePath, legacyGateCopy);
    const releaseGateCopy = path.join(directory, 'app28-integral-gate.json');
    fs.copyFileSync(releaseGatePath, releaseGateCopy);
    const manifest = createBuildArtifactManifest({ build, binaryPath: binary, binarySha256, root });
    manifest.releaseGate = {
      schemaVersion: releaseGate.schemaVersion,
      generatedAt: releaseGate.generatedAt,
      sourceFingerprint: releaseGate.source?.fingerprint || null,
      evidenceSha256: releaseGate.evidenceSha256,
      artifact: path.basename(legacyGateCopy)
    };
    manifest.integralGate = {
      schemaVersion: integralGate.schemaVersion,
      generatedAt: integralGate.generatedAt,
      sourceFingerprint: integralGate.source?.fingerprint || null,
      packageLockSha256: integralGate.source?.packageLockSha256 || null,
      maestroFlows: integralGate.nativeEvidence?.flowCount || 0,
      evidenceSha256: integralGate.evidenceSha256,
      artifact: path.basename(releaseGateCopy)
    };
    const manifestPath = path.join(directory, 'build-artifact.json');
    writeJson(manifestPath, manifest);
    fs.writeFileSync(path.join(directory, 'README.md'), `# Android beta-candidate

- Build EAS: ${manifest.buildId}
- Versão: ${manifest.appVersion} (${manifest.buildNumber})
- Commit: ${manifest.gitSha}
- APK: ${path.basename(binary)}
- SHA-256: ${manifest.binary.sha256}
- Gate APP-28: ${manifest.integralGate.evidenceSha256}
- Fluxos Maestro: ${manifest.integralGate.maestroFlows}

Próximo comando:

\`npm run beta:android:session:from-build -- --build ${path.relative(root, manifestPath)} --device "Nome do aparelho"\`
`);
    console.log(path.relative(root, manifestPath));
  } catch (error) {
    console.error(`ERRO: ${error.message}`);
    process.exit(1);
  }
})();
