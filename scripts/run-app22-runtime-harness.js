#!/usr/bin/env node
// expectedAssertions=42
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) { try { return require(candidate); } catch {} }
  throw new Error('TypeScript não encontrado para o harness APP-22.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app22-harness-'));
for (const relative of ['src/catalog/catalogBundleDigest.ts', 'src/catalog/utils.ts', 'src/catalog/catalogTrust.ts', 'src/catalog/catalogTransparency.ts', 'src/catalog/catalogDistribution.ts', 'src/catalog/catalogPublication.ts', 'src/catalog/catalogRolloutHealth.ts']) {
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
const health = loadRuntime('src/catalog/catalogRolloutHealth.ts');
const publicationRuntime = loadRuntime('src/catalog/catalogPublication.ts');
const trust = loadRuntime('src/catalog/catalogTrust.ts');
const { stableStringify } = loadRuntime('src/catalog/utils.ts');
const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = pair.publicKey.export({ format: 'jwk' });
const privateJwk = pair.privateKey.export({ format: 'jwk' });
const sign = (payload) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const registry = {
  schemaVersion: trust.CATALOG_TRUST_REGISTRY_SCHEMA,
  revision: 1,
  publishers: [{ publisherId: 'app22-official', displayName: 'APP-22 Official', kind: 'official', trustLevel: 'pinned', status: 'trusted', keys: [{ keyId: 'root-1', algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(publicJwk), status: 'active', validFrom: '2026-08-04T00:00:00.000Z', addedAt: '2026-08-04T00:00:00.000Z' }], createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }],
  events: [], updatedAt: '2026-08-04T00:00:00.000Z'
};
const notes = { locale: 'pt-BR', title: 'Catálogo 5.0', summary: 'Rollout saudável.', items: ['Conteúdo'], checksum: 'd'.repeat(64) };
const previewPublication = { schemaVersion: publicationRuntime.CATALOG_PUBLICATION_SCHEMA, publicationId: 'app22-preview-1', publisherId: 'app22-official', keyId: 'root-1', issuedAt: '2026-08-04T15:00:00.000Z', channel: 'preview', sequence: 1, distributionManifestChecksum: 'a'.repeat(64), catalogChecksum: 'b'.repeat(64), bundleChecksum: 'c'.repeat(64), catalogVersion: '5.0.0', snapshotId: 'snapshot-app22', minAppVersion: '0.1.0', rolloutPercent: 25, cohortSalt: 'app22-rollout-salt', releaseNotes: notes, signature: 'publication-signature' };
const betaPublication = { ...previewPublication, publicationId: 'app22-beta-1', channel: 'beta', rolloutPercent: 10 };
const stablePublication = { ...previewPublication, publicationId: 'app22-stable-1', channel: 'stable', rolloutPercent: 5 };
const signPolicy = (overrides = {}) => {
  const base = { schemaVersion: health.CATALOG_ROLLOUT_HEALTH_POLICY_SCHEMA, policyId: 'policy-1', publisherId: previewPublication.publisherId, keyId: previewPublication.keyId, publicationId: previewPublication.publicationId, channel: previewPublication.channel, issuedAt: '2026-08-04T15:05:00.000Z', revision: 1, thresholds: { minimumSampleSize: 20, minimumSuccessRate: 0.98, maximumFailureRate: 0.02, maximumRollbackRate: 0.01, maximumIntegrityFailureRate: 0, maximumP95DurationMs: 5000 }, ...overrides };
  return { ...base, signature: sign(stableStringify({ ...base, signature: undefined })) };
};
const policy = signPolicy();
const now = () => new Date('2026-08-04T16:00:00.000Z');
const healthySignals = [];
for (let index = 0; index < 10; index += 1) {
  const cohortScore = index * 900;
  healthySignals.push({ id: `start-${index}`, publicationId: previewPublication.publicationId, publisherId: previewPublication.publisherId, channel: 'preview', type: 'downloadStarted', occurredAt: `2026-08-04T15:${String(10 + index).padStart(2, '0')}:00.000Z`, cohortScore });
  healthySignals.push({ id: `download-${index}`, publicationId: previewPublication.publicationId, publisherId: previewPublication.publisherId, channel: 'preview', type: 'downloadSucceeded', occurredAt: `2026-08-04T15:${String(10 + index).padStart(2, '0')}:01.000Z`, durationMs: 1000 + index * 10, cohortScore });
  healthySignals.push({ id: `commit-${index}`, publicationId: previewPublication.publicationId, publisherId: previewPublication.publisherId, channel: 'preview', type: 'commitSucceeded', occurredAt: `2026-08-04T15:${String(10 + index).padStart(2, '0')}:02.000Z`, durationMs: 1500 + index * 10, cohortScore });
}
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const rejected = (fn, message) => { let didReject = false; try { fn(); } catch { didReject = true; } assert(didReject, message); };
const verifiedPolicy = health.verifySignedCatalogRolloutHealthPolicy({ policy, registry, publication: previewPublication, now });
assert(verifiedPolicy.policyId === policy.policyId, 'política assinada deve ser aceita');
assert(verifiedPolicy.thresholds.minimumSampleSize === 20, 'amostra mínima deve ser preservada');
rejected(() => health.verifySignedCatalogRolloutHealthPolicy({ policy: { ...policy, signature: `${policy.signature}x` }, registry, publication: previewPublication, now }), 'política adulterada deve ser rejeitada');
rejected(() => health.verifySignedCatalogRolloutHealthPolicy({ policy: signPolicy({ revision: 2 }), registry, publication: previewPublication, now }), 'primeira política não pode saltar revisão');
rejected(() => health.verifySignedCatalogRolloutHealthPolicy({ policy: signPolicy({ thresholds: { ...policy.thresholds, minimumSuccessRate: 2 } }), registry, publication: previewPublication, now }), 'limite fora de faixa deve ser rejeitado');
rejected(() => health.verifySignedCatalogRolloutHealthPolicy({ policy: signPolicy({ expiresAt: '2026-08-04T15:30:00.000Z' }), registry, publication: previewPublication, now }), 'política expirada deve ser rejeitada');
const evidence = health.createCatalogRolloutHealthEvidence({ publication: previewPublication, policy, signals: healthySignals, optInConfirmed: true, now });
assert(evidence.status === 'healthy', 'sinais saudáveis devem aprovar saúde');
assert(evidence.recommendation === 'expand', 'preview parcial saudável deve recomendar expansão');
assert(evidence.metrics.downloadAttempts === 10, 'tentativas de download devem ser agregadas');
assert(evidence.metrics.commitSuccesses === 10, 'commits devem ser agregados');
assert(evidence.metrics.successRate === 1, 'taxa de sucesso deve ser 100%');
assert(evidence.metrics.failureRate === 0, 'taxa de falha deve ser zero');
assert(evidence.cohorts.length >= 4, 'comparação entre coortes deve ser agregada');
assert(health.validateCatalogRolloutHealthEvidence(evidence), 'evidência deve validar checksum');
assert(!health.validateCatalogRolloutHealthEvidence({ ...evidence, recommendation: 'pause' }), 'evidência adulterada deve ser rejeitada');
rejected(() => health.createCatalogRolloutHealthEvidence({ publication: previewPublication, policy, signals: healthySignals, optInConfirmed: false, now }), 'exportação sem opt-in deve ser rejeitada');
const insufficient = health.createCatalogRolloutHealthEvidence({ publication: previewPublication, policy, signals: healthySignals.slice(0, 3), optInConfirmed: true, now });
assert(insufficient.status === 'insufficient', 'amostra pequena deve ser insuficiente');
assert(insufficient.recommendation === 'hold', 'amostra pequena deve recomendar espera');
const unhealthySignals = [...healthySignals, { id: 'rollback', publicationId: previewPublication.publicationId, publisherId: previewPublication.publisherId, channel: 'preview', type: 'rollbackCompleted', occurredAt: '2026-08-04T15:40:00.000Z' }, { id: 'integrity', publicationId: previewPublication.publicationId, publisherId: previewPublication.publisherId, channel: 'preview', type: 'integrityFailed', occurredAt: '2026-08-04T15:41:00.000Z' }];
const unhealthy = health.createCatalogRolloutHealthEvidence({ publication: previewPublication, policy, signals: unhealthySignals, optInConfirmed: true, now });
assert(unhealthy.status === 'unhealthy', 'rollback e integridade devem reprovar saúde');
assert(['rollback', 'pause'].includes(unhealthy.recommendation), 'saúde ruim deve recomendar pausa ou rollback');
const signDirective = (overrides = {}) => {
  const base = { schemaVersion: health.CATALOG_ROLLOUT_DIRECTIVE_SCHEMA, directiveId: 'expand-1', publisherId: previewPublication.publisherId, keyId: previewPublication.keyId, publicationId: previewPublication.publicationId, issuedAt: '2026-08-04T16:01:00.000Z', revision: 1, action: 'expand', fromRolloutPercent: 25, toRolloutPercent: 100, sourceChannel: 'preview', policyId: policy.policyId, healthEvidenceChecksum: evidence.checksum, reason: 'Saúde aprovada', ...overrides };
  return { ...base, signature: sign(stableStringify({ ...base, signature: undefined })) };
};
const expand = signDirective();
const expandVerification = health.verifySignedCatalogRolloutDirective({ directive: expand, registry, publication: previewPublication, policy, evidence, now: () => new Date('2026-08-04T16:02:00.000Z') });
assert(expandVerification.action === 'expand', 'expansão assinada deve ser aceita');
assert(expandVerification.effectiveRolloutPercent === 100, 'expansão deve alterar rollout efetivo');
assert(health.resolveEffectiveCatalogRollout(previewPublication, [expand]).rolloutPercent === 100, 'resolver deve usar a última diretriz');
rejected(() => health.verifySignedCatalogRolloutDirective({ directive: { ...expand, signature: `${expand.signature}x` }, registry, publication: previewPublication, policy, evidence, now }), 'diretriz adulterada deve ser rejeitada');
rejected(() => health.verifySignedCatalogRolloutDirective({ directive: signDirective({ fromRolloutPercent: 10 }), registry, publication: previewPublication, policy, evidence, now }), 'rollout anterior incorreto deve ser rejeitado');
rejected(() => health.verifySignedCatalogRolloutDirective({ directive: signDirective({ healthEvidenceChecksum: unhealthy.checksum }), registry, publication: previewPublication, policy, evidence: unhealthy, now }), 'expansão com saúde ruim deve ser rejeitada');
const promote = signDirective({ directiveId: 'promote-2', revision: 2, action: 'promote', fromRolloutPercent: 100, toRolloutPercent: 100, targetChannel: 'beta', targetPublicationId: betaPublication.publicationId, issuedAt: '2026-08-04T16:03:00.000Z' });
const promoteVerification = health.verifySignedCatalogRolloutDirective({ directive: promote, registry, publication: previewPublication, targetPublication: betaPublication, policy, evidence, previousDirectives: [expand], now: () => new Date('2026-08-04T16:04:00.000Z') });
assert(promoteVerification.action === 'promote', 'promoção preview para beta deve ser aceita');
assert(promoteVerification.targetPublicationId === betaPublication.publicationId, 'promoção deve vincular publicação alvo');
rejected(() => health.verifySignedCatalogRolloutDirective({ directive: signDirective({ directiveId: 'skip-2', revision: 2, action: 'promote', fromRolloutPercent: 100, toRolloutPercent: 100, targetChannel: 'stable', targetPublicationId: stablePublication.publicationId, issuedAt: '2026-08-04T16:03:00.000Z' }), registry, publication: previewPublication, targetPublication: stablePublication, policy, evidence, previousDirectives: [expand], now }), 'promoção não pode saltar beta');
rejected(() => health.verifySignedCatalogRolloutDirective({ directive: promote, registry, publication: previewPublication, targetPublication: { ...betaPublication, catalogChecksum: 'f'.repeat(64) }, policy, evidence, previousDirectives: [expand], now }), 'promoção deve preservar o catálogo');
const reduce = signDirective({ directiveId: 'reduce-2', revision: 2, action: 'reduce', fromRolloutPercent: 100, toRolloutPercent: 50, issuedAt: '2026-08-04T16:03:00.000Z' });
const reduceVerification = health.verifySignedCatalogRolloutDirective({ directive: reduce, registry, publication: previewPublication, policy, evidence, previousDirectives: [expand], now });
assert(reduceVerification.effectiveRolloutPercent === 50, 'redução assinada deve diminuir rollout');
const pause = signDirective({ directiveId: 'pause-3', revision: 3, action: 'pause', fromRolloutPercent: 50, toRolloutPercent: 0, issuedAt: '2026-08-04T16:05:00.000Z' });
assert(health.verifySignedCatalogRolloutDirective({ directive: pause, registry, publication: previewPublication, policy, evidence, previousDirectives: [expand, reduce], now: () => new Date('2026-08-04T16:06:00.000Z') }).effectiveRolloutPercent === 0, 'pausa deve zerar rollout efetivo');
const rollback = signDirective({ directiveId: 'rollback-1', action: 'rollback', fromRolloutPercent: 25, toRolloutPercent: 0, healthEvidenceChecksum: unhealthy.checksum, reason: 'Rollback por integridade' });
assert(health.verifySignedCatalogRolloutDirective({ directive: rollback, registry, publication: previewPublication, policy, evidence: unhealthy, now: () => new Date('2026-08-04T16:02:00.000Z') }).action === 'rollback', 'rollback com saúde ruim deve ser aceito');
rejected(() => health.verifySignedCatalogRolloutDirective({ directive: signDirective({ action: 'rollback', toRolloutPercent: 0 }), registry, publication: previewPublication, policy, evidence, now }), 'rollback com saúde saudável deve ser rejeitado');
assert(health.resolveEffectiveCatalogRollout(previewPublication, []).rolloutPercent === 25, 'sem diretriz deve preservar rollout declarado');
assert(evidence.optInConfirmed === true, 'evidência deve registrar opt-in');
assert(!JSON.stringify(evidence).includes('device-'), 'evidência não deve carregar identificador de instalação');
assert(evidence.windowStartedAt === healthySignals[0].occurredAt, 'janela deve iniciar no primeiro sinal');
assert(evidence.metrics.p95DurationMs > 0, 'p95 deve ser calculado');
assert(evidence.findings.length > 0, 'avaliação deve explicar o resultado');
assert(publicationRuntime.evaluateCatalogPublicationEligibility({ publication: previewPublication, selectedChannel: 'preview', appVersion: '0.1.0', cohortId: 'cohort', rolloutPercentOverride: 0, rolloutDirectiveId: 'pause-3', now }).reason === 'outsideRollout', 'diretriz de rollout deve proteger elegibilidade');
assert(publicationRuntime.evaluateCatalogPublicationEligibility({ publication: previewPublication, selectedChannel: 'preview', appVersion: '0.1.0', cohortId: 'cohort', rolloutPercentOverride: 100, rolloutDirectiveId: 'expand-1', now }).rolloutDirectiveId === 'expand-1', 'evidência de elegibilidade deve registrar diretriz');
if (assertions !== 42) throw new Error(`esperadas 40 asserções, obtidas ${assertions}`);
const report = { status: 'PASS', assertions, schemas: [health.CATALOG_ROLLOUT_HEALTH_POLICY_SCHEMA, health.CATALOG_ROLLOUT_HEALTH_EVIDENCE_SCHEMA, health.CATALOG_ROLLOUT_DIRECTIVE_SCHEMA], privacy: 'OPT_IN_AGGREGATED_NO_PERSONAL_DATA', healthyRecommendation: evidence.recommendation, unhealthyRecommendation: unhealthy.recommendation, promotion: 'preview->beta', automaticExecution: 'NOT_IMPLEMENTED' };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-22-runtime-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
