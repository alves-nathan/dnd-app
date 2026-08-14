import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { createCatalogOperationalAuditPackage } from '../catalog/catalogOperationalAudit';
import {
  CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA,
  CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA,
  catalogOperationalWitnessPolicyPayload,
  catalogOperationalWitnessStatementPayload,
  createCatalogOperationalFederationPackage,
  verifyCatalogOperationalFederationPackage,
  type SignedCatalogOperationalWitnessPolicy,
  type SignedCatalogOperationalWitnessStatement
} from '../catalog/catalogOperationalFederation';
import { appendCatalogOperationalJournalEntry } from '../catalog/catalogOperationalJournal';
import { catalogPublicKeyFingerprint, type CatalogEcPublicJwk, type CatalogTrustRegistry } from '../catalog/catalogTrust';

const at = new Date('2026-08-04T18:00:00.000Z');
const key = () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateJwk: pair.privateKey.export({ format: 'jwk' }) as JsonWebKey,
    publicJwk: pair.publicKey.export({ format: 'jwk' }) as unknown as CatalogEcPublicJwk
  };
};
const signature = (payload: string, privateJwk: JsonWebKey): string => sign('sha256', Buffer.from(payload), {
  key: createPrivateKey({ key: privateJwk, format: 'jwk' }),
  dsaEncoding: 'ieee-p1363'
}).toString('base64url');

const authority = key();
const witnessA = key();
const witnessB = key();
const publisher = (publisherId: string, keyId: string, publicJwk: CatalogEcPublicJwk) => ({
  publisherId,
  displayName: publisherId,
  kind: 'community' as const,
  trustLevel: 'userApproved' as const,
  status: 'trusted' as const,
  keys: [{ keyId, algorithm: 'ECDSA_P256_SHA256' as const, publicJwk, fingerprint: catalogPublicKeyFingerprint(publicJwk), status: 'active' as const, validFrom: '2026-01-01T00:00:00.000Z', addedAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
});
const registry: CatalogTrustRegistry = {
  schemaVersion: 'dnd-catalog-trust-registry.v1', revision: 1, updatedAt: at.toISOString(), events: [],
  publishers: [publisher('audit-authority', 'authority-key', authority.publicJwk), publisher('witness-a-publisher', 'witness-a-key', witnessA.publicJwk), publisher('witness-b-publisher', 'witness-b-key', witnessB.publicJwk)]
};

const journal = [appendCatalogOperationalJournalEntry({ entries: [], at: '2026-08-04T17:00:00.000Z', type: 'authorizationAccepted', authorizationId: 'auth' })];
const makePackage = (device: string, minute: number) => createCatalogOperationalAuditPackage({
  source: { deviceIdHash: device.repeat(64), appVersion: '0.1.0' }, archives: [], activeJournal: journal,
  receipts: [], evidence: [], authorizations: [], executorConfirmations: [], aggregationPolicies: [], aggregateReports: [], releaseApprovals: [], quorumDecisions: [], publications: [],
  now: () => new Date(`2026-08-04T17:${String(minute).padStart(2, '0')}:00.000Z`)
});
const packageA = makePackage('a', 1);
const packageB = makePackage('b', 2);

const unsignedPolicy: SignedCatalogOperationalWitnessPolicy = {
  schemaVersion: CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA,
  policyId: 'audit-federation-policy-1',
  issuedAt: '2026-08-04T17:30:00.000Z',
  expiresAt: '2026-08-05T17:30:00.000Z',
  authorityPublisherId: 'audit-authority',
  authorityKeyId: 'authority-key',
  minimumDevices: 2,
  minimumWitnessesPerPackage: 2,
  maximumStatementAgeHours: 24,
  authorizedWitnesses: [
    { witnessId: 'witness-a', displayName: 'Witness A', publisherId: 'witness-a-publisher', keyId: 'witness-a-key' },
    { witnessId: 'witness-b', displayName: 'Witness B', publisherId: 'witness-b-publisher', keyId: 'witness-b-key' }
  ],
  signature: ''
};
const policy: SignedCatalogOperationalWitnessPolicy = { ...unsignedPolicy, signature: signature(catalogOperationalWitnessPolicyPayload(unsignedPolicy), authority.privateJwk) };

const statement = (auditPackage: typeof packageA, witnessId: 'witness-a' | 'witness-b', witnessIndex: 'c' | 'd'): SignedCatalogOperationalWitnessStatement => {
  const isA = witnessId === 'witness-a';
  const unsigned: SignedCatalogOperationalWitnessStatement = {
    schemaVersion: CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA,
    statementId: `${witnessId}-${auditPackage.packageId}`,
    issuedAt: '2026-08-04T17:40:00.000Z',
    expiresAt: '2026-08-05T17:40:00.000Z',
    witnessId,
    publisherId: isA ? 'witness-a-publisher' : 'witness-b-publisher',
    keyId: isA ? 'witness-a-key' : 'witness-b-key',
    witnessDeviceIdHash: witnessIndex.repeat(64),
    packageId: auditPackage.packageId,
    packageChecksum: auditPackage.checksum,
    sourceDeviceIdHash: auditPackage.source.deviceIdHash,
    verificationStatus: 'approved',
    firstSequence: 1,
    lastSequence: 1,
    headHash: journal[0].hash,
    signature: ''
  };
  return { ...unsigned, signature: signature(catalogOperationalWitnessStatementPayload(unsigned), isA ? witnessA.privateJwk : witnessB.privateJwk) };
};

describe('catalog operational federation', () => {
  it('requires independent witness quorum and rejects a forked device', () => {
    const federation = createCatalogOperationalFederationPackage({
      policy,
      auditPackages: [packageA, packageB],
      witnessStatements: [statement(packageA, 'witness-a', 'c'), statement(packageA, 'witness-b', 'd'), statement(packageB, 'witness-a', 'c'), statement(packageB, 'witness-b', 'd')],
      now: () => at
    });
    const consensus = verifyCatalogOperationalFederationPackage({ federation, registry, now: () => at });
    expect(consensus.status).toBe('approved');
    expect(consensus.deviceCount).toBe(2);
    expect(consensus.uniqueWitnessCount).toBe(2);
    expect(consensus.canonicalHeadHash).toBe(journal[0].hash);

    const forkEntry = appendCatalogOperationalJournalEntry({ entries: [], at: '2026-08-04T17:00:30.000Z', type: 'executionFailed', authorizationId: 'auth' });
    const forkedPackage = createCatalogOperationalAuditPackage({ ...packageB, activeJournal: [forkEntry], now: () => new Date('2026-08-04T17:03:00.000Z') });
    const forkedFederation = createCatalogOperationalFederationPackage({
      policy, auditPackages: [packageA, forkedPackage],
      witnessStatements: [statement(packageA, 'witness-a', 'c'), statement(packageA, 'witness-b', 'd')], now: () => at
    });
    const forkedConsensus = verifyCatalogOperationalFederationPackage({ federation: forkedFederation, registry, now: () => at });
    expect(forkedConsensus.status).toBe('rejected');
    expect(forkedConsensus.findings.some((entry) => entry.code === 'FEDERATION_JOURNAL_FORK' || entry.code === 'FEDERATION_JOURNALS_UNRELATED')).toBe(true);
  });
});
