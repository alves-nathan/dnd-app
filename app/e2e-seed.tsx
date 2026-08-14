import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { characterCreationDraftRepository } from '../src/characters/creationDraftRepository';
import { progressionOperation } from '../src/characters/progressionTransaction';
import { buildCharacterCompatibilityReport } from '../src/characters/characterCompatibility';
import { createCompatibilityRemediationPlan, previewCompatibilityRemediation, upsertCompatibilityRemediationDecision } from '../src/characters/compatibilityRemediation';
import { useCharacterChoiceBridge } from '../src/catalog/useCharacterChoiceBridge';
import { useCatalogStore } from '../src/store/catalogStore';
import { createEmptyCharacter } from '../src/data/mockData';
import { e2eCharacterCreationFixture } from '../src/fixtures/e2eCharacterCreation';
import {
  createE2ETacticalMobileCharacter,
  createE2ETacticalMobileScenario,
  E2E_TACTICAL_CHARACTER_ID
} from '../src/fixtures/e2eTacticalMobile';
import { useCharacterStore } from '../src/store/characterStore';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { getRuntimeBuildInfo } from '../src/release/runtimeBuildInfo';
import { isE2ESeedAllowed } from '../src/release/runtimeReleasePolicy';
import { useAppTheme } from '../src/theme';
import { ContentPolicyService } from '../src/catalog/contentPolicyService';
import { createCatalogConfigurationHistoryEntry } from '../src/catalog/catalogConfigurationHistory';
import { comparePortableCatalogAudit, createPortableCatalogAuditSection } from '../src/backup/portableCatalogBackup';
import { createCharacterDataBackup } from '../src/backup/characterBackup';
import { preparePortableRestoreSession } from '../src/backup/portableRestoreSession';
import { applyPortableRestoreDataCheckpoint, capturePortableRestoreCheckpoint, commitPortableRestoreSession, verifyCommittedPortableRestoreSession } from '../src/backup/portableRestoreSessionExecutor';
import { usePortableRestoreSessionStore } from '../src/store/portableRestoreSessionStore';
import { parsePortableRestoreEvidenceImport } from '../src/backup/portableRestoreEvidenceCenter';
import { portableRestoreEvidenceToJson } from '../src/backup/portableRestoreVerification';
import { useCatalogUpdateSessionStore } from '../src/store/catalogUpdateSessionStore';
import { useCatalogTrustStore } from '../src/store/catalogTrustStore';
import { createDefaultCatalogTrustRegistry } from '../src/catalog/catalogTrustDefaults';
import type { RuntimeCatalogBundle } from '../src/catalog/types';

declare const require: (path: string) => unknown;

