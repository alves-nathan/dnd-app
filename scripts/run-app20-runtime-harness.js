#!/usr/bin/env node
// expectedAssertions=41
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) { try { return require(candidate); } catch {} }
  throw new Error('TypeScript não encontrado para o harness APP-20.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app20-harness-'));
const transpile = (file) => {
  const relative = path.relative(root, file);
  const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText);
};
for (const file of [
  'src/catalog/catalogBundleDigest.ts','src/catalog/utils.ts','src/catalog/catalogTrust.ts','src/catalog/catalogTransparency.ts','src/catalog/catalogDistribution.ts','src/catalog/catalogDownloadCoordinator.ts','src/storage/keyValueStorage.ts','src/storage/catalogDownloadCacheRepository.ts'
]) transpile(path.join(root, file));
const loadRuntime = (relative) => {
  const runtimePath = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
  const runtimeModule = new Module(runtimePath, module);
  runtimeModule.filename = runtimePath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
  return runtimeModule.exports;
};
const distribution = loadRuntime('src/catalog/catalogDistribution.ts');
const coordinator = loadRuntime('src/catalog/catalogDownloadCoordinator.ts');
const trust = loadRuntime('src/catalog/catalogTrust.ts');
const { stableStringify } = loadRuntime('src/catalog/utils.ts');
const { sha256Hex } = loadRuntime('src/catalog/catalogBundleDigest.ts');
const { createMemoryKeyValueStorage } = loadRuntime('src/storage/keyValueStorage.ts');
const { createCatalogDownloadCacheRepository } = loadRuntime('src/storage/catalogDownloadCacheRepository.ts');

