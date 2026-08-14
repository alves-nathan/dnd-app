import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Field } from '../../../src/components/Field';
import { Button } from '../../../src/components/Button';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useBuildPresetStore } from '../../../src/store/buildPresetStore';
import { summarizeBuildPreset } from '../../../src/presets/buildPresets';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const parseTags = (value: string): string[] => value.split(',').map((entry) => entry.trim()).filter(Boolean);

export default function CharacterPresetsScreen() {
  const { id: idParam } = useLocalSearchParams();
  const id = getId(idParam);
  const character = useCharacterStore((state) => state.characters.find((entry) => entry.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const presets = useBuildPresetStore((state) => state.presets);
  const createFromCharacter = useBuildPresetStore((state) => state.createFromCharacter);
  const removePreset = useBuildPresetStore((state) => state.removePreset);
  const applyPreset = useBuildPresetStore((state) => state.applyPreset);

  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [presetTags, setPresetTags] = useState('');
  const [search, setSearch] = useState('');
  const [includeRotations, setIncludeRotations] = useState(true);
  const [includeEquipment, setIncludeEquipment] = useState(true);
  const [includeResources, setIncludeResources] = useState(true);

  const filteredPresets = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return presets;
    return presets.filter((preset) => [preset.name, preset.description ?? '', preset.sourceCharacterName ?? '', ...preset.tags].join(' ').toLowerCase().includes(normalized));
  }, [presets, search]);

  if (!character) {
    return (
      <Screen title="Personagem não encontrado">
        <Button label="Voltar" secondary onPress={() => router.back()} />
      </Screen>
    );
  }

  const handleCreatePreset = () => {
    const preset = createFromCharacter(character, presetName, presetDescription, parseTags(presetTags));
    setPresetName('');
    setPresetDescription('');
    setPresetTags('');
    Alert.alert('Preset criado', `${preset.name} foi salvo localmente.`);
  };

  const handleApplyPreset = (presetId: string, mode: 'merge' | 'replaceBuild') => {
    const nextCharacter = applyPreset(character, presetId, { mode, includeRotations, includeEquipment, includeResources });
    if (!nextCharacter) {
      Alert.alert('Preset não encontrado', 'Esse preset pode ter sido removido.');
      return;
    }
    updateCharacter(character.id, () => nextCharacter);
    Alert.alert('Preset aplicado', mode === 'merge' ? 'O preset foi mesclado à ficha.' : 'O build da ficha foi substituído pelo preset.');
  };

  return (
    <Screen title="Presets de build" subtitle="Salve builds reutilizáveis e aplique-as em fichas sem reimportar todo o compêndio.">
      <Card title="Criar preset desta ficha" subtitle="O preset salva entidades aplicadas, links do compêndio, rotações e recursos conforme a ficha atual.">
        <Field label="Nome do preset" value={presetName} onChangeText={setPresetName} placeholder={`${getCharacterDisplayName(character)} build`} />
        <Field label="Descrição" value={presetDescription} onChangeText={setPresetDescription} multiline style={styles.textarea} placeholder="Ex.: Bladelock nível 5 com rotação Hex + ataques." />
        <Field label="Tags" value={presetTags} onChangeText={setPresetTags} placeholder="warlock, blade, dpr" autoCapitalize="none" />
        <Button label="Salvar preset" onPress={handleCreatePreset} />
      </Card>

      <Card title="Opções ao aplicar" subtitle="Afetam tanto mesclagem quanto substituição do build.">
        <Button label={includeRotations ? 'Incluir rotações: sim' : 'Incluir rotações: não'} secondary onPress={() => setIncludeRotations((value) => !value)} />
        <Button label={includeEquipment ? 'Incluir equipamento: sim' : 'Incluir equipamento: não'} secondary onPress={() => setIncludeEquipment((value) => !value)} />
        <Button label={includeResources ? 'Incluir recursos: sim' : 'Incluir recursos: não'} secondary onPress={() => setIncludeResources((value) => !value)} />
      </Card>

      <Card title="Presets salvos" subtitle={`${filteredPresets.length} preset(s) exibidos.`}>
        <Field label="Buscar preset" value={search} onChangeText={setSearch} placeholder="classe, tag, personagem de origem..." />
        {filteredPresets.length === 0 ? <Text style={styles.muted}>Nenhum preset encontrado.</Text> : null}
        {filteredPresets.map((preset) => (
          <View key={preset.id} style={styles.presetBox}>
            <Text style={styles.bold}>{preset.name}</Text>
            <Text style={styles.muted}>{summarizeBuildPreset(preset)}</Text>
            {preset.description ? <Text style={styles.summary}>{preset.description}</Text> : null}
            {preset.tags.length ? <Text style={styles.muted}>Tags: {preset.tags.join(', ')}</Text> : null}
            <Text style={styles.muted}>Origem: {preset.sourceCharacterName ?? 'manual'} · atualizado {preset.updatedAt}</Text>
            <View style={styles.actions}>
              <Button label="Mesclar" secondary onPress={() => handleApplyPreset(preset.id, 'merge')} />
              <Button label="Substituir build" secondary onPress={() => handleApplyPreset(preset.id, 'replaceBuild')} />
              <Button label="Remover" secondary onPress={() => removePreset(preset.id)} />
            </View>
          </View>
        ))}
      </Card>

      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  presetBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 6 },
  bold: { fontWeight: '800', color: '#111827' },
  muted: { color: '#64748b', lineHeight: 19 },
  summary: { color: '#334155', lineHeight: 20 },
  actions: { gap: 6 }
});
