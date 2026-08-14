import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native';
import { router } from 'expo-router';
import { BottomNavigation } from '../src/components/BottomNavigation';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { Field } from '../src/components/Field';
import { MetricTile } from '../src/components/MetricTile';
import { VirtualizedScreen } from '../src/components/VirtualizedScreen';
import {
  ContentPolicyService,
  type CatalogEntityState,
  type ContentCategory,
  type FilterImpactReport,
  type RuntimeCatalogEntry
} from '../src/catalog';
import {
  useCatalogStore,
  type PendingCatalogFilterChange
} from '../src/store/catalogStore';
import { useAppTheme } from '../src/theme';
import { useCharacterChoiceBridge } from '../src/catalog/useCharacterChoiceBridge';
import { useCharacterStore } from '../src/store/characterStore';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { BUNDLED_COMPENDIUM_PACKS, isRequiredCharacterCreationBundledPack } from '../src/compendium/bundledCompendium';
import {
  buildCatalogChangeCharacterImpact,
  createPreventiveCompatibilityPlans,
  reconcilePreventiveCompatibilityPlans
} from '../src/characters/catalogChangeImpact';

type ViewMode = 'books' | 'categories' | 'entities';

type ContentRow =
  | { rowType: 'category'; category: ContentCategory }
  | { rowType: 'entity'; entry: RuntimeCatalogEntry };

const bookLabels: Record<string, string> = {
  'phb-2024': "Player's Handbook 2024",
  'dmg-2024': "Dungeon Master's Guide 2024",
  'mm-2025': 'Monster Manual 2025'
};

const bundledBookLabels: Record<string, string> = {
  'phb-2024-full-consolidated-import-pack-v5-complete-invocations': "Player's Handbook 2024",
  'mm-2024-runtime-dependency-delta-v1': 'Monster Manual 2024 — dependências de criaturas',
  'forge-artificer-2025-full-consolidated-import-pack-v1': 'Eberron: Forge of the Artificer (2025)',
  'spelljammer-2022-full-consolidated-import-pack-v1': 'Spelljammer: Adventures in Space (2022)',
  'tcoe-2020-2024-compatible-import-pack-v2': "Tasha's Cauldron of Everything (2020)",
  'tcoe-2020-2024-compatible-import-pack-v1': "Tasha's Cauldron of Everything (2020) — versão anterior",
  'phb-2014-2024-compatible-delta-v1': "Player's Handbook 2014 — opções Legacy"
};

type MechanicalContentFeedback = {
  packId: string;
  tone: 'info' | 'success' | 'error';
  message: string;
};

const formatImpact = (impact: FilterImpactReport): string => {
  const lines = [
    `${impact.afterEnabled.toLocaleString('pt-BR')} entidades ficarão ativas.`,
    `${impact.disabledEntityIds.length.toLocaleString('pt-BR')} serão desativadas e ${impact.enabledEntityIds.length.toLocaleString('pt-BR')} serão ativadas.`
  ];
  if (impact.hardDependencyBreaks.length) {
    lines.push(
      '',
      `Atenção: ${impact.hardDependencyBreaks.length.toLocaleString('pt-BR')} dependência(s) obrigatória(s) ficarão indisponíveis.`
    );
  }
  return lines.join('\n');
};

