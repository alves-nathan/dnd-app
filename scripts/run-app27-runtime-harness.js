#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const loadRuntime = require('./load-catalog-operational-audit-runtime');
const root = path.resolve(__dirname, '..');
const { audit, journal, federation, trust } = loadRuntime(root);
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(message); };
const pair = () => {
  const value = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateJwk: value.privateKey.export({ format: 'jwk' }), publicJwk: value.publicKey.export({ format: 'jwk' }) };
};
const sign = (payload, privateJwk) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const authority = pair(); const witnessA = pair(); const witnessB = pair(); const witnessC = pair();
const keyEntry = (keyId, publicJwk) => ({ keyId, algorithm: 'ECDSA_P256_SHA256', publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-01-01T00:00:00.000Z', addedAt: '2026-01-01T00:00:00.000Z' });
const publisher = (publisherId, keyId, publicJwk) => ({ publisherId, displayName: publisherId, kind: 'community', trustLevel: 'userApproved', status: 'trusted', keys: [keyEntry(keyId, publicJwk)], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const registry = { schemaVersion: 'dnd-catalog-trust-registry.v1', revision: 1, publishers: [publisher('authority', 'authority-key', authority.publicJwk), publisher('witness-a-publisher', 'a-key', witnessA.publicJwk), publisher('witness-b-publisher', 'b-key', witnessB.publicJwk), publisher('witness-c-publisher', 'c-key', witnessC.publicJwk)], events: [], updatedAt: '2026-08-04T18:00:00.000Z' };
const first = journal.appendCatalogOperationalJournalEntry({ entries: [], at: '2026-08-04T17:00:00.000Z', type: 'authorizationAccepted', authorizationId: 'auth' });
const second = journal.appendCatalogOperationalJournalEntry({ entries: [first], at: '2026-08-04T17:01:00.000Z', type: 'executionStarted', authorizationId: 'auth' });
const makePackage = (device, minute, entries = [first, second]) => audit.createCatalogOperationalAuditPackage({ source: { deviceIdHash: device.repeat(64), appVersion: '0.1.0' }, archives: [], activeJournal: entries, receipts: [], evidence: [], authorizations: [], executorConfirmations: [], aggregationPolicies: [], aggregateReports: [], releaseApprovals: [], quorumDecisions: [], publications: [], now: () => new Date(`2026-08-04T17:${String(minute).padStart(2, '0')}:00.000Z`) });
const packageA = makePackage('a', 2); const packageB = makePackage('b', 3);
const policyUnsigned = { schemaVersion: federation.CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA, policyId: 'policy-1', issuedAt: '2026-08-04T17:20:00.000Z', expiresAt: '2026-08-05T17:20:00.000Z', authorityPublisherId: 'authority', authorityKeyId: 'authority-key', minimumDevices: 2, minimumWitnessesPerPackage: 2, maximumStatementAgeHours: 24, authorizedWitnesses: [
  { witnessId: 'witness-a', displayName: 'Witness A', publisherId: 'witness-a-publisher', keyId: 'a-key' },
  { witnessId: 'witness-b', displayName: 'Witness B', publisherId: 'witness-b-publisher', keyId: 'b-key' },
  { witnessId: 'witness-c', displayName: 'Witness C', publisherId: 'witness-c-publisher', keyId: 'c-key' }
], signature: '' };
const policy = { ...policyUnsigned, signature: sign(federation.catalogOperationalWitnessPolicyPayload(policyUnsigned), authority.privateJwk) };
const witnessData = { 'witness-a': ['witness-a-publisher','a-key','c',witnessA.privateJwk], 'witness-b': ['witness-b-publisher','b-key','d',witnessB.privateJwk], 'witness-c': ['witness-c-publisher','c-key','e',witnessC.privateJwk] };
const statement = (pkg, witnessId, issuedAt = '2026-08-04T17:30:00.000Z') => {
  const [publisherId,keyId,device,privateJwk] = witnessData[witnessId];
  const verification = audit.verifyCatalogOperationalAuditPackage(pkg);
  const unsigned = { schemaVersion: federation.CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA, statementId: `${witnessId}-${pkg.packageId}`, issuedAt, expiresAt: '2026-08-05T17:30:00.000Z', witnessId, publisherId, keyId, witnessDeviceIdHash: device.repeat(64), packageId: pkg.packageId, packageChecksum: pkg.checksum, sourceDeviceIdHash: pkg.source.deviceIdHash, verificationStatus: verification.status, firstSequence: verification.firstSequence, lastSequence: verification.lastSequence, headHash: verification.headHash, signature: '' };
  return { ...unsigned, signature: sign(federation.catalogOperationalWitnessStatementPayload(unsigned), privateJwk) };
};
const now = () => new Date('2026-08-04T18:00:00.000Z');
try {
  assert(federation.verifySignedCatalogOperationalWitnessPolicy(policy, registry, now).policyId === 'policy-1', 'policy should verify');
  const statements = [statement(packageA,'witness-a'),statement(packageA,'witness-b'),statement(packageB,'witness-a'),statement(packageB,'witness-b')];
  const fed = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA, packageB], witnessStatements: statements, now });
  assert(federation.catalogOperationalFederationPackageChecksum(fed) === fed.checksum, 'federation checksum');
  const consensus = federation.verifyCatalogOperationalFederationPackage({ federation: fed, registry, now });
  assert(consensus.status === 'approved', 'consensus approved');
  assert(consensus.deviceCount === 2, 'two devices');
  assert(consensus.uniqueWitnessCount === 2, 'two witnesses');
  assert(consensus.packageResults.every((entry) => entry.witnessQuorumMet), 'quorum per package');
  assert(consensus.packageResults.every((entry) => entry.validWitnesses.length === 2), 'two valid statements per package');
  assert(consensus.canonicalHeadHash === second.hash, 'canonical head');
  assert(consensus.commonPrefixEntries === 2, 'common prefix');
  assert(consensus.comparisons[0].status === 'identical', 'identical journals');
  assert(federation.catalogOperationalFederationConsensusChecksum(consensus) === consensus.checksum, 'consensus checksum');
  assert(federation.compareCatalogOperationalFederationConsensus(consensus, consensus).status === 'identical', 'consensus comparison');

  const tampered = JSON.parse(JSON.stringify(fed)); tampered.witnessStatements[0].headHash = 'f'.repeat(64); tampered.checksum = federation.catalogOperationalFederationPackageChecksum(tampered);
  const tamperedConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: tampered, registry, now });
  assert(tamperedConsensus.status === 'rejected', 'tampered statement rejected');
  assert(tamperedConsensus.findings.some((entry) => entry.code === 'FEDERATION_STATEMENT_INVALID'), 'tampered finding');

  const missing = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA, packageB], witnessStatements: [statement(packageA,'witness-a'),statement(packageB,'witness-a')], now });
  const missingConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: missing, registry, now });
  assert(missingConsensus.status === 'rejected', 'missing quorum rejected');
  assert(missingConsensus.findings.filter((entry) => entry.code === 'FEDERATION_WITNESS_QUORUM_MISSING').length === 2, 'quorum findings');

  const duplicateWitness = statement(packageA,'witness-b'); duplicateWitness.witnessDeviceIdHash = statement(packageA,'witness-a').witnessDeviceIdHash; duplicateWitness.signature = sign(federation.catalogOperationalWitnessStatementPayload({ ...duplicateWitness, signature: '' }), witnessB.privateJwk);
  const duplicateFed = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA, packageB], witnessStatements: [statement(packageA,'witness-a'),duplicateWitness,statement(packageB,'witness-a'),statement(packageB,'witness-b')], now });
  const duplicateConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: duplicateFed, registry, now });
  assert(duplicateConsensus.status === 'rejected', 'non-independent witnesses rejected');
  assert(duplicateConsensus.findings.some((entry) => entry.code === 'FEDERATION_WITNESS_NOT_INDEPENDENT'), 'independence finding');

  const self = statement(packageA,'witness-a'); self.witnessDeviceIdHash = packageA.source.deviceIdHash; self.signature = sign(federation.catalogOperationalWitnessStatementPayload({ ...self, signature: '' }), witnessA.privateJwk);
  const selfFed = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA, packageB], witnessStatements: [self,statement(packageA,'witness-b'),statement(packageB,'witness-a'),statement(packageB,'witness-b')], now });
  const selfConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: selfFed, registry, now });
  assert(selfConsensus.status === 'rejected', 'self witness rejected');
  assert(selfConsensus.findings.some((entry) => entry.code === 'FEDERATION_STATEMENT_INVALID'), 'self witness finding');

  const forkFirst = journal.appendCatalogOperationalJournalEntry({ entries: [], at: '2026-08-04T17:00:00.000Z', type: 'executionFailed', authorizationId: 'auth' });
  const forkPackage = makePackage('f', 4, [forkFirst]);
  const forkFed = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA, forkPackage], witnessStatements: [statement(packageA,'witness-a'),statement(packageA,'witness-b'),statement(forkPackage,'witness-a'),statement(forkPackage,'witness-b')], now });
  const forkConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: forkFed, registry, now });
  assert(forkConsensus.status === 'rejected', 'fork rejected');
  assert(forkConsensus.findings.some((entry) => entry.code === 'FEDERATION_JOURNAL_FORK' || entry.code === 'FEDERATION_JOURNALS_UNRELATED'), 'fork finding');

  const staleStatement = statement(packageA,'witness-a','2026-08-02T17:00:00.000Z');
  const staleFed = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA,packageB], witnessStatements: [staleStatement,statement(packageA,'witness-b'),statement(packageB,'witness-a'),statement(packageB,'witness-b')], now });
  const staleConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: staleFed, registry, now });
  assert(staleConsensus.status === 'rejected', 'stale statement rejected');
  assert(staleConsensus.findings.some((entry) => entry.code === 'FEDERATION_STATEMENT_INVALID'), 'stale finding');

  const duplicateDevicePackage = makePackage('a', 5);
  const duplicateDeviceFed = federation.createCatalogOperationalFederationPackage({ policy, auditPackages: [packageA, duplicateDevicePackage], witnessStatements: [statement(packageA,'witness-a'),statement(packageA,'witness-b'),statement(duplicateDevicePackage,'witness-a'),statement(duplicateDevicePackage,'witness-b')], now });
  const duplicateDeviceConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: duplicateDeviceFed, registry, now });
  assert(duplicateDeviceConsensus.status === 'rejected', 'duplicate devices rejected');
  assert(duplicateDeviceConsensus.findings.some((entry) => entry.code === 'FEDERATION_DUPLICATE_DEVICE'), 'duplicate device finding');

  const altered = JSON.parse(JSON.stringify(fed)); altered.generatedAt = '2026-08-04T18:01:00.000Z';
  const alteredConsensus = federation.verifyCatalogOperationalFederationPackage({ federation: altered, registry, now });
  assert(alteredConsensus.status === 'rejected', 'altered federation rejected');
  assert(alteredConsensus.findings.some((entry) => entry.code === 'FEDERATION_PACKAGE_TAMPERED'), 'checksum finding');

  const report = { schemaVersion: 'dnd-combat-app27-runtime-harness.v1', status: 'PASS', generatedAt: new Date().toISOString(), assertions, approvedConsensus: { devices: consensus.deviceCount, witnesses: consensus.uniqueWitnessCount, headHash: consensus.canonicalHeadHash, commonPrefixEntries: consensus.commonPrefixEntries }, rejectedScenarios: ['tamperedStatement','missingQuorum','nonIndependentWitness','selfWitness','fork','staleStatement','duplicateDevice','tamperedFederation'] };
  fs.mkdirSync(path.join(root,'reports'),{recursive:true}); fs.writeFileSync(path.join(root,'reports/app-27-runtime-harness.json'),`${JSON.stringify(report,null,2)}\n`); console.log(JSON.stringify(report,null,2));
} catch (error) {
  const report = { schemaVersion: 'dnd-combat-app27-runtime-harness.v1', status: 'FAIL', generatedAt: new Date().toISOString(), assertions, issue: error instanceof Error ? error.message : String(error) };
  fs.mkdirSync(path.join(root,'reports'),{recursive:true}); fs.writeFileSync(path.join(root,'reports/app-27-runtime-harness.json'),`${JSON.stringify(report,null,2)}\n`); console.error(JSON.stringify(report,null,2)); process.exit(1);
}
