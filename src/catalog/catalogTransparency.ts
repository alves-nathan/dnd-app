import { sha256Hex } from './catalogBundleDigest';
import { stableStringify } from './utils';
import {
  catalogPublicKeyFingerprint,
  verifyP256Signature,
  type CatalogEcPublicJwk,
  type CatalogTrustRegistry,
  type CatalogTrustVerification,
  type CatalogTrustEvent,
  type CatalogTrustedPublisher
} from './catalogTrust';

export const CATALOG_TRANSPARENCY_LOG_SCHEMA = 'dnd-catalog-transparency-log.v1' as const;
export const CATALOG_TRANSPARENCY_PROOF_SCHEMA = 'dnd-catalog-transparency-proof.v1' as const;
export const CATALOG_REMOTE_MANIFEST_SCHEMA = 'dnd-catalog-remote-manifest.v1' as const;
export const CATALOG_TRUST_PORTABLE_SCHEMA = 'dnd-catalog-trust-portable.v1' as const;
export const CATALOG_RECOVERY_POLICY_SCHEMA = 'dnd-catalog-recovery-policy.v1' as const;
export const CATALOG_RECOVERY_STATEMENT_SCHEMA = 'dnd-catalog-recovery-statement.v1' as const;

export interface CatalogTransparencyEntryPayload {
  publisherId: string;
  sequence: number;
  catalogChecksum: string;
  catalogVersion: string;
  snapshotId: string;
  keyId: string;
  previousBundleChecksum?: string;
  acceptedAt: string;
}

export interface CatalogTransparencyEntry extends CatalogTransparencyEntryPayload {
  index: number;
  leafHash: string;
}

export interface CatalogTransparencyLog {
  schemaVersion: typeof CATALOG_TRANSPARENCY_LOG_SCHEMA;
  logId: string;
  publisherId: string;
  revision: number;
  entries: CatalogTransparencyEntry[];
  treeRoot: string;
  updatedAt: string;
}

export interface CatalogMerkleProofStep { side: 'left' | 'right'; hash: string }
export interface CatalogInclusionProof {
  schemaVersion: typeof CATALOG_TRANSPARENCY_PROOF_SCHEMA;
  logId: string;
  publisherId: string;
  treeSize: number;
  leafIndex: number;
  leafHash: string;
  auditPath: CatalogMerkleProofStep[];
  rootHash: string;
}

export interface CatalogConsistencyProof {
  schemaVersion: typeof CATALOG_TRANSPARENCY_PROOF_SCHEMA;
  logId: string;
  publisherId: string;
  oldSize: number;
  newSize: number;
  oldRoot: string;
  newRoot: string;
  prefixLeafHashes: string[];
  appendedLeafHashes: string[];
}

export interface SignedCatalogRemoteManifest {
  schemaVersion: typeof CATALOG_REMOTE_MANIFEST_SCHEMA;
  publisherId: string;
  keyId: string;
  issuedAt: string;
  expiresAt?: string;
  latestSequence: number;
  latestCatalogChecksum: string;
  latestCatalogVersion: string;
  latestSnapshotId: string;
  logId: string;
  logSize: number;
  logRoot: string;
  downloadUrl?: string;
  signature: string;
}

export interface CatalogRemoteManifestVerification {
  publisherId: string;
  keyId: string;
  issuedAt: string;
  latestSequence: number;
  latestCatalogChecksum: string;
  latestCatalogVersion: string;
  latestSnapshotId: string;
  logSize: number;
  logRoot: string;
  status: 'current' | 'updateAvailable';
}

export interface CatalogRecoveryApprover {
  approverId: string;
  displayName: string;
  publicJwk: CatalogEcPublicJwk;
  fingerprint: string;
  status: 'active' | 'revoked';
}

export interface CatalogRecoveryPolicy {
  schemaVersion: typeof CATALOG_RECOVERY_POLICY_SCHEMA;
  publisherId: string;
  threshold: number;
  approvers: CatalogRecoveryApprover[];
  updatedAt: string;
}

export interface CatalogRecoveryApproval { approverId: string; signature: string }
export interface CatalogRecoveryStatement {
  schemaVersion: typeof CATALOG_RECOVERY_STATEMENT_SCHEMA;
  publisherId: string;
  action: 'replaceActiveKey' | 'restorePublisher';
  issuedAt: string;
  nonce: string;
  replacementKey?: { keyId: string; publicJwk: CatalogEcPublicJwk; validFrom: string };
  approvals: CatalogRecoveryApproval[];
}

