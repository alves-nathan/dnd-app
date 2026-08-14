import {
  appendCatalogOperationalJournalEntry,
  createCatalogOperationalEvidence,
  createCatalogOperationalReconciliation,
  createCatalogOperationalStateSnapshot,
  validateCatalogOperationalEvidence,
  validateCatalogOperationalJournalChain
} from '../catalog/catalogOperationalJournal';
import {
  createCatalogOperationalExecutionReceipt,
  type SignedCatalogExecutorConfirmation,
  type SignedCatalogOperationalAuthorization
} from '../catalog/catalogOperationalAuthorization';

const authorization: SignedCatalogOperationalAuthorization = {
  schemaVersion: 'dnd-catalog-operational-authorization.v1', authorizationId: 'auth-app25', issuedAt: '2026-08-04T12:00:00.000Z', expiresAt: '2026-08-04T14:00:00.000Z', publisherId: 'publisher', keyId: 'authorizer', publicationId: 'publication', aggregateReportChecksum: 'a'.repeat(64), quorumDecisionChecksum: 'b'.repeat(64), action: 'expand', targetRolloutPercent: 50, executor: { executorId: 'executor', publisherId: 'publisher', keyId: 'executor' }, nonce: 'nonce_operational_app25_123', maximumUses: 1, humanConfirmationRequired: true, automaticExecution: false, signature: 'signature'
};
const confirmation: SignedCatalogExecutorConfirmation = {
  schemaVersion: 'dnd-catalog-executor-confirmation.v1', confirmationId: 'confirmation-app25', issuedAt: '2026-08-04T12:10:00.000Z', expiresAt: '2026-08-04T13:50:00.000Z', executorId: 'executor', publisherId: 'publisher', keyId: 'executor', authorizationChecksum: 'c'.repeat(64), quorumDecisionChecksum: authorization.quorumDecisionChecksum, publicationId: authorization.publicationId, action: authorization.action, nonce: authorization.nonce, signature: 'signature'
};

const receipt = createCatalogOperationalExecutionReceipt({
  authorization,
  confirmation,
  humanConfirmedAt: '2026-08-04T12:20:00.000Z',
  startedAt: '2026-08-04T12:20:01.000Z',
  completedAt: '2026-08-04T12:20:02.000Z',
  status: 'succeeded',
  result: { kind: 'rolloutOverride', summary: 'Expanded', after: { rolloutPercent: 50 } }
});

describe('catalog operational journal', () => {
  it('detects drift and only closes after a passing reconciliation', () => {
    const first = appendCatalogOperationalJournalEntry({ entries: [], at: '2026-08-04T12:00:00.000Z', type: 'executionStarted', authorizationId: authorization.authorizationId });
    const second = appendCatalogOperationalJournalEntry({ entries: [first], at: '2026-08-04T12:20:02.000Z', type: 'executionSucceeded', authorizationId: authorization.authorizationId, receiptId: receipt.receiptId });
    expect(validateCatalogOperationalJournalChain([first, second])).toBe(true);
    expect(validateCatalogOperationalJournalChain([{ ...first, type: 'executionFailed' }, second])).toBe(false);

    const drift = createCatalogOperationalReconciliation({ receipt, actual: createCatalogOperationalStateSnapshot({ selectedChannel: 'stable', operationalOverridesChecksum: 'd'.repeat(64), publicationId: receipt.publicationId, effectiveRolloutPercent: 25 }) });
    expect(drift.status).toBe('failed');

    const passed = createCatalogOperationalReconciliation({ receipt, actual: createCatalogOperationalStateSnapshot({ selectedChannel: 'stable', operationalOverridesChecksum: 'e'.repeat(64), publicationId: receipt.publicationId, effectiveRolloutPercent: 50 }) });
    expect(passed.status).toBe('passed');
    const closed = appendCatalogOperationalJournalEntry({ entries: [first, second], at: '2026-08-04T12:30:00.000Z', type: 'operationClosed', authorizationId: authorization.authorizationId, receiptId: receipt.receiptId });
    const evidence = createCatalogOperationalEvidence({ receipt, reconciliation: passed, journalEntries: [first, second, closed], archives: [], closedAt: '2026-08-04T12:30:00.000Z' });
    expect(validateCatalogOperationalEvidence(evidence)).toBe(true);
  });
});
