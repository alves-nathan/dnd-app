import {
  assertCatalogOperationalAuthorizationUnused,
  createCatalogOperationalExecutionReceipt,
  validateCatalogOperationalExecutionReceipt,
  type SignedCatalogExecutorConfirmation,
  type SignedCatalogOperationalAuthorization
} from '../catalog/catalogOperationalAuthorization';

const authorization: SignedCatalogOperationalAuthorization = {
  schemaVersion: 'dnd-catalog-operational-authorization.v1', authorizationId: 'auth', issuedAt: '2026-08-04T12:00:00.000Z', expiresAt: '2026-08-04T13:00:00.000Z', publisherId: 'publisher', keyId: 'authorizer', publicationId: 'publication', aggregateReportChecksum: 'a'.repeat(64), quorumDecisionChecksum: 'b'.repeat(64), action: 'expand', targetRolloutPercent: 50, executor: { executorId: 'executor', publisherId: 'publisher', keyId: 'executor' }, nonce: 'nonce_operational_123456', maximumUses: 1, humanConfirmationRequired: true, automaticExecution: false, signature: 'signature'
};
const confirmation: SignedCatalogExecutorConfirmation = {
  schemaVersion: 'dnd-catalog-executor-confirmation.v1', confirmationId: 'confirmation', issuedAt: '2026-08-04T12:10:00.000Z', expiresAt: '2026-08-04T12:50:00.000Z', executorId: 'executor', publisherId: 'publisher', keyId: 'executor', authorizationChecksum: 'c'.repeat(64), quorumDecisionChecksum: authorization.quorumDecisionChecksum, publicationId: authorization.publicationId, action: authorization.action, nonce: authorization.nonce, signature: 'signature'
};

describe('catalog operational authorization', () => {
  it('creates an immutable one-use receipt after human confirmation', () => {
    const receipt = createCatalogOperationalExecutionReceipt({ authorization, confirmation, humanConfirmedAt: '2026-08-04T12:20:00.000Z', startedAt: '2026-08-04T12:20:01.000Z', completedAt: '2026-08-04T12:20:02.000Z', status: 'succeeded', result: { kind: 'rolloutOverride', summary: 'Expanded' } });
    expect(validateCatalogOperationalExecutionReceipt(receipt)).toBe(true);
    expect(receipt.useIndex).toBe(1);
    expect(receipt.automaticExecution).toBe(false);
    expect(() => assertCatalogOperationalAuthorizationUnused(authorization, [receipt])).toThrow();
  });
});