export interface PortableCatalogTrustDocument {
  schemaVersion: typeof CATALOG_TRUST_PORTABLE_SCHEMA;
  exportedAt: string;
  registry: CatalogTrustRegistry;
  logs: CatalogTransparencyLog[];
  recoveryPolicies: CatalogRecoveryPolicy[];
  checksum: string;
}


export interface CatalogTransparencyCheckpoint {
  logs: Record<string, CatalogTransparencyLog>;
  remoteManifests: Record<string, CatalogRemoteManifestVerification>;
  recoveryPolicies: CatalogRecoveryPolicy[];
  events: Array<{ id: string; at: string; type: string; details?: Record<string, unknown> }>;
}

export interface CatalogTransparencyAnchor {
  logId: string;
  publisherId: string;
  entryIndex: number;
  treeSize: number;
  leafHash: string;
  rootHash: string;
  inclusionProof: CatalogInclusionProof;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const emptyRoot = (): string => sha256Hex('catalog-transparency-empty');
const nodeHash = (left: string, right: string): string => sha256Hex(`catalog-transparency-node:${left}:${right}`);
const leafHash = (payload: CatalogTransparencyEntryPayload): string => sha256Hex(`catalog-transparency-leaf:${stableStringify(payload)}`);

export const computeCatalogTransparencyRoot = (leafHashes: readonly string[]): string => {
  if (!leafHashes.length) return emptyRoot();
  let level = [...leafHashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(nodeHash(left, right));
    }
    level = next;
  }
  return level[0];
};

export const createCatalogTransparencyLog = (publisherId: string, now: () => Date = () => new Date()): CatalogTransparencyLog => ({
  schemaVersion: CATALOG_TRANSPARENCY_LOG_SCHEMA,
  logId: `catalog-transparency-${publisherId}`,
  publisherId,
  revision: 0,
  entries: [],
  treeRoot: emptyRoot(),
  updatedAt: now().toISOString()
});

const assertLogIntegrity = (log: CatalogTransparencyLog): void => {
  if (log.schemaVersion !== CATALOG_TRANSPARENCY_LOG_SCHEMA) throw new Error('Registro de transparência incompatível.');
  log.entries.forEach((entry, index) => {
    if (entry.index !== index) throw new Error('O registro de transparência possui índices não contíguos.');
    const { index: _index, leafHash: stored, ...payload } = entry;
    if (stored !== leafHash(payload)) throw new Error(`A entrada ${index} do registro foi adulterada.`);
    if (index && entry.sequence !== log.entries[index - 1].sequence + 1) throw new Error('A sequência do registro não é contínua.');
    if (index && entry.previousBundleChecksum !== log.entries[index - 1].catalogChecksum) throw new Error('A cadeia de bundles do registro foi quebrada.');
  });
  const root = computeCatalogTransparencyRoot(log.entries.map((entry) => entry.leafHash));
  if (root !== log.treeRoot) throw new Error('A raiz Merkle do registro é inválida.');
};

export const appendCatalogTransparencyEntry = (
  log: CatalogTransparencyLog,
  verification: CatalogTrustVerification,
  acceptedAt = new Date().toISOString()
): { log: CatalogTransparencyLog; anchor: CatalogTransparencyAnchor } => {
  assertLogIntegrity(log);
  if (log.publisherId !== verification.publisherId) throw new Error('O publicador do bundle diverge do registro de transparência.');
  const previous = log.entries[log.entries.length - 1];
  if (previous && previous.sequence === verification.sequence && previous.catalogChecksum === verification.catalogChecksum) {
    const inclusionProof = createCatalogInclusionProof(log, previous.index);
    return { log: clone(log), anchor: { logId: log.logId, publisherId: log.publisherId, entryIndex: previous.index, treeSize: log.entries.length, leafHash: previous.leafHash, rootHash: log.treeRoot, inclusionProof } };
  }
  if (previous) {
    if (verification.sequence !== previous.sequence + 1) throw new Error('O bundle não estende a sequência append-only local.');
    if (verification.previousBundleChecksum !== previous.catalogChecksum) throw new Error('O bundle não aponta para a última entrada do registro local.');
  }
  const payload: CatalogTransparencyEntryPayload = {
    publisherId: verification.publisherId,
    sequence: verification.sequence,
    catalogChecksum: verification.catalogChecksum,
    catalogVersion: verification.catalogVersion,
    snapshotId: verification.snapshotId,
    keyId: verification.keyId,
    ...(verification.previousBundleChecksum ? { previousBundleChecksum: verification.previousBundleChecksum } : {}),
    acceptedAt
  };
  const entry: CatalogTransparencyEntry = { ...payload, index: log.entries.length, leafHash: leafHash(payload) };
  const entries = [...log.entries, entry];
  const next: CatalogTransparencyLog = {
    ...clone(log),
    revision: log.revision + 1,
    entries,
    treeRoot: computeCatalogTransparencyRoot(entries.map((item) => item.leafHash)),
    updatedAt: acceptedAt
  };
  const inclusionProof = createCatalogInclusionProof(next, entry.index);
  return { log: next, anchor: { logId: next.logId, publisherId: next.publisherId, entryIndex: entry.index, treeSize: entries.length, leafHash: entry.leafHash, rootHash: next.treeRoot, inclusionProof } };
};

