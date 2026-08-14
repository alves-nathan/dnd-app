import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Field } from '../../../src/components/Field';
import { Button } from '../../../src/components/Button';
import { IssueList } from '../../../src/components/IssueList';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { buildNormalizedJsonFromMappingDraft, createMappingDraftFromItem, getMappingDefinitionForItem, MappingDraft } from '../../../src/compendium/mappingEditor';
import type { StoredCompendiumItemStatus, StoredCompendiumReviewDecision } from '../../../src/compendium/types';

const decisionForStatus = (status: StoredCompendiumItemStatus): StoredCompendiumReviewDecision => {
  if (status === 'validated') return 'approved';
  if (status === 'disabled') return 'rejected';
  return 'pending';
};

const summarizeValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export default function CompendiumMappingEditorScreen() {
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const items = useCompendiumStore((state) => state.items);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const isSaving = useCompendiumStore((state) => state.isSaving);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const updateItemMapping = useCompendiumStore((state) => state.updateItemMapping);

  const item = items.find((entry) => entry.id === itemId);
  const definition = item ? getMappingDefinitionForItem(item) : undefined;
  const [draft, setDraft] = useState<MappingDraft>({ values: {} });
  const [reviewedBy, setReviewedBy] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  useEffect(() => {
    if (item) {
      setDraft(createMappingDraftFromItem(item));
      setReviewedBy(item.reviewedBy ?? '');
      setReviewNotes(item.reviewNotes ?? '');
    }
  }, [item?.id]);

  const preview = useMemo(() => (item ? buildNormalizedJsonFromMappingDraft(item, draft) : undefined), [draft, item]);

  const setField = (key: string, value: string) => {
    setDraft((current) => ({ values: { ...current.values, [key]: value } }));
  };

  const handleSave = async (status?: StoredCompendiumItemStatus) => {
    if (!item || !preview) return;
    const hasErrors = preview.issues.some((issue) => issue.severity === 'error');
    if (hasErrors) {
      Alert.alert('Mapeamento incompleto', 'Corrija os erros antes de salvar o mapeamento.');
      return;
    }

    const nextStatus = status ?? 'needsReview';
    const result = await updateItemMapping(item.id, {
      normalizedJson: preview.normalizedJson,
      status: nextStatus,
      reviewDecision: decisionForStatus(nextStatus),
      reviewNotes: reviewNotes.trim() || undefined,
      reviewedBy: reviewedBy.trim() || undefined
    });

    if (!result.ok) {
      Alert.alert('Mapeamento não salvo', result.issues.map((issue) => issue.message).join('\n'));
      return;
    }

    Alert.alert('Mapeamento salvo', nextStatus === 'validated' ? 'O item foi mapeado, validado e salvo no SQLite.' : 'O item foi salvo como precisa de revisão.');
  };

  if (!item || !definition) {
    return (
      <Screen title="Mapeamento não encontrado" subtitle="O item pode ter sido removido ou o compêndio ainda está carregando.">
        <Card>
          <Text style={styles.muted}>{isHydrating ? 'Carregando compêndio...' : `Nenhum item encontrado para ${itemId ?? '(sem id)'}.`}</Text>
        </Card>
        <Button label="Voltar" secondary onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen title={definition.title} subtitle={definition.description}>
      <Card title={item.name} subtitle={`${item.type} · ${item.status} · fonte ${item.sourceId}`}>
        {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : <Text style={styles.muted}>Sem resumo importado.</Text>}
        <Text style={styles.muted}>Este editor altera apenas o `normalizedJson`. O `rawJson` original continua preservado para auditoria.</Text>
      </Card>

      <Card title="Campos normalizados" subtitle="Campos em branco são removidos do mapeamento normalizado.">
        {definition.fields.map((field) => (
          <View key={field.key} style={styles.fieldBox}>
            <Field
              label={`${field.label}${field.required ? ' *' : ''}`}
              value={draft.values[field.key] ?? ''}
              onChangeText={(value) => setField(field.key, value)}
              placeholder={field.placeholder}
              multiline={field.kind === 'textarea'}
              autoCapitalize="none"
              keyboardType={field.kind === 'number' ? 'numeric' : 'default'}
              style={field.kind === 'textarea' ? styles.textarea : undefined}
            />
            {field.options?.length ? <Text style={styles.helper}>Opções: {field.options.filter(Boolean).join(', ')}</Text> : null}
            {field.helper ? <Text style={styles.helper}>{field.helper}</Text> : null}
          </View>
        ))}
      </Card>

      <Card title="Revisão do mapeamento" subtitle="Validar aqui significa que este payload normalizado já pode alimentar a ficha e a engine.">
        <Field label="Revisor" value={reviewedBy} onChangeText={setReviewedBy} placeholder="Nome opcional" />
        <Field label="Notas" value={reviewNotes} onChangeText={setReviewNotes} multiline style={styles.textarea} placeholder="Explique decisões, ambiguidades e campos ainda pendentes." />
      </Card>

      <Card title="Preview normalizado" subtitle="Valores que serão salvos no SQLite.">
        {Object.entries(preview?.normalizedJson ?? {}).map(([key, value]) => (
          <View key={key} style={styles.previewRow}>
            <Text style={styles.previewKey}>{key}</Text>
            <Text style={styles.previewValue}>{summarizeValue(value)}</Text>
          </View>
        ))}
      </Card>

      {preview?.issues.length ? (
        <Card title="Avisos do mapeamento">
          <IssueList issues={preview.issues} />
        </Card>
      ) : null}

      <Button label="Salvar como precisa de revisão" secondary disabled={isSaving} onPress={() => handleSave('needsReview')} />
      <Button label="Salvar e validar" disabled={isSaving || Boolean(preview?.issues.some((issue) => issue.severity === 'error'))} onPress={() => handleSave('validated')} />
      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { color: '#334155', lineHeight: 20 },
  muted: { color: '#64748b', lineHeight: 19 },
  helper: { color: '#64748b', fontSize: 12, lineHeight: 17 },
  fieldBox: { gap: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 8 },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  previewRow: { borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 2 },
  previewKey: { color: '#334155', fontWeight: '800' },
  previewValue: { color: '#111827', lineHeight: 19 }
});
