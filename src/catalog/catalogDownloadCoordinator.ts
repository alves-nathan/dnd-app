import {
  applyCatalogDownloadChunk,
  assertCatalogNetworkPolicy,
  createCatalogDownloadSession,
  catalogDistributionManifestChecksum,
  finalizeCatalogDownload,
  rankCatalogMirrors,
  utf8ByteLength,
  type CatalogDownloadEvidence,
  type CatalogDownloadSession,
  type CatalogMirrorObservation,
  type CatalogMirrorTransport,
  type CatalogNetworkPolicy,
  type CatalogNetworkSnapshot,
  type SignedCatalogDistributionManifest
} from './catalogDistribution';
import { sha256Hex } from './catalogBundleDigest';
import type { CatalogTrustRegistry, CatalogTrustVerification } from './catalogTrust';

export interface CatalogDownloadRepositoryPort {
  saveSession: (session: CatalogDownloadSession, manifest: SignedCatalogDistributionManifest) => Promise<void>;
  readChunk: (sessionId: string, index: number) => Promise<string | undefined>;
  writeChunk: (sessionId: string, index: number, content: string) => Promise<void>;
  assemble: (sessionId: string, chunkCount: number) => Promise<string>;
}

export interface CatalogDownloadCoordinatorResult {
  ok: boolean;
  session: CatalogDownloadSession;
  issue?: string;
  rawText?: string;
  evidence?: CatalogDownloadEvidence;
  trustVerification?: CatalogTrustVerification;
}

const updateSession = async (
  repository: CatalogDownloadRepositoryPort,
  manifest: SignedCatalogDistributionManifest,
  session: CatalogDownloadSession,
  onSession?: (session: CatalogDownloadSession) => void
): Promise<void> => {
  await repository.saveSession(session, manifest);
  onSession?.(session);
};

export const reconcileCatalogDownloadSession = async (params: {
  session: CatalogDownloadSession;
  manifest: SignedCatalogDistributionManifest;
  repository: CatalogDownloadRepositoryPort;
}): Promise<CatalogDownloadSession> => {
  const verifiedCompleted: number[] = [];
  let verifiedBytes = 0;
  for (const completedIndex of params.session.completedChunkIndexes) {
    const chunk = params.manifest.chunks[completedIndex];
    const content = chunk ? await params.repository.readChunk(params.session.id, completedIndex) : undefined;
    if (chunk && content !== undefined
      && content.length === chunk.characterLength
      && utf8ByteLength(content) === chunk.byteLength
      && sha256Hex(content) === chunk.checksum) {
      verifiedCompleted.push(completedIndex);
      verifiedBytes += chunk.byteLength;
    }
  }
  return { ...params.session, completedChunkIndexes: verifiedCompleted, downloadedBytes: verifiedBytes };
};

export const runCatalogDownloadCoordinator = async (params: {
  manifest: SignedCatalogDistributionManifest;
  observations: readonly CatalogMirrorObservation[];
  repository: CatalogDownloadRepositoryPort;
  transport: CatalogMirrorTransport;
  policy: CatalogNetworkPolicy;
  network: CatalogNetworkSnapshot;
  registry: CatalogTrustRegistry;
  session?: CatalogDownloadSession;
  automatic?: boolean;
  manualOverride?: boolean;
  preferredMirrorId?: string;
  shouldPause?: () => boolean;
  onSession?: (session: CatalogDownloadSession) => void;
  now?: () => Date;
}): Promise<CatalogDownloadCoordinatorResult> => {
  const now = params.now ?? (() => new Date());
  assertCatalogNetworkPolicy({
    policy: params.policy,
    network: params.network,
    bundleByteLength: params.manifest.bundleByteLength,
    automatic: Boolean(params.automatic),
    manualOverride: Boolean(params.manualOverride)
  });
  let mirrors = rankCatalogMirrors(params.manifest, params.observations, now);
  if (params.preferredMirrorId) {
    const selected = mirrors.find((entry) => entry.mirrorId === params.preferredMirrorId);
    if (!selected) throw new Error('O mirror selecionado não está disponível ou diverge do manifesto assinado.');
    mirrors = [selected, ...mirrors.filter((entry) => entry.mirrorId !== selected.mirrorId)];
  }
  if (!mirrors.length) throw new Error('Nenhum mirror consistente está disponível.');

  let session = params.session ?? createCatalogDownloadSession(params.manifest, now);
  if (session.manifestChecksum !== catalogDistributionManifestChecksum(params.manifest) || session.bundleChecksum !== params.manifest.bundleChecksum) {
    throw new Error('A sessão não corresponde ao manifesto atual.');
  }
  if (['paused', 'failed'].includes(session.status)) session = { ...session, resumeCount: session.resumeCount + 1 };
  const startedAt = now().toISOString();
  session = await reconcileCatalogDownloadSession({ session, manifest: params.manifest, repository: params.repository });
  session = { ...session, status: 'downloading', startedAt: session.startedAt ?? startedAt, updatedAt: startedAt, network: params.network, lastError: undefined };
  await updateSession(params.repository, params.manifest, session, params.onSession);

  for (const chunk of params.manifest.chunks) {
    if (session.completedChunkIndexes.includes(chunk.index)) continue;
    if (params.shouldPause?.()) {
      session = { ...session, status: 'paused', updatedAt: now().toISOString(), lastError: 'Download pausado pelo usuário.' };
      await updateSession(params.repository, params.manifest, session, params.onSession);
      return { ok: false, session, issue: session.lastError };
    }
    let completed = false;
    const failures: string[] = [];
    for (const mirror of mirrors) {
      try {
        const content = await params.transport.fetchChunk(mirror, params.manifest, chunk);
        session = applyCatalogDownloadChunk({ session, manifest: params.manifest, chunk, content, mirrorId: mirror.mirrorId, now });
        await params.repository.writeChunk(session.id, chunk.index, content);
        await updateSession(params.repository, params.manifest, session, params.onSession);
        completed = true;
        break;
      } catch (error) {
        failures.push(`${mirror.label}: ${error instanceof Error ? error.message : 'falha'}`);
      }
    }
    if (!completed) {
      session = { ...session, status: 'paused', updatedAt: now().toISOString(), lastError: `O bloco ${chunk.index} falhou em todos os mirrors. ${failures.join(' | ')}` };
      await updateSession(params.repository, params.manifest, session, params.onSession);
      return { ok: false, session, issue: session.lastError };
    }
  }

  const rawText = await params.repository.assemble(session.id, params.manifest.chunks.length);
  const finalized = finalizeCatalogDownload({ session, manifest: params.manifest, rawText, registry: params.registry, now });
  await updateSession(params.repository, params.manifest, finalized.session, params.onSession);
  return { ok: true, session: finalized.session, rawText, evidence: finalized.evidence, trustVerification: finalized.trustVerification };
};
