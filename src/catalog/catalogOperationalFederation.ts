import { sha256Hex } from './catalogBundleDigest';
import {
  compareCatalogOperationalAuditPackages,
  verifyCatalogOperationalAuditPackage,
  type CatalogOperationalAuditComparison,
  type CatalogOperationalAuditPackage,
  type CatalogOperationalAuditStatus
} from './catalogOperationalAudit';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogTrustKey,
  type CatalogTrustRegistry
} from './catalogTrust';
import { stableStringify } from './utils';

export const CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA = 'dnd-catalog-operational-witness-policy.v1' as const;
export const CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA = 'dnd-catalog-operational-witness-statement.v1' as const;
export const CATALOG_OPERATIONAL_FEDERATION_PACKAGE_SCHEMA = 'dnd-catalog-operational-federation-package.v1' as const;
export const CATALOG_OPERATIONAL_FEDERATION_CONSENSUS_SCHEMA = 'dnd-catalog-operational-federation-consensus.v1' as const;

export interface CatalogOperationalWitnessIdentity {
  witnessId: string;
  displayName: string;
  publisherId: string;
  keyId: string;
}

export interface SignedCatalogOperationalWitnessPolicy {
  schemaVersion: typeof CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA;
  policyId: string;
  issuedAt: string;
  expiresAt?: string;
  authorityPublisherId: string;
  authorityKeyId: string;
  minimumDevices: number;
  minimumWitnessesPerPackage: number;
  maximumStatementAgeHours: number;
  authorizedWitnesses: CatalogOperationalWitnessIdentity[];
  signature: string;
}

export interface SignedCatalogOperationalWitnessStatement {
  schemaVersion: typeof CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA;
  statementId: string;
  issuedAt: string;
  expiresAt?: string;
  witnessId: string;
  publisherId: string;
  keyId: string;
  witnessDeviceIdHash: string;
  packageId: string;
  packageChecksum: string;
  sourceDeviceIdHash: string;
  verificationStatus: CatalogOperationalAuditStatus;
  firstSequence?: number;
  lastSequence?: number;
  headHash?: string;
  signature: string;
}

export interface CatalogOperationalFederationPackage {
  schemaVersion: typeof CATALOG_OPERATIONAL_FEDERATION_PACKAGE_SCHEMA;
  federationId: string;
  generatedAt: string;
  policy: SignedCatalogOperationalWitnessPolicy;
  auditPackages: CatalogOperationalAuditPackage[];
  witnessStatements: SignedCatalogOperationalWitnessStatement[];
  checksum: string;
}

export interface CatalogOperationalFederationFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  packageId?: string;
  witnessId?: string;
  deviceIdHash?: string;
}

export interface CatalogOperationalFederationPackageResult {
  packageId: string;
  packageChecksum: string;
  deviceIdHash: string;
  verificationStatus: CatalogOperationalAuditStatus;
  totalEntries: number;
  headHash?: string;
  validWitnesses: string[];
  witnessQuorumMet: boolean;
}

export interface CatalogOperationalFederationConsensus {
  schemaVersion: typeof CATALOG_OPERATIONAL_FEDERATION_CONSENSUS_SCHEMA;
  consensusId: string;
  generatedAt: string;
  status: 'approved' | 'warning' | 'rejected';
  policyId?: string;
  policyChecksum?: string;
  federationChecksum?: string;
  deviceCount: number;
  uniqueWitnessCount: number;
  commonPrefixEntries: number;
  canonicalPackageId?: string;
  canonicalPackageChecksum?: string;
  canonicalHeadHash?: string;
  packageResults: CatalogOperationalFederationPackageResult[];
  comparisons: Array<{
    leftPackageId: string;
    rightPackageId: string;
    status: CatalogOperationalAuditComparison['status'];
    commonEntries: number;
    firstDivergentSequence?: number;
  }>;
  findings: CatalogOperationalFederationFinding[];
  checksum: string;
}

const HEX64 = /^[a-f0-9]{64}$/i;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const normalized = (value: string): string => value.trim().toLowerCase();
const checksumWithout = <T extends object>(value: T, key: keyof T): string => {
  const payload = { ...value } as Record<string, unknown>;
  delete payload[String(key)];
  return sha256Hex(stableStringify(payload));
};
const parseDate = (value: string | undefined, field: string): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`A data ${field} é inválida.`);
  return parsed;
};