export const createCatalogInclusionProof = (log: CatalogTransparencyLog, leafIndex: number): CatalogInclusionProof => {
  assertLogIntegrity(log);
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= log.entries.length) throw new Error('Índice de inclusão inválido.');
  let index = leafIndex;
  let level = log.entries.map((entry) => entry.leafHash);
  const auditPath: CatalogMerkleProofStep[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = level[siblingIndex] ?? level[index];
    auditPath.push({ side: index % 2 === 0 ? 'right' : 'left', hash: sibling });
    const next: string[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) next.push(nodeHash(level[cursor], level[cursor + 1] ?? level[cursor]));
    index = Math.floor(index / 2);
    level = next;
  }
  return { schemaVersion: CATALOG_TRANSPARENCY_PROOF_SCHEMA, logId: log.logId, publisherId: log.publisherId, treeSize: log.entries.length, leafIndex, leafHash: log.entries[leafIndex].leafHash, auditPath, rootHash: log.treeRoot };
};

export const verifyCatalogInclusionProof = (proof: CatalogInclusionProof): boolean => {
  if (proof.schemaVersion !== CATALOG_TRANSPARENCY_PROOF_SCHEMA || proof.leafIndex < 0 || proof.leafIndex >= proof.treeSize) return false;
  let hash = proof.leafHash;
  for (const step of proof.auditPath) hash = step.side === 'left' ? nodeHash(step.hash, hash) : nodeHash(hash, step.hash);
  return hash === proof.rootHash;
};

export const createCatalogConsistencyProof = (oldLog: CatalogTransparencyLog, newLog: CatalogTransparencyLog): CatalogConsistencyProof => {
  assertLogIntegrity(oldLog); assertLogIntegrity(newLog);
  if (oldLog.logId !== newLog.logId || oldLog.publisherId !== newLog.publisherId) throw new Error('Os registros pertencem a logs diferentes.');
  if (oldLog.entries.length > newLog.entries.length) throw new Error('O registro novo é menor que o registro anterior.');
  const oldHashes = oldLog.entries.map((entry) => entry.leafHash);
  const newHashes = newLog.entries.map((entry) => entry.leafHash);
  if (oldHashes.some((hash, index) => newHashes[index] !== hash)) throw new Error('O registro novo não é uma extensão append-only do anterior.');
  return { schemaVersion: CATALOG_TRANSPARENCY_PROOF_SCHEMA, logId: oldLog.logId, publisherId: oldLog.publisherId, oldSize: oldHashes.length, newSize: newHashes.length, oldRoot: oldLog.treeRoot, newRoot: newLog.treeRoot, prefixLeafHashes: oldHashes, appendedLeafHashes: newHashes.slice(oldHashes.length) };
};

export const verifyCatalogConsistencyProof = (proof: CatalogConsistencyProof): boolean => {
  if (proof.schemaVersion !== CATALOG_TRANSPARENCY_PROOF_SCHEMA || proof.prefixLeafHashes.length !== proof.oldSize || proof.oldSize + proof.appendedLeafHashes.length !== proof.newSize) return false;
  return computeCatalogTransparencyRoot(proof.prefixLeafHashes) === proof.oldRoot
    && computeCatalogTransparencyRoot([...proof.prefixLeafHashes, ...proof.appendedLeafHashes]) === proof.newRoot;
};

