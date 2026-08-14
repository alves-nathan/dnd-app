import { useState } from 'react';
import { Alert, Share, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { Field } from '../src/components/Field';
import {
  createSyntheticNativeBenchmarkImport,
  formatNativeCompendiumBenchmarkReport,
  runNativeCompendiumBenchmark,
  type NativeCompendiumBenchmarkReport
} from '../src/performance/nativeCompendiumBenchmark';
import { SQLiteCompendiumRepository } from '../src/storage/sqliteCompendiumRepository';

const BENCHMARK_DATABASE = 'dnd-combat-native-benchmark.db';

export default function NativePerformanceScreen() {
  const [itemCount, setItemCount] = useState('1263');
  const [batchSize, setBatchSize] = useState('250');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<NativeCompendiumBenchmarkReport>();

  const run = async () => {
    const resolvedItemCount = Math.max(100, Math.min(10000, Number.parseInt(itemCount, 10) || 1263));
    const resolvedBatchSize = Math.max(1, Math.min(resolvedItemCount, Number.parseInt(batchSize, 10) || 250));
    setRunning(true);
    try {
      const json = createSyntheticNativeBenchmarkImport(resolvedItemCount);
      const repository = new SQLiteCompendiumRepository(BENCHMARK_DATABASE);
      const result = await runNativeCompendiumBenchmark(repository, json, {
        batchSize: resolvedBatchSize,
        coldRepositoryFactory: () => new SQLiteCompendiumRepository(BENCHMARK_DATABASE)
      });
      setReport(result);
    } catch (error) {
      Alert.alert('Benchmark falhou', error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const share = async () => {
    if (!report) return;
    await Share.share({ title: 'Benchmark SQLite nativo', message: formatNativeCompendiumBenchmarkReport(report) });
  };

  return (
    <Screen
      title="Benchmark SQLite nativo"
      subtitle="Mede o banco expo-sqlite em uma base sintética isolada, sem tocar no compêndio do usuário."
      onBack={() => router.back()}
    >
      <Card title="Escopo" subtitle="O banco temporário é limpo antes e depois da execução.">
        <Field label="Quantidade de itens" value={itemCount} onChangeText={setItemCount} keyboardType="number-pad" />
        <Field label="Itens na revisão transacional" value={batchSize} onChangeText={setBatchSize} keyboardType="number-pad" />
        <Button label={running ? 'Executando benchmark...' : 'Executar benchmark nativo'} disabled={running} onPress={() => void run()} testID="native-benchmark-run" />
      </Card>

      {report ? (
        <Card title="Resultado" subtitle={`Gerado em ${new Date(report.generatedAt).toLocaleString()}`}>
          <Text selectable style={styles.report}>{formatNativeCompendiumBenchmarkReport(report)}</Text>
          <Button label="Compartilhar resultado" secondary onPress={() => void share()} />
        </Card>
      ) : (
        <Card title="Ainda não executado" subtitle="Rode em development build ou app nativo para medir o SQLite real do dispositivo/emulador." />
      )}

      <Card title="Medições externas ainda necessárias" subtitle="Este harness não substitui as ferramentas de perfil nativas.">
        <Text style={styles.muted}>Android: Memory Profiler, CPU Profiler, JankStats/Frame Timeline e logcat.</Text>
        <Text style={styles.muted}>iOS: Instruments — Allocations, Time Profiler e Core Animation.</Text>
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  report: { color: '#111827', lineHeight: 20, fontFamily: 'monospace' },
  muted: { color: '#64748b', lineHeight: 19 }
});