export default function ContentManagementScreen() {
  const { colors } = useAppTheme();
  const [mode, setMode] = useState<ViewMode>('books');
  const [query, setQuery] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [includeManualReview, setIncludeManualReview] = useState(true);
  const [impactAcknowledged, setImpactAcknowledged] = useState(false);
  const [mechanicalFeedback, setMechanicalFeedback] = useState<MechanicalContentFeedback>();

  const status = useCatalogStore((state) => state.status);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const pendingChange = useCatalogStore((state) => state.pendingChange);
  const isSaving = useCatalogStore((state) => state.isSaving);
  const lastError = useCatalogStore((state) => state.lastError);
  const initializationIssues = useCatalogStore(
    (state) => state.initializationIssues
  );
  const initialize = useCatalogStore((state) => state.initialize);
  const retry = useCatalogStore((state) => state.retry);
  const previewBookState = useCatalogStore(
    (state) => state.previewBookState
  );
  const previewCategoryState = useCatalogStore(
    (state) => state.previewCategoryState
  );
  const previewEntityState = useCatalogStore(
    (state) => state.previewEntityState
  );
  const previewProfile = useCatalogStore((state) => state.previewProfile);
  const previewReset = useCatalogStore((state) => state.previewReset);
  const commitPendingChange = useCatalogStore(
    (state) => state.commitPendingChange
  );
  const discardPendingChange = useCatalogStore(
    (state) => state.discardPendingChange
  );
  const search = useCatalogStore((state) => state.search);
  const characters = useCharacterStore((state) => state.characters);
  const remediationPlans = useCharacterStore((state) => state.compatibilityRemediationPlans);
  const saveRemediationPlan = useCharacterStore((state) => state.saveCompatibilityRemediationPlan);
  const discardRemediationPlan = useCharacterStore((state) => state.discardCompatibilityRemediationPlan);
  const history = useCatalogStore((state) => state.history);
  const revision = useCatalogStore((state) => state.revision);
  const bridge = useCharacterChoiceBridge();
  const compendiumPacks = useCompendiumStore((state) => state.packs);
  const compendiumEnabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const compendiumHydrated = useCompendiumStore((state) => state.isHydrated);
  const compendiumHydrating = useCompendiumStore((state) => state.isHydrating);
  const compendiumSaving = useCompendiumStore((state) => state.isSaving);
  const hydrateCompendium = useCompendiumStore((state) => state.hydrate);
  const installBundledPack = useCompendiumStore((state) => state.installBundledPack);
  const repairRequiredBundledContent = useCompendiumStore((state) => state.repairRequiredBundledContent);
  const setCompendiumSourceEnabled = useCompendiumStore((state) => state.setSourceEnabled);
  const compendiumStorageError = useCompendiumStore((state) => state.lastStorageError);

  useEffect(() => {
    if (status === 'idle') void initialize();
  }, [initialize, status]);

  useEffect(() => {
    if (!compendiumHydrated && !compendiumHydrating) void hydrateCompendium();
  }, [compendiumHydrated, compendiumHydrating, hydrateCompendium]);

  const policy = useMemo(
    () => (snapshot ? new ContentPolicyService(snapshot) : undefined),
    [snapshot]
  );

  const enabledCount = useMemo(() => {
    if (!snapshot || !filterState || !policy) return 0;
    let count = 0;
    for (const entry of snapshot.entries) {
      if (policy.isEnabled(entry.entityId, filterState)) count += 1;
    }
    return count;
  }, [filterState, policy, snapshot]);

  const manualReviewCount = useMemo(
    () =>
      snapshot?.entries.filter((entry) => entry.manualReviewRequired).length ??
      0,
    [snapshot]
  );

  const rows = useMemo<ContentRow[]>(() => {
    if (!snapshot || !filterState) return [];
    if (mode === 'categories') {
      return snapshot.categories
        .slice()
        .sort((left, right) => {
          const leftName = left.name['pt-BR'] ?? left.name.en ?? left.key;
          const rightName = right.name['pt-BR'] ?? right.name.en ?? right.key;
          return leftName.localeCompare(rightName, 'pt-BR');
        })
        .map((category) => ({ rowType: 'category', category }));
    }
    if (mode === 'entities') {
      return search({
        text: query,
        includeManualReview,
        enabledOnly,
        limit: 250
      }).map((entry) => ({ rowType: 'entity', entry }));
    }
    return [];
  }, [enabledOnly, filterState, includeManualReview, mode, query, search, snapshot]);

  const characterImpact = useMemo(() => {
    if (!pendingChange || !snapshot || !filterState || bridge.status !== 'ready') return undefined;
    return buildCatalogChangeCharacterImpact({
      label: pendingChange.label,
      characters,
      snapshot,
      beforeFilterState: filterState,
      afterFilterState: pendingChange.nextState,
      choices: bridge.choices,
      impact: pendingChange.impact
    });
  }, [bridge.choices, bridge.status, characters, filterState, pendingChange, snapshot]);

  useEffect(() => {
    setImpactAcknowledged(false);
  }, [pendingChange?.label, pendingChange?.nextState]);

  const planReconciliation = useMemo(() => {
    if (!pendingChange || !snapshot || bridge.status !== 'ready') return undefined;
    return reconcilePreventiveCompatibilityPlans({
      plans: remediationPlans,
      characters,
      snapshot,
      filterState: pendingChange.nextState,
      choices: bridge.choices
    });
  }, [bridge.choices, bridge.status, characters, pendingChange, remediationPlans, snapshot]);

  const applyPendingChange = async (createPlans: boolean): Promise<void> => {
    if (!pendingChange) return;
    if (characterImpact?.requiresAcknowledgement && !impactAcknowledged) {
      Alert.alert('Reconhecimento necessário', 'Revise os personagens afetados e reconheça o impacto antes de aplicar a alteração.');
      return;
    }
    const preventive = createPlans && characterImpact
      ? createPreventiveCompatibilityPlans({
          preview: characterImpact,
          characters,
          existingPlans: remediationPlans
        })
      : undefined;
    const reconciliation = planReconciliation;
    const result = await commitPendingChange({
      acknowledgement: {
        required: characterImpact?.requiresAcknowledgement ?? false,
        acknowledged: !characterImpact?.requiresAcknowledgement || impactAcknowledged,
        acknowledgedAt: characterImpact?.requiresAcknowledgement && impactAcknowledged ? new Date().toISOString() : undefined,
        affectedCharacterIds: characterImpact?.affectedCharacters.map((entry) => entry.characterId) ?? [],
        newBlockingIssues: characterImpact?.counts.newBlockingIssues ?? 0,
        newWarnings: characterImpact?.counts.newWarnings ?? 0,
        preventivePlansRequested: createPlans,
        preventivePlanCharacterIds: preventive?.plans.map((plan) => plan.characterId) ?? [],
        obsoletePreventivePlanCharacterIds: reconciliation?.obsoleteEmptyPlanCharacterIds ?? [],
        preservedPreventivePlanCharacterIds: reconciliation?.obsoletePlanWithDecisionsCharacterIds ?? []
      }
    });
    if (!result.ok) {
      Alert.alert('Alteração não salva', result.issues.join('\n'));
      return;
    }
    preventive?.plans.forEach(saveRemediationPlan);
    reconciliation?.obsoleteEmptyPlanCharacterIds.forEach(discardRemediationPlan);
    if (reconciliation?.obsoletePlanWithDecisionsCharacterIds.length) {
      Alert.alert(
        'Planos preservados para revisão',
        `${reconciliation.obsoletePlanWithDecisionsCharacterIds.length} plano(s) deixaram de ser necessários para os filtros atuais, mas possuem decisões manuais e não foram descartados.`
      );
    }
    if (createPlans && characterImpact?.counts.affectedCharacters) {
      const skipped = preventive?.skippedCharacterIds.length ?? 0;
      Alert.alert(
        'Alteração aplicada',
        `${preventive?.plans.length ?? 0} plano(s) preventivo(s) iniciado(s).${skipped ? ` ${skipped} personagem(ns) já possuíam plano ativo e foram preservados.` : ''}`,
        [{ text: 'Abrir planos', onPress: () => router.push('/character-compatibility') }]
      );
    }
  };

  const stageAndConfirm = (
    factory: () => PendingCatalogFilterChange
  ): void => {
    try {
      factory();
      setImpactAcknowledged(false);
    } catch (error) {
      Alert.alert(
        'Alteração indisponível',
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const setEntityState = (
    entityId: string,
    entityState: CatalogEntityState
  ) => {
    stageAndConfirm(() => previewEntityState(entityId, entityState));
  };

  const handleInstallBundledPack = async (packId: string): Promise<void> => {
    const label = bundledBookLabels[packId] ?? 'Conteúdo selecionado';
    setMechanicalFeedback({ packId, tone: 'info', message: `Instalando ${label}…` });
    const result = await installBundledPack(packId);
    if (!result.ok) {
      const message = result.issues.map((issue) => issue.message).join('\n') || 'A instalação não pôde ser concluída.';
      setMechanicalFeedback({ packId, tone: 'error', message });
      Alert.alert('Conteúdo não instalado', message);
      return;
    }
    setMechanicalFeedback({
      packId,
      tone: 'success',
      message: `${label} foi instalado e preparado para criação, progressão e cálculos.`
    });
  };

  const handleRepairRequiredBundledContent = async (packId: string): Promise<void> => {
    const label = bundledBookLabels[packId] ?? "Player's Handbook 2024";
    setMechanicalFeedback({ packId, tone: 'info', message: `Verificando e reparando ${label}…` });
    const result = await repairRequiredBundledContent();
    if (!result.ok) {
      const message = result.issues.map((issue) => issue.message).join('\n') || 'O reparo não pôde ser concluído.';
      setMechanicalFeedback({ packId, tone: 'error', message });
      Alert.alert('Conteúdo básico não reparado', message);
      return;
    }
    setMechanicalFeedback({
      packId,
      tone: 'success',
      message: `${label} foi verificado. Itens ausentes foram restaurados sem remover seus outros conteúdos.`
    });
  };

  const handleMechanicalSourceToggle = async (packId: string, sourceId: string, enabled: boolean): Promise<void> => {
    const result = await setCompendiumSourceEnabled(sourceId, enabled);
    if (!result.ok) {
      const message = result.issues.map((issue) => issue.message).join('\n') || 'A fonte não pôde ser atualizada.';
      setMechanicalFeedback({ packId, tone: 'error', message });
      Alert.alert('Fonte não atualizada', message);
      return;
    }
    setMechanicalFeedback({
      packId,
      tone: 'success',
      message: enabled ? 'Conteúdo ativado para novas escolhas.' : 'Conteúdo desativado para novas escolhas; dados existentes foram preservados.'
    });
  };


  const renderBookControls = () => {
    if (!snapshot || !filterState) return null;
    return snapshot.manifest.sourceBooks.map((bookId) => {
      const enabled = filterState.bookStates[bookId] ?? true;
      const memberCount = snapshot.entries.filter(
        (entry) => entry.sourceBookId === bookId
      ).length;
      return (
        <View key={bookId} style={[styles.bookRow, { borderTopColor: colors.outlineVariant }]}> 
          <View style={styles.flex}>
            <Text style={[styles.rowTitle, { color: colors.onSurface }]}> 
              {bookLabels[bookId] ?? bookId}
            </Text>
            <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
              {memberCount.toLocaleString('pt-BR')} entidades · {enabled ? 'ativo' : 'inativo'}
            </Text>
          </View>
          <Switch
            accessibilityLabel={`${enabled ? 'Desativar' : 'Ativar'} ${bookLabels[bookId] ?? bookId}`}
            value={enabled}
            disabled={isSaving}
            onValueChange={(next) =>
              stageAndConfirm(() => previewBookState(bookId, next))
            }
            trackColor={{ false: colors.outlineVariant, true: colors.secondaryContainer }}
            thumbColor={enabled ? colors.secondary : colors.outline}
          />
        </View>
      );
    });
  };

  const renderMechanicalPackControls = () => BUNDLED_COMPENDIUM_PACKS.map((definition) => {
    const installed = compendiumPacks.find((pack) => pack.id === definition.id);
    const predecessorInstalled = !installed
      ? compendiumPacks.find((pack) => definition.predecessorPackIds?.includes(pack.id))
      : undefined;
    const required = isRequiredCharacterCreationBundledPack(definition.id);
    const enabled = installed ? compendiumEnabledSourceIds.includes(installed.sourceId) : false;
    const busy = compendiumHydrating || compendiumSaving;
    const feedback = mechanicalFeedback?.packId === definition.id ? mechanicalFeedback : undefined;
    const displayLabel = bundledBookLabels[definition.id] ?? definition.label;
    return (
      <View key={definition.id} style={[styles.mechanicalPackRow, { borderTopColor: colors.outlineVariant }]}>
        <View style={styles.rowInline}>
          <View style={styles.flex}>
            <Text style={[styles.rowTitle, { color: colors.onSurface }]}>{displayLabel}</Text>
            <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
              {installed
                ? `${installed.itemCount.toLocaleString('pt-BR')} itens · ${required ? 'conteúdo básico' : enabled ? 'ativo' : 'inativo'}`
                : predecessorInstalled
                  ? `${predecessorInstalled.itemCount.toLocaleString('pt-BR')} itens na versão anterior · atualização compatível disponível`
                  : required
                    ? 'Conteúdo básico ainda não persistido neste dispositivo; o fallback embarcado mantém a criação disponível.'
                    : 'Disponível para instalar neste dispositivo'}
            </Text>
          </View>
          {installed ? (
            <Switch
              accessibilityLabel={`${enabled ? 'Desativar' : 'Ativar'} ${displayLabel}`}
              value={required ? true : enabled}
              disabled={busy || required}
              onValueChange={(next) => { void handleMechanicalSourceToggle(definition.id, installed.sourceId, next); }}
              trackColor={{ false: colors.outlineVariant, true: colors.secondaryContainer }}
              thumbColor={required || enabled ? colors.secondary : colors.outline}
            />
          ) : (
            <Button
              label={required ? 'Reparar' : predecessorInstalled ? 'Atualizar' : 'Instalar'}
              variant="text"
              disabled={busy}
              onPress={() => {
                if (required) void handleRepairRequiredBundledContent(definition.id);
                else void handleInstallBundledPack(definition.id);
              }}
            />
          )}
        </View>
        {feedback ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[
              feedback.tone === 'error' ? styles.error : feedback.tone === 'success' ? styles.success : styles.muted,
              { color: feedback.tone === 'error' ? colors.error : feedback.tone === 'success' ? colors.secondary : colors.onSurfaceVariant }
            ]}
          >
            {feedback.message}
          </Text>
        ) : null}
      </View>
    );
  });


  const headerContent = (
    <>
      <Card
        variant="hero"
        title={
          status === 'ready'
            ? `Catálogo ${snapshot?.catalogVersion ?? ''} pronto`
            : status === 'loading'
              ? 'Carregando catálogo consolidado'
              : status === 'failed'
                ? 'Falha ao carregar o catálogo'
                : 'Catálogo ainda não iniciado'
        }
        subtitle="Controle livros, categorias e entidades sem apagar conteúdo ou alterar snapshots existentes."
      >
        {lastError ? (
          <Text style={[styles.error, { color: colors.error }]}>{lastError}</Text>
        ) : null}
        {initializationIssues.map((issue) => (
          <Text key={issue} style={[styles.muted, { color: colors.onSurfaceVariant }]}>
            {issue}
          </Text>
        ))}
        {status === 'failed' ? (
          <Button label="Tentar carregar novamente" onPress={() => void retry()} />
        ) : null}
      </Card>

      {snapshot && filterState ? (
        <>
          <View style={styles.metrics}>
            <MetricTile label="Entidades" value={snapshot.entries.length.toLocaleString('pt-BR')} />
            <MetricTile label="Ativas" value={enabledCount.toLocaleString('pt-BR')} />
            <MetricTile label="Revisão" value={manualReviewCount.toLocaleString('pt-BR')} />
          </View>

          <Card title="Perfis rápidos" subtitle="A aplicação mostra o impacto antes de salvar.">
            <View style={styles.wrap}>
              {snapshot.filterPolicy.profiles.map((profile) => (
                <Chip
                  key={profile.id}
                  label={profile.name}
                  disabled={isSaving}
                  onPress={() =>
                    stageAndConfirm(() => previewProfile(profile.id))
                  }
                />
              ))}
            </View>
            <Button
              label="Restaurar padrão oficial completo"
              variant="text"
              disabled={isSaving}
              onPress={() => stageAndConfirm(previewReset)}
            />
          </Card>

          <Card
            title="Histórico transacional"
            subtitle={`Revisão ${revision} · ${history.length} commit(s) local(is). Restaurações sempre voltam para este preview.`}
          >
            <Button
              testID="catalog-history-open"
              label="Abrir histórico das configurações"
              icon="time-outline"
              variant="outlined"
              onPress={() => router.push('/catalog-history')}
            />
            <Button
              testID="catalog-update-open"
              label="Atualizar versão do catálogo"
              secondary
              onPress={() => router.push('/catalog-update')}
            />
          </Card>

          <Card title="Escopo do gerenciamento">
            <View style={styles.wrap}>
              <Chip
                label="Livros"
                selected={mode === 'books'}
                onPress={() => setMode('books')}
              />
              <Chip
                label="Categorias"
                selected={mode === 'categories'}
                onPress={() => setMode('categories')}
              />
              <Chip
                label="Entidades"
                selected={mode === 'entities'}
                onPress={() => setMode('entities')}
              />
            </View>
          </Card>

          {mode === 'books' ? (
            <>
              <Card
                title="Índice oficial consolidado"
                subtitle="PHB/DMG/MM controlam a disponibilidade editorial do catálogo consolidado."
              >
                {renderBookControls()}
              </Card>
              <Card
                title="Livros e suplementos do compêndio"
                subtitle="Conteúdo de regras usado diretamente por criação, progressão e cálculos. Livros adicionais incluídos no app podem ser instalados aqui."
              >
                {compendiumStorageError ? (
                  <Text style={[styles.error, { color: colors.error }]}>{compendiumStorageError}</Text>
                ) : null}
                {renderMechanicalPackControls()}
              </Card>
            </>
          ) : null}

          {mode === 'entities' ? (
            <Card
              title="Buscar entidades"
              subtitle="Até 250 resultados por consulta. Use termos específicos para localizar conteúdo."
            >
              <Field
                label="Nome, ID ou tipo"
                value={query}
                onChangeText={setQuery}
                placeholder="Ex.: fighter, fireball, ancient dragon..."
                autoCapitalize="none"
              />
              <View style={styles.wrap}>
                <Chip
                  label="Somente ativas"
                  selected={enabledOnly}
                  onPress={() => setEnabledOnly((value) => !value)}
                />
                <Chip
                  label="Incluir revisão editorial"
                  selected={includeManualReview}
                  onPress={() => setIncludeManualReview((value) => !value)}
                />
              </View>
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
                {rows.length.toLocaleString('pt-BR')} resultado(s) exibido(s).
              </Text>
            </Card>
          ) : null}

          {pendingChange ? (
            <Card
              variant="filled"
              title="Preview preventivo"
              subtitle={pendingChange.label}
            >
              <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
                {formatImpact(pendingChange.impact)}
              </Text>
              {pendingChange.origin === 'restore' ? (
                <Text testID="catalog-history-restoration-preview" style={[styles.warning, { color: colors.warning }]}>Esta é uma nova transação de restauração. O estado anterior só será aplicado após este preview e o reconhecimento de qualquer impacto.</Text>
              ) : null}
              {pendingChange.portableImport ? (
                <View testID="portable-catalog-import-preview" style={styles.impactRow}>
                  <Text style={[styles.warning, { color: colors.warning }]}>Backup portátil: {pendingChange.portableImport.comparison} · origem r{pendingChange.portableImport.sourceRevision} · {pendingChange.portableImport.sourceHistory.length} commit(s) preservados como auditoria importada.</Text>
                  {pendingChange.portableImport.conflictingCommitIds.length ? <Text style={[styles.error, { color: colors.error }]}>{pendingChange.portableImport.conflictingCommitIds.length} commit(s) possuem o mesmo ID e conteúdo divergente. O histórico local não será sobrescrito.</Text> : null}
                </View>
              ) : null}
              {bridge.status !== 'ready' ? (
                <Text style={[styles.warning, { color: colors.warning }]}>Aguardando o compêndio para calcular o impacto nas fichas.</Text>
              ) : characterImpact ? (
                <>
                  <View style={styles.metrics}>
                    <MetricTile label="Fichas verificadas" value={characterImpact.counts.charactersScanned} />
                    <MetricTile label="Afetadas" value={characterImpact.counts.affectedCharacters} />
                    <MetricTile label="Novos bloqueios" value={characterImpact.counts.newBlockingIssues} />
                  </View>
                  {characterImpact.affectedCharacters.map((character) => (
                    <View key={character.characterId} style={[styles.impactRow, { borderTopColor: colors.outlineVariant }]}>
                      <View style={styles.flex}>
                        <Text style={[styles.rowTitle, { color: colors.onSurface }]}>{character.characterName}</Text>
                        <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                          {character.affectedReferences.length} referência(s) · {character.blockingIssuesBefore} → {character.blockingIssuesAfter} bloqueio(s)
                        </Text>
                        <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
                          {character.affectedReferences.map((reference) => reference.label).join(', ')}
                        </Text>
                      </View>
                      <Button
                        label="Manifesto"
                        variant="text"
                        onPress={() => router.push(`/characters/${character.characterId}/compatibility`)}
                      />
                    </View>
                  ))}
                  {characterImpact.groups.length ? (
                    <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Ocorrências compartilhadas: {characterImpact.groups.slice(0, 5).map((group) => `${group.label} (${group.characterIds.length})`).join(' · ')}</Text>
                  ) : null}
                  {planReconciliation && (planReconciliation.obsoleteEmptyPlanCharacterIds.length || planReconciliation.obsoletePlanWithDecisionsCharacterIds.length) ? (
                    <Text testID="catalog-history-plan-reconciliation" style={[styles.warning, { color: colors.warning }]}>A configuração projetada torna {planReconciliation.obsoleteEmptyPlanCharacterIds.length} plano(s) preventivo(s) vazio(s) obsoleto(s). {planReconciliation.obsoletePlanWithDecisionsCharacterIds.length} plano(s) com decisões serão preservados para revisão.</Text>
                  ) : null}
                  {characterImpact.requiresAcknowledgement ? (
                    <Chip
                      testID="catalog-impact-acknowledgement"
                      label={characterImpact.counts.affectedCharacters ? "Reconheço o impacto nas fichas" : "Reconheço as dependências que ficarão indisponíveis"}
                      selected={impactAcknowledged}
                      onPress={() => setImpactAcknowledged((value) => !value)}
                    />
                  ) : (
                    <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>Nenhuma ficha será incompatibilizada por esta alteração.</Text>
                  )}
                </>
              ) : null}
              <Button
                testID="catalog-impact-apply"
                label="Aplicar configuração"
                disabled={isSaving || bridge.status !== 'ready' || Boolean(characterImpact?.requiresAcknowledgement && !impactAcknowledged)}
                onPress={() => void applyPendingChange(false)}
              />
              {characterImpact?.counts.affectedCharacters ? (
                <Button
                  testID="catalog-impact-apply-and-plan"
                  label="Aplicar e iniciar planos preventivos"
                  icon="git-compare-outline"
                  variant="tonal"
                  disabled={isSaving || !impactAcknowledged}
                  onPress={() => void applyPendingChange(true)}
                />
              ) : null}
              <Button
                testID="catalog-impact-discard"
                label="Cancelar alteração"
                variant="text"
                onPress={discardPendingChange}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <VirtualizedScreen<ContentRow>
      eyebrow="Regras e fontes"
      title="Gerenciar conteúdo"
      subtitle="Ative ou desative livros, categorias e entidades com prévia de dependências."
      onBack={() => router.back()}
      fixedFooter={(
        <BottomNavigation
          activeKey="compendium"
          items={[
            {
              key: 'characters',
              label: 'Personagens',
              icon: 'people',
              onPress: () => router.replace('/')
            },
            {
              key: 'compendium',
              label: 'Compêndio',
              icon: 'library',
              onPress: () => router.replace('/compendium')
            },
            {
              key: 'settings',
              label: 'Ajustes',
              icon: 'settings',
              onPress: () => router.replace('/settings')
            }
          ]}
        />
      )}
      data={rows}
      keyExtractor={(row) =>
        row.rowType === 'category'
          ? row.category.id
          : row.entry.entityId
      }
      headerContent={headerContent}
      emptyContent={
        status === 'ready' && mode !== 'books' ? (
          <Card
            variant="filled"
            title="Nenhum conteúdo encontrado"
            subtitle="Ajuste a busca ou os filtros desta tela."
          />
        ) : undefined
      }
      renderItem={({ item }) => {
        if (!snapshot || !filterState || !policy) return null;

        if (item.rowType === 'category') {
          const { category } = item;
          const explicit = filterState.categoryStates[category.id];
          const enabled = explicit ?? category.defaultEnabled;
          const label =
            category.name['pt-BR'] ?? category.name.en ?? category.key;
          return (
            <Card
              title={label}
              subtitle={`${category.memberCount.toLocaleString('pt-BR')} entidades · ${category.sourceBookId ?? 'multilivro'}`}
            >
              <View style={styles.rowInline}>
                <Text style={[styles.muted, styles.flex, { color: colors.onSurfaceVariant }]}> 
                  {category.canDisable
                    ? enabled
                      ? 'Categoria ativa'
                      : 'Categoria desativada'
                    : 'Categoria protegida pelo núcleo de regras'}
                </Text>
                <Switch
                  accessibilityLabel={`${enabled ? 'Desativar' : 'Ativar'} ${label}`}
                  value={enabled}
                  disabled={isSaving || category.canDisable === false}
                  onValueChange={(next) =>
                    stageAndConfirm(() =>
                      previewCategoryState(category.id, next)
                    )
                  }
                  trackColor={{ false: colors.outlineVariant, true: colors.secondaryContainer }}
                  thumbColor={enabled ? colors.secondary : colors.outline}
                />
              </View>
            </Card>
          );
        }

        const { entry } = item;
        const availability = policy.evaluate(entry, filterState);
        const explicit = filterState.entityStates[entry.entityId] ?? 'inherit';
        const protectedEntity = entry.categoryIds.some(
          (categoryId) =>
            snapshot.categoryById.get(categoryId)?.canDisable === false
        );
        return (
          <Card
            title={entry.displayName}
            subtitle={`${entry.kind} · ${entry.sourceBookId ?? 'núcleo'} · ${availability.enabled ? 'ativa' : 'inativa'}`}
          >
            <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
              {entry.entityId}
            </Text>
            {entry.manualReviewRequired ? (
              <Text style={[styles.warning, { color: colors.warning }]}> 
                Revisão editorial independente ainda indicada.
              </Text>
            ) : null}
            <View style={styles.wrap}>
              <Chip
                label="Herdar"
                selected={explicit === 'inherit'}
                disabled={isSaving}
                onPress={() => setEntityState(entry.entityId, 'inherit')}
              />
              <Chip
                label="Ativar"
                selected={explicit === 'enabled'}
                disabled={isSaving}
                onPress={() => setEntityState(entry.entityId, 'enabled')}
              />
              <Chip
                label="Desativar"
                selected={explicit === 'disabled'}
                disabled={isSaving || protectedEntity}
                onPress={() => setEntityState(entry.entityId, 'disabled')}
              />
            </View>
            <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
              Motivo efetivo: {availability.reason}
            </Text>
          </Card>
        );
      }}
      footerContent={(
        <Card
          title="Segurança da configuração"
          subtitle="As preferências são persistidas separadamente do compêndio e não alteram personagens ou combates já salvos."
        >
          <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}> 
            Mudanças com dependências obrigatórias quebradas sempre exibem aviso antes da confirmação.
          </Text>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flex: 1 },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 12
  },
  mechanicalPackRow: {
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 12
  },
  rowInline: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  impactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingTop: 10 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800' },
  muted: { fontSize: 13, lineHeight: 19 },
  error: { fontSize: 13, lineHeight: 19, fontWeight: '800' },
  success: { fontSize: 13, lineHeight: 19, fontWeight: '800' },
  warning: { fontSize: 13, lineHeight: 19, fontWeight: '800' }
});
