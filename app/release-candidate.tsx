import { Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import {
  APP29_RELEASE_CANDIDATE_CHECKS,
  releaseCandidateHardeningToMarkdown,
  summarizeReleaseCandidateChecks,
  type ReleaseCandidateCheckStatus
} from '../src/releaseCandidate/releaseCandidateHardening';

const baselineStatuses: Record<string, ReleaseCandidateCheckStatus> = Object.fromEntries(
  APP29_RELEASE_CANDIDATE_CHECKS.map((check) => [check.id, check.id === 'app28-integral-gate' ? 'BLOCKED' : 'PASS'])
);

const statusColor: Record<ReleaseCandidateCheckStatus, string> = {
  PASS: '#166534',
  WARN: '#92400e',
  FAIL: '#991b1b',
  BLOCKED: '#475569'
};

export default function ReleaseCandidateScreen() {
  const summary = summarizeReleaseCandidateChecks(baselineStatuses);
  const share = async () => Share.share({
    title: 'APP-29 — Hardening do release candidate',
    message: releaseCandidateHardeningToMarkdown(baselineStatuses)
  });

  return (
    <Screen
      title="Ensaio do release candidate"
      subtitle="Hardening reproduzível de desempenho, acessibilidade, segurança, migrações, instalação limpa e upgrade."
      onBack={() => router.back()}
    >
      <Card title={`Status ${summary.status}`} subtitle="O release candidate somente pode avançar quando todos os controles bloqueantes estiverem aprovados.">
        <Text>{summary.passed} PASS · {summary.warnings} WARN · {summary.failed} FAIL · {summary.blocked} BLOCKED</Text>
        <Text>O APP-28 continua bloqueado até typecheck, Jest e Android serem executados no ambiente proprietário.</Text>
      </Card>

      <Button label="Compartilhar checklist" onPress={() => void share()} />
      <Button label="Abrir release e dev build" secondary onPress={() => router.push('/release')} />
      <Button label="Abrir release de produção" secondary onPress={() => router.push('/production-release')} />
      <Button label="Abrir hardening lógico" secondary onPress={() => router.push('/hardening')} />

      {summary.checks.map((check) => (
        <Card key={check.id} title={`${check.status} · ${check.title}`} subtitle={check.blocking ? 'Bloqueante' : 'Informativo'}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: statusColor[check.status], fontWeight: '800' }}>{check.objective}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
