import { useEffect, useMemo, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Field';
import { Button } from '../src/components/Button';
import { useCharacterStore } from '../src/store/characterStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { useBuildPresetStore } from '../src/store/buildPresetStore';
import { useBuildHistoryStore } from '../src/store/buildHistoryStore';
import { useCompendiumStore } from '../src/store/compendiumStore';
import {
  filterGlobalDiagnosticIssues,
  globalDiagnosticsReportToMarkdown,
  runGlobalDiagnostics,
  type GlobalDiagnosticArea,
  type GlobalDiagnosticSeverity
} from '../src/diagnostics/globalDiagnostics';
import { createPrivacySafeDiagnosticExport, privacySafeDiagnosticToMarkdown } from '../src/diagnostics/privacySafeDiagnosticExport';

const areas: Array<GlobalDiagnosticArea | 'all'> = ['all', 'characters', 'rotations', 'actions', 'resources', 'spellSlots', 'effects', 'compendium', 'engine', 'scenarios', 'presets', 'history', 'backup'];
const severities: Array<GlobalDiagnosticSeverity | 'all'> = ['all', 'error', 'warning', 'info'];

const nextValue = <T extends string>(values: T[], current: T): T => values[(values.indexOf(current) + 1) % values.length];

export default function DiagnosticsScreen() {
  const characters = useCharacterStore((state) => state.characters);
  const scenarios = useCombatScenarioStore((state) => state.scenarios);
  const presets = useBuildPresetStore((state) => state.presets);
  const snapshots = useBuildHistoryStore((state) => state.snapshots);

  const sources = useCompendiumStore((state) => state.sources);
  const packs = useCompendiumStore((state) => state.packs);
  const items = useCompendiumStore((state) => state.items);
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const hydrate = useCompendiumStore((state) => state.hydrate);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);
  const lastStorageError = useCompendiumStore((state) => state.lastStorageError);

  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState<GlobalDiagnosticArea | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<GlobalDiagnosticSeverity | 'all'>('all');
  const [limit, setLimit] = useState('80');

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrate();
  }, [hydrate, isHydrated, isHydrating]);

  const report = useMemo(
    () =>
      runGlobalDiagnostics({
        characters,
        scenarios,
        buildPresets: presets,
        buildHistorySnapshots: snapshots,
        compendium: { sources, packs, items, enabledSourceIds }
      }),
    [characters, enabledSourceIds, items, packs, presets, scenarios, snapshots, sources]
  );

  const filteredIssues = useMemo(
    () => filterGlobalDiagnosticIssues(report, { query, area: areaFilter, severity: severityFilter }),
    [areaFilter, query, report, severityFilter]
  );
  const visibleLimit = Math.max(1, Number.parseInt(limit, 10) || 80);

  const shareReport = async () => {
    try {
      await Share.share({ title: 'Diagnóstico global D&D Combat Math', message: globalDiagnosticsReportToMarkdown(report) });
    } catch {
      Alert.alert('Exportação falhou', 'Não foi possível compartilhar o relatório Markdown.');
    }
  };

  const sharePrivacySafeReport = async () => {
    try {
      const diagnostic = createPrivacySafeDiagnosticExport(report, { sources, packs, items, enabledSourceIds });
      await Share.share({ title: 'Diagnóstico sem conteúdo privado', message: privacySafeDiagnosticToMarkdown(diagnostic) });
    } catch {
      Alert.alert('Exportação falhou', 'Não foi possível compartilhar o diagnóstico sem conteúdo privado.');
    }
  };

  return (
    <Screen title="Diagnóstico global" subtitle="Verifique integridade de personagens, rotações, compêndio, engine, backup e referências órfãs.">
      <Card title="Health score" subtitle={`${report.summary.healthScore}/100 · ${report.summary.totalIssues} problema(s) detectado(s)`}>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, report.summary.healthScore >= 80 ? styles.good : report.summary.healthScore >= 50 ? styles.warn : styles.bad]}>{report.summary.healthScore}</Text>
          <View style={styles.flex}>
            <Text style={styles.bold}>{report.summary.errorCount} erro(s) · {report.summary.warningCount} aviso(s) · {report.summary.infoCount} info(s)</Text>
            <Text style={styles.muted}>Backup roundtrip: {report.summary.backupRoundtripOk ? 'OK' : 'falhou'} · referências suspeitas: {report.summary.orphanReferenceCount}</Text>
            {lastStorageError ? <Text style={styles.errorText}>Erro de storage do compêndio: {lastStorageError}</Text> : null}
          </View>
        </View>
        <Button label="Compartilhar relatório completo" onPress={shareReport} />
        <Button label="Compartilhar diagnóstico sem conteúdo privado" secondary onPress={sharePrivacySafeReport} />
      </Card>

      <Card title="Inventário avaliado">
        <View style={styles.metricGrid}>
          <Text style={styles.metric}>Personagens: {report.summary.characterCount}</Text>
          <Text style={styles.metric}>Rotações: {report.summary.rotationCount}</Text>
          <Text style={styles.metric}>Cenários: {report.summary.scenarioCount}</Text>
          <Text style={styles.metric}>Itens compêndio: {report.summary.compendiumItemCount}</Text>
          <Text style={styles.metric}>Validados: {report.summary.validatedCompendiumItemCount}</Text>
          <Text style={styles.metric}>Engine ready: {report.summary.engineReadyCompendiumItemCount}</Text>
          <Text style={styles.metric}>Engine blocked: {report.engineReadiness.summary.blockedItems}</Text>
          <Text style={styles.metric}>Engine partial: {report.engineReadiness.summary.partialItems}</Text>
        </View>
      </Card>

      <Card title="Resumo por área" subtitle="Áreas sem problemas ficam ocultas para reduzir ruído.">
        {report.areas.filter((entry) => entry.total > 0).length === 0 ? <Text style={styles.successText}>Nenhum problema por área.</Text> : null}
        {report.areas.filter((entry) => entry.total > 0).map((entry) => (
          <View key={entry.area} style={styles.areaRow}>
            <Text style={styles.areaName}>{entry.area}</Text>
            <Text style={entry.errors ? styles.errorText : styles.muted}>E {entry.errors}</Text>
            <Text style={entry.warnings ? styles.warningText : styles.muted}>A {entry.warnings}</Text>
            <Text style={entry.infos ? styles.infoText : styles.muted}>I {entry.infos}</Text>
          </View>
        ))}
      </Card>

      <Card title="Filtros">
        <Field label="Buscar" value={query} onChangeText={setQuery} placeholder="código, nome, área, sugestão..." autoCapitalize="none" />
        <Field label="Limite visual" value={limit} onChangeText={setLimit} keyboardType="numeric" />
        <Button label={`Área: ${areaFilter}`} secondary onPress={() => setAreaFilter((value) => nextValue(areas, value))} />
        <Button label={`Severidade: ${severityFilter}`} secondary onPress={() => setSeverityFilter((value) => nextValue(severities, value))} />
      </Card>

      <Card title="Problemas encontrados" subtitle={`${filteredIssues.length} item(ns) após filtros. Mostrando até ${visibleLimit}.`}>
        {filteredIssues.length === 0 ? <Text style={styles.successText}>Nenhum problema para os filtros atuais.</Text> : null}
        {filteredIssues.slice(0, visibleLimit).map((issue) => (
          <View key={issue.id} style={styles.issueBox}>
            <Text style={issue.severity === 'error' ? styles.errorText : issue.severity === 'warning' ? styles.warningText : styles.infoText}>
              {issue.severity.toUpperCase()} · {issue.area} · {issue.code}
            </Text>
            {issue.entityLabel ? <Text style={styles.bold}>{issue.entityLabel}</Text> : null}
            <Text style={styles.muted}>{issue.message}</Text>
            {issue.suggestedAction ? <Text style={styles.suggestion}>Ação sugerida: {issue.suggestedAction}</Text> : null}
          </View>
        ))}
      </Card>

      <Card title="Atalhos de correção" subtitle="Use estas telas para corrigir os problemas mais comuns encontrados pelo diagnóstico.">
        <Button label="Prontidão pré-engine" secondary onPress={() => router.push('/compendium/readiness')} />
        <Button label="Fila de revisão do compêndio" secondary onPress={() => router.push('/compendium/review-queue')} />
        <Button label="Backup / restauração" secondary onPress={() => router.push('/backup')} />
        <Button label="Compêndio / importação" secondary onPress={() => router.push('/compendium')} />
        <Button label="Benchmark SQLite nativo" secondary onPress={() => router.push('/native-performance')} />
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  score: { width: 76, height: 76, borderRadius: 38, textAlign: 'center', textAlignVertical: 'center', fontSize: 28, fontWeight: '900', backgroundColor: '#f1f5f9' },
  good: { color: '#047857' },
  warn: { color: '#b45309' },
  bad: { color: '#b91c1c' },
  bold: { fontWeight: '800', color: '#111827' },
  muted: { color: '#64748b', lineHeight: 19 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, color: '#334155', fontWeight: '700' },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 },
  areaName: { flex: 1, fontWeight: '800', color: '#111827' },
  issueBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 4 },
  errorText: { color: '#b91c1c', fontWeight: '800', lineHeight: 20 },
  warningText: { color: '#b45309', fontWeight: '800', lineHeight: 20 },
  infoText: { color: '#2563eb', fontWeight: '800', lineHeight: 20 },
  successText: { color: '#047857', fontWeight: '800', lineHeight: 20 },
  suggestion: { color: '#334155', lineHeight: 19, fontStyle: 'italic' }
});