const trustedKey = (registry: CatalogTrustRegistry, publisherId: string, keyId: string, issuedAt: string): CatalogTrustKey => {
  const publisher = registry.publishers.find((entry) => entry.publisherId === publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error(`O publicador ${publisherId} não é confiável.`);
  const key = publisher.keys.find((entry) => entry.keyId === keyId && entry.status !== 'revoked');
  if (!key || key.fingerprint !== catalogPublicKeyFingerprint(key.publicJwk)) throw new Error(`A chave ${publisherId}/${keyId} não é confiável.`);
  const at = parseDate(issuedAt, 'issuedAt');
  if (key.validFrom && at < parseDate(key.validFrom, 'validFrom')) throw new Error(`A assinatura antecede a validade da chave ${keyId}.`);
  if (key.validUntil && at > parseDate(key.validUntil, 'validUntil')) throw new Error(`A assinatura foi emitida depois da validade da chave ${keyId}.`);
  if (key.revokedAt && at >= parseDate(key.revokedAt, 'revokedAt')) throw new Error(`A chave ${keyId} já estava revogada.`);
  return key;
};

export const catalogOperationalWitnessPolicyPayload = (policy: SignedCatalogOperationalWitnessPolicy): string => stableStringify({ ...policy, signature: undefined });
export const catalogOperationalWitnessPolicyChecksum = (policy: SignedCatalogOperationalWitnessPolicy): string => sha256Hex(stableStringify(policy));
export const catalogOperationalWitnessStatementPayload = (statement: SignedCatalogOperationalWitnessStatement): string => stableStringify({ ...statement, signature: undefined });
export const catalogOperationalWitnessStatementChecksum = (statement: SignedCatalogOperationalWitnessStatement): string => sha256Hex(stableStringify(statement));
export const catalogOperationalFederationPackageChecksum = (value: CatalogOperationalFederationPackage): string => checksumWithout(value, 'checksum');
export const catalogOperationalFederationConsensusChecksum = (value: CatalogOperationalFederationConsensus): string => checksumWithout(value, 'checksum');

export const verifySignedCatalogOperationalWitnessPolicy = (
  policy: SignedCatalogOperationalWitnessPolicy,
  registry: CatalogTrustRegistry,
  now: () => Date = () => new Date()
): SignedCatalogOperationalWitnessPolicy => {
  if (policy.schemaVersion !== CATALOG_OPERATIONAL_WITNESS_POLICY_SCHEMA) throw new Error('A política de testemunhas usa um schema incompatível.');
  if (!policy.policyId?.trim()) throw new Error('A política de testemunhas não possui identificador.');
  if (!Number.isInteger(policy.minimumDevices) || policy.minimumDevices < 2) throw new Error('A federação exige pelo menos dois dispositivos.');
  if (!Number.isInteger(policy.minimumWitnessesPerPackage) || policy.minimumWitnessesPerPackage < 2) throw new Error('Cada pacote exige pelo menos duas testemunhas independentes.');
  if (!Number.isFinite(policy.maximumStatementAgeHours) || policy.maximumStatementAgeHours < 1) throw new Error('A idade máxima dos testemunhos é inválida.');
  if (policy.authorizedWitnesses.length < policy.minimumWitnessesPerPackage) throw new Error('A política não autoriza testemunhas suficientes.');
  const witnessIds = new Set<string>();
  const witnessKeys = new Set<string>();
  for (const witness of policy.authorizedWitnesses) {
    if (!witness.witnessId?.trim() || !witness.publisherId?.trim() || !witness.keyId?.trim()) throw new Error('A política contém uma testemunha incompleta.');
    if (witnessIds.has(witness.witnessId)) throw new Error(`A testemunha ${witness.witnessId} aparece mais de uma vez.`);
    const keyIdentity = `${witness.publisherId}:${witness.keyId}`;
    if (keyIdentity === `${policy.authorityPublisherId}:${policy.authorityKeyId}`) throw new Error('A autoridade da política não pode atuar como testemunha da mesma federação.');
    if (witnessKeys.has(keyIdentity)) throw new Error('Duas testemunhas não podem compartilhar a mesma chave.');
    witnessIds.add(witness.witnessId);
    witnessKeys.add(keyIdentity);
    trustedKey(registry, witness.publisherId, witness.keyId, policy.issuedAt);
  }
  const issuedAt = parseDate(policy.issuedAt, 'issuedAt');
  const current = now().getTime();
  if (issuedAt > current + 5 * 60 * 1000) throw new Error('A política foi emitida no futuro.');
  if (policy.expiresAt && current > parseDate(policy.expiresAt, 'expiresAt')) throw new Error('A política de testemunhas expirou.');
  const authority = trustedKey(registry, policy.authorityPublisherId, policy.authorityKeyId, policy.issuedAt);
  if (!verifyP256Signature(catalogOperationalWitnessPolicyPayload(policy), policy.signature, authority.publicJwk)) throw new Error('A assinatura da política de testemunhas é inválida.');
  return clone(policy);
};

export const verifySignedCatalogOperationalWitnessStatement = (params: {
  statement: SignedCatalogOperationalWitnessStatement;
  policy: SignedCatalogOperationalWitnessPolicy;
  auditPackage: CatalogOperationalAuditPackage;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): SignedCatalogOperationalWitnessStatement => {
  const { statement, policy, auditPackage, registry } = params;
  const now = params.now ?? (() => new Date());
  if (statement.schemaVersion !== CATALOG_OPERATIONAL_WITNESS_STATEMENT_SCHEMA) throw new Error('O testemunho usa um schema incompatível.');
  if (!HEX64.test(statement.witnessDeviceIdHash) || !HEX64.test(statement.sourceDeviceIdHash)) throw new Error('O testemunho possui hash de dispositivo inválido.');
  if (normalized(statement.witnessDeviceIdHash) === normalized(statement.sourceDeviceIdHash)) throw new Error('Uma testemunha não pode atestar o próprio dispositivo de origem.');
  const authorized = policy.authorizedWitnesses.find((entry) => entry.witnessId === statement.witnessId);
  if (!authorized || authorized.publisherId !== statement.publisherId || authorized.keyId !== statement.keyId) throw new Error(`A testemunha ${statement.witnessId} não está autorizada pela política.`);
  const issuedAt = parseDate(statement.issuedAt, 'issuedAt');
  const current = now().getTime();
  if (issuedAt > current + 5 * 60 * 1000) throw new Error('O testemunho foi emitido no futuro.');
  if (current - issuedAt > policy.maximumStatementAgeHours * 60 * 60 * 1000) throw new Error('O testemunho excede a idade máxima da política.');
  if (statement.expiresAt && current > parseDate(statement.expiresAt, 'expiresAt')) throw new Error('O testemunho expirou.');
  if (statement.packageId !== auditPackage.packageId || normalized(statement.packageChecksum) !== normalized(auditPackage.checksum)) throw new Error('O testemunho referencia outro pacote de auditoria.');
  if (normalized(statement.sourceDeviceIdHash) !== normalized(auditPackage.source.deviceIdHash)) throw new Error('O testemunho referencia outro dispositivo de origem.');
  const verification = verifyCatalogOperationalAuditPackage(auditPackage);
  if (statement.verificationStatus !== verification.status || statement.firstSequence !== verification.firstSequence || statement.lastSequence !== verification.lastSequence || normalized(statement.headHash ?? '') !== normalized(verification.headHash ?? '')) throw new Error('O testemunho não corresponde ao resultado independente do pacote.');
  const key = trustedKey(registry, statement.publisherId, statement.keyId, statement.issuedAt);
  if (!verifyP256Signature(catalogOperationalWitnessStatementPayload(statement), statement.signature, key.publicJwk)) throw new Error('A assinatura da testemunha é inválida.');
  return clone(statement);
};

export const createCatalogOperationalFederationPackage = (params: {
  policy: SignedCatalogOperationalWitnessPolicy;
  auditPackages: CatalogOperationalAuditPackage[];
  witnessStatements: SignedCatalogOperationalWitnessStatement[];
  now?: () => Date;
}): CatalogOperationalFederationPackage => {
  const generatedAt = (params.now ?? (() => new Date()))().toISOString();
  const payload: Omit<CatalogOperationalFederationPackage, 'checksum'> = {
    schemaVersion: CATALOG_OPERATIONAL_FEDERATION_PACKAGE_SCHEMA,
    federationId: `catalog-operational-federation-${sha256Hex(`${params.policy.policyId}:${generatedAt}:${params.auditPackages.map((entry) => entry.checksum).sort().join(':')}`).slice(0, 16)}`,
    generatedAt,
    policy: clone(params.policy),
    auditPackages: clone(params.auditPackages),
    witnessStatements: clone(params.witnessStatements)
  };
  return { ...payload, checksum: sha256Hex(stableStringify(payload)) };
};

const finding = (findings: CatalogOperationalFederationFinding[], code: string, severity: CatalogOperationalFederationFinding['severity'], message: string, extra?: Partial<CatalogOperationalFederationFinding>): void => {
  findings.push({ code, severity, message, ...extra });
};

const buildConsensus = (value: Omit<CatalogOperationalFederationConsensus, 'checksum'>): CatalogOperationalFederationConsensus => ({
  ...value,
  checksum: sha256Hex(stableStringify(value))
});

export const verifyCatalogOperationalFederationPackage = (params: {
  federation: CatalogOperationalFederationPackage;
  registry: CatalogTrustRegistry;
  now?: () => Date;
}): CatalogOperationalFederationConsensus => {
  const { federation, registry } = params;
  const now = params.now ?? (() => new Date());
  const findings: CatalogOperationalFederationFinding[] = [];
  if (federation.schemaVersion !== CATALOG_OPERATIONAL_FEDERATION_PACKAGE_SCHEMA) finding(findings, 'FEDERATION_SCHEMA_INVALID', 'error', 'O pacote federado usa um schema incompatível.');
  if (!HEX64.test(federation.checksum) || normalized(federation.checksum) !== normalized(catalogOperationalFederationPackageChecksum(federation))) finding(findings, 'FEDERATION_PACKAGE_TAMPERED', 'error', 'O checksum do pacote federado é inválido.');
  if (!Number.isFinite(Date.parse(federation.generatedAt))) finding(findings, 'FEDERATION_GENERATED_AT_INVALID', 'error', 'A data do pacote federado é inválida.');

  let policy: SignedCatalogOperationalWitnessPolicy | undefined;
  try { policy = verifySignedCatalogOperationalWitnessPolicy(federation.policy, registry, now); }
  catch (error) { finding(findings, 'FEDERATION_POLICY_INVALID', 'error', error instanceof Error ? error.message : 'A política de testemunhas é inválida.'); }

  const packageIds = new Set<string>();
  const packageChecksums = new Set<string>();
  const deviceHashes = new Set<string>();
  const packageResults: CatalogOperationalFederationPackageResult[] = [];
  const validStatementsByPackage = new Map<string, SignedCatalogOperationalWitnessStatement[]>();

  for (const auditPackage of federation.auditPackages) {
    if (packageIds.has(auditPackage.packageId) || packageChecksums.has(normalized(auditPackage.checksum))) finding(findings, 'FEDERATION_DUPLICATE_PACKAGE', 'error', `O pacote ${auditPackage.packageId} aparece mais de uma vez.`, { packageId: auditPackage.packageId });
    packageIds.add(auditPackage.packageId);
    packageChecksums.add(normalized(auditPackage.checksum));
    if (deviceHashes.has(normalized(auditPackage.source.deviceIdHash))) finding(findings, 'FEDERATION_DUPLICATE_DEVICE', 'error', 'Dois pacotes usam o mesmo dispositivo de origem.', { packageId: auditPackage.packageId, deviceIdHash: auditPackage.source.deviceIdHash });
    deviceHashes.add(normalized(auditPackage.source.deviceIdHash));
    const verification = verifyCatalogOperationalAuditPackage(auditPackage);
    if (verification.status === 'rejected') finding(findings, 'FEDERATION_AUDIT_REJECTED', 'error', `O pacote ${auditPackage.packageId} foi rejeitado pela auditoria independente.`, { packageId: auditPackage.packageId });
    else if (verification.status === 'warning') finding(findings, 'FEDERATION_AUDIT_WARNING', 'warning', `O pacote ${auditPackage.packageId} possui avisos de auditoria.`, { packageId: auditPackage.packageId });
    packageResults.push({
      packageId: auditPackage.packageId,
      packageChecksum: auditPackage.checksum,
      deviceIdHash: auditPackage.source.deviceIdHash,
      verificationStatus: verification.status,
      totalEntries: verification.counts.totalEntries,
      ...(verification.headHash ? { headHash: verification.headHash } : {}),
      validWitnesses: [],
      witnessQuorumMet: false
    });
  }

  const usedStatementIds = new Set<string>();
  for (const statement of federation.witnessStatements) {
    if (usedStatementIds.has(statement.statementId)) {
      finding(findings, 'FEDERATION_DUPLICATE_STATEMENT', 'error', `O testemunho ${statement.statementId} aparece mais de uma vez.`, { witnessId: statement.witnessId });
      continue;
    }
    usedStatementIds.add(statement.statementId);
    const auditPackage = federation.auditPackages.find((entry) => entry.packageId === statement.packageId && normalized(entry.checksum) === normalized(statement.packageChecksum));
    if (!auditPackage) {
      finding(findings, 'FEDERATION_STATEMENT_PACKAGE_MISSING', 'error', `O testemunho ${statement.statementId} referencia um pacote ausente.`, { witnessId: statement.witnessId });
      continue;
    }
    if (!policy) continue;
    try {
      const verified = verifySignedCatalogOperationalWitnessStatement({ statement, policy, auditPackage, registry, now });
      const list = validStatementsByPackage.get(auditPackage.packageId) ?? [];
      if (list.some((entry) => entry.witnessId === verified.witnessId || normalized(entry.witnessDeviceIdHash) === normalized(verified.witnessDeviceIdHash) || `${entry.publisherId}:${entry.keyId}` === `${verified.publisherId}:${verified.keyId}`)) {
        finding(findings, 'FEDERATION_WITNESS_NOT_INDEPENDENT', 'error', `A testemunha ${verified.witnessId} não é independente para o pacote ${auditPackage.packageId}.`, { packageId: auditPackage.packageId, witnessId: verified.witnessId });
        continue;
      }
      validStatementsByPackage.set(auditPackage.packageId, [...list, verified]);
    } catch (error) {
      finding(findings, 'FEDERATION_STATEMENT_INVALID', 'error', error instanceof Error ? error.message : 'O testemunho é inválido.', { packageId: auditPackage.packageId, witnessId: statement.witnessId });
    }
  }

  for (const result of packageResults) {
    const statements = validStatementsByPackage.get(result.packageId) ?? [];
    result.validWitnesses = statements.map((entry) => entry.witnessId).sort();
    result.witnessQuorumMet = Boolean(policy && statements.length >= policy.minimumWitnessesPerPackage);
    if (!result.witnessQuorumMet) finding(findings, 'FEDERATION_WITNESS_QUORUM_MISSING', 'error', `O pacote ${result.packageId} não possui testemunhas independentes suficientes.`, { packageId: result.packageId });
  }

  if (policy && deviceHashes.size < policy.minimumDevices) finding(findings, 'FEDERATION_DEVICE_QUORUM_MISSING', 'error', `A política exige pelo menos ${policy.minimumDevices} dispositivos distintos.`);

  const comparisons: CatalogOperationalFederationConsensus['comparisons'] = [];
  for (let leftIndex = 0; leftIndex < federation.auditPackages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < federation.auditPackages.length; rightIndex += 1) {
      const left = federation.auditPackages[leftIndex];
      const right = federation.auditPackages[rightIndex];
      const comparison = compareCatalogOperationalAuditPackages(left, right);
      const leftCount = packageResults.find((entry) => entry.packageId === left.packageId)?.totalEntries ?? 0;
      const rightCount = packageResults.find((entry) => entry.packageId === right.packageId)?.totalEntries ?? 0;
      const federatedStatus: CatalogOperationalAuditComparison['status'] = comparison.commonEntries === leftCount && comparison.commonEntries === rightCount
        ? 'identical'
        : comparison.status;
      comparisons.push({
        leftPackageId: left.packageId,
        rightPackageId: right.packageId,
        status: federatedStatus,
        commonEntries: comparison.commonEntries,
        ...(federatedStatus === 'forked' && comparison.firstDivergentSequence ? { firstDivergentSequence: comparison.firstDivergentSequence } : {})
      });
      if (federatedStatus === 'forked') finding(findings, 'FEDERATION_JOURNAL_FORK', 'error', `Os pacotes ${left.packageId} e ${right.packageId} bifurcaram.`, { packageId: left.packageId });
      if (federatedStatus === 'unrelated') finding(findings, 'FEDERATION_JOURNALS_UNRELATED', 'error', `Os pacotes ${left.packageId} e ${right.packageId} não compartilham uma cadeia verificável.`, { packageId: left.packageId });
    }
  }

  const canonical = packageResults.slice().sort((left, right) => right.totalEntries - left.totalEntries || left.packageId.localeCompare(right.packageId))[0];
  const commonPrefixEntries = comparisons.length ? Math.min(...comparisons.map((entry) => entry.commonEntries)) : canonical?.totalEntries ?? 0;
  const uniqueWitnesses = new Set(Array.from(validStatementsByPackage.values()).flat().map((entry) => entry.witnessId));
  const status: CatalogOperationalFederationConsensus['status'] = findings.some((entry) => entry.severity === 'error') ? 'rejected' : findings.some((entry) => entry.severity === 'warning') ? 'warning' : 'approved';
  const generatedAt = now().toISOString();
  return buildConsensus({
    schemaVersion: CATALOG_OPERATIONAL_FEDERATION_CONSENSUS_SCHEMA,
    consensusId: `catalog-operational-consensus-${sha256Hex(`${federation.checksum}:${generatedAt}`).slice(0, 16)}`,
    generatedAt,
    status,
    ...(policy ? { policyId: policy.policyId, policyChecksum: catalogOperationalWitnessPolicyChecksum(policy) } : {}),
    federationChecksum: federation.checksum,
    deviceCount: deviceHashes.size,
    uniqueWitnessCount: uniqueWitnesses.size,
    commonPrefixEntries,
    ...(canonical ? { canonicalPackageId: canonical.packageId, canonicalPackageChecksum: canonical.packageChecksum, ...(canonical.headHash ? { canonicalHeadHash: canonical.headHash } : {}) } : {}),
    packageResults,
    comparisons,
    findings
  });
};

export const parseCatalogOperationalFederationPackage = (raw: string): CatalogOperationalFederationPackage => JSON.parse(raw) as CatalogOperationalFederationPackage;

export const compareCatalogOperationalFederationConsensus = (left: CatalogOperationalFederationConsensus, right: CatalogOperationalFederationConsensus): {
  status: 'identical' | 'leftAhead' | 'rightAhead' | 'forked' | 'unrelated';
  message: string;
} => {
  if (left.policyId && right.policyId && left.policyId !== right.policyId) return { status: 'unrelated', message: 'Os consensos utilizam políticas diferentes.' };
  if (left.canonicalHeadHash && left.canonicalHeadHash === right.canonicalHeadHash) return { status: 'identical', message: 'Os consensos observam o mesmo head do diário.' };
  const leftPackage = left.packageResults.find((entry) => entry.packageChecksum === left.canonicalPackageChecksum);
  const rightPackage = right.packageResults.find((entry) => entry.packageChecksum === right.canonicalPackageChecksum);
  if (!leftPackage || !rightPackage) return { status: 'unrelated', message: 'Não foi possível identificar os pacotes canônicos.' };
  if (left.commonPrefixEntries === 0 || right.commonPrefixEntries === 0) return { status: 'unrelated', message: 'Os consensos não possuem prefixo comum verificável.' };
  const sharedPackage = left.packageResults.find((entry) => right.packageResults.some((other) => other.packageChecksum === entry.packageChecksum));
  if (!sharedPackage) return { status: 'forked', message: 'Os consensos não compartilham nenhum pacote testemunhado.' };
  if (leftPackage.totalEntries > rightPackage.totalEntries) return { status: 'leftAhead', message: 'O consenso esquerdo está à frente.' };
  if (rightPackage.totalEntries > leftPackage.totalEntries) return { status: 'rightAhead', message: 'O consenso direito está à frente.' };
  return { status: 'forked', message: 'Os consensos possuem heads diferentes na mesma altura.' };
};
