import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { useCharacterProgressionSession } from '../../../src/characters/useCharacterProgressionSession';
import { reconcileCharacterBuild } from '../../../src/characters/buildReconciliation';
import { describeCustomModifier } from '../../../src/characters/customModifierRules';
import { getSelectedSpeciesFeatureChoice } from '../../../src/characters/speciesChoiceRules';
import { getCharacterMetamagicSources } from '../../../src/characters/metamagicRules';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import type { Character, Feature } from '../../../src/types';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function FeaturesScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const progressionSession = useCharacterProgressionSession(id);
  const character = progressionSession.character;
  const updateCharacter = progressionSession.updateCharacter;
  const { items } = useCharacterChoiceBridge();
  const metamagicSources = character ? getCharacterMetamagicSources(character, items) : [];
  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const removeCustomFeature = (feature: Feature) => Alert.alert(
    'Remover feature personalizada?',
    feature.name,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => updateCharacter(id, (current) => {
          const resourceIds = new Set((feature.customRules?.spellReplacement ?? []).map((rule) => rule.resourceId));
          const next: Character = {
            ...current,
            features: current.features.filter((entry) => entry.id !== feature.id),
            resources: current.resources.filter((resource) => !resourceIds.has(resource.id))
          };
          return reconcileCharacterBuild(next, items).character;
        })
      }
    ]
  );

  return (
    <Screen title="Recursos especiais" subtitle="Features oficiais e homebrew podem conceder magias, recursos por descanso e modificadores estruturados para a engine.">
      <Card variant="hero" title="Adicionar feature">
        <Button label="Procurar features no compêndio" onPress={() => router.push(`/characters/${character.id}/compendium?type=feature`)} />
        <Button label="Criar feature personalizada" secondary onPress={() => router.push(`/characters/${character.id}/custom-rule?kind=feature`)} />
      </Card>

      {character.features.length ? character.features.map((feature) => {
        const damageRules = feature.customRules?.damageMultipliers ?? [];
        const triggerRules = feature.customRules?.triggeredDamage ?? [];
        const replacementRules = feature.customRules?.spellReplacement ?? [];
        const listAdditionRules = feature.customRules?.spellListAdditions ?? [];
        const structuredModifiers = feature.customRules?.modifiers ?? [];
        const grantedSpells = character.spells.filter((spell) => spell.grantedByFeatureEntityId === feature.id || (spell.externalSpellGrantSources ?? []).some((source) => source.kind === 'feature' && source.sourceEntityId === feature.id));
        const selectedSpeciesChoice = getSelectedSpeciesFeatureChoice(character, items, feature.id);
        const metamagicSource = metamagicSources.find((source) => source.kind === 'sorcerer' && source.featureEntityId === feature.id);
        return (
          <Card key={feature.id} title={feature.name} subtitle={`${feature.custom ? 'Personalizada' : feature.source?.book ?? feature.sourceType} · ${feature.summary ?? 'Feature sem resumo.'}`}>
            <Text style={{ color: colors.onSurfaceVariant }}>Custo: {feature.actionCost ?? 'passivo/configurável'} · Fonte: {feature.sourceType}</Text>
            {selectedSpeciesChoice ? <Text style={{ color: colors.primary, fontWeight: '800' }}>Escolha ativa: {selectedSpeciesChoice.option.label}</Text> : null}
            {selectedSpeciesChoice?.description ? <Text style={{ color: colors.onSurfaceVariant }}>{selectedSpeciesChoice.description}</Text> : null}
            {selectedSpeciesChoice ? <Button label={`Alterar escolha de ${feature.name}`} variant="outlined" onPress={() => router.push(`/characters/${character.id}/identity`)} /> : null}
            {metamagicSource ? <Text style={{ color: colors.primary, fontWeight: '800' }}>Metamagic selecionado: {metamagicSource.selectedOptionIds.length}/{metamagicSource.optionLimit}</Text> : null}
            {metamagicSource ? <Button label="Configurar Metamagic do Sorcerer" variant="outlined" onPress={() => router.push(`/characters/${character.id}/metamagic`)} /> : null}
            {damageRules.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Dano {rule.damageType}: ×{rule.multiplier}</Text>)}
            {triggerRules.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Ao causar {rule.triggerDamageType}: {rule.triggerRoll.count}d{rule.triggerRoll.sides}, dispara em {rule.triggerValues.join('/')} {rule.radiusFeet ? `· raio ${rule.radiusFeet} ft` : ''} {rule.saveAbility ? `· save ${rule.saveAbility}` : ''}</Text>)}
            {replacementRules.map((rule) => {
              const resource = character.resources.find((entry) => entry.id === rule.resourceId);
              return <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Troca de magia: {resource?.current ?? 0}/{resource?.max ?? rule.count} · {rule.recharge}</Text>;
            })}
            {listAdditionRules.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• Lista de magia expandida: {rule.spellItemIds.length} magia(s){rule.classNames?.length ? ` · ${rule.classNames.join(', ')}` : ' · qualquer classe conjuradora'}</Text>)}
            {structuredModifiers.map((rule) => <Text key={rule.id} style={{ color: colors.onSurfaceVariant }}>• {describeCustomModifier(rule)}</Text>)}
            {grantedSpells.length ? <Text style={{ color: colors.onSurfaceVariant }}>• Magias concedidas: {grantedSpells.map((spell) => spell.name).join(', ')}</Text> : null}
            {feature.custom ? <Button label="Remover feature personalizada" variant="text" onPress={() => removeCustomFeature(feature)} /> : null}
          </Card>
        );
      }) : <Card title="Nenhum recurso especial" subtitle="Recursos podem ser adicionados manualmente ou via compêndio." />}
      <Button label="Recursos e descanso" onPress={() => router.push(`/characters/${character.id}/resources`)} />
      <Button label="Voltar" secondary onPress={() => router.back()} />
    </Screen>
  );
}
