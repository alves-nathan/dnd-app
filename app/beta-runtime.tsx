import { router } from 'expo-router';
import { Share, StyleSheet, Text } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { StatRow } from '../src/components/StatRow';
import { formatRuntimeBuildInfo, getRuntimeBuildInfo } from '../src/release/runtimeBuildInfo';
import { isE2ESeedAllowed } from '../src/release/runtimeReleasePolicy';
import { useAppTheme } from '../src/theme';

export default function BetaRuntimeScreen() {
  const { colors } = useAppTheme();
  const info = getRuntimeBuildInfo();
  const seedAllowed = isE2ESeedAllowed({
    isDevelopment: __DEV__,
    releaseStage: info.releaseStage,
    e2eSeedEnabled: info.e2eSeedEnabled
  });

  const share = async () => {
    await Share.share({
      title: 'Identidade da build beta',
      message: formatRuntimeBuildInfo(info)
    });
  };

  return (
    <Screen
      eyebrow="Execução nativa"
      title="Identidade da build"
      subtitle="Confirme que o binário, o commit e a execução de testes pertencem à mesma candidata antes de capturar evidências."
      onBack={() => router.back()}
    >
      <Card
        variant={info.releaseStage === 'beta-candidate' ? 'hero' : 'outlined'}
        title={`${info.appName} ${info.appVersion}`}
        subtitle={`Build nativa ${info.nativeBuildVersion}`}
      >
        <Text
          testID="beta-runtime-stage"
          accessibilityLiveRegion="polite"
          style={[styles.stage, { color: info.releaseStage === 'beta-candidate' ? colors.onPrimaryContainer : colors.onSurface }]}
        >
          {info.releaseStage}
        </Text>
        <StatRow label="Plataforma" value={info.platform} />
        <StatRow label="Perfil" value={info.buildProfile} />
        <StatRow label="Build ID" value={info.buildId ?? 'Não informado'} />
        <StatRow label="Commit" value={info.gitSha ?? 'Não informado'} />
        <StatRow label="Test run" value={info.testRunId ?? 'Não informado'} />
      </Card>

      <Card
        variant={seedAllowed ? 'filled' : 'outlined'}
        title={seedAllowed ? 'Fixture E2E disponível' : 'Fixture E2E bloqueada'}
        subtitle={seedAllowed
          ? 'Esta build interna permite limpar somente os dados locais do app e carregar a fixture determinística.'
          : 'A ferramenta destrutiva permanece indisponível fora de development e beta-candidate explicitamente habilitada.'}
      >
        <Button
          label="Abrir preparação E2E"
          icon="flask-outline"
          variant="outlined"
          disabled={!seedAllowed}
          testID="beta-runtime-open-seed"
          onPress={() => router.push('/e2e-seed')}
        />
      </Card>

      <Button
        label="Executar benchmark SQLite"
        icon="speedometer-outline"
        testID="beta-runtime-open-benchmark"
        onPress={() => router.push('/native-performance')}
      />
      <Button
        label="Compartilhar identidade da build"
        icon="share-outline"
        variant="outlined"
        onPress={() => void share()}
      />
      <Button
        label="Voltar ao fechamento beta"
        icon="checkmark-done-outline"
        variant="text"
        onPress={() => router.replace('/beta-closure')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { fontSize: 22, lineHeight: 28, fontWeight: '900', textTransform: 'uppercase' }
});
