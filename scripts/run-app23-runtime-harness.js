#!/usr/bin/env node
// expectedAssertions=46
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const loadTypeScript = () => {
  for (const candidate of ['typescript', '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js', '/usr/local/lib/node_modules/typescript/lib/typescript.js']) { try { return require(candidate); } catch {} }
  throw new Error('TypeScript não encontrado para o harness APP-23.');
};
const ts = loadTypeScript();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app23-harness-'));
for (const relative of ['src/catalog/catalogBundleDigest.ts', 'src/catalog/utils.ts', 'src/catalog/catalogTrust.ts', 'src/catalog/catalogTransparency.ts', 'src/catalog/catalogDistribution.ts', 'src/catalog/catalogPublication.ts', 'src/catalog/catalogRolloutHealth.ts', 'src/catalog/catalogRolloutAggregation.ts']) {
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
const aggregation = loadRuntime('src/catalog/catalogRolloutAggregation.ts');
const health = loadRuntime('src/catalog/catalogRolloutHealth.ts');
const publicationRuntime = loadRuntime('src/catalog/catalogPublication.ts');
const trust = loadRuntime('src/catalog/catalogTrust.ts');
const { stableStringify } = loadRuntime('src/catalog/utils.ts');
const makePair = () => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { publicJwk: pair.publicKey.export({ format: 'jwk' }), privateJwk: pair.privateKey.export({ format: 'jwk' }) };
};
const rootKey = makePair();
const approverAKey = makePair();
const approverBKey = makePair();
const signWith = (payload, privateJwk) => crypto.sign('sha256', Buffer.from(payload), { key: crypto.createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const keyEntry = (keyId, pair) => ({ keyId, algorithm: trust.CATALOG_SIGNATURE_ALGORITHM, publicJwk: pair.publicJwk, fingerprint: trust.catalogPublicKeyFingerprint(pair.publicJwk), status: 'active', validFrom: '2026-08-04T00:00:00.000Z', addedAt: '2026-08-04T00:00:00.000Z' });
const registry = {
  schemaVersion: trust.CATALOG_TRUST_REGISTRY_SCHEMA,
  revision: 1,
  publishers: [{ publisherId: 'app23-official', displayName: 'APP-23 Official', kind: 'official', trustLevel: 'pinned', status: 'trusted', keys: [keyEntry('root-1', rootKey), keyEntry('approver-a', approverAKey), keyEntry('approver-b', approverBKey)], createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }],
  events: [], updatedAt: '2026-08-04T00:00:00.000Z'
};
const publication = { schemaVersion: publicationRuntime.CATALOG_PUBLICATION_SCHEMA, publicationId: 'app23-preview-1', publisherId: 'app23-official', keyId: 'root-1', issuedAt: '2026-08-04T12:00:00.000Z', channel: 'preview', sequence: 1, distributionManifestChecksum: 'a'.repeat(64), catalogChecksum: 'b'.repeat(64), bundleChecksum: 'c'.repeat(64), catalogVersion: '5.1.0', snapshotId: 'snapshot-app23', minAppVersion: '0.1.0', rolloutPercent: 25, cohortSalt: 'app23-rollout-salt', releaseNotes: { locale: 'pt-BR', title: 'Catálogo 5.1', summary: 'Agregação verificável.', items: ['Saúde'], checksum: 'd'.repeat(64) }, signature: 'publication-signature' };
const healthPolicy = { schemaVersion: health.CATALOG_ROLLOUT_HEALTH_POLICY_SCHEMA, policyId: 'health-policy-1', publisherId: publication.publisherId, keyId: 'root-1', publicationId: publication.publicationId, channel: publication.channel, issuedAt: '2026-08-04T12:05:00.000Z', revision: 1, thresholds: { minimumSampleSize: 6, minimumSuccessRate: 0.9, maximumFailureRate: 0.1, maximumRollbackRate: 0.05, maximumIntegrityFailureRate: 0, maximumP95DurationMs: 5000 }, signature: 'health-policy-signature' };
const policyBase = { schemaVersion: aggregation.CATALOG_ROLLOUT_AGGREGATION_POLICY_SCHEMA, aggregationPolicyId: 'aggregation-policy-1', publisherId: publication.publisherId, keyId: 'root-1', publicationId: publication.publicationId, channel: publication.channel, issuedAt: '2026-08-04T12:10:00.000Z', revision: 1, minimumUniqueContributors: 4, minimumCohortContributors: 3, maximumEvidenceAgeHours: 48, healthPolicyId: healthPolicy.policyId, healthPolicyRevision: healthPolicy.revision, healthThresholds: healthPolicy.thresholds, quorum: { minimumApprovals: 2, approvers: [{ approverId: 'release-a', publisherId: publication.publisherId, keyId: 'approver-a' }, { approverId: 'release-b', publisherId: publication.publisherId, keyId: 'approver-b' }] } };
const policy = { ...policyBase, signature: signWith(stableStringify({ ...policyBase, signature: undefined }), rootKey.privateJwk) };
const now = () => new Date('2026-08-04T14:00:00.000Z');
const evidenceFor = (index, options = {}) => {
  const cohortScore = options.cohortScore ?? (index < 3 ? 1000 : 5000);
  const signals = [
    { id: `start-${index}`, publicationId: publication.publicationId, publisherId: publication.publisherId, channel: 'preview', type: 'downloadStarted', occurredAt: `2026-08-04T12:${String(20 + index).padStart(2, '0')}:00.000Z`, cohortScore },
    { id: `download-${index}`, publicationId: publication.publicationId, publisherId: publication.publisherId, channel: 'preview', type: options.fail ? 'downloadFailed' : 'downloadSucceeded', occurredAt: `2026-08-04T12:${String(20 + index).padStart(2, '0')}:01.000Z`, durationMs: 1000 + index * 10, cohortScore },
    { id: `commit-${index}`, publicationId: publication.publicationId, publisherId: publication.publisherId, channel: 'preview', type: options.fail ? 'commitFailed' : 'commitSucceeded', occurredAt: `2026-08-04T12:${String(20 + index).padStart(2, '0')}:02.000Z`, durationMs: 1500 + index * 10, cohortScore }
  ];
  return health.createCatalogRolloutHealthEvidence({ publication, policy: healthPolicy, signals, optInConfirmed: true, now: () => new Date(`2026-08-04T13:${String(index).padStart(2, '0')}:00.000Z`) });
};
let assertions = 0;
const assert = (condition, message) => { assertions += 1; if (!condition) throw new Error(`Assertion ${assertions}: ${message}`); };
const rejected = (fn, message) => { let didReject = false; try { fn(); } catch { didReject = true; } assert(didReject, message); };
const verifiedPolicy = aggregation.verifySignedCatalogRolloutAggregationPolicy({ policy, registry, publication, now });
assert(verifiedPolicy.minimumUniqueContributors === 4, 'política assinada deve preservar k anonimato');
assert(verifiedPolicy.quorum.minimumApprovals === 2, 'política deve preservar quórum');
rejected(() => aggregation.verifySignedCatalogRolloutAggregationPolicy({ policy: { ...policy, signature: `${policy.signature}x` }, registry, publication, now }), 'política adulterada deve ser rejeitada');
rejected(() => aggregation.verifySignedCatalogRolloutAggregationPolicy({ policy: { ...policy, minimumUniqueContributors: 2, signature: signWith(stableStringify({ ...policy, minimumUniqueContributors: 2, signature: undefined }), rootKey.privateJwk) }, registry, publication, now }), 'k menor que 3 deve ser rejeitado');
rejected(() => aggregation.verifySignedCatalogRolloutAggregationPolicy({ policy: { ...policy, quorum: { minimumApprovals: 1, approvers: policy.quorum.approvers }, signature: signWith(stableStringify({ ...policy, quorum: { minimumApprovals: 1, approvers: policy.quorum.approvers }, signature: undefined }), rootKey.privateJwk) }, registry, publication, now }), 'quórum unitário deve ser rejeitado');
const evidence = [0, 1, 2, 3].map((index) => evidenceFor(index));
const submissions = evidence.map((entry, index) => aggregation.createCatalogRolloutHealthSubmission({ evidence: entry, contributorSecret: `${index}`.repeat(32), now }));
assert(submissions.every(aggregation.validateCatalogRolloutHealthSubmission), 'submissões válidas devem verificar checksum');
assert(new Set(submissions.map((entry) => entry.contributorToken)).size === 4, 'tokens devem distinguir contribuidores');
assert(!JSON.stringify(submissions).includes('00000000000000000000000000000000'), 'segredo local não pode ser exportado');
assert(submissions[0].contributorToken.length === 64, 'token deve ser SHA-256 opaco');
assert(!aggregation.validateCatalogRolloutHealthSubmission({ ...submissions[0], checksum: 'f'.repeat(64) }), 'submissão adulterada deve ser rejeitada');
const duplicate = aggregation.createCatalogRolloutHealthSubmission({ evidence: evidenceFor(0), contributorSecret: '0'.repeat(32), now: () => new Date('2026-08-04T14:01:00.000Z') });
const staleEvidence = health.createCatalogRolloutHealthEvidence({ publication, policy: healthPolicy, signals: [], optInConfirmed: true, now: () => new Date('2026-07-01T00:00:00.000Z') });
const stale = aggregation.createCatalogRolloutHealthSubmission({ evidence: staleEvidence, contributorSecret: 'stale'.repeat(8), now });
const draftReport = aggregation.buildCatalogRolloutAggregateReport({ submissions: [...submissions, duplicate, stale], policy, publication, reportPublisherId: publication.publisherId, reportKeyId: 'root-1', now });
assert(draftReport.uniqueContributors === 4, 'relatório deve deduplicar contribuição repetida');
assert(draftReport.duplicateSubmissions === 1, 'duplicata deve ser contabilizada');
assert(draftReport.rejectedSubmissions === 1, 'evidência antiga deve ser rejeitada');
assert(draftReport.status === 'healthy', 'agregado saudável deve ser aprovado');
assert(draftReport.recommendation === 'expand', 'rollout parcial saudável deve recomendar expansão');
assert(draftReport.metrics.downloadAttempts === 4, 'métricas devem somar tentativas');
assert(draftReport.metrics.commitSuccesses === 4, 'métricas devem somar commits');
const lowCohort = draftReport.cohorts.find((entry) => entry.band === '50-74');
assert(lowCohort?.suppressed === true, 'coorte com um contribuidor deve ser suprimida');
assert(lowCohort?.successRate === undefined, 'coorte suprimida não pode expor taxa');
const largeCohort = draftReport.cohorts.find((entry) => entry.band === '0-24');
assert(largeCohort?.suppressed === false, 'coorte com três contribuidores pode ser publicada');
assert(largeCohort?.contributorCount === 3, 'contagem da coorte deve preservar k');
rejected(() => aggregation.buildCatalogRolloutAggregateReport({ submissions: submissions.slice(0, 3), policy, publication, reportPublisherId: publication.publisherId, reportKeyId: 'root-1', now }), 'agregação abaixo de k deve falhar');
const report = { ...draftReport, signature: signWith(aggregation.catalogRolloutAggregateReportPayload(draftReport), rootKey.privateJwk) };
const verifiedReport = aggregation.verifySignedCatalogRolloutAggregateReport({ report, registry, policy, publication, now });
assert(verifiedReport.reportId === report.reportId, 'relatório consolidado assinado deve ser aceito');
assert(aggregation.catalogRolloutAggregateReportChecksum(report).length === 64, 'relatório deve possuir checksum estável');
rejected(() => aggregation.verifySignedCatalogRolloutAggregateReport({ report: { ...report, uniqueContributors: 5 }, registry, policy, publication, now }), 'relatório adulterado deve ser rejeitado');
rejected(() => aggregation.verifySignedCatalogRolloutAggregateReport({ report: { ...report, cohorts: report.cohorts.map((entry) => entry.suppressed ? { ...entry, suppressed: false, successRate: 1 } : entry), signature: report.signature }, registry, policy, publication, now }), 'coorte pequena exposta deve ser rejeitada');
const reportChecksum = aggregation.catalogRolloutAggregateReportChecksum(report);
const approvalFor = (approverId, keyId, pair, vote = 'approve', overrides = {}) => {
  const base = { schemaVersion: aggregation.CATALOG_RELEASE_APPROVAL_SCHEMA, approvalId: `approval-${approverId}-${vote}`, issuedAt: '2026-08-04T14:05:00.000Z', approverId, publisherId: publication.publisherId, keyId, publicationId: publication.publicationId, aggregateReportChecksum: reportChecksum, action: 'expand', targetRolloutPercent: 50, vote, reason: vote === 'approve' ? 'Saúde consolidada aprovada.' : 'Risco operacional.', ...overrides };
  return { ...base, signature: signWith(stableStringify({ ...base, signature: undefined }), pair.privateJwk) };
};
const approvalA = approvalFor('release-a', 'approver-a', approverAKey);
const approvalB = approvalFor('release-b', 'approver-b', approverBKey);
assert(aggregation.verifySignedCatalogReleaseApproval({ approval: approvalA, registry, policy, report, now }).approverId === 'release-a', 'primeira aprovação deve ser válida');
assert(aggregation.verifySignedCatalogReleaseApproval({ approval: approvalB, registry, policy, report, now }).approverId === 'release-b', 'segunda aprovação deve ser válida');
rejected(() => aggregation.verifySignedCatalogReleaseApproval({ approval: { ...approvalA, signature: `${approvalA.signature}x` }, registry, policy, report, now }), 'aprovação adulterada deve ser rejeitada');
rejected(() => aggregation.verifySignedCatalogReleaseApproval({ approval: approvalFor('intruder', 'approver-a', approverAKey), registry, policy, report, now }), 'aprovador fora da política deve ser rejeitado');
const pending = aggregation.createCatalogReleaseQuorumDecision({ action: 'expand', targetRolloutPercent: 50, report, policy, registry, approvals: [approvalA], now });
assert(pending.status === 'pending', 'uma aprovação deve manter decisão pendente');
assert(pending.approvalCount === 1, 'decisão pendente deve contar uma aprovação');
const approved = aggregation.createCatalogReleaseQuorumDecision({ action: 'expand', targetRolloutPercent: 50, report, policy, registry, approvals: [approvalA, approvalB], now });
assert(approved.status === 'approved', 'duas aprovações independentes devem formar quórum');
assert(approved.approvalCount === 2, 'quórum deve contar duas aprovações');
assert(approved.automaticExecution === false, 'decisão jamais pode executar automaticamente');
assert(aggregation.validateCatalogReleaseQuorumDecision(approved), 'decisão deve validar checksum');
assert(!aggregation.validateCatalogReleaseQuorumDecision({ ...approved, automaticExecution: true }), 'execução automática adulterada deve ser rejeitada');
const rejectA = approvalFor('release-a', 'approver-a', approverAKey, 'reject');
const rejectB = approvalFor('release-b', 'approver-b', approverBKey, 'reject');
const rejectedDecision = aggregation.createCatalogReleaseQuorumDecision({ action: 'expand', targetRolloutPercent: 50, report, policy, registry, approvals: [rejectA, rejectB], now });
assert(rejectedDecision.status === 'rejected', 'dois votos negativos devem rejeitar a decisão');
assert(rejectedDecision.rejectionCount === 2, 'rejeições devem ser contabilizadas');
const duplicateApproverDecision = aggregation.createCatalogReleaseQuorumDecision({ action: 'expand', targetRolloutPercent: 50, report, policy, registry, approvals: [approvalA, approvalA], now });
assert(duplicateApproverDecision.approvalCount === 1, 'aprovações duplicadas não podem ampliar quórum');
assert(duplicateApproverDecision.status === 'pending', 'duplicata deve manter decisão pendente');
assert(report.sourceEvidenceChecksums.length === 4, 'relatório deve preservar apenas checksums das evidências');
assert(!JSON.stringify(report).includes('rollout-signal'), 'relatório não pode conter sinais brutos');
assert(!JSON.stringify(report).includes('contributorToken'), 'relatório não pode conter tokens dos contribuidores');
assert(report.acceptedSubmissions === report.uniqueContributors, 'uma evidência por contribuidor deve ser aceita');
assert(report.windowStartedAt <= report.windowEndedAt, 'janela agregada deve ser ordenada');
if (assertions !== 46) throw new Error(`esperadas 46 asserções, obtidas ${assertions}`);
const output = { status: 'PASS', assertions, schemas: [aggregation.CATALOG_ROLLOUT_HEALTH_SUBMISSION_SCHEMA, aggregation.CATALOG_ROLLOUT_AGGREGATION_POLICY_SCHEMA, aggregation.CATALOG_ROLLOUT_AGGREGATE_REPORT_SCHEMA, aggregation.CATALOG_RELEASE_APPROVAL_SCHEMA, aggregation.CATALOG_RELEASE_QUORUM_DECISION_SCHEMA], uniqueContributors: report.uniqueContributors, duplicateSubmissions: report.duplicateSubmissions, rejectedSubmissions: report.rejectedSubmissions, cohortSuppression: true, quorum: `${approved.approvalCount}/${approved.requiredApprovals}`, automaticExecution: approved.automaticExecution };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/app-23-runtime-harness.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
