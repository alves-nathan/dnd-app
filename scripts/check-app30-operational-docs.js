#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = {
  'docs/production/APP30_RELEASE_RUNBOOK.md': ['APP-28', 'APP-29', 'AAB', 'submissão', 'Proibições'],
  'docs/production/OPERATIONS_HANDBOOK.md': ['Responsabilidades', 'Rotina de release', 'Continuidade'],
  'docs/production/INCIDENT_ROLLBACK_PLAYBOOK.md': ['SEV-1', 'Rollback', 'Encerramento'],
  'docs/production/PRIVACY_DATA_HANDLING.md': ['Dados locais', 'opt-in', 'Suporte', 'Backup'],
  'docs/production/SUPPORT_CHECKLIST.md': ['Identificação', 'Reprodução', 'Proteção', 'Encaminhamento'],
  'docs/production/STORE_LISTING_PT_BR.md': ['Descrição curta', 'Descrição completa', 'Observação editorial'],
  'docs/production/RELEASE_NOTES_1.0.0.md': ['1.0.0', 'Destaques'],
  'docs/production/DELIVERY_INDEX.md': ['Codebase', 'Evidências', 'Segredos deliberadamente excluídos']
};
const issues = [];
const files = [];
for (const [relative, markers] of Object.entries(required)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { issues.push(`Documento ausente: ${relative}`); continue; }
  const text = fs.readFileSync(absolute, 'utf8');
  if (text.length < 200) issues.push(`Documento muito curto: ${relative}`);
  for (const marker of markers) if (!text.includes(marker)) issues.push(`Marcador ausente em ${relative}: ${marker}`);
  files.push({ path: relative, bytes: Buffer.byteLength(text), sections: (text.match(/^## /gm) || []).length });
}
const report = { schemaVersion: 'dnd-combat-app30-operational-docs.v1', status: issues.length ? 'FAIL' : 'PASS', generatedAt: new Date().toISOString(), files, issues };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-30-operational-docs.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
