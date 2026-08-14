import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { VirtualizedScreen } from '../../src/components/VirtualizedScreen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Field';
import { StatRow } from '../../src/components/StatRow';
import { IssueList } from '../../src/components/IssueList';
import { useCompendiumStore } from '../../src/store/compendiumStore';
import { buildReviewQueue, createReviewApprovalNotes, reviewQueueToIssues, type ReviewQueueGroupBy } from '../../src/compendium/reviewQueue';
import type { CompendiumItemType, StoredCompendiumItemStatus } from '../../src/compendium/types';

const parseCsv = (value: string): string[] => value.split(',').map((entry) => entry.trim()).filter(Boolean);
const parseStatuses = (value: string): StoredCompendiumItemStatus[] | undefined => {
  const entries = parseCsv(value) as StoredCompendiumItemStatus[];
  return entries.length ? entries : undefined;
};
const parseTypes = (value: string): CompendiumItemType[] | undefined => {
  const entries = parseCsv(value) as CompendiumItemType[];
  return entries.length ? entries : undefined;
};

const checklistIcon = (severity: string) => {
  if (severity === 'pass') return '✓';
  if (severity === 'warning') return '⚠';
  return '✕';
};

export default function CompendiumReviewQueueScreen() {
  const sources = useCompendiumStore((state) => state.sources);
  const packs = useCompendiumStore((state) => state.packs);
  const items = useCompendiumStore((state) => state.items);
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const isSaving = useCompendiumStore((state) => state.isSaving);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const updateItemReview = useCompendiumStore((state) => state.updateItemReview);
  const updateItemsReview = useCompendiumStore((state) => state.updateItemsReview);

  const [query, setQuery] = useState('');
  const [types, setTypes] = useState('');
  const [statuses, setStatuses] = useState('needsReview,draft');
  const [sourceIds, setSourceIds] = useState('');
  const [packIds, setPackIds] = useState('');
  const [onlyEnabledSources, setOnlyEnabledSources] = useState(false);
  const [groupBy, setGroupBy] = useState<ReviewQueueGroupBy>('pack');
  const [reviewedBy, setReviewedBy] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [expandedItemId, setExpandedItemId] = useState<string | undefined>();
  const [lastIssuesItemId, setLastIssuesItemId] = useState<string | undefined>();

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  const queue = useMemo(
    () =>
      buildReviewQueue({
        items,
        sources,
        packs,
        filters: {
          query,
          groupBy,
          types: parseTypes(types),
          statuses: parseStatuses(statuses),
          sourceIds: parseCsv(sourceIds),
          packIds: parseCsv(packIds),
          onlyEnabledSources,
          enabledSourceIds
        }
      }),
    [enabledSourceIds, groupBy, items, onlyEnabledSources, packIds, packs, query, sourceIds, sources, statuses, types]
  );

  const busy = isHydrating || isSaving;
  const lastIssuesRow = queue.items.find((row) => row.item.id === lastIssuesItemId);
  const queueRows = queue.groups.flatMap((group) => [
    { kind: 'group' as const, id: `group:${group.id}`, group },
    ...group.items.map((row) => ({ kind: 'item' as const, id: `item:${row.item.id}`, row }))
  ]);

  const approveItem = async (itemId: string) => {
    const row = queue.items.find((entry) => entry.item.id === itemId);
    if (!row) return;
    setLastIssuesItemId(itemId);

    if (!row.canApprove) {
      Alert.alert('Item bloqueado', 'Este item ainda possui erro(s) bloqueante(s). Abra o mapeamento visual ou os detalhes antes de aprovar.');
      return;
    }

    const result = await updateItemReview(itemId, {
      status: 'validated',
      reviewDecision: 'approved',
      reviewNotes: createReviewApprovalNotes(row, approvalNotes),
      reviewedBy: reviewedBy.trim() || undefined
    });

    if (!result.ok) {
      Alert.alert('Aprovação não salva', result.issues.map((issue) => issue.message).join('\n'));
      return;
    }
  };

  const approveAllVisible = async () => {
    const approvable = queue.items.filter((row) => row.canApprove);
    if (!approvable.length) {
      Alert.alert('Nada para aprovar', 'Nenhum item exibido está livre de bloqueios.');
      return;
    }

    const result = await updateItemsReview(approvable.map((row) => ({
      itemId: row.item.id,
      update: {
        status: 'validated' as const,
        reviewDecision: 'approved' as const,
        reviewNotes: createReviewApprovalNotes(row, approvalNotes),
        reviewedBy: reviewedBy.trim() || undefined
      }
    })));
    if (!result.ok) {
      Alert.alert('Aprovação em lote não salva', result.issues.map((issue) => issue.message).join('\n'));
      return;
    }
    Alert.alert('Fila atualizada', `${approvable.length} item(ns) aprovados em uma única transação SQLite.`);
  };

  const rejectAllVisible = () => {
    const rejectable = queue.items.filter((row) => row.item.status !== 'disabled');
    if (!rejectable.length) {
      Alert.alert('Nada para desativar', 'Nenhum item exibido pode ser desativado.');
      return;
    }
    Alert.alert(
      'Desativar itens visíveis?',
      `${rejectable.length} item(ns) serão rejeitados em uma única transação.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desativar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await updateItemsReview(rejectable.map((row) => ({
                itemId: row.item.id,
                update: {
                  status: 'disabled' as const,
                  reviewDecision: 'rejected' as const,
                  reviewNotes: approvalNotes.trim() || 'Rejeitado/desativado em lote via fila guiada de revisão.',
                  reviewedBy: reviewedBy.trim() || undefined
                }
              })));
              if (!result.ok) Alert.alert('Rejeição em lote não salva', result.issues.map((issue) => issue.message).join('\n'));
              else Alert.alert('Fila atualizada', `${rejectable.length} item(ns) desativados em uma única transação SQLite.`);
            })();
          }
        }
      ]
    );
  };

  const disableItem = async (itemId: string) => {
    const result = await updateItemReview(itemId, {
      status: 'disabled',
      reviewDecision: 'rejected',
      reviewNotes: approvalNotes.trim() || 'Rejeitado/desativado via fila guiada de revisão.',
      reviewedBy: reviewedBy.trim() || undefined
    });
    if (!result.ok) Alert.alert('Item não desativado', result.issues.map((issue) => issue.message).join('\n'));
  };

  const setNeedsReview = async (itemId: string) => {
    const result = await updateItemReview(itemId, {
      status: 'needsReview',
      reviewDecision: 'pending',
      reviewNotes: approvalNotes.trim() || 'Reaberto para revisão guiada.',
      reviewedBy: reviewedBy.trim() || undefined
    });
    if (!result.ok) Alert.alert('Item não reaberto', result.issues.map((issue) => issue.message).join('\n'));
  };

  const cycleGroupBy = () => {
    setGroupBy((current) => {
      if (current === 'pack') return 'source';
      if (current === 'source') return 'type';
      if (current === 'type') return 'status';
      return 'pack';
    });
  };

  return (
    <VirtualizedScreen
      title="Fila de revisão guiada"
      subtitle="Revise itens importados por pacote/fonte/tipo, corrija mapeamentos incompletos e aprove somente regras sem bloqueios."
      onBack={() => router.back()}
      data={queueRows}
      keyExtractor={(entry) => entry.id}
      initialNumToRender={12}
      headerContent={(
        <>
          <Card title="Resumo da fila" subtitle={`${queue.summary.totalItems} item(ns) no filtro atual · ${queue.groups.length} grupo(s)`}>
            <StatRow label="Aprováveis no filtro" value={queue.summary.approvableItems} />
            <StatRow label="Com bloqueios" value={queue.summary.blockingItems} />
            <StatRow label="Com avisos" value={queue.summary.warningItems} />
            <StatRow label="needsReview total" value={queue.summary.needsReviewItems} />
            <StatRow label="draft total" value={queue.summary.draftItems} />
            <StatRow label="validated total" value={queue.summary.validatedItems} />
            <StatRow label="disabled total" value={queue.summary.disabledItems} />
            <Text style={styles.muted}>{isHydrating ? 'Carregando compêndio...' : isHydrated ? 'Compêndio hidratado.' : 'Compêndio ainda não hidratado.'}</Text>
            <View style={styles.buttonRow}>
              <View style={styles.buttonBox}><Button label="Aprovar visíveis sem bloqueio" disabled={busy || queue.summary.approvableItems === 0} onPress={approveAllVisible} /></View>
              <View style={styles.buttonBox}><Button label="Desativar todos os visíveis" secondary disabled={busy || queue.items.length === 0} onPress={rejectAllVisible} /></View>
            </View>
          </Card>

          <Card title="Filtros" subtitle="Por padrão a fila mostra needsReview e draft. Campos aceitam valores separados por vírgula.">
            <Field label="Buscar" value={query} onChangeText={setQuery} placeholder="nome, fonte, nota, campo normalizado..." />
            <Field label="Tipos" value={types} onChangeText={setTypes} placeholder="spell, weapon, feature" autoCapitalize="none" />
            <Field label="Status" value={statuses} onChangeText={setStatuses} placeholder="needsReview,draft,validated,disabled" autoCapitalize="none" />
            <Field label="Source IDs" value={sourceIds} onChangeText={setSourceIds} placeholder="source-1,source-2" autoCapitalize="none" />
            <Field label="Pack IDs" value={packIds} onChangeText={setPackIds} placeholder="pack-1,pack-2" autoCapitalize="none" />
            <View style={styles.buttonRow}>
              <View style={styles.buttonBox}><Button label={`Agrupar: ${groupBy}`} secondary onPress={cycleGroupBy} /></View>
              <View style={styles.buttonBox}><Button label={onlyEnabledSources ? 'Só fontes ativas' : 'Todas as fontes'} secondary onPress={() => setOnlyEnabledSources((value) => !value)} /></View>
            </View>
          </Card>

          <Card title="Assinatura da revisão" subtitle="Esses dados serão gravados nas notas dos itens aprovados/rejeitados por esta fila.">
            <Field label="Revisor" value={reviewedBy} onChangeText={setReviewedBy} placeholder="Nathan, mesa 01, revisão manual..." />
            <Field label="Notas adicionais" value={approvalNotes} onChangeText={setApprovalNotes} multiline style={{ minHeight: 74, textAlignVertical: 'top' }} />
          </Card>

          {lastIssuesRow ? (
            <Card title={`Checklist como issues: ${lastIssuesRow.item.name}`} subtitle="Útil para entender por que a aprovação foi bloqueada.">
              <IssueList issues={reviewQueueToIssues(lastIssuesRow)} />
            </Card>
          ) : null}

          <Card title="Resultados da fila" subtitle={`${queue.summary.totalItems} item(ns) renderizados por FlatList, sem limite de 30 por grupo.`} />
        </>
      )}
      renderItem={({ item: entry }) => {
        if (entry.kind === 'group') {
          const group = entry.group;
          return <Card variant="filled" title={group.title} subtitle={`${group.subtitle} · ${group.items.length} item(ns) · ${group.approvableCount} aprovável(is) · ${group.blockingCount} bloqueio(s)`} />;
        }

        const row = entry.row;
        const expanded = expandedItemId === row.item.id;
        return (
          <View style={styles.itemBox}>
            <View style={styles.itemHeader}>
              <View style={styles.flex}>
                <Text style={styles.bold}>{row.item.name}</Text>
                <Text style={styles.muted}>{row.item.type} · {row.item.status} · {row.completionPercent}% OK · {row.blockingCount} bloqueio(s) · {row.warningCount} aviso(s)</Text>
              </View>
              <Text style={[styles.badge, row.canApprove ? styles.goodBadge : styles.badBadge]}>{row.canApprove ? 'aprovável' : 'bloqueado'}</Text>
            </View>

            {row.item.summary ? <Text style={styles.summary}>{row.item.summary}</Text> : null}
            {row.item.reviewNotes ? <Text style={styles.note}>Nota atual: {row.item.reviewNotes}</Text> : null}

            <View style={styles.buttonRow}>
              <View style={styles.buttonBox}><Button label={expanded ? 'Ocultar checklist' : 'Ver checklist'} secondary onPress={() => setExpandedItemId(expanded ? undefined : row.item.id)} /></View>
              <View style={styles.buttonBox}><Button label="Mapear" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]/mapping', params: { itemId: row.item.id } })} /></View>
              <View style={styles.buttonBox}><Button label="Detalhes" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]', params: { itemId: row.item.id } })} /></View>
            </View>

            {expanded ? (
              <View style={styles.checklist}>
                {row.checklist.map((check) => (
                  <View key={check.id} style={styles.checkRow}>
                    <Text style={[styles.checkIcon, check.severity === 'error' ? styles.error : check.severity === 'warning' ? styles.warning : styles.success]}>{checklistIcon(check.severity)}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.checkLabel}>{check.label}</Text>
                      <Text style={styles.muted}>{check.message}</Text>
                      {check.details ? <Text style={styles.note}>{check.details}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.buttonRow}>
              <View style={styles.buttonBox}><Button label="Aprovar" disabled={busy || !row.canApprove} onPress={() => approveItem(row.item.id)} /></View>
              <View style={styles.buttonBox}><Button label="Desativar" secondary disabled={busy} onPress={() => disableItem(row.item.id)} /></View>
              {row.item.status !== 'needsReview' ? <View style={styles.buttonBox}><Button label="Reabrir" secondary disabled={busy} onPress={() => setNeedsReview(row.item.id)} /></View> : null}
            </View>
          </View>
        );
      }}
      emptyContent={<Card title="Nenhum item na fila" subtitle="Ajuste os filtros ou importe conteúdo com status needsReview/draft." />}
      footerContent={<Button label="Voltar" secondary onPress={() => router.back()} />}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  muted: { color: '#64748b', lineHeight: 19 },
  bold: { fontWeight: '800', color: '#111827' },
  summary: { color: '#334155', lineHeight: 20 },
  note: { color: '#475569', lineHeight: 19, fontStyle: 'italic' },
  itemBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 8 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { fontSize: 12, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  goodBadge: { backgroundColor: '#dcfce7', color: '#166534' },
  badBadge: { backgroundColor: '#fee2e2', color: '#991b1b' },
  buttonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  buttonBox: { flex: 1, minWidth: 132 },
  checklist: { gap: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 },
  checkRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  checkIcon: { width: 22, fontSize: 16, fontWeight: '900' },
  checkLabel: { color: '#111827', fontWeight: '700' },
  success: { color: '#15803d' },
  warning: { color: '#b45309' },
  error: { color: '#b91c1c' }
});
