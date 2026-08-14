import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { VirtualizedScreen } from '../../src/components/VirtualizedScreen';
import { Card } from '../../src/components/Card';
import { Field } from '../../src/components/Field';
import { Button } from '../../src/components/Button';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import { IssueList } from '../../src/components/IssueList';
import { parseAndPreviewImportPack } from '../../src/compendium/parseImportPreview';
import { useCompendiumStore } from '../../src/store/compendiumStore';
import { RuleValidationIssue } from '../../src/types';
import { getActiveCompendiumRepository } from '../../src/storage/activeCompendiumRepository';
import type { CompendiumItemType, StoredCompendiumItemStatus } from '../../src/compendium/types';
import { isCoreCharacterPreparationItem } from '../../src/compendium/coreCharacterContentPreparation';
import { isRequiredCharacterCreationBundledPack } from '../../src/compendium/bundledCompendium';

const exampleJson = JSON.stringify(
  {
    templateVersion: 'dnd-combat-import.v2',
    id: 'manual-import-example',
    source: { id: 'manual-source', book: 'Minha fonte legal', page: '1', version: '2024', status: 'active', confidence: 'manual' },
    items: [
      {
        id: 'training-weapon',
        kind: 'weapon',
        name: 'Arma de treino importada',
        summary: 'Exemplo autoral/manual usado apenas para validar persistência do compêndio.',
        source: { id: 'manual-source', book: 'Minha fonte legal', page: '1', version: '2024', status: 'active', confidence: 'manual' },
        payload: { weaponCategory: 'simple', weaponType: 'melee', damageFormula: '1d8 + STR', actionCost: 'action' }
      }
    ]
  },
  null,
  2
);

const itemTypes: CompendiumItemType[] = ['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'];
const itemStatuses: StoredCompendiumItemStatus[] = ['draft', 'validated', 'needsReview', 'disabled'];


const parseCsv = (input: string): string[] => input.split(',').map((entry) => entry.trim()).filter(Boolean);

const parseTypes = (input: string): CompendiumItemType[] | undefined => {
  const values = parseCsv(input);
  if (!values.length) return undefined;
  return values.filter((entry): entry is CompendiumItemType => itemTypes.includes(entry as CompendiumItemType));
};

const parseStatuses = (input: string): StoredCompendiumItemStatus[] | undefined => {
  const values = parseCsv(input);
  if (!values.length) return undefined;
  return values.filter((entry): entry is StoredCompendiumItemStatus => itemStatuses.includes(entry as StoredCompendiumItemStatus));
};