export type CatalogLogComparison = 'identical' | 'remoteAhead' | 'localAhead' | 'forked';
export const compareCatalogTransparencyLogs = (local: CatalogTransparencyLog, remote: CatalogTransparencyLog): CatalogLogComparison => {
  assertLogIntegrity(local); assertLogIntegrity(remote);
  if (local.logId !== remote.logId || local.publisherId !== remote.publisherId) return 'forked';
  const shared = Math.min(local.entries.length, remote.entries.length);
  for (let index = 0; index < shared; index += 1) if (local.entries[index].leafHash !== remote.entries[index].leafHash) return 'forked';
  if (local.entries.length === remote.entries.length) return local.treeRoot === remote.treeRoot ? 'identical' : 'forked';
  return local.entries.length < remote.entries.length ? 'remoteAhead' : 'localAhead';
};

const remoteManifestPayload = (manifest: SignedCatalogRemoteManifest): string => stableStringify({ ...manifest, signature: undefined });
const activeOrHistoricalKey = (publisher: CatalogTrustedPublisher, keyId: string) => publisher.keys.find((key) => key.keyId === keyId && key.status !== 'revoked');

export const verifySignedCatalogRemoteManifest = (params: {
  manifest: SignedCatalogRemoteManifest;
  registry: CatalogTrustRegistry;
  localLog: CatalogTransparencyLog;
  now?: () => Date;
}): CatalogRemoteManifestVerification => {
  const { manifest, registry, localLog } = params;
  if (manifest.schemaVersion !== CATALOG_REMOTE_MANIFEST_SCHEMA) throw new Error('Manifesto remoto incompatível.');
  assertLogIntegrity(localLog);
  const publisher = registry.publishers.find((entry) => entry.publisherId === manifest.publisherId && entry.status === 'trusted');
  if (!publisher) throw new Error('O manifesto remoto foi assinado por um publicador não confiável.');
  const key = activeOrHistoricalKey(publisher, manifest.keyId);
  if (!key || catalogPublicKeyFingerprint(key.publicJwk) !== key.fingerprint) throw new Error('A chave do manifesto não é confiável.');
  if (!verifyP256Signature(remoteManifestPayload(manifest), manifest.signature, key.publicJwk)) throw new Error('A assinatura do manifesto remoto é inválida.');
  const now = (params.now ?? (() => new Date()))().getTime();
  if (!Number.isFinite(Date.parse(manifest.issuedAt)) || Date.parse(manifest.issuedAt) > now + 300000) throw new Error('A data do manifesto remoto é inválida.');
  if (manifest.expiresAt && now > Date.parse(manifest.expiresAt)) throw new Error('O manifesto remoto expirou.');
  if (manifest.logId !== localLog.logId) throw new Error('O manifesto aponta para outro registro de transparência.');
  if (manifest.logSize < localLog.entries.length || manifest.latestSequence < (localLog.entries.at(-1)?.sequence ?? 0)) throw new Error('O servidor apresentou um manifesto anterior ao estado já observado neste dispositivo.');
  if (manifest.logSize === localLog.entries.length && manifest.logRoot !== localLog.treeRoot) throw new Error('O manifesto remoto bifurca o registro local na mesma altura.');
  const localLatest = localLog.entries.at(-1);
  if (manifest.latestSequence === localLatest?.sequence && manifest.latestCatalogChecksum !== localLatest.catalogChecksum) throw new Error('O manifesto omite ou substitui o bundle local mais recente.');
  return { publisherId: manifest.publisherId, keyId: manifest.keyId, issuedAt: manifest.issuedAt, latestSequence: manifest.latestSequence, latestCatalogChecksum: manifest.latestCatalogChecksum, latestCatalogVersion: manifest.latestCatalogVersion, latestSnapshotId: manifest.latestSnapshotId, logSize: manifest.logSize, logRoot: manifest.logRoot, status: manifest.latestSequence > (localLatest?.sequence ?? 0) ? 'updateAvailable' : 'current' };
};

export const assertBundleAllowedByRemoteManifest = (verification: CatalogTrustVerification, remote?: CatalogRemoteManifestVerification): void => {
  if (!remote) return;
  if (verification.publisherId !== remote.publisherId) return;
  if (verification.sequence > remote.latestSequence) throw new Error('O bundle está à frente do manifesto remoto assinado conhecido.');
  if (verification.sequence === remote.latestSequence && verification.catalogChecksum !== remote.latestCatalogChecksum) throw new Error('O bundle diverge do checksum publicado no manifesto remoto assinado.');
};

