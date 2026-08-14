import { router } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import {
  BetaDataSafetyReport,
  betaDataSafetyReportToJson,
  runBetaDataSafetyRehearsal
} from '../src/release/betaDataSafety';
import { useBuildHistoryStore } from '../src/store/buildHistoryStore';
import { useBuildPresetStore } from '../src/store/buildPresetStore';
import { useCharacterStore } from '../src/store/characterStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { useAppTheme } from '../src/theme';

export default function BetaValidationScreen() {
  const { colors } = useAppTheme();
  const characters = useCharacterStore((state) => state.characters);
  const scenarios = useCombatScenarioStore((state) => state.scenarios);
  const presets = useBuildPresetStore((state) => state.presets);
  const snapshots = useBuildHistoryStore((state) => state.snapshots);
  const [report, setReport] = useState<BetaDataSafetyReport>();

  const runRehearsal = () => {
    setReport(
      runBetaDataSafetyRehearsal({
        characters,
        scenarios,
        buildPresets: presets,
        buildHistorySnapshots: snapshots
      })
    );
  };

  const shareReport = async () => {
    if (!report) return;
    await Share.share({
      title: 'Ensaio de segurança de dados da beta',
      message: betaDataSafetyReportToJson(report)
    });
  };

  return (
    <Screen
      eyebrow="Beta"
      title="Validação de dados"
      subtitle="Executa localmente migração, integridade, restauração isolada e referências internas. Não substitui os testes Android/iOS reais."
      onBack={() => router.back()}
    >
      <Card
        variant="hero"
        title="Ensaio sem alterar seus dados"
        subtitle="O app cria um backup temporário em memória, restaura em um conjunto vazio e compara o resultado."
      >
        <Text style={[styles.body, { color: colors.onPrimaryContainer }]}>Escopo atual: {characters.length} personagem(ns), {scenarios.length} cenário(s), {presets.length} preset(s) e {snapshots.length} snapshot(s).</Text>
        <Button
          label="Executar ensaio de migração e restauração"
          icon="shield-checkmark-outline"
          testID="beta-run-data-safety"
          onPress={runRehearsal}
        />
      </Card>

      {report ? (
        <>
          <Card
            variant={report.status === 'passed' ? 'filled' : 'outlined'}
            title={report.status === 'passed' ? 'Ensaio local aprovado' : 'Ensaio local com falha'}
            subtitle={`${report.checks.filter((entry) => entry.passed).length}/${report.checks.length} verificações · ${report.migrations.filter((entry) => entry.passed).length}/${report.migrations.length} versões migradas · ${report.durationMs} ms`}
          >
            <Text
              accessibilityLiveRegion="polite"
              testID="beta-data-safety-status"
              style={[styles.status, { color: report.status === 'passed' ? colors.primary : colors.error }]}
            >
              {report.status.toUpperCase()}
            </Text>
          </Card>

          <Card title="Verificações">
            {report.checks.map((entry) => (
              <View key={entry.id} style={styles.checkRow}>
                <Text style={[styles.checkTitle, { color: entry.passed ? colors.primary : colors.error }]}>{entry.passed ? '✓' : '✕'} {entry.label}</Text>
                <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{entry.details}</Text>
              </View>
            ))}
          </Card>

          <Card title="Migrações da store" subtitle={`Versões 0 a ${report.migrations.length - 1} verificadas contra o shape atual.`}>
            <View style={styles.versionGrid}>
              {report.migrations.map((entry) => (
                <View key={entry.fromVersion} style={[styles.versionBadge, { borderColor: entry.passed ? colors.primary : colors.error }]}>
                  <Text style={{ color: entry.passed ? colors.primary : colors.error, fontWeight: '900' }}>v{entry.fromVersion}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Button label="Compartilhar relatório local" icon="share-outline" variant="outlined" onPress={() => void shareReport()} />
        </>
      ) : (
        <Card title="Ainda não executado" subtitle="Execute o ensaio depois de criar ou importar fichas representativas da beta." />
      )}

      <Card
        variant="outlined"
        title="Evidência móvel ainda obrigatória"
        subtitle="A aprovação final depende de E2E, profiling nativo, TalkBack/VoiceOver e restauração em uma instalação separada."
      >
        <Button label="Registrar feedback da beta" icon="chatbox-ellipses-outline" variant="tonal" onPress={() => router.push('/beta-feedback')} />
        <Button label="Abrir release e builds" icon="construct-outline" variant="text" onPress={() => router.push('/release')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 19 },
  status: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  checkRow: { gap: 3, paddingVertical: 6 },
  checkTitle: { fontSize: 14, lineHeight: 20, fontWeight: '900' },
  versionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  versionBadge: { minWidth: 46, minHeight: 42, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});
