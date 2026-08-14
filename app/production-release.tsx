import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Share, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import {
  APP30_PRODUCTION_RELEASE_CHECKS,
  productionReleaseToMarkdown,
  summarizeProductionRelease,
  type ProductionReleaseStatus
} from '../src/releaseDelivery/productionReleaseDelivery';

const baselineStatuses: Record<string, ProductionReleaseStatus> = Object.fromEntries(
  APP30_PRODUCTION_RELEASE_CHECKS.map((check) => [
    check.id,
    ['production-identity', 'operations-handbook', 'privacy-data-handling', 'support-readiness'].includes(check.id)
      ? 'PASS'
      : 'BLOCKED'
  ])
);

const statusColor: Record<ProductionReleaseStatus, string> = {
  PASS: '#166534',
  WARN: '#92400e',
  FAIL: '#991b1b',
  BLOCKED: '#475569'
};

export default function ProductionReleaseScreen() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const summary = summarizeProductionRelease(baselineStatuses);
  const share = async () => Share.share({
    title: `APP-30 — Release ${version}`,
    message: productionReleaseToMarkdown(baselineStatuses, version)
  });

  return (
    <Screen
      title="Release de produção"
      subtitle="Entrega operacional verificável. Preparar não significa publicar: build, submissão e disponibilidade exigem evidências distintas."
      onBack={() => router.back()}
    >
      <Card
        variant="hero"
        title={`Versão ${version} · ${summary.status}`}
        subtitle="O release permanece bloqueado até APP-28 e APP-29 passarem na mesma fingerprint e existirem artefato e recibo reais."
      >
        <Text>{summary.passed} PASS · {summary.warnings} WARN · {summary.failed} FAIL · {summary.blocked} BLOCKED</Text>
      </Card>

      <Button label="Compartilhar checklist de produção" onPress={() => void share()} />
      <Button label="Abrir release candidate" secondary onPress={() => router.push('/release-candidate')} />
      <Button label="Abrir release e dev build" secondary onPress={() => router.push('/release')} />

      {summary.checks.map((check) => (
        <Card key={check.id} title={`${check.status} · ${check.title}`} subtitle={check.blocking ? 'Controle bloqueante' : 'Controle informativo'}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: statusColor[check.status], fontWeight: '800' }}>{check.objective}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
