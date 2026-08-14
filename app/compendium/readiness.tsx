import { useEffect, useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { VirtualizedScreen } from '../../src/components/VirtualizedScreen';
import { Card } from '../../src/components/Card';
import { Field } from '../../src/components/Field';
import { Button } from '../../src/components/Button';
import { useCompendiumStore } from '../../src/store/compendiumStore';
import { buildEngineReadinessReport, engineReadinessReportToMarkdown } from '../../src/compendium/engineReadiness';
import type { CompendiumItemType, StoredCompendiumItemStatus } from '../../src/compendium/types';

const itemTypes: CompendiumItemType[] = ['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock'];
const itemStatuses: StoredCompendiumItemStatus[] = ['draft', 'validated', 'needsReview', 'disabled'];

const parseCsv = (input: string): string[] => input.split(',').map((entry) => entry.trim()).filter(Boolean);
const parseTypes = (input: string): CompendiumItemType[] | undefined => {
  const values = parseCsv(input).filter((entry): entry is CompendiumItemType => itemTypes.includes(entry as CompendiumItemType));
  return values.length ? values : undefined;
};
const parseStatuses = (input: string): StoredCompendiumItemStatus[] | undefined => {
  const values = parseCsv(input).filter((entry): entry is StoredCompendiumItemStatus => itemStatuses.includes(entry as StoredCompendiumItemStatus));
  return values.length ? values : undefined;
};

export default function CompendiumReadinessScreen() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('validated');
  const [sourceFilter, setSourceFilter] = useState('');
  const [onlyEnabledSources, setOnlyEnabledSources] = useState(true);
  const [onlyValidated, setOnlyValidated] = useState(true);

  const sources = useCompendiumStore((state) => state.sources);
  const packs = useCompendiumStore((state) => state.packs);
  const items = useCompendiumStore((state) => state.items);
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const hydrate = useCompendiumStore((state) => state.hydrate);

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  const report = useMemo(
    () =>
      buildEngineReadinessReport({
        items,
        sources,
        packs,
        enabledSourceIds,
        filters: {
          query,
          types: parseTypes(typeFilter),
          statuses: parseStatuses(statusFilter),
          sourceIds: parseCsv(sourceFilter).length ? parseCsv(sourceFilter) : undefined,
          onlyEnabledSources,
          onlyValidated
        }
      }),
    [enabledSourceIds, items, onlyEnabledSources, onlyValidated, packs, query, sourceFilter, sources, statusFilter, typeFilter]
  );

  const handleShare = async () => {
    try {
      await Share.share({ message: engineReadinessReportToMarkdown(report), title: 'Relatório de prontidão pré-engine' });
    } catch {
      Alert.alert('Exportação falhou', 'Não foi possível compartilhar o relatório Markdown.');
    }
  };

  return (
    <VirtualizedScreen
      title="Prontidão pré-engine"
      subtitle="Valide se o compêndio importado consegue alimentar a engine: aplicação à ficha, ações, dano, efeitos, recursos e spell slots."
      onBack={() => router.back()}
      data={report.items}
      keyExtractor={(row) => row.item.id}
      initialNumToRender={12}
      headerContent={(
        <>
          <Card title="Resumo" subtitle={`${report.summary.totalItems} item(ns) avaliados · score médio ${report.summary.readinessAverage}%`}>
            <View style={styles.metricGrid}>
              <Text style={styles.metric}>Prontos: {report.summary.readyItems}</Text>
              <Text style={styles.metric}>Parciais: {report.summary.partialItems}</Text>
              <Text style={styles.metric}>Bloqueados: {report.summary.blockedItems}</Text>
              <Text style={styles.metric}>Validados: {report.summary.validatedItems}</Text>
              <Text style={styles.metric}>Ações: {report.summary.actionItems}</Text>
              <Text style={styles.metric}>Dano: {report.summary.damageItems}</Text>
              <Text style={styles.metric}>Efeitos: {report.summary.effectItems}</Text>
              <Text style={styles.metric}>Recursos: {report.summary.resourceItems}</Text>
              <Text style={styles.metric}>Slots: {report.summary.spellSlotItems}</Text>
              <Text style={styles.metric}>Tokens pendentes: {report.summary.unresolvedDamageItems}</Text>
            </View>
            <Button label="Compartilhar relatório Markdown" secondary onPress={handleShare} />
          </Card>

          <Card title="Suites de compatibilidade" subtitle="Esses testes não substituem a revisão humana; eles indicam se o compêndio está pronto para ser consumido pela engine.">
            {report.suites.map((suite) => (
              <View key={suite.id} style={styles.suiteRow}>
                <Text style={[styles.suiteStatus, suite.status === 'pass' ? styles.pass : suite.status === 'warning' ? styles.warning : styles.error]}>{suite.status.toUpperCase()}</Text>
                <View style={styles.flex}>
                  <Text style={styles.bold}>{suite.title}</Text>
                  <Text style={styles.muted}>{suite.message}</Text>
                </View>
              </View>
            ))}
          </Card>

          <Card title="Filtros" subtitle="Por padrão a tela avalia apenas itens validados de fontes ativas.">
            <Field label="Buscar" value={query} onChangeText={setQuery} placeholder="Ex.: spell, weapon, resource, fonte..." />
            <Field label="Tipos" value={typeFilter} onChangeText={setTypeFilter} placeholder="weapon, spell, feature" autoCapitalize="none" />
            <Field label="Status" value={statusFilter} onChangeText={setStatusFilter} placeholder="validated, needsReview, draft, disabled" autoCapitalize="none" />
            <Field label="Fontes" value={sourceFilter} onChangeText={setSourceFilter} placeholder="source-id-1, source-id-2" autoCapitalize="none" />
            <Button label={onlyEnabledSources ? 'Somente fontes ativas' : 'Fontes ativas e inativas'} secondary onPress={() => setOnlyEnabledSources((value) => !value)} />
            <Button label={onlyValidated ? 'Somente itens validados' : 'Todos os status'} secondary onPress={() => setOnlyValidated((value) => !value)} />
          </Card>

          <Card title="Itens avaliados" subtitle={`${report.items.length} item(ns) em lista virtualizada, ordenados por bloqueios, avisos e nome.`} />
        </>
      )}
      renderItem={({ item: row }) => (
        <View style={styles.itemBox}>
          <View style={styles.rowNoBorder}>
            <View style={styles.flex}>
              <Text style={styles.bold}>{row.item.name}</Text>
              <Text style={styles.muted}>{row.item.type} · {row.item.status} · {row.status} · score {row.readinessScore}%</Text>
              <Text style={styles.muted}>Capacidades: {row.capabilities.length ? row.capabilities.join(', ') : 'nenhuma'}</Text>
            </View>
            <View style={styles.actions}>
              <Button label="Mapear" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]/mapping', params: { itemId: row.item.id } })} />
              <Button label="Detalhes" secondary onPress={() => router.push({ pathname: '/compendium/[itemId]', params: { itemId: row.item.id } })} />
            </View>
          </View>
          {row.issues.length === 0 ? <Text style={styles.passText}>Sem problemas detectados para os filtros atuais.</Text> : null}
          {row.issues.slice(0, 8).map((problem) => (
            <Text key={`${row.item.id}-${problem.code}-${problem.message}`} style={problem.severity === 'error' ? styles.problemError : styles.problemWarning}>
              {problem.severity.toUpperCase()} · {problem.code}: {problem.message}
            </Text>
          ))}
        </View>
      )}
      emptyContent={<Card variant="filled" title="Nenhum item encontrado" subtitle="Ajuste os filtros para ampliar o relatório." />}
      footerContent={<Button label="Voltar ao compêndio" secondary onPress={() => router.back()} />}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, color: '#334155', fontWeight: '700' },
  suiteRow: { flexDirection: 'row', gap: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, alignItems: 'flex-start' },
  suiteStatus: { width: 72, fontWeight: '900' },
  pass: { color: '#047857' },
  warning: { color: '#b45309' },
  error: { color: '#b91c1c' },
  bold: { fontWeight: '800', color: '#111827' },
  muted: { color: '#64748b', lineHeight: 19 },
  rowNoBorder: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  actions: { gap: 6 },
  itemBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 6 },
  passText: { color: '#047857', lineHeight: 19, fontWeight: '700' },
  problemError: { color: '#b91c1c', lineHeight: 19 },
  problemWarning: { color: '#b45309', lineHeight: 19 }
});
