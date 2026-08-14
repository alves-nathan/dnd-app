#!/usr/bin/env node
// expectedAssertions=34
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) { try { return require(candidate); } catch {} }
  throw new Error('TypeScript não encontrado para o harness APP-21.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app21-harness-'));
for (const relative of ['src/catalog/catalogBundleDigest.ts', 'src/catalog/utils.ts', 'src/catalog/catalogTrust.ts', 'src/catalog/catalogTransparency.ts', 'src/catalog/catalogDistribution.ts', 'src/catalog/catalogPublication.ts']) {
  const file = path.join(root, relative);
  const output = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText);
}
const loadRuntime = (relative) => {
  const runtimePath = path.join(tempRoot, relative.replace(/\.ts$/, '.js'));
  const runtimeModule = new Module(runtimePath, module);
  runtimeModule.filename = runtimePath;
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  runtimeModule._compile(fs.readFileSync(runtimePath, 'utf8'), runtimePath);
  return runtimeModule.exports;
};
const publication = loadRuntime('src/catalog/catalogPublication.ts');
const distribution = loadRuntime('src/catalog/catalogDistribution.ts');
const trust = loadRuntime('src/catalog/catalogTrust.ts');
const { stableStringify } = loadRuntime('src/catalog/utils.ts');
const { sha256Hex } = loadRuntime('src/catalog/catalogBundleDigest.ts');
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = pair.publicKey.export({ format: 'jwk' });
const privateJwk = pair.privateKey.export({ format: 'jwk' });
const sign = (payload) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const registry = {
  schemaVersion: trust.CATALOG_TRUST_REGISTRY_SCHEMA,
  revision: 1,
  publishers: [{ publisherId: 'app21-official', displayName: 'APP-21 Official', kind: 'official', trustLevel: 'pinned', status: 'trusted', keys: [{ keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-08-04T00:00:00.000Z', addedAt: '2026-08-04T00:00:00.000Z' }], createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }],
  events: [], updatedAt: '2026-08-04T00:00:00.000Z'
};
const baseDistribution = {
  schemaVersion: distribution.CATALOG_DISTRIBUTION_MANIFEST_SCHEMA,
  publisherId: 'app21-official', keyId: 'root-1', issuedAt: '2026-08-04T16:00:00.000Z', sequence: 1,
  catalogChecksum: 'a'.repeat(64), bundleChecksum: 'b'.repeat(64), catalogVersion: '4.9.0', snapshotId: 'snapshot-app21-1',
  bundleByteLength: 3, bundleCharacterLength: 3,
  chunks: [{ index: 0, characterOffset: 0, characterLength: 3, byteLength: 3, checksum: sha256Hex('abc') }],
  mirrors: [
    { mirrorId: 'a', label: 'A', priority: 1, statusUrl: 'https://a.example/status', chunkUrlTemplate: 'https://a.example/{index}' },
    { mirrorId: 'b', label: 'B', priority: 2, statusUrl: 'https://b.example/status', chunkUrlTemplate: 'https://b.example/{index}' }
  ]
};
const distributionManifest = { ...baseDistribution, signature: sign(stableStringify({ ...baseDistribution, signature: undefined })) };
const notesPayload = { locale: 'pt-BR', title: 'Catálogo 4.9', summary: 'Atualização gradual das regras.', items: ['Novo conteúdo', 'Correções de dependências'] };
const releaseNotes = { ...notesPayload, checksum: publication.catalogReleaseNotesChecksum(notesPayload) };
const publicationBase = {
  schemaVersion: publication.CATALOG_PUBLICATION_SCHEMA,
  publicationId: 'app21-stable-1', publisherId: 'app21-official', keyId: 'root-1', issuedAt: '2026-08-04T16:05:00.000Z', channel: 'stable', sequence: 1,
  distributionManifestChecksum: distribution.catalogDistributionManifestChecksum(distributionManifest), catalogChecksum: distributionManifest.catalogChecksum, bundleChecksum: distributionManifest.bundleChecksum,
  catalogVersion: distributionManifest.catalogVersion, snapshotId: distributionManifest.snapshotId, minAppVersion: '0.1.0', maxAppVersion: '0.2.0', rolloutPercent: 100, cohortSalt: 'app21-rollout-salt', releaseNotes
};
const signedPublication = { ...publicationBase, signature: sign(stableStringify({ ...publicationBase, signature: undefined })) };
const signPublication = (overrides = {}) => {
  const base = { ...publicationBase, ...overrides };
  return { ...base, signature: sign(stableStringify({ ...base, signature: undefined })) };
};
const signControl = (overrides) => {
  const base = { schemaVersion: publication.CATALOG_PUBLICATION_CONTROL_SCHEMA, controlId: 'control', publicationId: signedPublication.publicationId, publisherId: signedPublication.publisherId, keyId: signedPublication.keyId, issuedAt: '2026-08-04T16:10:00.000Z', revision: 1, action: 'pause', reason: 'Pausa operacional', ...overrides };
  return { ...base, signature: sign(stableStringify({ ...base, signature: undefined })) };
};

let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
let rejected = false;
const now = () => new Date('2026-08-04T16:20:00.000Z');
const verified = publication.verifySignedCatalogPublication({ publication: signedPublication, registry, distributionManifest, now });
assert(verified.channel === 'stable', 'canal estável deve ser validado');
assert(verified.rolloutPercent === 100, 'rollout deve ser preservado');
assert(verified.keyFingerprint === trust.catalogPublicKeyFingerprint(publicJwk), 'fingerprint da chave deve ser preservado');
assert(publication.compareAppVersions('0.1.0', '0.1.0') === 0, 'versões iguais devem comparar como zero');
assert(publication.compareAppVersions('0.1.1', '0.1.0') > 0, 'versão posterior deve ser maior');
assert(publication.compareAppVersions('0.1.0-beta', '0.1.0') < 0, 'pré-release deve preceder versão final');
assert(releaseNotes.checksum === publication.catalogReleaseNotesChecksum(notesPayload), 'notas devem possuir checksum canônico');
rejected = false; try { publication.verifySignedCatalogPublication({ publication: { ...signedPublication, releaseNotes: { ...releaseNotes, summary: 'alterado' } }, registry, distributionManifest, now }); } catch { rejected = true; }
assert(rejected, 'notas adulteradas devem ser rejeitadas');
rejected = false; try { publication.verifySignedCatalogPublication({ publication: { ...signedPublication, signature: `${signedPublication.signature.startsWith('A') ? 'B' : 'A'}${signedPublication.signature.slice(1)}` }, registry, distributionManifest, now }); } catch { rejected = true; }
assert(rejected, 'assinatura adulterada deve ser rejeitada');
rejected = false; try { publication.verifySignedCatalogPublication({ publication: signedPublication, registry, distributionManifest: { ...distributionManifest, bundleChecksum: 'c'.repeat(64) }, now }); } catch { rejected = true; }
assert(rejected, 'distribuição divergente deve ser rejeitada');
const eligible = publication.evaluateCatalogPublicationEligibility({ publication: signedPublication, selectedChannel: 'stable', appVersion: '0.1.0', cohortId: 'device-a', distributionManifest, now });
assert(eligible.eligible && eligible.reason === 'eligible', 'publicação 100% compatível deve ser elegível');
assert(publication.validateCatalogPublicationEligibilityEvidence(eligible), 'evidência íntegra deve ser válida');
assert(!publication.validateCatalogPublicationEligibilityEvidence({ ...eligible, cohortScore: eligible.cohortScore + 1 }), 'evidência adulterada deve ser rejeitada');
const wrongChannel = publication.evaluateCatalogPublicationEligibility({ publication: signedPublication, selectedChannel: 'beta', appVersion: '0.1.0', cohortId: 'device-a', distributionManifest, now });
assert(!wrongChannel.eligible && wrongChannel.reason === 'channelMismatch', 'canal divergente deve bloquear elegibilidade');
const tooOld = publication.evaluateCatalogPublicationEligibility({ publication: signedPublication, selectedChannel: 'stable', appVersion: '0.0.9', cohortId: 'device-a', distributionManifest, now });
assert(tooOld.reason === 'appTooOld', 'versão antiga deve ser bloqueada');
const tooNew = publication.evaluateCatalogPublicationEligibility({ publication: signedPublication, selectedChannel: 'stable', appVersion: '0.3.0', cohortId: 'device-a', distributionManifest, now });
assert(tooNew.reason === 'appTooNew', 'versão acima do limite deve ser bloqueada');
const zeroRollout = signPublication({ publicationId: 'app21-zero', rolloutPercent: 0 });
const outside = publication.evaluateCatalogPublicationEligibility({ publication: zeroRollout, selectedChannel: 'stable', appVersion: '0.1.0', cohortId: 'device-a', distributionManifest, now });
assert(outside.reason === 'outsideRollout', 'rollout zero deve excluir a coorte');
const scoreA = publication.calculateCatalogCohortScore({ cohortId: 'device-a', publisherId: 'app21-official', publicationId: 'app21-stable-1', channel: 'stable', cohortSalt: 'app21-rollout-salt' });
const scoreB = publication.calculateCatalogCohortScore({ cohortId: 'device-a', publisherId: 'app21-official', publicationId: 'app21-stable-1', channel: 'stable', cohortSalt: 'app21-rollout-salt' });
assert(scoreA === scoreB, 'coorte deve ser determinística');
assert(scoreA >= 0 && scoreA < 10000, 'score deve permanecer entre 0 e 9999');
const riskier = publication.assessCatalogChannelMigration('stable', 'preview');
assert(riskier.direction === 'riskier' && riskier.requiresConfirmation, 'migração para preview deve exigir confirmação');
const safer = publication.assessCatalogChannelMigration('preview', 'stable');
assert(safer.direction === 'safer' && safer.requiresConfirmation, 'migração para stable deve preservar confirmação explícita');
const same = publication.assessCatalogChannelMigration('stable', 'stable');
assert(same.direction === 'same' && !same.requiresConfirmation, 'mesmo canal não deve exigir confirmação');
const pause = signControl({});
const pauseVerification = publication.verifySignedCatalogPublicationControl({ control: pause, publication: signedPublication, registry, now });
assert(pauseVerification.action === 'pause', 'pausa assinada deve ser aceita');
assert(publication.resolveCatalogPublicationStatus([pause]) === 'paused', 'pausa deve mudar estado em runtime');
const pausedEvidence = publication.evaluateCatalogPublicationEligibility({ publication: signedPublication, controls: [pause], selectedChannel: 'stable', appVersion: '0.1.0', cohortId: 'device-a', distributionManifest, now });
assert(pausedEvidence.reason === 'paused', 'publicação pausada deve ser inelegível');
const resume = signControl({ controlId: 'resume-2', revision: 2, action: 'resume', issuedAt: '2026-08-04T16:11:00.000Z', reason: 'Retomada segura' });
publication.verifySignedCatalogPublicationControl({ control: resume, publication: signedPublication, registry, previousControls: [pause], now });
assert(publication.resolveCatalogPublicationStatus([pause, resume]) === 'active', 'retomada assinada deve reativar publicação');
const withdraw = signControl({ controlId: 'withdraw-3', revision: 3, action: 'withdraw', issuedAt: '2026-08-04T16:12:00.000Z', reason: 'Publicação retirada' });
publication.verifySignedCatalogPublicationControl({ control: withdraw, publication: signedPublication, registry, previousControls: [pause, resume], now });
assert(publication.resolveCatalogPublicationStatus([pause, resume, withdraw]) === 'withdrawn', 'retirada deve ser terminal');
const afterWithdraw = signControl({ controlId: 'resume-4', revision: 4, action: 'resume', issuedAt: '2026-08-04T16:13:00.000Z', reason: 'Tentativa inválida' });
rejected = false; try { publication.verifySignedCatalogPublicationControl({ control: afterWithdraw, publication: signedPublication, registry, previousControls: [pause, resume, withdraw], now }); } catch { rejected = true; }
assert(rejected, 'publicação retirada não pode ser retomada');
rejected = false; try { publication.verifySignedCatalogPublicationControl({ control: resume, publication: signedPublication, registry, previousControls: [], now }); } catch { rejected = true; }
assert(rejected, 'controle com salto de revisão deve ser rejeitado');
const found = publication.findCatalogPublicationForDistribution({ [signedPublication.publicationId]: signedPublication }, distributionManifest);
assert(found?.publicationId === signedPublication.publicationId, 'publicação deve ser vinculada pelo checksum do manifesto');
const beta = signPublication({ publicationId: 'app21-beta-1', channel: 'beta' });
assert(publication.findCatalogPublicationForDistribution({ a: beta, b: signedPublication }, distributionManifest, 'beta')?.publicationId === beta.publicationId, 'busca deve permanecer determinística para publicação compatível');
const expiredPublication = signPublication({ publicationId: 'app21-expired', expiresAt: '2026-08-04T16:15:00.000Z' });
const expiredEvidence = publication.evaluateCatalogPublicationEligibility({ publication: expiredPublication, selectedChannel: 'stable', appVersion: '0.1.0', cohortId: 'device-a', distributionManifest, now });
assert(expiredEvidence.reason === 'expired', 'publicação expirada deve ser bloqueada');
assert(eligible.cohortIdHash === sha256Hex('device-a'), 'evidência deve expor apenas hash da coorte');
assert(eligible.distributionManifestChecksum === distribution.catalogDistributionManifestChecksum(distributionManifest), 'evidência deve vincular o manifesto');
if (assertions !== 34) throw new Error(`esperadas 34 asserções, obtidas ${assertions}`);
const report = { status: 'PASS', assertions, channels: ['stable', 'beta', 'preview'], rollout: 'DETERMINISTIC', validPublication: verified.publicationId, pause: 'PASS', withdrawal: 'TERMINAL', appCompatibility: 'PASS', releaseNotesTampering: 'REJECTED', automaticApplication: 'NOT_IMPLEMENTED' };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-21-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
