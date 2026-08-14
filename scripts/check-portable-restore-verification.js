#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
const mustContain = (relative, snippets) => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { errors.push(`${relative}: arquivo ausente`); return; }
  const text = fs.readFileSync(absolute, 'utf8');
  snippets.forEach((snippet) => { if (!text.includes(snippet)) errors.push(`${relative}: contrato ausente ${snippet}`); });
};
mustContain('src/backup/portableRestoreVerification.ts', [
  'dnd-portable-restore-verification.v1',
  'dnd-portable-restore-integrity-receipt.v1',
  'dnd-portable-restore-evidence.v1',
  'RESTORE_EFFECTIVE_FINGERPRINT_MISMATCH',
  'RESTORE_ORPHAN_PROGRESSION_DRAFT',
  'RESTORE_CHARACTER_COMPATIBILITY_BLOCKED',
  'createPortableRestoreIntegrityReceipt',
  'validatePortableRestoreIntegrityReceipt',
  'createPortableRestoreEvidenceBundle',
  'validatePortableRestoreEvidenceBundle'
]);
mustContain('src/backup/portableRestoreSessionExecutor.ts', ['verifyCommittedPortableRestoreSession', 'recordPostRestoreVerification']);
mustContain('src/store/portableRestoreSessionStore.ts', [
  'PORTABLE_RESTORE_SESSION_STORE_VERSION =',
  'archivedSessions',
  'acknowledgePostRestoreVerification',
  'reopenArchivedRollback',
  'validatePortableRestoreIntegrityReceipt'
]);
mustContain('app/restore-session.tsx', [
  'Verificação pós-restauração',
  'restore-session-reverify',
  'restore-verification-accept',
  'restore-receipt-share',
  'restore-evidence-share',
  'Reabrir rollback seguro'
]);
mustContain('src/tests/portableRestoreVerification.test.ts', ['blocks closure', 'verifiable receipt']);
mustContain('scripts/run-app15-runtime-harness.js', ['app-15-runtime-harness.json', '5841', '15385']);
const flows = [31, 32, 33, 34].map((number) => fs.readdirSync(path.join(root, '.maestro/flows')).find((name) => name.startsWith(`${number}-`))).filter(Boolean);
if (flows.length !== 4) errors.push(`esperado 4 fluxos Maestro APP-15, encontrado ${flows.length}`);
const gate = fs.readFileSync(path.join(root, 'scripts/run-app06-native-gate.js'), 'utf8');
if (!gate.includes('34-portable-restore-receipt-reopen-rollback.yaml')) errors.push('gate nativo não inclui o fluxo 34');
const flowCount = (gate.match(/\.maestro\/flows\//g) || []).length;
if (flowCount < 27) errors.push(`gate nativo deveria reconhecer ao menos 27 fluxos, encontrado ${flowCount}`);
if (errors.length) {
  console.error('[backup:portable-restore-verification:check] FAIL');
  errors.forEach((entry) => console.error(`- ${entry}`));
  process.exit(1);
}
console.log('[backup:portable-restore-verification:check] PASS');
console.log('verificationSchema=dnd-portable-restore-verification.v1');
console.log('receiptSchema=dnd-portable-restore-integrity-receipt.v1');
console.log('evidenceSchema=dnd-portable-restore-evidence.v1');
console.log(`nativeGateFlows=${flowCount}`);
