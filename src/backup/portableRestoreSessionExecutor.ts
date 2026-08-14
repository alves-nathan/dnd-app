import type { CatalogConfigurationHistoryEntry } from '../catalog/catalogConfigurationHistory';
import { useBuildHistoryStore } from '../store/buildHistoryStore';
import { useBuildPresetStore } from '../store/buildPresetStore';
import { useCatalogStore } from '../store/catalogStore';
import { useCharacterStore } from '../store/characterStore';
import { useCombatScenarioStore } from '../store/combatScenarioStore';
import { useCompendiumStore } from '../store/compendiumStore';
import { listCharacterChoices } from '../catalog/characterChoiceBridge';
import { usePortableRestoreSessionStore } from '../store/portableRestoreSessionStore';
import {
  canCommitPortableRestoreSession,
  portableRestoreCheckpointFingerprint,
  type PortableRestoreDataCheckpoint,
  type PortableRestoreSession
} from './portableRestoreSession';
import { verifyPortableRestoreIntegrity, type PortableRestorePostVerification } from './portableRestoreVerification';

export interface PortableRestoreExecutionResult {
  ok: boolean;
  issues: string[];
  session?: PortableRestoreSession;
  verification?: PortableRestorePostVerification;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const capturePortableRestoreCheckpoint = (): PortableRestoreDataCheckpoint => {
  const characters = useCharacterStore.getState();
  const catalog = useCatalogStore.getState();
  if (!catalog.filterState) throw new Error('O catálogo ainda não está pronto para criar o checkpoint portátil.');
  return {
    characterStore: {
      characters: clone(characters.characters),
      progressionDrafts: clone(characters.progressionDrafts),
      progressionRecovery: clone(characters.progressionRecovery),
      compatibilityRemediationPlans: clone(characters.compatibilityRemediationPlans),
      compatibilityRemediationRecovery: clone(characters.compatibilityRemediationRecovery),
      compatibilityRemediationQuarantine: clone(characters.compatibilityRemediationQuarantine)
    },
    scenarios: clone(useCombatScenarioStore.getState().scenarios),
    buildPresets: clone(useBuildPresetStore.getState().presets),
    buildHistorySnapshots: clone(useBuildHistoryStore.getState().snapshots),
    catalog: {
      filterState: clone(catalog.filterState),
      revision: catalog.revision,
      history: clone(catalog.history),
      savedAt: catalog.lastSavedAt
    }
  };
};

export const applyPortableRestoreDataCheckpoint = (
  checkpoint: PortableRestoreDataCheckpoint
): void => {
  useCharacterStore.setState({
    characters: clone(checkpoint.characterStore.characters),
    progressionDrafts: clone(checkpoint.characterStore.progressionDrafts),
    progressionRecovery: clone(checkpoint.characterStore.progressionRecovery),
    compatibilityRemediationPlans: clone(checkpoint.characterStore.compatibilityRemediationPlans),
    compatibilityRemediationRecovery: clone(checkpoint.characterStore.compatibilityRemediationRecovery),
    compatibilityRemediationQuarantine: clone(checkpoint.characterStore.compatibilityRemediationQuarantine)
  });
  useCombatScenarioStore.getState().setScenarios(clone(checkpoint.scenarios));
  useBuildPresetStore.getState().setPresets(clone(checkpoint.buildPresets));
  useBuildHistoryStore.getState().setSnapshots(clone(checkpoint.buildHistorySnapshots));
};

const catalogCommitAlreadyExists = (sessionId: string): string | undefined =>
  useCatalogStore.getState().history.find((entry: CatalogConfigurationHistoryEntry) => entry.portableRestoreSessionId === sessionId)?.id;


export const verifyCommittedPortableRestoreSession = (): PortableRestoreExecutionResult => {
  const session = usePortableRestoreSessionStore.getState().activeSession;
  if (!session || session.status !== 'committed') return { ok: false, issues: ['Não existe uma sessão confirmada para verificar.'], session };
  const catalog = useCatalogStore.getState();
  const compendium = useCompendiumStore.getState();
  let choices;
  if (catalog.snapshot && catalog.filterState && compendium.isHydrated) {
    choices = listCharacterChoices({
      snapshot: catalog.snapshot,
      filterState: catalog.filterState,
      compendiumItems: compendium.items,
      enabledSourceIds: compendium.enabledSourceIds
    }, { includeUnavailable: true }).choices;
  }
  const verification = verifyPortableRestoreIntegrity({
    session,
    effective: capturePortableRestoreCheckpoint(),
    snapshot: catalog.snapshot,
    filterState: catalog.filterState,
    choices
  });
  usePortableRestoreSessionStore.getState().recordPostRestoreVerification(verification);
  return {
    ok: verification.status !== 'failed',
    issues: verification.issues.map((entry) => entry.message),
    session: usePortableRestoreSessionStore.getState().activeSession,
    verification
  };
};

export const commitPortableRestoreSession = async (): Promise<PortableRestoreExecutionResult> => {
  const sessionStore = usePortableRestoreSessionStore.getState();
  const initial = sessionStore.activeSession;
  if (!initial) return { ok: false, issues: ['Nenhuma sessão portátil está ativa.'] };
  if (!canCommitPortableRestoreSession(initial)) {
    return { ok: false, issues: ['Existem conflitos que ainda não foram reconhecidos.'], session: initial };
  }

  if (initial.status === 'prepared') {
    const currentFingerprint = portableRestoreCheckpointFingerprint(capturePortableRestoreCheckpoint());
    if (currentFingerprint !== initial.beforeFingerprint) {
      usePortableRestoreSessionStore.getState().markInterrupted('Os dados locais mudaram depois do preview. Recrie a sessão ou reverta para o checkpoint capturado.');
      return { ok: false, issues: ['Os dados locais mudaram depois do preview; o commit foi bloqueado.'], session: usePortableRestoreSessionStore.getState().activeSession };
    }
  }

  usePortableRestoreSessionStore.getState().markCommitStarted();
  try {
    let session = usePortableRestoreSessionStore.getState().activeSession!;
    if (!session.applied.data) {
      applyPortableRestoreDataCheckpoint(session.projected);
      usePortableRestoreSessionStore.getState().markDataApplied();
      session = usePortableRestoreSessionStore.getState().activeSession!;
    } else {
      applyPortableRestoreDataCheckpoint(session.projected);
    }

    if (session.catalogAudit) {
      const existingEntryId = catalogCommitAlreadyExists(session.id);
      if (existingEntryId) {
        usePortableRestoreSessionStore.getState().markCatalogApplied(existingEntryId);
      } else {
        const catalogStore = useCatalogStore.getState();
        if (!session.catalogComparison) throw new Error('A comparação do catálogo não foi preservada na sessão.');
        catalogStore.previewPortableBackupImport(session.catalogAudit, session.catalogComparison);
        const impact = session.catalogImpact;
        const result = await useCatalogStore.getState().commitPendingChange({
          origin: 'import',
          portableRestoreSessionId: session.id,
          acknowledgement: {
            required: impact?.requiresAcknowledgement ?? false,
            acknowledged: true,
            acknowledgedAt: new Date().toISOString(),
            affectedCharacterIds: impact?.affectedCharacters.map((entry) => entry.characterId) ?? [],
            newBlockingIssues: impact?.counts.newBlockingIssues ?? 0,
            newWarnings: impact?.counts.newWarnings ?? 0,
            preventivePlansRequested: Boolean(impact?.affectedCharacters.length),
            preventivePlanCharacterIds: impact?.affectedCharacters.map((entry) => entry.characterId) ?? []
          }
        });
        if (!result.ok) throw new Error(result.issues.join('\n'));
        usePortableRestoreSessionStore.getState().markCatalogApplied(result.historyEntryId);
      }
    } else if (!session.applied.catalog) {
      usePortableRestoreSessionStore.getState().markCatalogApplied();
    }

    usePortableRestoreSessionStore.getState().markCommitted();
    const verificationResult = verifyCommittedPortableRestoreSession();
    return {
      ok: true,
      issues: verificationResult.issues,
      session: verificationResult.session,
      verification: verificationResult.verification
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no commit da restauração.';
    usePortableRestoreSessionStore.getState().markInterrupted(message);
    return { ok: false, issues: [message], session: usePortableRestoreSessionStore.getState().activeSession };
  }
};

export const rollbackPortableRestoreSession = async (): Promise<PortableRestoreExecutionResult> => {
  const initial = usePortableRestoreSessionStore.getState().activeSession;
  if (!initial) return { ok: false, issues: ['Nenhuma sessão portátil está ativa.'] };
  if (!['committed', 'interrupted', 'failed'].includes(initial.status)) {
    return { ok: false, issues: ['A sessão atual não pode ser revertida.'], session: initial };
  }
  usePortableRestoreSessionStore.getState().markRollbackStarted();
  try {
    const session = usePortableRestoreSessionStore.getState().activeSession!;
    applyPortableRestoreDataCheckpoint(session.before);
    usePortableRestoreSessionStore.getState().markDataRolledBack();
    const catalogResult = await useCatalogStore.getState().replaceConfigurationCheckpoint(session.before.catalog);
    if (!catalogResult.ok) throw new Error(catalogResult.issues.join('\n'));
    usePortableRestoreSessionStore.getState().markCatalogRolledBack();
    usePortableRestoreSessionStore.getState().markRolledBack();
    return { ok: true, issues: [], session: usePortableRestoreSessionStore.getState().activeSession };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada no rollback da restauração.';
    usePortableRestoreSessionStore.getState().markInterrupted(message);
    return { ok: false, issues: [message], session: usePortableRestoreSessionStore.getState().activeSession };
  }
};
