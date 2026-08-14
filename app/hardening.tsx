import { useEffect, useMemo } from 'react';
import { Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useCharacterStore } from '../src/store/characterStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { useBuildPresetStore } from '../src/store/buildPresetStore';
import { useBuildHistoryStore } from '../src/store/buildHistoryStore';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { compatibilityReportToMarkdown, runCompatibilitySuite, type CompatibilityCheckStatus } from '../src/hardening/compatibilitySuite';
import { useShallow } from 'zustand/react/shallow';

const statusLabel: Record<CompatibilityCheckStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  skip: 'SKIP'
};

const statusColor: Record<CompatibilityCheckStatus, string> = {
  pass: '#166534',
  warn: '#92400e',
  fail: '#991b1b',
  skip: '#475569'
};

export default function HardeningScreen() {
  const characters = useCharacterStore((state) => state.characters);
  const scenarios = useCombatScenarioStore((state) => state.scenarios);
  const buildPresets = useBuildPresetStore((state) => state.presets);
  const buildHistorySnapshots = useBuildHistoryStore((state) => state.snapshots);
  const compendium = useCompendiumStore(useShallow((state) => state.getSnapshot()));
  const hydrateCompendium = useCompendiumStore((state) => state.hydrate);
  const isHydrated = useCompendiumStore((state) => state.isHydrated);
  const isHydrating = useCompendiumStore((state) => state.isHydrating);

  useEffect(() => {
    if (!isHydrated && !isHydrating) void hydrateCompendium();
  }, [hydrateCompendium, isHydrated, isHydrating]);

  const report = useMemo(
    () =>
      runCompatibilitySuite({
        characters,
        scenarios,
        buildPresets,
        buildHistorySnapshots,
        compendium
      }),
    [characters, scenarios, buildPresets, buildHistorySnapshots, compendium]
  );

  const shareReport = async () => {
    await Share.share({ title: 'Hardening e compatibilidade', message: compatibilityReportToMarkdown(report) });
  };

  return (
    <Screen title="Hardening e compatibilidade" subtitle="Smoke tests lógicos para validar importação, exportação, backup, engine, modo mesa e gate antes da dev build.">
      <Card title={`Score ${report.summary.readinessScore}/100`} subtitle={`Gate: ${report.summary.nextReleaseGate} · Status: ${report.summary.status}`}>
        <View style={{ gap: 4 }}>
          <Text>{report.summary.passed} pass · {report.summary.warnings} warn · {report.summary.failed} fail · {report.summary.skipped} skip</Text>
          <Text>Checks executados: {report.summary.totalChecks}</Text>
        </View>
      </Card>

      <Button label="Compartilhar relatório Markdown" onPress={shareReport} />
      <Button label="Abrir diagnóstico global" secondary onPress={() => router.push('/diagnostics')} />
      <Button label="Abrir prontidão pré-engine" secondary onPress={() => router.push('/compendium/readiness')} />

      {report.checks.map((check) => (
        <Card key={check.id} title={`${statusLabel[check.status]} · ${check.title}`} subtitle={`${check.area} · ${check.durationMs}ms`}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: statusColor[check.status], fontWeight: '800' }}>{check.message}</Text>
            {check.suggestedAction ? <Text>Ação sugerida: {check.suggestedAction}</Text> : null}
            {check.issues.slice(0, 5).map((issue) => (
              <Text key={`${check.id}-${issue.code}-${issue.message}`} style={{ fontSize: 12, color: issue.severity === 'error' ? '#991b1b' : issue.severity === 'warning' ? '#92400e' : '#475569' }}>
                {issue.severity.toUpperCase()} {issue.code}: {issue.message}
              </Text>
            ))}
            {check.issues.length > 5 ? <Text style={{ fontSize: 12, color: '#64748b' }}>+{check.issues.length - 5} issue(s) adicionais no relatório Markdown</Text> : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
