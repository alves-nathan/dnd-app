import { useEffect, useMemo } from 'react';
import { Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { StatRow } from '../src/components/StatRow';
import { useCharacterStore } from '../src/store/characterStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { useBuildPresetStore } from '../src/store/buildPresetStore';
import { useBuildHistoryStore } from '../src/store/buildHistoryStore';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { runCompatibilitySuite } from '../src/hardening/compatibilitySuite';
import { createReleasePlan, defaultReleasePlanInput, type ReleaseCheckStatus } from '../src/release/releaseReadiness';
import { useShallow } from 'zustand/react/shallow';

const statusColor: Record<ReleaseCheckStatus, string> = {
  pass: '#166534',
  warn: '#92400e',
  fail: '#991b1b'
};

export default function ReleaseScreen() {
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

  const compatibility = useMemo(
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

  const plan = useMemo(
    () =>
      createReleasePlan({
        ...defaultReleasePlanInput,
        validationScore: compatibility.summary.readinessScore,
        compatibilityGate: compatibility.summary.nextReleaseGate
      }),
    [compatibility.summary.nextReleaseGate, compatibility.summary.readinessScore]
  );

  const sharePlan = async () => {
    await Share.share({ title: 'Plano de release/dev build', message: plan.markdown });
  };

  return (
    <Screen title="Release / dev build" subtitle="Checklist final para gerar builds internos, preview e produção usando EAS sem incluir conteúdo oficial protegido no binário.">
      <Card title={`Gate ${plan.gate}`} subtitle="Resultado combinado da configuração de release com o hardening lógico do app.">
        <StatRow label="Versão" value={plan.app.version} />
        <StatRow label="Android package" value={plan.app.androidPackage} />
        <StatRow label="Android versionCode" value={plan.app.androidVersionCode} />
        <StatRow label="iOS bundle" value={plan.app.iosBundleIdentifier} />
        <StatRow label="iOS buildNumber" value={plan.app.iosBuildNumber} />
        <StatRow label="Score compatibilidade" value={`${compatibility.summary.readinessScore}/100`} />
      </Card>

      <Button label="Compartilhar plano Markdown" onPress={sharePlan} />
      <Button label="Abrir hardening / compatibilidade" secondary onPress={() => router.push('/hardening')} />
      <Button label="Abrir ensaio do release candidate" secondary onPress={() => router.push('/release-candidate')} />
      <Button label="Abrir diagnóstico global" secondary onPress={() => router.push('/diagnostics')} />
      <Button label="Executar validação de dados da beta" secondary onPress={() => router.push('/beta-validation')} />
      <Button label="Fechamento do ciclo beta" secondary onPress={() => router.push('/beta-closure')} />

      <Card title="Ordem sugerida">
        <View style={{ gap: 6 }}>
          <Text>1. npm run app28:dependencies:install</Text>
          <Text>2. Conectar dispositivo Android com ADB e Maestro</Text>
          <Text>3. npm run app28:gate</Text>
          <Text>4. npm run app28:gate:verify</Text>
          <Text>5. npm run app29:linear</Text>
          <Text>6. npm run app29:gate</Text>
          <Text>7. npm run app29:gate:verify</Text>
          <Text>8. npm run beta:android:build-candidate</Text>
          <Text>9. Capturar e revisar as evidências nativas</Text>
          <Text>10. Preparar o release de produção no APP-30</Text>
        </View>
      </Card>

      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Checklist</Text>
      {plan.checklist.map((check) => (
        <Card key={check.id} title={`${check.status.toUpperCase()} · ${check.title}`} subtitle={check.blocking ? 'Bloqueante para build' : 'Recomendação'}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: statusColor[check.status], fontWeight: '800' }}>{check.description}</Text>
            {check.action ? <Text>Ação: {check.action}</Text> : null}
          </View>
        </Card>
      ))}

      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Comandos</Text>
      {plan.commands.map((command) => (
        <Card key={command.id} title={command.label} subtitle={command.purpose}>
          <Text style={{ fontFamily: 'monospace', backgroundColor: '#f1f5f9', padding: 8, borderRadius: 8 }}>{command.command}</Text>
        </Card>
      ))}
    </Screen>
  );
}
