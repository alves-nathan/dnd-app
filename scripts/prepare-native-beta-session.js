#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createChecklist, SESSION_SCHEMA, writeJson } = require('./lib/mobile-test-session');
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
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Valor ausente para --${key}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
};

try {
  if (!['android', 'ios'].includes(platform)) throw new Error('Plataforma deve ser android ou ios.');
  const options = readArgs(args);
  const required = ['device', 'binary', 'build-id', 'build-number', 'git-sha'];
  const missing = required.filter((key) => !options[key]);
  if (missing.length) throw new Error(`Argumentos ausentes: ${missing.join(', ')}`);

  const binary = path.resolve(root, options.binary);
  if (!fs.existsSync(binary)) throw new Error(`Binário não encontrado: ${options.binary}`);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const now = new Date().toISOString();
  const runId = options['run-id'] || `${platform}-${now.replace(/[^0-9]/g, '').slice(0, 14)}`;
  const sessionDir = path.join(root, 'artifacts', 'native-sessions', runId);
  if (fs.existsSync(sessionDir)) throw new Error(`Sessão já existe: ${path.relative(root, sessionDir)}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const relativeBinary = path.relative(root, binary).split(path.sep).join('/');
  const session = {
    schemaVersion: SESSION_SCHEMA,
    runId,
    platform,
    status: 'prepared',
    generatedAt: now,
    updatedAt: now,
    appVersion: app.expo.version,
    packageId: platform === 'android' ? app.expo.android?.package : app.expo.ios?.bundleIdentifier,
    device: options.device,
    buildId: options['build-id'],
    buildNumber: options['build-number'],
    gitSha: options['git-sha'],
    binary: {
      location: relativeBinary.startsWith('..') ? binary : relativeBinary,
      sha256: sha256Path(binary)
    },
    artifacts: {
      maestro: 'maestro',
      performance: 'performance',
      accessibility: 'accessibility.json',
      backupRestore: 'backup-restore.json',
      dataSafety: 'data-safety.json'
    },
    automated: { e2e: 'pending', performance: 'pending' },
    manual: { accessibility: 'pending', backupRestore: 'pending', dataSafety: 'pending' }
  };

  writeJson(path.join(sessionDir, 'session.json'), session);
  writeJson(path.join(sessionDir, 'accessibility.json'), createChecklist('accessibility', platform, now));
  writeJson(path.join(sessionDir, 'backup-restore.json'), createChecklist('backupRestore', platform, now));
  writeJson(path.join(sessionDir, 'data-safety.json'), createChecklist('dataSafety', platform, now));
  fs.mkdirSync(path.join(sessionDir, 'maestro'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'performance'), { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'README.md'), `# Sessão nativa ${runId}\n\n1. Execute o runner nativo da plataforma.\n2. Revise os artefatos em \`maestro/\` e \`performance/\`.\n3. Para o fechamento tático, siga também \`docs/TACTICAL_MOBILE_CLOSURE_NATIVE_CHECKLIST.md\` e execute os flows 91–94.\n4. Preencha os três checklists JSON somente após verificações reais.\n5. Use \`npm run beta:session:finalize -- --session ${path.relative(root, sessionDir)}\`.\n\nA sessão não gera evidência aprovada enquanto qualquer etapa estiver pendente.\n`);
  console.log(path.relative(root, sessionDir));
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  console.error('Uso: npm run beta:session:prepare -- android|ios --device "..." --binary app.apk --build-id ID --build-number N --git-sha SHA');
  process.exit(1);
}