const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
const privateJwk = keyPair.privateKey.export({ format: 'jwk' });
const sign = (payload) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const catalog = { catalogVersion: '4.8.1', runtimeIndex: { entryCount: 1 }, dependencyGraph: { edgeCount: 0 }, entities: [{ id: 'spell:test' }] };
const provenance = {
  publisherId: 'app20-official', publisherName: 'APP-20 Official', publisherKind: 'official', keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM,
  issuedAt: '2026-08-04T17:00:00.000Z', sequence: 1, catalogChecksum: trust.catalogCanonicalChecksum(catalog), catalogVersion: catalog.catalogVersion, snapshotId: 'snapshot-app20-1'
};
const envelope = { schemaVersion: trust.SIGNED_CATALOG_BUNDLE_SCHEMA, catalog, provenance, signature: sign(trust.catalogSignaturePayload(provenance)) };
const rawText = JSON.stringify(envelope);
const splitAt = Math.ceil(rawText.length / 3);
const chunks = [];
for (let offset = 0, index = 0; offset < rawText.length; offset += splitAt, index += 1) {
  const content = rawText.slice(offset, offset + splitAt);
  chunks.push({ index, characterOffset: offset, characterLength: content.length, byteLength: distribution.utf8ByteLength(content), checksum: sha256Hex(content), content });
}
const baseManifest = {
  schemaVersion: distribution.CATALOG_DISTRIBUTION_MANIFEST_SCHEMA, publisherId: provenance.publisherId, keyId: provenance.keyId, issuedAt: '2026-08-04T17:01:00.000Z', sequence: 1,
  catalogChecksum: provenance.catalogChecksum, bundleChecksum: sha256Hex(rawText), catalogVersion: provenance.catalogVersion, snapshotId: provenance.snapshotId,
  bundleByteLength: distribution.utf8ByteLength(rawText), bundleCharacterLength: rawText.length, chunks: chunks.map(({ content, ...chunk }) => chunk), mirrors: [
    { mirrorId: 'mirror-a', label: 'Mirror A', priority: 10, statusUrl: 'https://a.example/status', chunkUrlTemplate: 'https://a.example/chunks/{bundleChecksum}/{index}' },
    { mirrorId: 'mirror-b', label: 'Mirror B', priority: 20, statusUrl: 'https://b.example/status', chunkUrlTemplate: 'https://b.example/chunks/{bundleChecksum}/{index}' }
  ]
};
const manifest = { ...baseManifest, signature: sign(stableStringify({ ...baseManifest, signature: undefined })) };
const registry = { schemaVersion: trust.CATALOG_TRUST_REGISTRY_SCHEMA, revision: 1, publishers: [{ publisherId: provenance.publisherId, displayName: provenance.publisherName, kind: 'official', trustLevel: 'pinned', status: 'trusted', keys: [{ keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-08-04T00:00:00.000Z', addedAt: '2026-08-04T00:00:00.000Z' }], createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }], events: [], updatedAt: '2026-08-04T00:00:00.000Z' };

(async () => {
  let assertions = 0;
  const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
  const verified = distribution.verifySignedCatalogDistributionManifest({ manifest, registry, now: () => new Date('2026-08-04T17:02:00.000Z') });
  assert(verified.mirrorCount === 2, 'manifesto deve preservar dois mirrors');
  assert(verified.chunkCount === chunks.length, 'manifesto deve preservar blocos');
  assert(verified.bundleChecksum === sha256Hex(rawText), 'checksum do bundle deve ser validado');
  let rejected = false;
  try { distribution.verifySignedCatalogDistributionManifest({ manifest: { ...manifest, bundleByteLength: manifest.bundleByteLength + 1 }, registry }); } catch { rejected = true; }
  assert(rejected, 'manifesto adulterado deve ser rejeitado');
  rejected = false;
  try { distribution.verifySignedCatalogDistributionManifest({ manifest: { ...manifest, mirrors: manifest.mirrors.slice(0, 1), signature: manifest.signature }, registry }); } catch { rejected = true; }
  assert(rejected, 'manifesto com um único mirror deve ser rejeitado');

  const status = (mirrorId, overrides = {}) => ({ schemaVersion: distribution.CATALOG_MIRROR_STATUS_SCHEMA, mirrorId, publisherId: manifest.publisherId, sequence: manifest.sequence, catalogChecksum: manifest.catalogChecksum, bundleChecksum: manifest.bundleChecksum, bundleByteLength: manifest.bundleByteLength, chunkCount: manifest.chunks.length, observedAt: '2026-08-04T17:03:00.000Z', ...overrides });
  const availableA = distribution.assessCatalogMirrorStatus(manifest, manifest.mirrors[0], status('mirror-a'), 40, '2026-08-04T17:03:00.000Z');
  const availableB = distribution.assessCatalogMirrorStatus(manifest, manifest.mirrors[1], status('mirror-b'), 20, '2026-08-04T17:03:00.000Z');
  assert(availableA.status === 'available', 'mirror A deve estar disponível');
  assert(availableB.status === 'available', 'mirror B deve estar disponível');
  const stale = distribution.assessCatalogMirrorStatus(manifest, manifest.mirrors[0], status('mirror-a', { sequence: 0 }), 10, '2026-08-04T17:03:00.000Z');
  assert(stale.status === 'stale', 'mirror atrasado deve ser classificado como stale');
  const conflicting = distribution.assessCatalogMirrorStatus(manifest, manifest.mirrors[1], status('mirror-b', { bundleChecksum: 'f'.repeat(64) }), 10, '2026-08-04T17:03:00.000Z');
  assert(conflicting.status === 'conflicting', 'mirror divergente deve ser bloqueado');
  const ranked = distribution.rankCatalogMirrors(manifest, [availableA, availableB], () => new Date('2026-08-04T17:04:00.000Z'));
  assert(ranked[0].mirrorId === 'mirror-a', 'prioridade assinada deve preceder menor latência');
  assert(distribution.rankCatalogMirrors(manifest, [stale, conflicting], () => new Date('2026-08-04T17:04:00.000Z')).length === 0, 'mirrors não íntegros não podem ser selecionados');

  rejected = false; try { distribution.assertCatalogNetworkPolicy({ policy: distribution.DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'cellular', observedAt: 'now' }, bundleByteLength: 100, automatic: false }); } catch { rejected = true; }
  assert(rejected, 'dados móveis devem ser bloqueados por padrão');
  distribution.assertCatalogNetworkPolicy({ policy: distribution.DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'cellular', observedAt: 'now' }, bundleByteLength: 100, automatic: false, manualOverride: true });
  assert(true, 'override manual explícito deve ser aceito');
  rejected = false; try { distribution.assertCatalogNetworkPolicy({ policy: distribution.DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'wifi', observedAt: 'now' }, bundleByteLength: 100, automatic: true }); } catch { rejected = true; }
  assert(rejected, 'modo manual deve bloquear download automático');
  rejected = false; try { distribution.assertCatalogNetworkPolicy({ policy: { ...distribution.DEFAULT_CATALOG_NETWORK_POLICY, mode: 'assisted', maxAssistedBundleBytes: 10 }, network: { kind: 'wifi', observedAt: 'now' }, bundleByteLength: 100, automatic: true }); } catch { rejected = true; }
  assert(rejected, 'limite assistido deve ser respeitado');

  const storage = createMemoryKeyValueStorage();
  const repository = createCatalogDownloadCacheRepository(storage, () => new Date('2026-08-04T17:04:00.000Z'));
  let session = distribution.createCatalogDownloadSession(manifest, () => new Date('2026-08-04T17:04:00.000Z'));
  assert(session.status === 'prepared', 'sessão deve iniciar preparada');
  session = { ...session, startedAt: '2026-08-04T17:04:00.000Z', network: { kind: 'wifi', observedAt: '2026-08-04T17:04:00.000Z' } };
  session = distribution.applyCatalogDownloadChunk({ session, manifest, chunk: manifest.chunks[0], content: chunks[0].content, mirrorId: 'mirror-a', now: () => new Date('2026-08-04T17:04:10.000Z') });
  await repository.writeChunk(session.id, 0, chunks[0].content);
  await repository.saveSession(session, manifest);
  assert(session.completedChunkIndexes.length === 1, 'primeiro bloco deve ser persistido');
  assert(session.usedMirrorIds.includes('mirror-a'), 'primeiro mirror deve ser auditado');
  const restarted = await repository.loadSession(session.id);
  assert(Boolean(restarted), 'sessão deve sobreviver ao reinício');
  assert(restarted.session.completedChunkIndexes[0] === 0, 'checkpoint deve preservar o bloco concluído');
  session = { ...restarted.session, resumeCount: restarted.session.resumeCount + 1 };
  for (let index = 1; index < chunks.length; index += 1) {
    session = distribution.applyCatalogDownloadChunk({ session, manifest, chunk: manifest.chunks[index], content: chunks[index].content, mirrorId: 'mirror-b', now: () => new Date(`2026-08-04T17:04:${10 + index}.000Z`) });
    await repository.writeChunk(session.id, index, chunks[index].content);
    await repository.saveSession(session, manifest);
  }
  assert(session.completedChunkIndexes.length === chunks.length, 'retomada deve completar os blocos restantes');
  assert(session.resumeCount === 1, 'retomada deve ser contada');
  assert(session.usedMirrorIds.length === 2, 'fallback entre mirrors deve ser preservado');
  const assembled = await repository.assemble(session.id, chunks.length);
  assert(assembled === rawText, 'cache deve materializar exatamente o envelope assinado');
  const finalized = distribution.finalizeCatalogDownload({ session, manifest, rawText: assembled, registry, now: () => new Date('2026-08-04T17:05:00.000Z') });
  assert(finalized.session.status === 'verified', 'bundle completo deve ser verificado');
  assert(finalized.trustVerification.status === 'trusted', 'assinatura do envelope deve ser revalidada offline');
  assert(finalized.evidence.verifiedOffline, 'evidência deve registrar verificação offline');
  assert(distribution.validateCatalogDownloadEvidence(finalized.evidence), 'evidência íntegra deve ser válida');
  assert(!distribution.validateCatalogDownloadEvidence({ ...finalized.evidence, downloadedBytes: 1 }), 'evidência adulterada deve falhar');
  const cacheId = `catalog-cache-${manifest.publisherId}-${manifest.sequence}-${manifest.bundleChecksum.slice(0, 12)}`;
  const descriptor = { cacheId, publisherId: manifest.publisherId, sequence: manifest.sequence, catalogVersion: manifest.catalogVersion, snapshotId: manifest.snapshotId, catalogChecksum: manifest.catalogChecksum, bundleChecksum: manifest.bundleChecksum, manifestChecksum: session.manifestChecksum, bundleByteLength: manifest.bundleByteLength, chunkCount: manifest.chunks.length, cachedAt: finalized.evidence.completedAt, lastVerifiedAt: finalized.evidence.completedAt, evidenceId: finalized.evidence.evidenceId };
  await repository.cacheVerifiedBundle(descriptor, finalized.evidence);
  const cached = await repository.readCachedBundle(cacheId);
  assert(cached.rawText === rawText, 'bundle deve permanecer disponível sem rede');
  assert(cached.descriptor.bundleChecksum === manifest.bundleChecksum, 'descritor offline deve preservar checksum');
  assert(cached.evidence.usedMirrorIds.length === 2, 'evidência deve preservar mirrors utilizados');
  rejected = false; try { distribution.applyCatalogDownloadChunk({ session, manifest, chunk: manifest.chunks[0], content: `${chunks[0].content}x`, mirrorId: 'mirror-a' }); } catch { rejected = true; }
  assert(rejected, 'bloco adulterado deve ser rejeitado antes de entrar no cache');
  const storage2 = createMemoryKeyValueStorage();
  const repository2 = createCatalogDownloadCacheRepository(storage2, () => new Date('2026-08-04T17:06:00.000Z'));
  let transportPhase = 1;
  const transport = {
    probe: async () => { throw new Error('probe não usado'); },
    fetchChunk: async (mirror, _manifest, chunk) => {
      if (transportPhase === 1 && chunk.index > 0) throw new Error('interrupção simulada');
      if (transportPhase === 2 && mirror.mirrorId === 'mirror-a') throw new Error('mirror A indisponível');
      return chunks[chunk.index].content;
    }
  };
  const firstRun = await coordinator.runCatalogDownloadCoordinator({ manifest, observations: [availableA, availableB], repository: repository2, transport, policy: distribution.DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'wifi', observedAt: '2026-08-04T17:06:00.000Z' }, registry, manualOverride: true, now: () => new Date('2026-08-04T17:06:00.000Z') });
  assert(!firstRun.ok && firstRun.session.status === 'paused', 'coordenador deve persistir interrupção como pausa');
  assert(firstRun.session.completedChunkIndexes.length === 1, 'coordenador deve preservar somente blocos verificados antes da interrupção');
  transportPhase = 2;
  const resumedRun = await coordinator.runCatalogDownloadCoordinator({ manifest, observations: [availableA, availableB], repository: repository2, transport, policy: distribution.DEFAULT_CATALOG_NETWORK_POLICY, network: { kind: 'wifi', observedAt: '2026-08-04T17:07:00.000Z' }, registry, session: firstRun.session, manualOverride: true, now: () => new Date('2026-08-04T17:07:00.000Z') });
  assert(resumedRun.ok && resumedRun.session.status === 'verified', 'coordenador deve concluir a retomada');
  assert(resumedRun.session.resumeCount === 1, 'coordenador deve contar a retomada');
  assert(resumedRun.evidence.usedMirrorIds.includes('mirror-a') && resumedRun.evidence.usedMirrorIds.includes('mirror-b'), 'coordenador deve registrar fallback entre mirrors');

  const removed = await repository.removeCachedBundle(cacheId);
  assert(removed, 'cache verificado deve poder ser removido explicitamente');
  rejected = false; try { await repository.readCachedBundle(cacheId); } catch { rejected = true; }
  assert(rejected, 'cache removido não deve continuar legível');
  assert(finalized.session.downloadedBytes === manifest.bundleByteLength, 'evidência deve registrar todos os bytes verificados');
  if (assertions !== 41) throw new Error(`Esperadas 41 asserções, obtidas ${assertions}.`);

  const report = { status: 'PASS', assertions, mirrors: manifest.mirrors.length, chunks: chunks.length, bundleBytes: manifest.bundleByteLength, interruptionResume: 'PASS', mirrorFallback: 'PASS', staleMirror: 'REJECTED', conflictingMirror: 'REJECTED', offlineVerification: 'PASS', evidenceTampering: 'REJECTED' };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/app-20-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
