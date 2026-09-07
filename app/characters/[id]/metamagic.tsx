import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import {
  getCharacterMetamagicSources,
  setClassMetamagicOptions
} from '../../../src/characters/metamagicRules';
import { useAppTheme } from '../../../src/theme';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default function MetamagicScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const session = useCharacterProgressionSession(id);
  const character = session.character;
  const { items } = useCharacterChoiceBridge();

  if (!character || !id) return <Screen title="Metamagic"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const sources = getCharacterMetamagicSources(character, items);

  const toggleSorcererOption = (sourceId: string, optionId: string) => {
    const source = sources.find((entry) => entry.id === sourceId && entry.kind === 'sorcerer');
    if (!source) return;
    const selected = source.selectedOptionIds;
    const nextIds = selected.includes(optionId)
      ? selected.filter((idValue) => idValue !== optionId)
      : selected.length < source.optionLimit
        ? [...selected, optionId]
        : selected;

    session.updateCharacter(character.id, (current) => {
      if (!current.buildChoices) return current;
      return reconcileCharacterBuild({
        ...current,
        buildChoices: {
          ...current.buildChoices,
          classMetamagicChoices: setClassMetamagicOptions(
            current.buildChoices.classMetamagicChoices,
            source,
            nextIds
          )
        }
      }, items).character;
    });
  };

  return (
    <Screen title="Metamagic" subtitle="Configure cada fonte separadamente. O combate tático oferece somente as opções realmente conhecidas pelo personagem e gasta o pool correspondente.">
      {sources.length ? sources.map((source) => (
        <Card
          key={source.id}
          variant={source.kind === 'sorcerer' ? 'filled' : 'outlined'}
          title={source.label}
          subtitle={`${source.description} Disponíveis: ${source.availableOptions.length} · Selecionadas: ${source.selectedOptionIds.length}/${source.optionLimit}.`}
        >
          {source.kind === 'sorcerer' ? (
            <View style={{ gap: 8 }}>
              {source.availableOptions.map((option) => {
                const selected = source.selectedOptionIds.includes(option.id);
                const disabled = !selected && source.selectedOptionIds.length >= source.optionLimit;
                return (
                  <View key={`${source.id}:${option.id}`} style={{ gap: 4 }}>
                    <Button
                      label={`${selected ? '✓ ' : ''}${option.name} · ${option.sorceryPointCost ?? 0} SP`}
                      variant={selected ? 'tonal' : 'outlined'}
                      disabled={disabled}
                      onPress={() => toggleSorcererOption(source.id, option.id)}
                    />
                    <Text style={{ color: colors.onSurfaceVariant }}>{option.summary}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <>
              <Text style={{ color: colors.onSurfaceVariant }}>
                {source.selectedOptionIds.length
                  ? `Escolhas do feat: ${source.selectedOptionIds.map((optionId) => source.availableOptions.find((option) => option.id === optionId)?.name ?? optionId).join(', ')}`
                  : 'As duas opções do feat ainda precisam ser selecionadas.'}
              </Text>
              <Button
                label={source.selectedOptionIds.length === source.optionLimit ? 'Alterar escolhas do feat' : 'Selecionar escolhas do feat'}
                variant="outlined"
                onPress={() => router.push(`/characters/${character.id}/feats?editFeatId=${encodeURIComponent(source.featEntityId ?? '')}`)}
              />
            </>
          )}
        </Card>
      )) : (
        <Card title="Nenhuma fonte de Metamagic" subtitle="Este personagem não possui Metamagic de Sorcerer nem Metamagic Adept configurável." />
      )}
      <Button label="Voltar" variant="outlined" onPress={() => router.back()} />
    </Screen>
  );
}
