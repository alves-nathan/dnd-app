import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Field } from '../../../src/components/Field';
import { Button } from '../../../src/components/Button';
import { IssueList } from '../../../src/components/IssueList';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import {
  applyMechanicPresetToCharacter,
  createMechanicPresetDraft,
  getMechanicPresetBlueprint,
  MechanicPresetDraft,
  mechanicPresetBlueprints
} from '../../../src/presets/mechanicPresets';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function MechanicPresetsScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((entry) => entry.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const [draft, setDraft] = useState<MechanicPresetDraft>(() => createMechanicPresetDraft(mechanicPresetBlueprints[0].id));
  const [lastSummary, setLastSummary] = useState<string[]>([]);
  const [lastIssues, setLastIssues] = useState<ReturnType<typeof applyMechanicPresetToCharacter>['issues']>([]);

  const blueprint = useMemo(() => getMechanicPresetBlueprint(draft.blueprintId) ?? mechanicPresetBlueprints[0], [draft.blueprintId]);

  if (!character || !id) {
    return (
      <Screen title="Personagem não encontrado">
        <Button label="Voltar" secondary onPress={() => router.back()} />
      </Screen>
    );
  }

  const selectBlueprint = (blueprintId: string) => {
    setDraft(createMechanicPresetDraft(blueprintId));
    setLastSummary([]);
    setLastIssues([]);
  };

  const updateValue = (key: string, value: string) => {
    setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }));
  };

  const applyPreset = () => {
    const result = applyMechanicPresetToCharacter(character, draft);
    setLastSummary(result.summary);
    setLastIssues(result.issues);
    const hasError = result.issues.some((issue) => issue.severity === 'error');
    if (hasError) {
      Alert.alert('Preset não aplicado', 'Corrija os erros antes de aplicar o preset.');
      return;
    }
    updateCharacter(character.id, () => result.character);
    Alert.alert('Preset aplicado', result.summary.join('\n'));
  };

  return (
    <Screen title="Assistente de presets mecânicos" subtitle="Crie blocos configuráveis para dano condicional, recursos, buffs/debuffs e economia de ação sem embutir regras oficiais.">
      <Card title="Escolha o padrão" subtitle="Cada preset cria entidades auditáveis na ficha. Os valores vêm do que você preencher manualmente.">
        {mechanicPresetBlueprints.map((entry) => (
          <View key={entry.id} style={styles.blueprintBox}>
            <Text style={styles.bold}>{entry.name}</Text>
            <Text style={styles.muted}>{entry.description}</Text>
            <Text style={styles.muted}>Exemplos de uso: {entry.examples.join(', ')}</Text>
            <Button label={entry.id === blueprint.id ? 'Selecionado' : 'Selecionar'} disabled={entry.id === blueprint.id} secondary={entry.id !== blueprint.id} onPress={() => selectBlueprint(entry.id)} />
          </View>
        ))}
      </Card>

      <Card title={blueprint.name} subtitle={blueprint.caution}>
        <StatRow label="Categoria" value={blueprint.category} />
        {blueprint.fields.map((field) => (
          <View key={field.key} style={styles.fieldBox}>
            <Field
              label={`${field.label}${field.required ? ' *' : ''}`}
              value={draft.values[field.key] ?? ''}
              onChangeText={(value) => updateValue(field.key, value)}
              placeholder={field.placeholder || (field.options ? field.options.join(' | ') : undefined)}
              multiline={field.kind === 'textarea'}
              style={field.kind === 'textarea' ? styles.textarea : undefined}
              autoCapitalize="none"
            />
            {field.kind === 'select' && field.options?.length ? <Text style={styles.helper}>Opções: {field.options.join(', ')}</Text> : null}
            {field.kind === 'boolean' ? <Text style={styles.helper}>Aceita: sim/não, true/false, 1/0.</Text> : null}
            {field.helper ? <Text style={styles.helper}>{field.helper}</Text> : null}
          </View>
        ))}
        <Button label="Aplicar preset na ficha" onPress={applyPreset} />
      </Card>

      <Card title="O que será criado" subtitle="Resumo conceitual do preset selecionado.">
        <Text style={styles.summary}>• Uma feature manual com metadados de revisão.</Text>
        <Text style={styles.summary}>• Opcionalmente, um recurso limitado para gasto/descanso.</Text>
        <Text style={styles.summary}>• Opcionalmente, uma ação especial para usar em rotações.</Text>
        <Text style={styles.summary}>• Opcionalmente, um template de efeito ativo que pode ligar condições ao cálculo de dano.</Text>
      </Card>

      {lastSummary.length || lastIssues.length ? (
        <Card title="Última aplicação">
          {lastSummary.map((line) => <Text key={line} style={styles.summary}>• {line}</Text>)}
          <IssueList issues={lastIssues} />
        </Card>
      ) : null}

      <Card title="Observação de regras" subtitle="Este assistente não decide interpretação de regras. Ele só cria estruturas configuráveis que você deve revisar contra seus livros/importações legais." />
      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  blueprintBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 10, gap: 6 },
  fieldBox: { gap: 4 },
  bold: { color: '#111827', fontWeight: '800' },
  muted: { color: '#64748b', lineHeight: 19 },
  helper: { color: '#64748b', fontSize: 12, lineHeight: 18 },
  summary: { color: '#334155', lineHeight: 20 },
  textarea: { minHeight: 90, textAlignVertical: 'top' }
});
