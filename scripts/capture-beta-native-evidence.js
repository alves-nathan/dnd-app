#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { sha256Path } = require('./lib/beta-native-evidence');

const root = process.cwd();
const args = process.argv.slice(2);
const platform = args.shift();
const readArgs = (values) => {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) throw new Error(`Argumento inválido: ${token}`);
    const key = token.slice(2);
    if (key === 'confirm-real-execution') parsed[key] = true;
    else {
      const value = values[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Valor ausente para --${key}`);
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
};

const usage = () => {
  console.error(`Uso:\n  node scripts/capture-beta-native-evidence.js android|ios \\\n    --device "Aparelho e SO" --build-id "EAS build ID/URL" --git-sha SHA \\\n    --build-number 1 --binary /caminho/app.apk \\\n    --maestro artifacts/... --performance artifacts/... \\\n    --accessibility artifacts/... --backup artifacts/... \\\n    --data-safety artifacts/... --confirm-real-execution`);
};

try {
  if (!['android', 'ios'].includes(platform)) throw new Error('Plataforma deve ser android ou ios.');
  const options = readArgs(args);
  if (!options['confirm-real-execution']) throw new Error('Use --confirm-real-execution somente após executar todas as verificações no runtime nativo.');

  const required = ['device', 'build-id', 'git-sha', 'build-number', 'binary', 'maestro', 'performance', 'accessibility', 'backup', 'data-safety'];
  const missing = required.filter((key) => !options[key]);
  if (missing.length) throw new Error(`Argumentos obrigatórios ausentes: ${missing.join(', ')}`);

  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const now = new Date().toISOString();
  const normalizeLocation = (target) => {
    const absolute = path.resolve(root, target);
    if (!fs.existsSync(absolute)) throw new Error(`Artefato não encontrado: ${target}`);
    const relative = path.relative(root, absolute);
    return relative.startsWith('..') ? absolute : relative.split(path.sep).join('/');
  };
  const artifact = (target) => {
    const location = normalizeLocation(target);
    const absolute = path.isAbsolute(location) ? location : path.join(root, location);
    return { location, sha256: sha256Path(absolute), capturedAt: now };
  };

  const binaryLocation = normalizeLocation(options.binary);
  const binaryAbsolute = path.isAbsolute(binaryLocation) ? binaryLocation : path.join(root, binaryLocation);
  const evidence = {
    schemaVersion: 'dnd-combat-beta-native-evidence.v3',
    platform,
    generatedAt: now,
    device: options.device,
    appVersion: app.expo.version,
    buildProfile: 'beta-candidate',
    buildId: options['build-id'],
    gitSha: options['git-sha'],
    binarySha256: sha256Path(binaryAbsolute),
    platformBuildNumber: options['build-number'],
    testRunId: options['test-run-id'] || `${platform}-${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    e2ePassed: true,
    nativeBenchmarkPassed: true,
    accessibilityAuditPassed: true,
    backupRestorePassed: true,
    dataSafetyRehearsalPassed: true,
    artifacts: {
      maestro: artifact(options.maestro),
      performance: artifact(options.performance),
      accessibility: artifact(options.accessibility),
      backupRestore: artifact(options.backup),
      dataSafety: artifact(options['data-safety'])
    },
    notes: options.notes || 'Evidência capturada por confirmação explícita após execução nativa.'
  };

  const output = path.join(root, 'artifacts', 'beta-evidence', `${platform}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Evidência ${platform} criada: ${path.relative(root, output)}`);
  console.log('Execute npm run beta:evidence:validate para verificar hashes, versão, commit e validade temporal.');
} catch (error) {
  usage();
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