const recoveryPayload = (statement: CatalogRecoveryStatement): string => stableStringify({ ...statement, approvals: undefined });
export const validateCatalogRecoveryStatement = (policy: CatalogRecoveryPolicy, statement: CatalogRecoveryStatement, now: () => Date = () => new Date()): void => {
  if (statement.schemaVersion !== CATALOG_RECOVERY_STATEMENT_SCHEMA || policy.schemaVersion !== CATALOG_RECOVERY_POLICY_SCHEMA) throw new Error('Documento de recuperação incompatível.');
  if (statement.publisherId !== policy.publisherId) throw new Error('A política não corresponde ao publicador recuperado.');
  if (!Number.isInteger(policy.threshold) || policy.threshold < 2) throw new Error('A recuperação crítica exige quórum mínimo de duas aprovações.');
  if (!Number.isFinite(Date.parse(statement.issuedAt)) || Date.parse(statement.issuedAt) > now().getTime() + 300000) throw new Error('A data da recuperação é inválida.');
  const payload = recoveryPayload(statement);
  const valid = new Set<string>();
  for (const approval of statement.approvals) {
    const approver = policy.approvers.find((entry) => entry.approverId === approval.approverId && entry.status === 'active');
    if (approver && catalogPublicKeyFingerprint(approver.publicJwk) === approver.fingerprint && verifyP256Signature(payload, approval.signature, approver.publicJwk)) valid.add(approver.approverId);
  }
  if (valid.size < policy.threshold) throw new Error(`A recuperação exige ${policy.threshold} aprovações válidas e recebeu ${valid.size}.`);
  if (statement.action === 'replaceActiveKey' && !statement.replacementKey) throw new Error('A chave substituta é obrigatória.');
};

export const applyCatalogTrustRecovery = (registry: CatalogTrustRegistry, policy: CatalogRecoveryPolicy, statement: CatalogRecoveryStatement): CatalogTrustRegistry => {
  validateCatalogRecoveryStatement(policy, statement);
  const next = clone(registry);
  const publisher = next.publishers.find((entry) => entry.publisherId === statement.publisherId);
  if (!publisher) throw new Error('O publicador recuperado não existe no registro local.');
  publisher.status = 'trusted';
  if (statement.replacementKey) {
    publisher.keys.forEach((key) => { if (key.status === 'active') { key.status = 'revoked'; key.revokedAt = statement.issuedAt; key.revocationReason = 'Substituição por recuperação em quórum.'; } });
    publisher.keys.push({ keyId: statement.replacementKey.keyId, algorithm: 'ECDSA_P256_SHA256', publicJwk: statement.replacementKey.publicJwk, fingerprint: catalogPublicKeyFingerprint(statement.replacementKey.publicJwk), status: 'active', validFrom: statement.replacementKey.validFrom, addedAt: statement.issuedAt });
  }
  publisher.updatedAt = statement.issuedAt;
  next.revision += 1;
  next.updatedAt = statement.issuedAt;
  const recoveryEvent: CatalogTrustEvent = { id: `trust-recovery-${statement.nonce}`, at: statement.issuedAt, type: 'recoveryApplied', publisherId: publisher.publisherId, ...(statement.replacementKey ? { keyId: statement.replacementKey.keyId } : {}), details: { action: statement.action, approvals: statement.approvals.map((entry) => entry.approverId) } };
  next.events = [...next.events, recoveryEvent].slice(-150);
  return next;
};

export const createPortableCatalogTrustDocument = (registry: CatalogTrustRegistry, logs: CatalogTransparencyLog[], recoveryPolicies: CatalogRecoveryPolicy[], now: () => Date = () => new Date()): PortableCatalogTrustDocument => {
  logs.forEach(assertLogIntegrity);
  const base = { schemaVersion: CATALOG_TRUST_PORTABLE_SCHEMA, exportedAt: now().toISOString(), registry: clone(registry), logs: clone(logs), recoveryPolicies: clone(recoveryPolicies) };
  return { ...base, checksum: sha256Hex(stableStringify(base)) };
};

export const parsePortableCatalogTrustDocument = (rawText: string): PortableCatalogTrustDocument => {
  const document = JSON.parse(rawText) as PortableCatalogTrustDocument;
  if (document.schemaVersion !== CATALOG_TRUST_PORTABLE_SCHEMA) throw new Error('Exportação de confiança incompatível.');
  const { checksum, ...base } = document;
  if (checksum !== sha256Hex(stableStringify(base))) throw new Error('A exportação de confiança foi adulterada.');
  document.logs.forEach(assertLogIntegrity);
  return clone(document);
};
