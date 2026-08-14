#!/usr/bin/env node
// expectedAssertions=38
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) {
    try { return require(candidate); } catch {}
  }
  throw new Error('TypeScript não encontrado para o harness APP-18.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app18-harness-'));
const transpile = (file) => {
  const relative = path.relative(root, file);
  const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText);
};
const transpileTree = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { transpileTree(absolute); continue; }
    if (!entry.name.endsWith('.ts') || absolute.includes(`${path.sep}tests${path.sep}`)) continue;
    transpile(absolute);
  }
};
transpileTree(path.join(root, 'src'));
const loadRuntime = (relative) => {
  const runtimePath = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
  const runtimeModule = new Module(runtimePath, module);
  runtimeModule.filename = runtimePath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
  return runtimeModule.exports;
};
const trust = loadRuntime('src/catalog/catalogTrust.ts');
const { CatalogLoader } = loadRuntime('src/catalog/catalogLoader.ts');
const { catalogDigestAdapter, sha256Hex } = loadRuntime('src/catalog/catalogBundleDigest.ts');
const update = loadRuntime('src/catalog/catalogUpdateTransaction.ts');

const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.keys(value).sort().reduce((result, key) => { if (value[key] !== undefined) result[key] = stable(value[key]); return result; }, {}) : value;
const stableStringify = (value) => JSON.stringify(stable(value));
const pair = () => {
  const generated = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { publicJwk: generated.publicKey.export({ format: 'jwk' }), privateJwk: generated.privateKey.export({ format: 'jwk' }) };
};
const signPayload = (payload, privateJwk) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const createRegistry = (publicJwk, anchorChecksum) => ({
  schemaVersion: trust.CATALOG_TRUST_REGISTRY_SCHEMA,
  revision: 1,
  publishers: [{
    publisherId: 'app18-official', displayName: 'APP-18 Official', kind: 'official', trustLevel: 'pinned', status: 'trusted',
    keys: [{ keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-08-04T00:00:00.000Z', addedAt: '2026-08-04T00:00:00.000Z' }],
    lastAcceptedBundle: { checksum: anchorChecksum, sequence: 0, catalogVersion: '4.8.0', snapshotId: 'current', keyId: 'root-1', acceptedAt: '2026-08-04T00:00:00.000Z' },
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z'
  }], events: [], updatedAt: '2026-08-04T00:00:00.000Z'
});

(async () => {
  let assertions = 0;
  const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
  const rawCurrent = fs.readFileSync(path.join(root, 'assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'), 'utf8');
  const currentBundle = JSON.parse(rawCurrent);
  const current = await new CatalogLoader().initializeFromText(rawCurrent, { expectedSha256: sha256Hex(rawCurrent), digestAdapter: catalogDigestAdapter, now: () => new Date('2026-08-04T15:00:00.000Z') });
  assert(current.entries.length === 5841, 'catálogo real deve possuir 5841 entidades');
  assert(Array.from(current.dependenciesFrom.values()).reduce((sum, edges) => sum + edges.length, 0) === 15385, 'grafo real deve possuir 15385 dependências');
  const rootPair = pair();
  const anchorChecksum = trust.catalogCanonicalChecksum(currentBundle);
  assert(anchorChecksum.length === 64, 'checksum canônico deve ser SHA-256');
  let registry = createRegistry(rootPair.publicJwk, anchorChecksum);
  assert(trust.catalogPublicKeyFingerprint(rootPair.publicJwk) === registry.publishers[0].keys[0].fingerprint, 'fingerprint da raiz deve ser determinístico');

  const candidate = JSON.parse(rawCurrent);
  candidate.catalogVersion = '4.8.1'; candidate.manifest.version = '4.8.1'; candidate.sourcePackage.version = '4.8.1';
  candidate.runtimeIndex.version = '4.8.1'; candidate.entityRegistry.generatedFromVersion = '4.8.1'; candidate.dependencyGraph.generatedFromVersion = '4.8.1'; candidate.contentCategories.version = '4.8.1';
  candidate.runtimeIndex.entries[0].displayContext = [...candidate.runtimeIndex.entries[0].displayContext, 'APP-18 signed'];
  const candidateRaw = JSON.stringify(candidate);
  const candidateSnapshot = await new CatalogLoader().initializeFromText(candidateRaw, { expectedSha256: sha256Hex(candidateRaw), digestAdapter: catalogDigestAdapter, now: () => new Date('2026-08-04T15:05:00.000Z') });
  const provenance = {
    publisherId: 'app18-official', publisherName: 'APP-18 Official', publisherKind: 'official', keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM,
    issuedAt: '2026-08-04T15:06:00.000Z', sequence: 1, previousBundleChecksum: anchorChecksum,
    catalogChecksum: trust.catalogCanonicalChecksum(candidate), catalogVersion: '4.8.1', snapshotId: candidateSnapshot.snapshotId
  };
  const signature = signPayload(trust.catalogSignaturePayload(provenance), rootPair.privateJwk);
  const envelope = { schemaVersion: trust.SIGNED_CATALOG_BUNDLE_SCHEMA, catalog: candidate, provenance, signature };
  assert(trust.verifyP256Signature(trust.catalogSignaturePayload(provenance), signature, rootPair.publicJwk), 'assinatura P-256 válida deve ser aceita');
  const verified = trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(envelope), registry, now: () => new Date('2026-08-04T15:07:00.000Z') });
  assert(verified.verification.status === 'trusted', 'envelope deve ser confiável');
  assert(verified.verification.chainStatus === 'continued', 'cadeia deve continuar a âncora');
  assert(verified.verification.sequence === 1, 'sequência deve ser preservada');
  assert(verified.verification.catalogChecksum === provenance.catalogChecksum, 'checksum assinado deve ser preservado');

  const parsed = await update.parseAndValidateTrustedCatalogCandidate({ rawText: JSON.stringify(envelope), currentSnapshot: current, trustRegistry: registry, now: () => new Date('2026-08-04T15:07:00.000Z') });
  assert(parsed.snapshot.catalogVersion === '4.8.1', 'parser confiável deve carregar o candidato');
  assert(parsed.diff.changedEntityIds.length >= 1, 'diff deve detectar alteração assinada');
  assert(parsed.verification.keyId === 'root-1', 'parser deve devolver a chave validada');
  assert(parsed.catalogRawText.length > 10_000_000, 'bundle real deve permanecer materializado');

  const tampered = JSON.parse(JSON.stringify(envelope)); tampered.catalog.runtimeIndex.entries[0].displayContext.push('tampered');
  let rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(tampered), registry }); } catch { rejected = true; }
  assert(rejected, 'bundle adulterado deve ser rejeitado');
  const badSignature = JSON.parse(JSON.stringify(envelope)); badSignature.signature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(badSignature), registry }); } catch { rejected = true; }
  assert(rejected, 'assinatura inválida deve ser rejeitada');
  const wrongChain = JSON.parse(JSON.stringify(envelope)); wrongChain.provenance.previousBundleChecksum = 'f'.repeat(64); wrongChain.signature = signPayload(trust.catalogSignaturePayload(wrongChain.provenance), rootPair.privateJwk);
  rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(wrongChain), registry }); } catch { rejected = true; }
  assert(rejected, 'cadeia incorreta deve ser rejeitada');
  const unknown = JSON.parse(JSON.stringify(envelope)); unknown.provenance.publisherId = 'unknown'; unknown.signature = signPayload(trust.catalogSignaturePayload(unknown.provenance), rootPair.privateJwk);
  rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(unknown), registry }); } catch { rejected = true; }
  assert(rejected, 'publicador desconhecido deve ser rejeitado');
  const expired = JSON.parse(JSON.stringify(envelope)); expired.provenance.expiresAt = '2026-08-04T15:06:30.000Z'; expired.signature = signPayload(trust.catalogSignaturePayload(expired.provenance), rootPair.privateJwk);
  rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(expired), registry, now: () => new Date('2026-08-04T15:07:00.000Z') }); } catch { rejected = true; }
  assert(rejected, 'assinatura expirada deve ser rejeitada');

  const nextPair = pair();
  const rotationBase = { schemaVersion: trust.CATALOG_KEY_ROTATION_SCHEMA, publisherId: 'app18-official', currentKeyId: 'root-1', newKey: { keyId: 'root-2', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk: nextPair.publicJwk, validFrom: '2026-08-04T15:08:00.000Z' }, issuedAt: '2026-08-04T15:08:00.000Z', sequence: 2 };
  const rotation = { ...rotationBase, signature: signPayload(stableStringify(rotationBase), rootPair.privateJwk) };
  registry = trust.applyCatalogKeyRotation(registry, rotation, () => new Date('2026-08-04T15:08:01.000Z'));
  assert(registry.publishers[0].keys.find((key) => key.keyId === 'root-1').status === 'retired', 'raiz anterior deve ser aposentada');
  assert(registry.publishers[0].keys.find((key) => key.keyId === 'root-2').status === 'active', 'nova chave deve ficar ativa');
  assert(registry.events.some((event) => event.type === 'keyRotated'), 'rotação deve ser auditada');

  const rotatedProvenance = { ...provenance, keyId: 'root-2', issuedAt: '2026-08-04T15:09:00.000Z' };
  const rotatedEnvelope = { ...envelope, provenance: rotatedProvenance, signature: signPayload(trust.catalogSignaturePayload(rotatedProvenance), nextPair.privateJwk) };
  const rotatedVerified = trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(rotatedEnvelope), registry, now: () => new Date('2026-08-04T15:09:01.000Z') });
  assert(rotatedVerified.verification.keyId === 'root-2', 'bundle assinado pela chave rotacionada deve ser aceito');

  const revocationBase = { schemaVersion: trust.CATALOG_KEY_REVOCATION_SCHEMA, publisherId: 'app18-official', authorizingKeyId: 'root-2', revokedKeyId: 'root-2', reason: 'Harness revocation', issuedAt: '2026-08-04T15:10:00.000Z', sequence: 3 };
  const revocation = { ...revocationBase, signature: signPayload(stableStringify(revocationBase), nextPair.privateJwk) };
  const revokedRegistry = trust.applyCatalogKeyRevocation(registry, revocation, () => new Date('2026-08-04T15:10:01.000Z'));
  assert(revokedRegistry.publishers[0].keys.find((key) => key.keyId === 'root-2').status === 'revoked', 'chave deve ficar revogada');
  rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(rotatedEnvelope), registry: revokedRegistry }); } catch { rejected = true; }
  assert(rejected, 'bundle de chave revogada deve ser rejeitado');

  registry = trust.acceptVerifiedCatalogBundle(registry, rotatedVerified.verification, '4.8.1', candidateSnapshot.snapshotId, '2026-08-04T15:11:00.000Z');
  assert(registry.publishers[0].lastAcceptedBundle.sequence === 1, 'aceite deve avançar a âncora');
  assert(registry.publishers[0].lastAcceptedBundle.checksum === provenance.catalogChecksum, 'âncora deve registrar checksum assinado');
  const sameRevision = registry.revision;
  registry = trust.acceptVerifiedCatalogBundle(registry, rotatedVerified.verification, '4.8.1', candidateSnapshot.snapshotId, '2026-08-04T15:12:00.000Z');
  assert(registry.revision === sameRevision, 'aceite repetido deve ser idempotente');
  rejected = false; try { trust.verifySignedCatalogEnvelope({ rawText: JSON.stringify(rotatedEnvelope), registry }); } catch { rejected = true; }
  assert(rejected, 'replay de sequência aceita deve ser rejeitado no próximo preview');

  const communityPair = pair();
  const communityFingerprint = trust.catalogPublicKeyFingerprint(communityPair.publicJwk);
  let communityRegistry = createRegistry(rootPair.publicJwk, anchorChecksum);
  rejected = false; try { trust.addCommunityPublisher(communityRegistry, { publisherId: 'community.app18', displayName: 'APP-18 Community', keyId: 'community-root', publicJwk: communityPair.publicJwk, acknowledgedFingerprint: '0'.repeat(64) }); } catch { rejected = true; }
  assert(rejected, 'fingerprint comunitário incorreto deve ser rejeitado');
  communityRegistry = trust.addCommunityPublisher(communityRegistry, { publisherId: 'community.app18', displayName: 'APP-18 Community', keyId: 'community-root', publicJwk: communityPair.publicJwk, acknowledgedFingerprint: communityFingerprint, now: () => new Date('2026-08-04T15:13:00.000Z') });
  assert(communityRegistry.publishers.some((publisher) => publisher.publisherId === 'community.app18'), 'publicador comunitário deve ser adicionado');
  assert(communityRegistry.publishers.find((publisher) => publisher.publisherId === 'community.app18').trustLevel === 'userApproved', 'política comunitária deve exigir aprovação do usuário');

  const session = update.createCatalogUpdateSession({
    candidate: { id: parsed.packageId, catalogVersion: parsed.snapshot.catalogVersion, snapshotId: parsed.snapshot.snapshotId, checksum: parsed.checksum, byteLength: parsed.catalogRawText.length, chunkCount: 81, stagedAt: '2026-08-04T15:14:00.000Z' },
    diff: parsed.diff,
    impact: { characters: [], affectedCharacterIds: [], snapshotMigrationCharacterIds: [], blockingCharacterIds: [], affectedEvidenceRecordIds: [], counts: { charactersExamined: 0, charactersAffected: 0, snapshotMigrations: 0, blockingCharacters: 0, evidenceRecordsAffected: 0 } },
    projectedFilterState: { enabledBookIds: [], categoryOverrides: {}, entityOverrides: {} },
    checkpoint: { runtimeRef: { kind: 'bundled' }, catalog: { filterState: { enabledBookIds: [], categoryOverrides: {}, entityOverrides: {} }, revision: 0, history: [] }, characters: [], evidenceRecords: [], trustRegistry: createRegistry(rootPair.publicJwk, anchorChecksum) },
    trustVerification: rotatedVerified.verification,
    now: () => new Date('2026-08-04T15:14:00.000Z')
  });
  assert(update.canCommitCatalogUpdate(session).ok, 'sessão assinada sem impactos deve poder confirmar');
  const unsignedSession = { ...session, trustVerification: undefined };
  assert(!update.canCommitCatalogUpdate(unsignedSession).ok, 'sessão sem assinatura deve ser bloqueada');
  const receipt = update.createCatalogUpdateReceipt(session, () => new Date('2026-08-04T15:15:00.000Z'));
  assert(receipt.provenance.publisherId === 'app18-official', 'recibo deve preservar o publicador');
  assert(receipt.provenance.keyId === 'root-2', 'recibo deve preservar a chave');
  assert(update.validateCatalogUpdateReceipt(receipt), 'recibo assinado deve manter integridade');
  const alteredReceipt = JSON.parse(JSON.stringify(receipt)); alteredReceipt.provenance.sequence = 99;
  assert(!update.validateCatalogUpdateReceipt(alteredReceipt), 'alteração da proveniência deve invalidar o recibo');

  assert(assertions === 37, `esperadas 37 asserções, obtidas ${assertions}`);
  const report = { status: 'PASS', assertions, catalogVersion: current.catalogVersion, entities: current.entries.length, dependencies: 15385, signatureAlgorithm: trust.CATALOG_SIGNATURE_ALGORITHM, validPublisher: rotatedVerified.verification.publisherId, rotation: 'PASS', revocation: 'PASS', tampering: 'REJECTED', replay: 'REJECTED' };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/app-18-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
