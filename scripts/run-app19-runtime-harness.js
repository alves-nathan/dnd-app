#!/usr/bin/env node
// expectedAssertions=32
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
  throw new Error('TypeScript não encontrado para o harness APP-19.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app19-harness-'));
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
const transparency = loadRuntime('src/catalog/catalogTransparency.ts');
const trust = loadRuntime('src/catalog/catalogTrust.ts');
const utils = loadRuntime('src/catalog/utils.ts');
const { sha256Hex } = loadRuntime('src/catalog/catalogBundleDigest.ts');

const pair = () => {
  const generated = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { publicJwk: generated.publicKey.export({ format: 'jwk' }), privateJwk: generated.privateKey.export({ format: 'jwk' }) };
};
const sign = (payload, privateJwk) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const verification = (sequence, checksum, previous) => ({
  status: 'trusted', publisherId: 'app19-official', publisherName: 'APP-19 Official', publisherKind: 'official', trustLevel: 'pinned', keyId: 'root-1', keyFingerprint: 'f'.repeat(64), signatureAlgorithm: trust.CATALOG_SIGNATURE_ALGORITHM,
  issuedAt: `2026-08-04T15:${String(sequence).padStart(2, '0')}:00.000Z`, sequence, ...(previous ? { previousBundleChecksum: previous } : {}), catalogChecksum: checksum,
  catalogVersion: `4.8.${sequence}`, snapshotId: `snapshot-${sequence}`, signature: `signature-${sequence}`, chainStatus: sequence === 1 ? 'anchored' : 'continued'
});
const createRegistry = (publicJwk) => ({
  schemaVersion: trust.CATALOG_TRUST_REGISTRY_SCHEMA, revision: 1, publishers: [{
    publisherId: 'app19-official', displayName: 'APP-19 Official', kind: 'official', trustLevel: 'pinned', status: 'trusted',
    keys: [{ keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-08-04T00:00:00.000Z', addedAt: '2026-08-04T00:00:00.000Z' }],
    lastAcceptedBundle: { checksum: '0'.repeat(64), sequence: 0, catalogVersion: '4.8.0', snapshotId: 'snapshot-0', keyId: 'root-1', acceptedAt: '2026-08-04T00:00:00.000Z' },
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z'
  }], events: [], updatedAt: '2026-08-04T00:00:00.000Z'
});

(() => {
  let assertions = 0;
  const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
  const checksum1 = '1'.repeat(64); const checksum2 = '2'.repeat(64); const checksum3 = '3'.repeat(64);
  let log0 = transparency.createCatalogTransparencyLog('app19-official', () => new Date('2026-08-04T15:00:00.000Z'));
  assert(log0.entries.length === 0, 'registro inicial deve estar vazio');
  assert(log0.treeRoot.length === 64, 'raiz vazia deve usar SHA-256');
  const first = transparency.appendCatalogTransparencyEntry(log0, verification(1, checksum1), '2026-08-04T15:01:00.000Z');
  assert(first.log.entries.length === 1, 'primeiro bundle deve ser anexado');
  assert(transparency.verifyCatalogInclusionProof(first.anchor.inclusionProof), 'prova do primeiro bundle deve ser válida');
  assert(first.anchor.treeSize === 1, 'âncora deve preservar o tamanho da árvore');
  const tamperedProof = { ...first.anchor.inclusionProof, rootHash: '0'.repeat(64) };
  assert(!transparency.verifyCatalogInclusionProof(tamperedProof), 'prova adulterada deve falhar');
  const second = transparency.appendCatalogTransparencyEntry(first.log, verification(2, checksum2, checksum1), '2026-08-04T15:02:00.000Z');
  const third = transparency.appendCatalogTransparencyEntry(second.log, verification(3, checksum3, checksum2), '2026-08-04T15:03:00.000Z');
  assert(third.log.entries.length === 3, 'registro deve possuir três entradas');
  assert(third.log.treeRoot !== first.log.treeRoot, 'a raiz deve mudar quando novas folhas são anexadas');
  assert(third.log.entries[2].previousBundleChecksum === checksum2, 'cadeia deve apontar para o checksum anterior');
  const consistency = transparency.createCatalogConsistencyProof(first.log, third.log);
  assert(transparency.verifyCatalogConsistencyProof(consistency), 'prova de consistência deve ser válida');
  assert(consistency.oldSize === 1 && consistency.newSize === 3, 'prova deve preservar os dois tamanhos da árvore');
  assert(transparency.compareCatalogTransparencyLogs(first.log, third.log) === 'remoteAhead', 'registro maior deve ser extensão remota');
  assert(transparency.compareCatalogTransparencyLogs(third.log, first.log) === 'localAhead', 'registro menor deve ser detectado como rollback remoto');
  assert(transparency.compareCatalogTransparencyLogs(third.log, JSON.parse(JSON.stringify(third.log))) === 'identical', 'cópias íntegras devem ser idênticas');
  const forked = JSON.parse(JSON.stringify(third.log)); forked.entries[2].catalogChecksum = '9'.repeat(64); forked.entries[2].leafHash = sha256Hex(`catalog-transparency-leaf:${utils.stableStringify({ publisherId: forked.entries[2].publisherId, sequence: forked.entries[2].sequence, catalogChecksum: forked.entries[2].catalogChecksum, catalogVersion: forked.entries[2].catalogVersion, snapshotId: forked.entries[2].snapshotId, keyId: forked.entries[2].keyId, previousBundleChecksum: forked.entries[2].previousBundleChecksum, acceptedAt: forked.entries[2].acceptedAt })}`); forked.treeRoot = transparency.computeCatalogTransparencyRoot(forked.entries.map((entry) => entry.leafHash));
  assert(transparency.compareCatalogTransparencyLogs(third.log, forked) === 'forked', 'bifurcação deve ser detectada');
  const idempotent = transparency.appendCatalogTransparencyEntry(third.log, verification(3, checksum3, checksum2));
  assert(idempotent.log.entries.length === 3, 'retomada não deve duplicar entrada já confirmada');

  const keyPair = pair();
  const registry = createRegistry(keyPair.publicJwk);
  const manifestBase = {
    schemaVersion: transparency.CATALOG_REMOTE_MANIFEST_SCHEMA, publisherId: 'app19-official', keyId: 'root-1', issuedAt: '2026-08-04T15:04:00.000Z',
    latestSequence: 3, latestCatalogChecksum: checksum3, latestCatalogVersion: '4.8.3', latestSnapshotId: 'snapshot-3',
    logId: third.log.logId, logSize: third.log.entries.length, logRoot: third.log.treeRoot
  };
  const manifest = { ...manifestBase, signature: sign(utils.stableStringify({ ...manifestBase, signature: undefined }), keyPair.privateJwk) };
  const verifiedManifest = transparency.verifySignedCatalogRemoteManifest({ manifest, registry, localLog: third.log, now: () => new Date('2026-08-04T15:05:00.000Z') });
  assert(verifiedManifest.status === 'current', 'manifesto na mesma sequência deve estar atual');
  const nextManifestBase = { ...manifestBase, issuedAt: '2026-08-04T15:05:00.000Z', latestSequence: 4, latestCatalogChecksum: '4'.repeat(64), latestCatalogVersion: '4.8.4', latestSnapshotId: 'snapshot-4', logSize: 4, logRoot: 'a'.repeat(64) };
  const nextManifest = { ...nextManifestBase, signature: sign(utils.stableStringify({ ...nextManifestBase, signature: undefined }), keyPair.privateJwk) };
  const nextVerified = transparency.verifySignedCatalogRemoteManifest({ manifest: nextManifest, registry, localLog: third.log, now: () => new Date('2026-08-04T15:06:00.000Z') });
  assert(nextVerified.status === 'updateAvailable', 'manifesto adiante deve anunciar atualização');
  let rejected = false;
  const rollbackBase = { ...manifestBase, latestSequence: 2, logSize: 2, latestCatalogChecksum: checksum2, latestCatalogVersion: '4.8.2', latestSnapshotId: 'snapshot-2' };
  const rollbackManifest = { ...rollbackBase, signature: sign(utils.stableStringify({ ...rollbackBase, signature: undefined }), keyPair.privateJwk) };
  try { transparency.verifySignedCatalogRemoteManifest({ manifest: rollbackManifest, registry, localLog: third.log }); } catch { rejected = true; }
  assert(rejected, 'rollback do servidor deve ser rejeitado');
  const omissionBase = { ...manifestBase, logRoot: 'b'.repeat(64) };
  const omissionManifest = { ...omissionBase, signature: sign(utils.stableStringify({ ...omissionBase, signature: undefined }), keyPair.privateJwk) };
  rejected = false; try { transparency.verifySignedCatalogRemoteManifest({ manifest: omissionManifest, registry, localLog: third.log }); } catch { rejected = true; }
  assert(rejected, 'raiz divergente na mesma altura deve ser rejeitada');
  transparency.assertBundleAllowedByRemoteManifest(verification(4, '4'.repeat(64), checksum3), nextVerified);
  assert(true, 'bundle publicado no manifesto deve ser aceito');
  rejected = false; try { transparency.assertBundleAllowedByRemoteManifest(verification(4, '5'.repeat(64), checksum3), nextVerified); } catch { rejected = true; }
  assert(rejected, 'checksum divergente do manifesto deve ser rejeitado');
  rejected = false; try { transparency.assertBundleAllowedByRemoteManifest(verification(5, '5'.repeat(64), '4'.repeat(64)), nextVerified); } catch { rejected = true; }
  assert(rejected, 'bundle à frente do manifesto conhecido deve ser rejeitado');

  const portable = transparency.createPortableCatalogTrustDocument(registry, [third.log], [], () => new Date('2026-08-04T15:07:00.000Z'));
  const parsedPortable = transparency.parsePortableCatalogTrustDocument(JSON.stringify(portable));
  assert(parsedPortable.checksum === portable.checksum, 'exportação íntegra deve ser importável');
  assert(parsedPortable.logs.length === 1, 'exportação deve preservar o registro de transparência');
  rejected = false; try { transparency.parsePortableCatalogTrustDocument(JSON.stringify({ ...portable, exportedAt: 'altered' })); } catch { rejected = true; }
  assert(rejected, 'exportação adulterada deve ser rejeitada');

  const approverA = pair(); const approverB = pair(); const replacement = pair();
  const policy = { schemaVersion: transparency.CATALOG_RECOVERY_POLICY_SCHEMA, publisherId: 'app19-official', threshold: 2, approvers: [
    { approverId: 'recovery-a', displayName: 'Recovery A', publicJwk: approverA.publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(approverA.publicJwk), status: 'active' },
    { approverId: 'recovery-b', displayName: 'Recovery B', publicJwk: approverB.publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(approverB.publicJwk), status: 'active' }
  ], updatedAt: '2026-08-04T15:08:00.000Z' };
  const recoveryBase = { schemaVersion: transparency.CATALOG_RECOVERY_STATEMENT_SCHEMA, publisherId: 'app19-official', action: 'replaceActiveKey', issuedAt: '2026-08-04T15:09:00.000Z', nonce: 'app19-recovery-1', replacementKey: { keyId: 'root-recovered', publicJwk: replacement.publicJwk, validFrom: '2026-08-04T15:09:00.000Z' } };
  const recoveryPayload = utils.stableStringify({ ...recoveryBase, approvals: undefined });
  const recovery = { ...recoveryBase, approvals: [
    { approverId: 'recovery-a', signature: sign(recoveryPayload, approverA.privateJwk) },
    { approverId: 'recovery-b', signature: sign(recoveryPayload, approverB.privateJwk) }
  ] };
  transparency.validateCatalogRecoveryStatement(policy, recovery, () => new Date('2026-08-04T15:10:00.000Z'));
  assert(true, 'duas aprovações válidas devem satisfazer o quórum');
  rejected = false; try { transparency.validateCatalogRecoveryStatement(policy, { ...recovery, approvals: recovery.approvals.slice(0, 1) }, () => new Date('2026-08-04T15:10:00.000Z')); } catch { rejected = true; }
  assert(rejected, 'aprovação única deve ser insuficiente');
  const recovered = transparency.applyCatalogTrustRecovery(registry, policy, recovery);
  const recoveredPublisher = recovered.publishers[0];
  assert(recoveredPublisher.keys.some((key) => key.keyId === 'root-recovered' && key.status === 'active'), 'chave recuperada deve ficar ativa');
  assert(recoveredPublisher.keys.find((key) => key.keyId === 'root-1').status === 'revoked', 'chave perdida anterior deve ser revogada');
  assert(recovered.events.some((entry) => entry.type === 'recoveryApplied'), 'recuperação deve ser auditada');
  assert(assertions === 31, `esperadas 32 asserções, obtidas ${assertions}`);

  const report = { status: 'PASS', assertions, logEntries: third.log.entries.length, treeRoot: third.log.treeRoot, inclusionProof: 'PASS', consistencyProof: 'PASS', remoteRollback: 'REJECTED', omission: 'REJECTED', portableTrustTampering: 'REJECTED', quorumRecovery: 'PASS' };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/app-19-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
})();// no async work
