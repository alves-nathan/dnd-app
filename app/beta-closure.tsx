import { router } from 'expo-router';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { StatRow } from '../src/components/StatRow';
import {
  betaFeedbackExportToJson,
  createBetaFeedbackExport,
  summarizeBetaFeedbackTriage
} from '../src/release/betaFeedback';
import { useBetaFeedbackStore } from '../src/store/betaFeedbackStore';
import { useAppTheme } from '../src/theme';

const gateLabels = {
  blocked: 'BLOQUEADO',
  needsReview: 'EM REVISÃO',
  ready: 'PRONTO'
} as const;

export default function BetaClosureScreen() {
  const { colors } = useAppTheme();
  const entries = useBetaFeedbackStore((state) => state.entries);
  const triage = summarizeBetaFeedbackTriage(entries);

  const shareFeedback = async () => {
    const exported = createBetaFeedbackExport(entries);
    await Share.share({
      title: 'Feedback local da beta',
      message: betaFeedbackExportToJson(exported)
    });
  };

  const gateColor = triage.releaseGate === 'ready'
    ? colors.primary
    : triage.releaseGate === 'blocked'
      ? colors.error
      : colors.onSurfaceVariant;

  return (
    <Screen
      eyebrow="Candidata beta"
      title="Fechamento do ciclo"
      subtitle="Revise o feedback local e conclua as verificações nativas antes de promover a candidata."
      onBack={() => router.back()}
    >
      <Card
        variant={triage.releaseGate === 'ready' ? 'hero' : 'outlined'}
        title={`Gate local de feedback: ${gateLabels[triage.releaseGate]}`}
        subtitle="Feedback bloqueante ou de severidade alta impede a promoção. Itens médios e baixos exigem decisão explícita."
      >
        <Text
          testID="beta-closure-gate"
          accessibilityLiveRegion="polite"
          style={[styles.gate, { color: gateColor }]}
        >
          {gateLabels[triage.releaseGate]}
        </Text>
        <StatRow label="Registros" value={triage.total} />
        <StatRow label="Resolvidos" value={triage.resolved} />
        <StatRow label="Bloqueantes abertos" value={triage.unresolvedBlocking} />
        <StatRow label="Altos abertos" value={triage.unresolvedHigh} />
        <StatRow label="Médios abertos" value={triage.unresolvedMedium} />
        <StatRow label="Baixos abertos" value={triage.unresolvedLow} />
      </Card>

      {triage.unresolvedBlocking || triage.unresolvedHigh ? (
        <Card
          variant="filled"
          title="Correções obrigatórias"
          subtitle="Resolva ou documente a decisão sobre todos os itens bloqueantes e altos antes de gerar o relatório de promoção."
        />
      ) : null}

      <Card title="Evidências nativas" subtitle="Essas verificações precisam ser executadas em cada plataforma usando a mesma versão e commit da candidata.">
        <View style={styles.list}>
          <Text style={[styles.item, { color: colors.onSurface }]}>• Cinco fluxos Maestro aprovados</Text>
          <Text style={[styles.item, { color: colors.onSurface }]}>• Profiling e benchmark SQLite/Hermes</Text>
          <Text style={[styles.item, { color: colors.onSurface }]}>• TalkBack ou VoiceOver e fonte ampliada</Text>
          <Text style={[styles.item, { color: colors.onSurface }]}>• Backup/restauração em instalação separada</Text>
          <Text style={[styles.item, { color: colors.onSurface }]}>• Ensaio de atualização sobre versão anterior</Text>
        </View>
      </Card>

      <Button
        label="Abrir feedback local"
        icon="chatbox-ellipses-outline"
        onPress={() => router.push('/beta-feedback')}
      />
      <Button
        label="Compartilhar exportação revisada"
        icon="share-outline"
        variant="outlined"
        onPress={() => void shareFeedback()}
      />
      <Button
        label="Conferir identidade da build"
        icon="finger-print-outline"
        variant="outlined"
        testID="beta-closure-runtime"
        onPress={() => router.push('/beta-runtime')}
      />
      <Button
        label="Executar validação de dados"
        icon="shield-checkmark-outline"
        variant="outlined"
        onPress={() => router.push('/beta-validation')}
      />
      <Button
        label="Abrir benchmark nativo"
        icon="speedometer-outline"
        variant="text"
        onPress={() => router.push('/native-performance')}
      />
      <Button
        label="Abrir plano de release"
        icon="construct-outline"
        variant="text"
        onPress={() => router.push('/release')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { fontSize: 22, lineHeight: 28, fontWeight: '900' },
  list: { gap: 8 },
  item: { fontSize: 14, lineHeight: 20 }
});