export default function CompendiumScreen() {
  const [json, setJson] = useState(exampleJson);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);
  const [lastIssues, setLastIssues] = useState<RuleValidationIssue[]>([]);
  const [snapshotJson, setSnapshotJson] = useState('');
  const [storageStatus, setStorageStatus] = useState('Compêndio ainda não consultado nesta tela.');

  const sources = useCompendiumStore((state) => state.sources);
  const packs = useCompendiumStore((state) => state.packs);
  const items = useCompendiumStore((state) => state.items);
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const isSaving = useCompendiumStore((state) => state.isSaving);
  const lastStorageError = useCompendiumStore((state) => state.lastStorageError);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const saveImportJson = useCompendiumStore((state) => state.saveImportJson);
  const removePack = useCompendiumStore((state) => state.removePack);
  const setSourceEnabled = useCompendiumStore((state) => state.setSourceEnabled);
  const prepareCoreCharacterContent = useCompendiumStore(
    (state) => state.prepareCoreCharacterContent
  );
  const setItemStatus = useCompendiumStore((state) => state.setItemStatus);
  const searchItems = useCompendiumStore((state) => state.searchItems);
  const clearCompendium = useCompendiumStore((state) => state.clearCompendium);
  const exportSnapshotJson = useCompendiumStore((state) => state.exportSnapshotJson);
  const importSnapshotJson = useCompendiumStore((state) => state.importSnapshotJson);

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  const preview = useMemo(() => {
    const result = parseAndPreviewImportPack(json, items);
    return {
      ok: result.parse.ok && Boolean(result.preview?.valid),
      data: result.parse.data,
      issues: result.preview?.issues ?? result.parse.issues
    };
  }, [items, json]);
  const filters = useMemo(
    () => ({
      types: parseTypes(typeFilter),
      statuses: parseStatuses(statusFilter),
      sourceIds: parseCsv(sourceFilter).length ? parseCsv(sourceFilter) : undefined,
      onlyEnabled: showOnlyEnabled
    }),
    [sourceFilter, showOnlyEnabled, statusFilter, typeFilter]
  );
  const filteredItems = useMemo(() => searchItems(search, filters), [search, filters, searchItems, items, enabledSourceIds]);
  const busy = isHydrating || isSaving;

  const coreContentSummary = useMemo(() => {
    const coreItems = items.filter(
      (item) =>
        item.status !== 'disabled' &&
        isCoreCharacterPreparationItem(
          item,
          items
        )
    );

    const sourceIds = Array.from(
      new Set(coreItems.map((item) => item.sourceId))
    );

    return {
      total: coreItems.length,
      validated: coreItems.filter(
        (item) => item.status === 'validated'
      ).length,
      pending: coreItems.filter(
        (item) => item.status !== 'validated'
      ).length,
      sourceCount: sourceIds.length,
      enabledSourceCount: sourceIds.filter(
        (sourceId) =>
          enabledSourceIds.includes(sourceId)
      ).length
    };
  }, [enabledSourceIds, items]);

  const handleSave = async () => {
    const result = await saveImportJson(json);
    setLastIssues(result.issues);
    if (!result.ok) {
      Alert.alert('Importação não salva', result.issues.map((entry) => entry.message).join('\n') || 'Corrija os erros do JSON antes de persistir o pacote.');
      return;
    }
    setStorageStatus(`Importação ${result.importFormat?.toUpperCase() ?? ''} salva diretamente no SQLite: ${result.itemCount} item(ns).`);
    Alert.alert('Importação salva', `${result.itemCount} itens processados pelo compêndio SQLite local.`);
  };

  const handleClear = async () => {
    const result = await clearCompendium();
    setLastIssues(result.issues);
    if (!result.ok) {
      Alert.alert('Compêndio não limpo', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    setSnapshotJson('');
    setStorageStatus('SQLite limpo: 0 fontes, 0 pacotes, 0 itens.');
  };

  const handleExportSnapshot = () => {
    setSnapshotJson(exportSnapshotJson());
    setStorageStatus('Snapshot atual da store/SQLite exportado para o campo de texto.');
  };

  const handleExportRepositorySnapshot = async () => {
    try {
      setSnapshotJson(await getActiveCompendiumRepository().exportSnapshot());
      setStorageStatus('Snapshot lido diretamente do SQLite e exportado para o campo de texto.');
    } catch {
      Alert.alert('Exportação falhou', 'Não foi possível exportar o snapshot diretamente do SQLite.');
    }
  };

  const handleRestoreSnapshot = async () => {
    const result = await importSnapshotJson(snapshotJson);
    setLastIssues(result.issues);
    if (!result.ok) {
      Alert.alert('Snapshot inválido', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    setStorageStatus('Snapshot restaurado diretamente no SQLite e refletido na UI.');
    Alert.alert('Snapshot restaurado', 'O snapshot foi salvo no SQLite e carregado no estado reativo da UI.');
  };

  const handleHydrate = async () => {
    const result = await hydrate();
    setLastIssues(result.issues);
    if (!result.ok) Alert.alert('Hidratação falhou', result.issues.map((entry) => entry.message).join('\n'));
    else setStorageStatus('Estado recarregado do SQLite.');
  };

  const handleToggleSource = async (sourceId: string, enabled: boolean) => {
    const result = await setSourceEnabled(sourceId, enabled);
    setLastIssues(result.issues);
    if (!result.ok) Alert.alert('Fonte não atualizada', result.issues.map((entry) => entry.message).join('\n'));
  };

  const handleRemovePack = async (packId: string) => {
    const result = await removePack(packId);
    setLastIssues(result.issues);
    if (!result.ok) Alert.alert('Pacote não removido', result.issues.map((entry) => entry.message).join('\n'));
  };

  const handleValidateItem = async (itemId: string) => {
    const result = await setItemStatus(itemId, 'validated');
    setLastIssues(result.issues);
    if (!result.ok) Alert.alert('Item não validado', result.issues.map((entry) => entry.message).join('\n'));
  };

  const executePrepareCoreContent = async () => {
    const result = await prepareCoreCharacterContent();

    setLastIssues(result.issues);

    if (!result.ok) {
      Alert.alert(
        'Dados de criação não preparados',
        result.issues
          .map((entry) => entry.message)
          .join('\n') ||
          'Não foi possível atualizar o compêndio.'
      );
      return;
    }

    const message = [
      `${result.eligibleItemCount} item(ns) básico(s) disponível(is).`,
      `${result.validatedItemCount} item(ns) validado(s) nesta operação.`,
      `${result.enabledSourceCount} fonte(s) ativada(s).`
    ].join('\n');

    setStorageStatus(
      'Classes, espécies e backgrounds preparados para criação de personagem.'
    );

    Alert.alert(
      'Dados de criação preparados',
      message
    );
  };

  const handlePrepareCoreContent = () => {
    if (coreContentSummary.total === 0) {
      Alert.alert(
        'Nenhum dado básico encontrado',
        'O compêndio não possui classes, espécies ou backgrounds disponíveis.'
      );
      return;
    }

    if (
      coreContentSummary.pending === 0 &&
      coreContentSummary.enabledSourceCount ===
        coreContentSummary.sourceCount
    ) {
      Alert.alert(
        'Dados de criação já preparados',
        'As classes, espécies e backgrounds já estão validados e suas fontes estão ativas.'
      );
      return;
    }

    Alert.alert(
      'Preparar dados de criação?',
      [
        `Serão liberados ${coreContentSummary.total} item(ns): classes, subclasses, espécies, backgrounds, feats, magias e features vinculadas.`,
        '',
        'Esta operação aprova esses itens em lote, sem revisão individual.',
        'Os demais tipos continuarão aguardando revisão.'
      ].join('\n'),
      [
        {
          text: 'Cancelar',
          style: 'cancel'
        },
        {
          text: 'Preparar',
          onPress: () => {
            void executePrepareCoreContent();
          }
        }
      ]
    );
  };

  return (
    <VirtualizedScreen
      eyebrow="Biblioteca local"
      title="Compêndio / importação"
      subtitle="Importe, revise e organize o conteúdo usado nas fichas. Somente itens validados entram no fluxo principal."
      onBack={() => router.replace('/')}
      fixedFooter={(
        <BottomNavigation
          activeKey="compendium"
          items={[
            { key: 'characters', label: 'Personagens', icon: 'people', onPress: () => router.replace('/') },
            { key: 'compendium', label: 'Compêndio', icon: 'library', onPress: () => undefined },
            { key: 'settings', label: 'Ajustes', icon: 'settings', onPress: () => router.push('/settings') }
          ]}
        />
      )}
      data={filteredItems}
      keyExtractor={(item) => item.id}
      initialNumToRender={12}
      maxToRenderPerBatch={14}
      headerContent={(
        <>
          <Card title="Estado da persistência" subtitle={`${sources.length} fontes · ${packs.length} pacotes · ${items.length} itens`}>
            <Text style={styles.muted}>{isHydrating ? 'Carregando compêndio do SQLite...' : isHydrated ? 'Compêndio hidratado.' : 'Compêndio ainda não hidratado.'}</Text>
            <Text style={styles.muted}>{storageStatus}</Text>
            {lastStorageError ? <Text style={styles.error}>{lastStorageError}</Text> : null}
            <Button label="Recarregar do SQLite" secondary onPress={handleHydrate} disabled={busy} />
          </Card>

          <Card title="Catálogo consolidado de regras" subtitle="Ative ou desative PHB, DMG, MM, categorias e entidades com análise de impacto.">
            <Text style={styles.muted}>O gerenciamento é separado das importações locais e preserva personagens e combates já salvos.</Text>
            <Button label="Gerenciar livros e regras" secondary onPress={() => router.push('/content-management')} disabled={busy} />
          </Card>

          <Card title="Dados para criação e progressão" subtitle="Libere classes, subclasses, espécies, backgrounds, feats, magias e features vinculadas.">
            <Text style={styles.muted}>{coreContentSummary.total} item(ns) encontrado(s) · {coreContentSummary.validated} validado(s) · {coreContentSummary.pending} pendente(s)</Text>
            <Text style={styles.muted}>{coreContentSummary.enabledSourceCount} de {coreContentSummary.sourceCount} fonte(s) ativa(s).</Text>
            <Button
              label={coreContentSummary.pending > 0 ? 'Preparar dados para criação e progressão' : 'Ativar fontes dos dados de criação'}
              secondary
              onPress={handlePrepareCoreContent}
              disabled={busy || coreContentSummary.total === 0}
            />
          </Card>

          <Card title="Assistente de importação semi-estruturada" subtitle="Cole texto ou Markdown de fonte própria para gerar um JSON de rascunho, sempre com revisão obrigatória.">
            <Text style={styles.muted}>Use este fluxo para transformar anotações, Markdown ou texto extraído de material que você possui em candidatos de compêndio auditáveis.</Text>
            <Button label="Abrir assistente" onPress={() => router.push('/compendium/assistant')} disabled={busy} />
          </Card>

          <Card title="Importar arquivo local" subtitle="Selecione JSON, Markdown, TXT ou CSV do dispositivo e salve no SQLite depois do preview.">
            <Text style={styles.muted}>Use para arquivos gerados pelo template padrão ou exportações de outra IA. Markdown/TXT passa pelo assistente semi-estruturado e entra como needsReview.</Text>
            <Button label="Selecionar arquivo local" onPress={() => router.push('/compendium/file-import')} disabled={busy} />
          </Card>

          <Card title="Modelo padrão de importação" subtitle="Gere JSON, Markdown e prompt para outra IA extrair livros/fonte própria já no padrão do app.">
            <Text style={styles.muted}>Use antes de processar seus livros por IA. O modelo já orienta a saída para entrar como needsReview e preservar fonte, página e versão.</Text>
            <Button label="Abrir modelos de importação" onPress={() => router.push('/compendium/templates')} disabled={busy} />
          </Card>

          <Card title="Exportar pacote do compêndio" subtitle="Gere JSON dnd-combat-import.v2 canônico a partir de fontes, pacotes, tipos e status selecionados.">
            <Text style={styles.muted}>Use para backup, revisão externa e compartilhamento privado entre seus dispositivos.</Text>
            <Button label="Abrir exportação de pacote" onPress={() => router.push('/compendium/export')} disabled={busy} />
          </Card>

          <Card title="Revisão e prontidão" subtitle="Revise conteúdo pendente e verifique compatibilidade com a engine.">
            <Button label="Abrir fila de revisão" onPress={() => router.push('/compendium/review-queue')} disabled={busy} />
            <Button label="Abrir prontidão pré-engine" secondary onPress={() => router.push('/compendium/readiness')} disabled={busy} />
          </Card>

          <Card title="Importar JSON" subtitle="Itens manuais ou ambíguos entram como needsReview até validação.">
            <Field label="JSON" value={json} onChangeText={setJson} multiline style={{ minHeight: 220, textAlignVertical: 'top' }} />
            <Button label="Salvar importação no SQLite" onPress={handleSave} disabled={!preview.ok || busy} />
          </Card>

          <Card title={preview.ok ? 'Preview válido' : 'Preview inválido'} subtitle={preview.data ? `${preview.data.items.length} itens encontrados` : undefined}>
            <IssueList issues={preview.issues} />
            {preview.ok && !preview.issues.length ? <Text>Sem erros. O pacote pode ser persistido.</Text> : null}
          </Card>

          {lastIssues.length ? <Card title="Última operação: avisos"><IssueList issues={lastIssues} /></Card> : null}

          <Card title="Fontes locais" subtitle="Ativar/desativar fonte atualiza somente a linha correspondente no SQLite.">
            {sources.length === 0 ? <Text style={styles.muted}>Nenhum conteúdo importado salvo ainda.</Text> : null}
            {sources.map((source) => {
              const enabled = enabledSourceIds.includes(source.id);
              return (
                <View key={source.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.bold}>{source.book ?? source.id}</Text>
                    <Text style={styles.muted}>{source.id} · {source.confidence} · {enabled ? 'ativa' : 'inativa'}</Text>
                  </View>
                  <Button label={enabled ? 'Desativar' : 'Ativar'} secondary disabled={busy} onPress={() => handleToggleSource(source.id, !enabled)} />
                </View>
              );
            })}
          </Card>

          <Card title="Pacotes importados">
            {packs.length === 0 ? <Text style={styles.muted}>Nenhum pacote persistido.</Text> : null}
            {packs.map((pack) => (
              <View key={pack.id} style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.bold}>{pack.name}</Text>
                  <Text style={styles.muted}>{pack.itemCount} itens · checksum {pack.checksum}</Text>
                </View>
                {isRequiredCharacterCreationBundledPack(pack.id) ? (
                  <Button label="Conteúdo básico" secondary disabled onPress={() => undefined} />
                ) : (
                  <Button label="Remover" secondary disabled={busy} onPress={() => handleRemovePack(pack.id)} />
                )}
              </View>
            ))}
          </Card>

          <Card title="Busca avançada do compêndio local" subtitle="A lista abaixo é virtualizada e não possui limite visual fixo.">
            <Field label="Buscar" value={search} onChangeText={setSearch} placeholder="Ex.: spell, weapon, smite, longsword, nota..." />
            <Field label="Tipos" value={typeFilter} onChangeText={setTypeFilter} placeholder="weapon, spell, feat" autoCapitalize="none" />
            <Field label="Status" value={statusFilter} onChangeText={setStatusFilter} placeholder="validated, needsReview, draft, disabled" autoCapitalize="none" />
            <Field label="Fontes" value={sourceFilter} onChangeText={setSourceFilter} placeholder="manual-source, outro-source-id" autoCapitalize="none" />
            <Button label={showOnlyEnabled ? 'Exibindo só fontes ativas' : 'Exibindo fontes ativas e inativas'} secondary onPress={() => setShowOnlyEnabled((value) => !value)} />
          </Card>

          <Card title="Itens encontrados" subtitle={`${filteredItems.length} item(ns) no resultado virtualizado.`} />
        </>
      )}
      renderItem={({ item }) => {
        const enabled = enabledSourceIds.includes(item.sourceId);
        return (
          <View style={styles.itemBox} accessibilityLabel={`${item.name}, ${item.type}, status ${item.status}`}>
            <View style={styles.rowNoBorder}>
              <View style={styles.flex}>
                <Text style={styles.bold}>{item.name}</Text>
                <Text style={styles.muted}>{item.type} · {item.status} · {item.reviewDecision ?? 'pending'} · fonte {enabled ? 'ativa' : 'inativa'}</Text>
              </View>
              <View style={styles.actions}>
                {item.status === 'needsReview' ? <Button label="Validar" secondary disabled={busy} onPress={() => handleValidateItem(item.id)} /> : null}
                <Button label="Mapear" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]/mapping', params: { itemId: item.id } })} />
                <Button label="Detalhes" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]', params: { itemId: item.id } })} />
              </View>
            </View>
            {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
            {item.reviewNotes ? <Text style={styles.note}>Nota: {item.reviewNotes}</Text> : null}
          </View>
        );
      }}
      emptyContent={<Card variant="filled" title="Nenhum item encontrado" subtitle="Ajuste os filtros ou importe conteúdo." />}
      footerContent={(
        <>
          <Card title="Snapshot técnico" subtitle="Backup/restauração do compêndio. A restauração substitui o snapshot no SQLite.">
            <Button label="Exportar snapshot da UI" secondary onPress={handleExportSnapshot} disabled={busy} />
            <Button label="Exportar snapshot direto do SQLite" secondary onPress={handleExportRepositorySnapshot} disabled={busy} />
            <Field label="Snapshot JSON" value={snapshotJson} onChangeText={setSnapshotJson} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} />
            <Button label="Restaurar snapshot no SQLite" secondary onPress={handleRestoreSnapshot} disabled={busy || !snapshotJson.trim()} />
          </Card>
          {items.length ? <Button label="Limpar compêndio SQLite" secondary onPress={handleClear} disabled={busy} /> : null}
          <Button label="Voltar" secondary onPress={() => router.back()} />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 },
  rowNoBorder: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, gap: 2 },
  actions: { gap: 6 },
  bold: { fontWeight: '800', color: '#111827' },
  error: { color: '#b91c1c', lineHeight: 19, fontWeight: '700' },
  muted: { color: '#64748b', lineHeight: 19 },
  summary: { color: '#334155', lineHeight: 20 },
  note: { color: '#475569', lineHeight: 19, fontStyle: 'italic' },
  itemBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 6 }
});
