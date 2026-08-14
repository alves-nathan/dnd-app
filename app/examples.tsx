import { useMemo, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useCharacterStore } from '../src/store/characterStore';
import { useCombatScenarioStore } from '../src/store/combatScenarioStore';
import { useBuildPresetStore } from '../src/store/buildPresetStore';
import { useBuildHistoryStore } from '../src/store/buildHistoryStore';
import { useCompendiumStore } from '../src/store/compendiumStore';
import {
  createExampleLibraryBundle,
  exampleCharacterBackupJson,
  exampleCompendiumImportJson,
  summarizeExampleLibrary
} from '../src/fixtures/exampleLibrary';

const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const existing = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !existing.has(item.id))];
};

export default function ExamplesScreen() {
  const [lastMessage, setLastMessage] = useState<string>();
  const [isInstalling, setIsInstalling] = useState(false);
  const characters = useCharacterStore((state) => state.characters);
  const setCharacters = useCharacterStore((state) => state.setCharacters);
  const scenarios = useCombatScenarioStore((state) => state.scenarios);
  const setScenarios = useCombatScenarioStore((state) => state.setScenarios);
  const presets = useBuildPresetStore((state) => state.presets);
  const setPresets = useBuildPresetStore((state) => state.setPresets);
  const snapshots = useBuildHistoryStore((state) => state.snapshots);
  const setSnapshots = useBuildHistoryStore((state) => state.setSnapshots);
  const hydrateCompendium = useCompendiumStore((state) => state.hydrate);
  const saveImportJson = useCompendiumStore((state) => state.saveImportJson);

  const bundle = useMemo(() => createExampleLibraryBundle(), []);
  const summary = useMemo(() => summarizeExampleLibrary(bundle), [bundle]);

  const installExamples = async (replace = false) => {
    setIsInstalling(true);
    try {
      await hydrateCompendium();
      const result = await saveImportJson(JSON.stringify(bundle.compendiumImport, null, 2));
      if (!result.ok) {
        const text = result.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n');
        setLastMessage(`Compêndio não importado: ${text}`);
        Alert.alert('Importação de exemplo falhou', text || 'Erro desconhecido.');
        return;
      }

      setCharacters(replace ? bundle.characters : mergeById(characters, bundle.characters));
      setScenarios(replace ? bundle.scenarios : mergeById(scenarios, bundle.scenarios));
      setPresets(replace ? bundle.buildPresets : mergeById(presets, bundle.buildPresets));
      setSnapshots(replace ? bundle.buildHistorySnapshots : mergeById(snapshots, bundle.buildHistorySnapshots));
      const message = replace ? 'Biblioteca de exemplos instalada substituindo dados locais.' : 'Biblioteca de exemplos adicionada sem duplicar IDs existentes.';
      setLastMessage(message);
      Alert.alert('Exemplos instalados', message);
    } finally {
      setIsInstalling(false);
    }
  };

  const shareText = async (title: string, message: string) => {
    await Share.share({ title, message });
  };

  return (
    <Screen title="Biblioteca de exemplos" subtitle="Fixtures fictícias para testar personagens, compêndio, rotações, recursos, histórico e backup sem usar regras oficiais embutidas.">
      <Card title="Resumo da biblioteca" subtitle={`${summary.characterCount} personagens · ${summary.scenarioCount} cenários · ${summary.compendiumItemCount} itens de compêndio`}>
        <View style={{ gap: 6 }}>
          <Text>Presets: {summary.presetCount}</Text>
          <Text>Snapshots de histórico: {summary.historySnapshotCount}</Text>
          {summary.highlights.map((highlight) => (
            <Text key={highlight}>• {highlight}</Text>
          ))}
        </View>
      </Card>

      <Button label="Adicionar exemplos" disabled={isInstalling} onPress={() => installExamples(false)} />
      <Button label="Substituir dados locais pelos exemplos" secondary disabled={isInstalling} onPress={() => installExamples(true)} />
      <Button label="Compartilhar JSON de compêndio exemplo" secondary onPress={() => shareText('Compêndio exemplo', exampleCompendiumImportJson())} />
      <Button label="Compartilhar backup exemplo" secondary onPress={() => shareText('Backup exemplo', exampleCharacterBackupJson())} />

      {lastMessage ? <Card title="Última ação" subtitle={lastMessage} /> : null}

      <Card title="Uso recomendado" subtitle="Instale os exemplos em um app limpo ou exporte um backup antes de substituir dados.">
        <Text>
          Os exemplos são homebrew/fictícios e servem para regressão de engine, demonstração de UX, validação de importação e testes manuais em mesa.
        </Text>
      </Card>
    </Screen>
  );
}
