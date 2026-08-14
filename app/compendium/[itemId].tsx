import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Field';
import { useCompendiumStore } from '../../src/store/compendiumStore';
import type { StoredCompendiumItemStatus, StoredCompendiumReviewDecision } from '../../src/compendium/types';
import { buildReviewChecklistForItem } from '../../src/compendium/reviewQueue';

const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const flattenJson = (value: unknown, prefix = '', depth = 0): Record<string, string> => {
  if (depth > 4) return { [prefix || '(root)']: JSON.stringify(value) };
  if (!isRecord(value) && !Array.isArray(value)) return { [prefix || '(root)']: JSON.stringify(value) };

  const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : Object.entries(value);
  return entries.reduce<Record<string, string>>((acc, [key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    Object.assign(acc, flattenJson(child, nextPrefix, depth + 1));
    return acc;
  }, {});
};

const diffJson = (left: unknown, right: unknown): Array<{ path: string; raw?: string; normalized?: string }> => {
  const raw = flattenJson(left);
  const normalized = flattenJson(right);
  const paths = Array.from(new Set([...Object.keys(raw), ...Object.keys(normalized)])).sort();
  return paths
    .filter((path) => raw[path] !== normalized[path])
    .slice(0, 80)
    .map((path) => ({ path, raw: raw[path], normalized: normalized[path] }));
};

const decisionForStatus = (status: StoredCompendiumItemStatus): StoredCompendiumReviewDecision => {
  if (status === 'validated') return 'approved';
  if (status === 'disabled') return 'rejected';
  return 'pending';
};

export default function CompendiumItemDetailScreen() {
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const items = useCompendiumStore((state) => state.items);
  const sources = useCompendiumStore((state) => state.sources);
  const packs = useCompendiumStore((state) => state.packs);
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const isSaving = useCompendiumStore((state) => state.isSaving);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const updateItemReview = useCompendiumStore((state) => state.updateItemReview);

  const item = items.find((entry) => entry.id === itemId);
  const source = sources.find((entry) => entry.id === item?.sourceId);
  const pack = packs.find((entry) => entry.id === item?.packId);
  const sourceEnabled = item ? enabledSourceIds.includes(item.sourceId) : false;

  const [notes, setNotes] = useState('');
  const [reviewedBy, setReviewedBy] = useState('');

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  useEffect(() => {
    if (item) {
      setNotes(item.reviewNotes ?? '');
      setReviewedBy(item.reviewedBy ?? '');
    }
  }, [item?.id]);

  const rawJson = useMemo(() => prettyJson(item?.rawJson ?? {}), [item]);
  const normalizedJson = useMemo(() => prettyJson(item?.normalizedJson ?? {}), [item]);
  const diffRows = useMemo(() => diffJson(item?.rawJson ?? {}, item?.normalizedJson ?? {}), [item]);
  const checklist = useMemo(() => (item ? buildReviewChecklistForItem(item, source) : []), [item, source]);

  const handleSaveReview = async (status?: StoredCompendiumItemStatus) => {
    if (!item) return;
    const nextStatus = status ?? item.status;
    const result = await updateItemReview(item.id, {
      status: nextStatus,
      reviewDecision: decisionForStatus(nextStatus),
      reviewNotes: notes.trim() || undefined,
      reviewedBy: reviewedBy.trim() || undefined
    });

    if (!result.ok) {
      Alert.alert('Revisão não salva', result.issues.map((issue) => issue.message).join('\n'));
      return;
    }
    Alert.alert('Revisão salva', 'As notas e o status do item foram persistidos no SQLite.');
  };

  if (!item) {
    return (
      <Screen title="Item não encontrado" subtitle="O item pode ter sido removido ou o compêndio ainda não foi hidratado.">
        <Card>
          <Text style={styles.muted}>{isHydrating ? 'Carregando compêndio...' : `Nenhum item encontrado para: ${itemId ?? '(sem id)'}`}</Text>
        </Card>
        <Button label="Voltar" secondary onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen title={item.name} subtitle="Revisão da regra importada, metadados de origem e comparação entre JSON bruto e normalizado.">
      <Card title="Resumo do item" subtitle={`${item.type} · ${item.status} · ${item.reviewDecision ?? 'pending'}`}>
        {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : <Text style={styles.muted}>Sem resumo informado.</Text>}
        <Text style={styles.muted}>Fonte: {source?.book ?? item.sourceId} · {sourceEnabled ? 'ativa' : 'inativa'}</Text>
        <Text style={styles.muted}>Pacote: {pack?.name ?? item.packId}</Text>
        <Text style={styles.muted}>Import ID: {item.importItemId}</Text>
        <Text style={styles.muted}>Criado: {item.createdAt}</Text>
        <Text style={styles.muted}>Atualizado: {item.updatedAt}</Text>
        {item.reviewedAt ? <Text style={styles.muted}>Revisado: {item.reviewedAt}</Text> : null}
      </Card>

      <Card title="Checklist de revisão guiada" subtitle="Aprovação pela fila só é liberada quando não há erros bloqueantes. Avisos podem ser mantidos com nota de revisão.">
        {checklist.map((entry) => (
          <View key={entry.id} style={styles.checkRow}>
            <Text style={[styles.checkIcon, entry.severity === 'error' ? styles.error : entry.severity === 'warning' ? styles.warning : styles.success]}>
              {entry.severity === 'pass' ? '✓' : entry.severity === 'warning' ? '⚠' : '✕'}
            </Text>
            <View style={styles.flex}>
              <Text style={styles.checkLabel}>{entry.label}</Text>
              <Text style={styles.muted}>{entry.message}</Text>
            </View>
          </View>
        ))}
        <Button label="Abrir fila de revisão" secondary onPress={() => router.push('/compendium/review-queue')} />
      </Card>

      <Card title="Metadados de fonte" subtitle="Use estes dados para auditar se o conteúdo foi importado legalmente e com origem suficiente.">
        <View style={styles.metaGrid}>
          <Text style={styles.metaLabel}>ID</Text>
          <Text style={styles.metaValue}>{source?.id ?? item.sourceId}</Text>
          <Text style={styles.metaLabel}>Livro</Text>
          <Text style={styles.metaValue}>{source?.book ?? 'não informado'}</Text>
          <Text style={styles.metaLabel}>Página</Text>
          <Text style={styles.metaValue}>{source?.page ?? 'não informada'}</Text>
          <Text style={styles.metaLabel}>Versão</Text>
          <Text style={styles.metaValue}>{source?.version ?? 'não informada'}</Text>
          <Text style={styles.metaLabel}>Confiança</Text>
          <Text style={styles.metaValue}>{source?.confidence ?? item.rawJson.source.confidence}</Text>
          <Text style={styles.metaLabel}>Status</Text>
          <Text style={styles.metaValue}>{source?.status ?? item.rawJson.source.status}</Text>
        </View>
        {source?.notes ? <Text style={styles.note}>Notas da fonte: {source.notes}</Text> : null}
      </Card>

      <Card title="Revisão manual" subtitle="Valide somente quando a regra estiver completa e auditada. Itens needsReview não devem alimentar a engine automaticamente.">
        <Field label="Revisor" value={reviewedBy} onChangeText={setReviewedBy} placeholder="Nome opcional" />
        <Field label="Notas de revisão" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 120, textAlignVertical: 'top' }} />
        <Button label="Salvar notas" secondary disabled={isSaving} onPress={() => handleSaveReview()} />
        <Button label="Editar mapeamento visual" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]/mapping', params: { itemId: item.id } })} />
        <Button label="Marcar como validado" disabled={isSaving} onPress={() => handleSaveReview('validated')} />
        <Button label="Marcar como precisa de revisão" secondary disabled={isSaving} onPress={() => handleSaveReview('needsReview')} />
        <Button label="Desabilitar item" secondary disabled={isSaving} onPress={() => handleSaveReview('disabled')} />
      </Card>

      <Card title="Tags de busca">
        {item.tags.length ? <Text style={styles.summary}>{item.tags.join(', ')}</Text> : <Text style={styles.muted}>Sem tags geradas.</Text>}
      </Card>

      <Card title="Diferenças rawJson × normalizedJson" subtitle="Mostra campos que foram adicionados, removidos ou alterados durante a normalização.">
        {diffRows.length === 0 ? <Text style={styles.muted}>Sem diferenças detectadas.</Text> : null}
        {diffRows.map((row) => (
          <View key={row.path} style={styles.diffRow}>
            <Text style={styles.metaLabel}>{row.path}</Text>
            <Text style={styles.diffText}>raw: {row.raw ?? '∅'}</Text>
            <Text style={styles.diffText}>normalized: {row.normalized ?? '∅'}</Text>
          </View>
        ))}
      </Card>

      <Card title="JSON normalizado" subtitle="Estrutura usada pelos mapeadores e pela engine após validação.">
        <Field label="normalizedJson" value={normalizedJson} editable={false} multiline style={styles.jsonBox} />
      </Card>

      <Card title="JSON bruto" subtitle="Conteúdo original preservado para auditoria, reprocessamento e futura migração de schema.">
        <Field label="rawJson" value={rawJson} editable={false} multiline style={styles.jsonBox} />
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { color: '#334155', lineHeight: 20 },
  muted: { color: '#64748b', lineHeight: 19 },
  note: { color: '#475569', lineHeight: 19, fontStyle: 'italic' },
  metaGrid: { gap: 4 },
  metaLabel: { fontSize: 12, color: '#64748b', fontWeight: '700', marginTop: 6 },
  metaValue: { color: '#111827', lineHeight: 20 },
  diffRow: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 8, gap: 3 },
  diffText: { color: '#334155', fontSize: 12, lineHeight: 17 },
  jsonBox: { minHeight: 220, textAlignVertical: 'top', fontSize: 12, lineHeight: 17 },
  flex: { flex: 1, gap: 2 },
  checkRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  checkIcon: { width: 22, fontSize: 16, fontWeight: '900' },
  checkLabel: { color: '#111827', fontWeight: '700' },
  success: { color: '#15803d' },
  warning: { color: '#b45309' },
  error: { color: '#b91c1c' }
});