export default function E2ESeedScreen() {
  const { colors } = useAppTheme();
  const [status, setStatus] = useState('Ambiente ainda não preparado.');
  const [busy, setBusy] = useState(false);
  const buildInfo = getRuntimeBuildInfo();
  const seedAllowed = isE2ESeedAllowed({
    isDevelopment: __DEV__,
    releaseStage: buildInfo.releaseStage,
    e2eSeedEnabled: buildInfo.e2eSeedEnabled
  });
  const setCharacters = useCharacterStore((state) => state.setCharacters);
  const beginProgressionTransaction = useCharacterStore((state) => state.beginProgressionTransaction);
  const commitProgressionTransaction = useCharacterStore((state) => state.commitProgressionTransaction);
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const saveCompatibilityRemediationPlan = useCharacterStore((state) => state.saveCompatibilityRemediationPlan);
  const commitCompatibilityRemediationPlan = useCharacterStore((state) => state.commitCompatibilityRemediationPlan);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const previewEntityState = useCatalogStore((state) => state.previewEntityState);
  const commitPendingCatalogChange = useCatalogStore((state) => state.commitPendingChange);
  const previewPortableBackupImport = useCatalogStore((state) => state.previewPortableBackupImport);
  const bridge = useCharacterChoiceBridge();
  const clearCompendium = useCompendiumStore((state) => state.clearCompendium);
  const saveImportJson = useCompendiumStore((state) => state.saveImportJson);
  const setCombatScenarios = useCombatScenarioStore((state) => state.setScenarios);

  const seed = async () => {
    setBusy(true);
    try {
      await characterCreationDraftRepository.clear();
      setCharacters([]);

      const clearResult = await clearCompendium();
      if (!clearResult.ok) {
        throw new Error(clearResult.issues.map((issue) => issue.message).join('\n') || 'Não foi possível limpar o compêndio local.');
      }

      const importResult = await saveImportJson(JSON.stringify(e2eCharacterCreationFixture));
      if (!importResult.ok) {
        throw new Error(importResult.issues.map((issue) => issue.message).join('\n') || 'Não foi possível importar a fixture E2E.');
      }

      setStatus('Ambiente E2E preparado.');
    } catch (error) {
      setStatus(`Falha ao preparar ambiente E2E: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const prepareTacticalMobileScenario = () => {
    const character = createE2ETacticalMobileCharacter();
    setCharacters([character]);
    setCombatScenarios([createE2ETacticalMobileScenario(character)]);
    setStatus('Cenário E2E de fechamento móvel tático preparado.');
  };

  const progressionCharacter = () => ({
    ...createEmptyCharacter('E2E Recovery Wizard'),
    id: 'e2e-progression-recovery',
    level: 1,
    catalogSnapshotId: 'catalog-4.8.0-e2e',
    classes: [{
      id: 'class-wizard-e2e',
      name: 'Wizard',
      level: 1,
      source: { id: 'e2e', status: 'active' as const, confidence: 'exact' as const }
    }]
  });

  const prepareProgressionScenario = (scenario: 'recovery' | 'conflict' | 'rollback') => {
    const published = progressionCharacter();
    const projected = {
      ...published,
      level: 2,
      classes: published.classes.map((entry) => ({ ...entry, level: 2 }))
    };
    setCharacters([published]);
    beginProgressionTransaction(published.id, projected, {
      kind: 'levelUp',
      targetCatalogSnapshotId: projected.catalogSnapshotId,
      migrationApproved: true,
      operations: [progressionOperation('levelUp', 'E2E Wizard 1 → 2')]
    });
    if (scenario === 'conflict') {
      updateCharacter(published.id, (character) => ({ ...character, notes: 'Edição concorrente criada pelo E2E' }));
      setStatus('Cenário E2E de conflito transacional preparado.');
      return;
    }
    if (scenario === 'rollback') {
      const result = commitProgressionTransaction(published.id);
      if (!result?.ok) throw new Error('Não foi possível preparar o histórico de rollback.');
      setStatus('Cenário E2E de rollback preparado.');
      return;
    }
    setStatus('Cenário E2E de recuperação transacional preparado.');
  };

  const compatibilityCharacter = () => ({
    ...createEmptyCharacter('E2E Compatibility Wizard'),
    id: 'e2e-compatibility-remediation',
    level: 1,
    catalogSnapshotId: 'catalog-e2e-old',
    feats: [{ id: 'e2e-missing-feat', name: 'E2E Missing Feat', features: [] }],
    compendiumLinks: [{
      id: 'e2e-missing-link',
      characterId: 'e2e-compatibility-remediation',
      itemId: 'catalog:e2e-missing-feat',
      importItemId: 'catalog:e2e-missing-feat',
      packId: 'e2e',
      sourceId: 'phb-2024',
      itemType: 'feat' as const,
      appliedAs: 'feat' as const,
      appliedEntityId: 'e2e-missing-feat',
      appliedEntityName: 'E2E Missing Feat',
      status: 'active' as const,
      addedAt: '2026-08-04T00:00:00.000Z',
      choiceId: 'catalog:e2e-missing-feat',
      origin: 'catalog' as const,
      catalogEntityId: 'e2e-missing-feat',
      catalogSnapshotId: 'catalog-e2e-old'
    }]
  });

  const prepareCompatibilityScenario = (scenario: 'create' | 'discard' | 'commit' | 'rollback') => {
    if (!snapshot || !filterState || bridge.status !== 'ready') {
      setStatus('Catálogo ainda não está pronto para a fixture de compatibilidade.');
      return;
    }
    const character = compatibilityCharacter();
    setCharacters([character]);
    const report = buildCharacterCompatibilityReport({ character, snapshot, filterState, choices: bridge.choices });
    if (scenario === 'create') {
      setStatus('Cenário E2E de criação do plano de remediação preparado.');
      return;
    }
    const snapshotIssue = report.issues.find((issue) => issue.code === 'CHARACTER_SNAPSHOT_MISMATCH');
    const missingIssue = report.issues.find((issue) => issue.code === 'CHARACTER_CATALOG_ENTITY_MISSING');
    if (!snapshotIssue || !missingIssue) throw new Error('Fixture de compatibilidade não produziu as ocorrências esperadas.');
    let plan = createCompatibilityRemediationPlan({ character, report });
    plan = upsertCompatibilityRemediationDecision(plan, { issueId: snapshotIssue.id, kind: 'adoptSnapshot' });
    plan = upsertCompatibilityRemediationDecision(plan, { issueId: missingIssue.id, referenceKey: missingIssue.referenceKey, kind: 'remove' });
    saveCompatibilityRemediationPlan(plan);
    if (scenario === 'rollback') {
      const preview = previewCompatibilityRemediation({ character, report, plan, snapshot, filterState, choices: bridge.choices });
      const result = commitCompatibilityRemediationPlan(character.id, preview);
      if (!result?.ok) throw new Error('Não foi possível preparar o rollback de remediação.');
      setStatus('Cenário E2E de rollback da remediação preparado.');
      return;
    }
    setStatus(scenario === 'discard'
      ? 'Cenário E2E de descarte do plano de remediação preparado.'
      : 'Cenário E2E de commit do plano de remediação preparado.');
  };

  const prepareCatalogImpactScenario = async () => {
    if (!snapshot || !filterState || bridge.status !== 'ready') {
      setStatus('Catálogo ainda não está pronto para a fixture preventiva.');
      return;
    }
    setBusy(true);
    try {
      const character = {
        ...createEmptyCharacter('E2E Preventive Wizard'),
        id: 'e2e-catalog-impact',
        catalogSnapshotId: snapshot.snapshotId,
        compendiumLinks: [{
          id: 'e2e-acid-splash-link',
          characterId: 'e2e-catalog-impact',
          itemId: 'catalog:phb-2024-spell-acid-splash',
          importItemId: 'catalog:phb-2024-spell-acid-splash',
          packId: 'e2e',
          sourceId: 'phb-2024',
          itemType: 'spell' as const,
          appliedAs: 'spell' as const,
          appliedEntityId: 'e2e-acid-splash',
          appliedEntityName: 'Acid Splash',
          status: 'active' as const,
          addedAt: '2026-08-04T08:00:00.000Z',
          choiceId: 'catalog:phb-2024-spell-acid-splash',
          origin: 'catalog' as const,
          catalogEntityId: 'phb-2024-spell-acid-splash',
          catalogSnapshotId: snapshot.snapshotId
        }]
      };
      setCharacters([character]);
      previewEntityState('phb-2024-spell-acid-splash', 'enabled');
      const result = await commitPendingCatalogChange();
      if (!result.ok) throw new Error(result.issues.join('\n'));
      setStatus('Cenário E2E de impacto preventivo do catálogo preparado.');
    } catch (error) {
      setStatus(`Falha ao preparar impacto preventivo: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const prepareCatalogHistoryScenario = async () => {
    if (!snapshot || !filterState || bridge.status !== 'ready') {
      setStatus('Catálogo ainda não está pronto para a fixture de histórico.');
      return;
    }
    setBusy(true);
    try {
      const character = {
        ...createEmptyCharacter('E2E History Wizard'),
        id: 'e2e-catalog-history',
        catalogSnapshotId: snapshot.snapshotId,
        compendiumLinks: [{
          id: 'e2e-history-acid-link',
          characterId: 'e2e-catalog-history',
          itemId: 'catalog:phb-2024-spell-acid-splash',
          importItemId: 'catalog:phb-2024-spell-acid-splash',
          packId: 'e2e',
          sourceId: 'phb-2024',
          itemType: 'spell' as const,
          appliedAs: 'spell' as const,
          appliedEntityId: 'e2e-history-acid',
          appliedEntityName: 'Acid Splash',
          status: 'active' as const,
          addedAt: '2026-08-04T08:00:00.000Z',
          choiceId: 'catalog:phb-2024-spell-acid-splash',
          origin: 'catalog' as const,
          catalogEntityId: 'phb-2024-spell-acid-splash',
          catalogSnapshotId: snapshot.snapshotId
        }]
      };
      setCharacters([character]);
      previewEntityState('phb-2024-spell-acid-splash', 'enabled');
      let result = await commitPendingCatalogChange();
      if (!result.ok) throw new Error(result.issues.join('\n'));
      previewEntityState('phb-2024-spell-acid-splash', 'disabled');
      result = await commitPendingCatalogChange({
        acknowledgement: {
          required: true,
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
          affectedCharacterIds: [character.id],
          newBlockingIssues: 1,
          preventivePlansRequested: true,
          preventivePlanCharacterIds: [character.id]
        }
      });
      if (!result.ok) throw new Error(result.issues.join('\n'));
      const currentFilters = useCatalogStore.getState().filterState;
      if (!currentFilters) throw new Error('Filtros não foram persistidos.');
      const report = buildCharacterCompatibilityReport({ character, snapshot, filterState: currentFilters, choices: bridge.choices });
      saveCompatibilityRemediationPlan(createCompatibilityRemediationPlan({
        character,
        report,
        origin: 'preventiveCatalogChange',
        preventiveContext: {
          label: 'Fixture E2E de histórico',
          catalogSnapshotId: snapshot.snapshotId,
          disabledEntityIds: ['phb-2024-spell-acid-splash'],
          affectedBookIds: ['phb-2024'],
          affectedCategoryIds: snapshot.entryById.get('phb-2024-spell-acid-splash')?.categoryIds ?? []
        }
      }));
      setStatus('Cenário E2E de histórico transacional do catálogo preparado.');
    } catch (error) {
      setStatus(`Falha ao preparar histórico do catálogo: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const preparePortableBackupScenario = async (conflict = false) => {
    if (!snapshot || !filterState) {
      setStatus('Catálogo ainda não está pronto para a fixture de backup portátil.');
      return;
    }
    setBusy(true);
    try {
      const current = useCatalogStore.getState();
      const currentState = current.filterState;
      if (!currentState) throw new Error('Filtros atuais indisponíveis.');
      const policy = new ContentPolicyService(snapshot);
      const incomingState = JSON.parse(JSON.stringify(currentState));
      incomingState.entityStates['phb-2024-spell-acid-splash'] = currentState.entityStates['phb-2024-spell-acid-splash'] === 'disabled' ? 'enabled' : 'disabled';
      const sourceHistory = current.history.map((entry) => ({ ...entry }));
      if (conflict && sourceHistory.length) sourceHistory[0] = { ...sourceHistory[0], label: `${sourceHistory[0].label} · conflito E2E` };
      const nextRevision = Math.max(current.revision, sourceHistory.reduce((maximum, entry) => Math.max(maximum, entry.revision), 0)) + 1;
      sourceHistory.push(createCatalogConfigurationHistoryEntry({
        revision: nextRevision,
        committedAt: new Date().toISOString(),
        label: 'Importação portátil E2E',
        origin: 'import',
        catalogVersion: snapshot.catalogVersion,
        catalogSnapshotId: snapshot.snapshotId,
        beforeState: currentState,
        afterState: incomingState,
        impact: policy.previewImpact(currentState, incomingState)
      }));
      const section = createPortableCatalogAuditSection({
        snapshot, filterState: incomingState, revision: nextRevision, history: sourceHistory,
        remediationPlans: useCharacterStore.getState().compatibilityRemediationPlans
      });
      const comparison = comparePortableCatalogAudit({
        snapshot, localFilterState: currentState, localRevision: current.revision, localHistory: current.history,
        localPlans: useCharacterStore.getState().compatibilityRemediationPlans, incoming: section
      });
      previewPortableBackupImport(section, comparison);
      setStatus(conflict ? 'Cenário E2E de conflito de backup portátil preparado.' : 'Cenário E2E de importação de backup portátil preparado.');
    } catch (error) {
      setStatus(`Falha ao preparar backup portátil: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };


  const prepareRestoreSessionScenario = async (scenario: 'preview' | 'interrupted' | 'commit' | 'rollback') => {
    setBusy(true);
    try {
      usePortableRestoreSessionStore.setState({ activeSession: undefined });
      const base = { ...createEmptyCharacter('E2E Restore Base'), id: 'e2e-restore-base' };
      const imported = { ...createEmptyCharacter('E2E Restore Imported'), id: 'e2e-restore-imported' };
      setCharacters([base]);
      const backup = createCharacterDataBackup(
        { characters: [imported], scenarios: [], buildPresets: [], buildHistorySnapshots: [] },
        { metadata: { name: `E2E restore ${scenario}` } }
      );
      const prepared = preparePortableRestoreSession({
        backup,
        options: { mode: 'merge' },
        current: capturePortableRestoreCheckpoint()
      });
      if (!prepared.ok || !prepared.session) throw new Error('Não foi possível preparar a sessão portátil E2E.');
      usePortableRestoreSessionStore.getState().setPreparedSession(prepared.session);
      if (scenario === 'interrupted') {
        usePortableRestoreSessionStore.getState().markCommitStarted();
        usePortableRestoreSessionStore.getState().markInterrupted('Interrupção E2E simulada antes da aplicação completa.');
      } else if (scenario === 'commit' || scenario === 'rollback') {
        const result = await commitPortableRestoreSession();
        if (!result.ok) throw new Error(result.issues.join('\n'));
      }
      setStatus(`Cenário E2E de sessão portátil ${scenario} preparado.`);
    } catch (error) {
      setStatus(`Falha ao preparar sessão portátil: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };


  const preparePostRestoreVerificationScenario = async (scenario: 'divergence' | 'corrected' | 'warning' | 'closed') => {
    if (!snapshot || !filterState || bridge.status !== 'ready') {
      setStatus('Catálogo ainda não está pronto para a fixture de verificação pós-restauração.');
      return;
    }
    setBusy(true);
    try {
      usePortableRestoreSessionStore.setState({ activeSession: undefined });
      const base = { ...createEmptyCharacter('E2E Verification Base'), id: 'e2e-verification-base', catalogSnapshotId: snapshot.snapshotId };
      const imported = { ...createEmptyCharacter('E2E Verification Imported'), id: 'e2e-verification-imported', catalogSnapshotId: snapshot.snapshotId };
      setCharacters([base]);
      useCharacterStore.setState({
        compatibilityRemediationQuarantine: scenario === 'warning' ? {
          'e2e-verification-quarantine': {
            id: 'e2e-verification-quarantine', quarantinedAt: new Date().toISOString(), reason: 'invalid', rawPlan: { fixture: true }
          }
        } : {}
      });
      const backup = createCharacterDataBackup(
        { characters: [imported], scenarios: [], buildPresets: [], buildHistorySnapshots: [] },
        { metadata: { name: `E2E post verification ${scenario}` } }
      );
      const prepared = preparePortableRestoreSession({ backup, options: { mode: 'merge' }, current: capturePortableRestoreCheckpoint() });
      if (!prepared.ok || !prepared.session) throw new Error('Não foi possível preparar a sessão de verificação E2E.');
      usePortableRestoreSessionStore.getState().setPreparedSession(prepared.session);
      const committed = await commitPortableRestoreSession();
      if (!committed.session?.committedAt) throw new Error(committed.issues.join('\n') || 'Commit E2E não concluído.');
      if (scenario === 'divergence' || scenario === 'corrected') {
        updateCharacter('e2e-verification-base', (character) => ({ ...character, notes: 'Divergência E2E após commit' }));
        verifyCommittedPortableRestoreSession();
      }
      if (scenario === 'corrected') {
        const active = usePortableRestoreSessionStore.getState().activeSession;
        if (!active) throw new Error('Sessão E2E não encontrada para correção.');
        applyPortableRestoreDataCheckpoint(active.projected);
        verifyCommittedPortableRestoreSession();
      }
      if (scenario === 'closed') {
        if (!usePortableRestoreSessionStore.getState().archiveCommittedSession()) throw new Error('Sessão E2E íntegra não pôde ser encerrada.');
      }
      setStatus(`Cenário E2E de verificação pós-restauração ${scenario} preparado.`);
    } catch (error) {
      setStatus(`Falha ao preparar verificação pós-restauração: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const prepareEvidenceCenterScenario = async (scenario: 'imported' | 'tampered' | 'changed' | 'cleanup') => {
    setBusy(true);
    try {
      usePortableRestoreSessionStore.setState({ activeSession: undefined, archivedSessions: [], evidenceRecords: [] });
      await preparePostRestoreVerificationScenario('closed');
      const restoreState = usePortableRestoreSessionStore.getState();
      const local = restoreState.evidenceRecords[0];
      if (!local?.evidence) throw new Error('A evidência local E2E não foi gerada.');
      if (scenario === 'imported') {
        const parsed = parsePortableRestoreEvidenceImport(portableRestoreEvidenceToJson(local.evidence));
        if (!parsed.ok) throw new Error(parsed.issues.join('\n'));
        usePortableRestoreSessionStore.setState({ evidenceRecords: parsed.records, archivedSessions: [] });
      } else if (scenario === 'tampered') {
        const parsed = parsePortableRestoreEvidenceImport(JSON.stringify({ ...local.evidence, sessionId: 'e2e-tampered-session' }));
        if (!parsed.records[0]) throw new Error('O registro adulterado não foi materializado para diagnóstico.');
        usePortableRestoreSessionStore.setState({ evidenceRecords: parsed.records, archivedSessions: [] });
      } else if (scenario === 'changed') {
        updateCharacter('e2e-verification-base', (character) => ({ ...character, notes: 'Alteração posterior ao recibo E2E' }));
        usePortableRestoreSessionStore.getState().revalidateEvidenceHistory(capturePortableRestoreCheckpoint(), useCatalogStore.getState().history, true);
      } else {
        const archived = usePortableRestoreSessionStore.getState().archivedSessions[0];
        if (!archived) throw new Error('Checkpoint E2E não encontrado.');
        usePortableRestoreSessionStore.setState({
          archivedSessions: Array.from({ length: 7 }, (_, index) => ({
            ...archived,
            id: `e2e-evidence-checkpoint-${index}`,
            closedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`
          }))
        });
      }
      setStatus(`Cenário E2E da central de evidências ${scenario} preparado.`);
    } catch (error) {
      setStatus(`Falha ao preparar central de evidências: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };


  const prepareCatalogUpdateScenario = async (scenario: 'valid' | 'invalid' | 'revoked' = 'valid') => {
    setBusy(true);
    try {
      const currentSnapshot = useCatalogStore.getState().snapshot;
      if (!currentSnapshot) throw new Error('Catálogo atual indisponível.');
      useCatalogUpdateSessionStore.setState({ activeSession: undefined, history: [] });
      const registry = createDefaultCatalogTrustRegistry(() => new Date('2026-08-04T15:55:00.000Z'));
      if (scenario === 'revoked') {
        registry.publishers[0].keys[0].status = 'revoked';
        registry.publishers[0].keys[0].revokedAt = '2026-08-04T15:58:00.000Z';
      }
      useCatalogTrustStore.getState().replaceRegistry(registry);
      const source = require('../assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json') as RuntimeCatalogBundle;
      const proof = require('../assets/catalog-v4.8.0/e2e-signed-update-proof.json') as { schemaVersion: string; provenance: Record<string, unknown>; signature: string };
      const candidate = JSON.parse(JSON.stringify(source)) as RuntimeCatalogBundle;
      candidate.catalogVersion = '4.8.1-e2e';
      candidate.manifest.version = candidate.catalogVersion;
      candidate.sourcePackage.version = candidate.catalogVersion;
      candidate.runtimeIndex.version = candidate.catalogVersion;
      candidate.entityRegistry.generatedFromVersion = candidate.catalogVersion;
      candidate.dependencyGraph.generatedFromVersion = candidate.catalogVersion;
      candidate.contentCategories.version = candidate.catalogVersion;
      const changedId = candidate.runtimeIndex.entries[0]?.entityId;
      if (!changedId) throw new Error('Catálogo sem entidade para fixture.');
      candidate.runtimeIndex.entries[0] = {
        ...candidate.runtimeIndex.entries[0],
        displayContext: [...candidate.runtimeIndex.entries[0].displayContext, 'E2E catalog update']
      };
      const character = { ...createEmptyCharacter('E2E Catalog Update'), id: 'e2e-catalog-update', catalogSnapshotId: currentSnapshot.snapshotId };
      setCharacters([character]);
      const envelope = {
        schemaVersion: proof.schemaVersion,
        catalog: candidate,
        provenance: proof.provenance,
        signature: scenario === 'invalid' ? `${proof.signature.startsWith('A') ? 'B' : 'A'}${proof.signature.slice(1)}` : proof.signature
      };
      const result = await useCatalogUpdateSessionStore.getState().prepareCandidate({
        rawText: JSON.stringify(envelope),
        sourceName: 'catalog-v4.8.1-e2e.signed.json',
        currentReports: [{
          status: 'compatible', requiresReview: false, canOpenAfterAcknowledgement: true,
          manifest: {
            schemaVersion: 'dnd-character-rules-manifest.v1', characterId: character.id, characterName: character.name,
            generatedAt: new Date().toISOString(), characterCatalogSnapshotId: currentSnapshot.snapshotId,
            currentCatalogSnapshotId: currentSnapshot.snapshotId, currentCatalogVersion: currentSnapshot.catalogVersion,
            catalogSnapshotIds: [currentSnapshot.snapshotId], sourceBookIds: [], sourceIds: [], catalogEntityIds: [changedId], compendiumItemIds: [],
            references: [{ key: `catalog:${changedId}`, choiceId: `catalog:${changedId}`, origin: 'catalog', role: 'e2e', label: 'E2E changed entity', entityId: changedId, status: 'available', manualReviewRequired: false, discoveredFrom: ['e2e'] }],
            counts: { total: 1, available: 1, review: 0, disabled: 0, missing: 0, catalog: 1, compendium: 0 }
          }, issues: [], blockingIssueCount: 0, warningCount: 0
        }]
      });
      if (scenario === 'valid') {
        if (!result.ok) throw new Error(result.issues.join('\n'));
        setStatus('Atualização assinada e confiável preparada para E2E.');
      } else {
        if (result.ok) throw new Error('O cenário não confiável foi aceito indevidamente.');
        setStatus(scenario === 'invalid' ? 'Assinatura inválida rejeitada corretamente.' : 'Chave revogada rejeitada corretamente.');
      }
    } catch (error) {
      setStatus(`Falha ao preparar atualização E2E: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!seedAllowed) {
    return (
      <Screen title="Ferramenta indisponível" onBack={() => router.replace('/')}>
        <Card variant="filled" title="Build não autorizada" subtitle="A preparação E2E só é habilitada em development ou em beta-candidate interna explicitamente configurada." />
      </Screen>
    );
  }

  return (
    <Screen title="Preparação E2E" subtitle={`Ferramenta interna · ${buildInfo.releaseStage} · não vinculada à navegação principal.`} onBack={() => router.replace('/')}>
      <Card variant="hero" title="Fixture mínima de criação">
        <Text testID="e2e-seed-status" accessibilityLiveRegion="polite" style={{ color: colors.onSurfaceVariant }}>{status}</Text>
        <Button testID="e2e-seed-button" label="Preparar ambiente E2E" onPress={() => { void seed(); }} disabled={busy} />
        <Button testID="e2e-open-creation" label="Abrir criação de personagem" variant="outlined" onPress={() => router.replace('/characters/new')} disabled={busy} />
        <Button testID="e2e-seed-tactical-mobile" label="Preparar fechamento móvel tático" variant="outlined" onPress={prepareTacticalMobileScenario} disabled={busy} />
        <Button testID="e2e-open-tactical-mobile" label="Abrir combate tático E2E" variant="text" onPress={() => router.replace(`/characters/${E2E_TACTICAL_CHARACTER_ID}/tactical`)} disabled={busy} />
        <Button testID="e2e-seed-progression-recovery" label="Preparar recuperação transacional" variant="outlined" onPress={() => prepareProgressionScenario('recovery')} disabled={busy} />
        <Button testID="e2e-seed-progression-conflict" label="Preparar conflito transacional" variant="outlined" onPress={() => prepareProgressionScenario('conflict')} disabled={busy} />
        <Button testID="e2e-seed-progression-rollback" label="Preparar rollback transacional" variant="outlined" onPress={() => prepareProgressionScenario('rollback')} disabled={busy} />
        <Button testID="e2e-open-progression-recovery" label="Abrir recuperação de progressão" variant="text" onPress={() => router.replace('/progression-recovery')} disabled={busy} />
        <Button testID="e2e-seed-remediation-create" label="Preparar criação de plano de remediação" variant="outlined" onPress={() => prepareCompatibilityScenario('create')} disabled={busy} />
        <Button testID="e2e-seed-remediation-discard" label="Preparar descarte de plano de remediação" variant="outlined" onPress={() => prepareCompatibilityScenario('discard')} disabled={busy} />
        <Button testID="e2e-seed-remediation-commit" label="Preparar commit de plano de remediação" variant="outlined" onPress={() => prepareCompatibilityScenario('commit')} disabled={busy} />
        <Button testID="e2e-seed-remediation-rollback" label="Preparar rollback de remediação" variant="outlined" onPress={() => prepareCompatibilityScenario('rollback')} disabled={busy} />
        <Button testID="e2e-open-remediation-management" label="Abrir planos e manifestos" variant="text" onPress={() => router.replace('/character-compatibility')} disabled={busy} />
        <Button testID="e2e-seed-catalog-impact" label="Preparar impacto preventivo do catálogo" variant="outlined" onPress={() => { void prepareCatalogImpactScenario(); }} disabled={busy} />
        <Button testID="e2e-open-content-management" label="Abrir gerenciamento de conteúdo" variant="text" onPress={() => router.replace('/content-management')} disabled={busy} />
        <Button testID="e2e-seed-catalog-history" label="Preparar histórico transacional do catálogo" variant="outlined" onPress={() => { void prepareCatalogHistoryScenario(); }} disabled={busy} />
        <Button testID="e2e-open-catalog-history" label="Abrir histórico do catálogo" variant="text" onPress={() => router.replace('/catalog-history')} disabled={busy} />
        <Button testID="e2e-seed-portable-backup" label="Preparar importação de backup portátil" variant="outlined" onPress={() => { void preparePortableBackupScenario(false); }} disabled={busy} />
        <Button testID="e2e-seed-portable-backup-conflict" label="Preparar conflito de backup portátil" variant="outlined" onPress={() => { void preparePortableBackupScenario(true); }} disabled={busy} />
        <Button testID="e2e-open-backup" label="Abrir backup portátil" variant="text" onPress={() => router.replace('/backup')} disabled={busy} />
        <Button testID="e2e-seed-restore-session-preview" label="Preparar preview de sessão portátil" variant="outlined" onPress={() => { void prepareRestoreSessionScenario('preview'); }} disabled={busy} />
        <Button testID="e2e-seed-restore-session-interrupted" label="Preparar sessão portátil interrompida" variant="outlined" onPress={() => { void prepareRestoreSessionScenario('interrupted'); }} disabled={busy} />
        <Button testID="e2e-seed-restore-session-commit" label="Preparar commit de sessão portátil" variant="outlined" onPress={() => { void prepareRestoreSessionScenario('commit'); }} disabled={busy} />
        <Button testID="e2e-seed-restore-session-rollback" label="Preparar rollback de sessão portátil" variant="outlined" onPress={() => { void prepareRestoreSessionScenario('rollback'); }} disabled={busy} />
        <Button testID="e2e-open-restore-session" label="Abrir sessão portátil" variant="text" onPress={() => router.replace('/restore-session')} disabled={busy} />
        <Button testID="e2e-seed-restore-verification-divergence" label="Preparar divergência pós-restauração" variant="outlined" onPress={() => { void preparePostRestoreVerificationScenario('divergence'); }} disabled={busy} />
        <Button testID="e2e-seed-restore-verification-corrected" label="Preparar correção pós-restauração" variant="outlined" onPress={() => { void preparePostRestoreVerificationScenario('corrected'); }} disabled={busy} />
        <Button testID="e2e-seed-restore-verification-warning" label="Preparar aceite de avisos pós-restauração" variant="outlined" onPress={() => { void preparePostRestoreVerificationScenario('warning'); }} disabled={busy} />
        <Button testID="e2e-seed-restore-verification-closed" label="Preparar recibo encerrado para rollback" variant="outlined" onPress={() => { void preparePostRestoreVerificationScenario('closed'); }} disabled={busy} />
        <Button testID="e2e-seed-evidence-imported" label="Preparar evidência importada" variant="outlined" onPress={() => { void prepareEvidenceCenterScenario('imported'); }} disabled={busy} />
        <Button testID="e2e-seed-evidence-tampered" label="Preparar evidência adulterada" variant="outlined" onPress={() => { void prepareEvidenceCenterScenario('tampered'); }} disabled={busy} />
        <Button testID="e2e-seed-evidence-changed" label="Preparar comparação histórica alterada" variant="outlined" onPress={() => { void prepareEvidenceCenterScenario('changed'); }} disabled={busy} />
        <Button testID="e2e-seed-evidence-cleanup" label="Preparar retenção de checkpoints" variant="outlined" onPress={() => { void prepareEvidenceCenterScenario('cleanup'); }} disabled={busy} />
        <Button testID="e2e-open-evidence-center" label="Abrir central de evidências" variant="text" onPress={() => router.replace('/evidence-center')} disabled={busy} />
        <Button testID="e2e-seed-catalog-update" label="Preparar atualização transacional do catálogo" variant="outlined" onPress={() => { void prepareCatalogUpdateScenario('valid'); }} disabled={busy} />
        <Button testID="e2e-seed-catalog-signature-invalid" label="Rejeitar assinatura inválida" variant="outlined" onPress={() => { void prepareCatalogUpdateScenario('invalid'); }} disabled={busy} />
        <Button testID="e2e-seed-catalog-key-revoked" label="Rejeitar chave revogada" variant="outlined" onPress={() => { void prepareCatalogUpdateScenario('revoked'); }} disabled={busy} />
        <Button testID="e2e-open-catalog-update" label="Abrir atualização do catálogo" variant="text" onPress={() => router.replace('/catalog-update')} disabled={busy} />

      </Card>
    </Screen>
  );
}
