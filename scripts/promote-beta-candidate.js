#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const args = process.argv.slice(2);
const execute = args.includes('--execute');
const platformArgIndex = args.indexOf('--platform');
const platform = platformArgIndex >= 0 ? args[platformArgIndex + 1] : 'all';
if (!['android', 'ios', 'all'].includes(platform)) {
  console.error('--platform deve ser android, ios ou all.');
  process.exit(1);
}

const reportPath = path.join(root, 'artifacts', 'beta-promotion', 'report.json');
if (!fs.existsSync(reportPath)) {
  console.error('Relatório ausente. Execute npm run beta:promotion:report.');
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'ready') {
  console.error(`Promoção bloqueada: relatório está ${report.status}.`);
  process.exit(1);
}

const selected = platform === 'all' ? ['android', 'ios'] : [platform];
const commands = selected.map((target) => ({
  platform: target,
  command: 'npx',
  args: ['eas', 'build', '--platform', target, '--profile', 'beta', '--non-interactive']
}));
const plan = {
  schemaVersion: 'dnd-combat-beta-promotion-plan.v1',
  generatedAt: new Date().toISOString(),
  mode: execute ? 'execute' : 'dryRun',
  appVersion: report.app.version,
  gitSha: report.app.expectedGitSha,
  sourceBuilds: report.platforms,
  commands: commands.map((entry) => `npx ${entry.args.join(' ')}`)
};
const outputDir = path.join(root, 'artifacts', 'beta-promotion');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'promotion-plan.json'), JSON.stringify(plan, null, 2) + '\n');

console.log(`Plano de promoção beta ${report.app.version}:`);
for (const command of plan.commands) console.log(`- ${command}`);
if (!execute) {
  console.log('Dry-run concluído. Use --execute somente após revisar report.json e promotion-plan.json.');
  process.exit(0);
}

const expectedConfirmation = `promote-${report.app.version}`;
if (process.env.BETA_PROMOTION_CONFIRM !== expectedConfirmation) {
  console.error(`Confirmação ausente. Defina BETA_PROMOTION_CONFIRM=${expectedConfirmation}.`);
  process.exit(1);
}

for (const item of commands) {
  console.log(`Executando build beta ${item.platform}...`);
  const result = spawnSync(item.command, item.args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Build(s) beta solicitado(s). Registre os novos IDs no ciclo de distribuição.');
