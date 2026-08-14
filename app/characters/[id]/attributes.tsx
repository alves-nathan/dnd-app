import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Field } from '../../../src/components/Field';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import {
  ABILITY_ORDER,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  abilityScoresFromValues,
  areGeneratedAbilitiesFullyAssigned,
  emptyAbilityScores,
  inferGeneratedAbilityAssignments,
  isGeneratedValueAssignedElsewhere,
  isValidPointBuy,
  pointBuySpent,
  pointBuyState,
  rollAbilitySet,
  standardArrayState,
  toggleGeneratedAbilityAssignment,
  type GeneratedAbilityAssignments
} from '../../../src/characters/abilityGeneration';
import { useCharacterStore } from '../../../src/store/characterStore';
import type { AbilityGenerationMethod, AbilityGenerationState, AbilityScore, AbilityScores } from '../../../src/types';
import { getAbilityModifier } from '../../../src/rules-engine/characters/derivedStats';
import { useAppTheme } from '../../../src/theme';
import { getCharacterDisplayName } from '../../../src/ui/characterIdentity';

const getId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default function AttributesScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((entry) => entry.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const storedBonuses = character?.abilityScoreBonuses ?? {};
  const initialBonusAbilities = ABILITY_ORDER
    .filter((ability) => (storedBonuses[ability] ?? 0) > 0)
    .sort((left, right) => (storedBonuses[right] ?? 0) - (storedBonuses[left] ?? 0));
  const initialBase = character
    ? ABILITY_ORDER.reduce((result, ability) => ({
        ...result,
        [ability]: Math.max(1, character.abilities[ability] - (storedBonuses[ability] ?? 0))
      }), {} as AbilityScores)
    : abilityScoresFromValues([...STANDARD_ARRAY]);
  const initialMethod = character?.abilityGeneration?.method ?? 'manual';
  const storedGeneration = character?.abilityGeneration ?? {
    method: 'manual' as const,
    generatedValues: ABILITY_ORDER.map((ability) => initialBase[ability])
  };
  const initialGeneration: AbilityGenerationState = storedGeneration.method === 'standardArray'
    ? { ...storedGeneration, generatedValues: [...STANDARD_ARRAY] }
    : storedGeneration.method === 'diceRoll' && storedGeneration.diceRolls?.length === ABILITY_ORDER.length
      ? { ...storedGeneration, generatedValues: storedGeneration.diceRolls.map((roll) => roll.total) }
      : storedGeneration;

  const [bonusMode, setBonusMode] = useState<'twoOne' | 'threeOnes'>(
    initialBonusAbilities.length >= 3 && initialBonusAbilities.every((ability) => storedBonuses[ability] === 1)
      ? 'threeOnes'
      : 'twoOne'
  );
  const [bonusAbilities, setBonusAbilities] = useState<AbilityScore[]>(initialBonusAbilities.length ? initialBonusAbilities : ['STR', 'DEX']);
  const [method, setMethod] = useState<AbilityGenerationMethod>(initialMethod);
  const [generation, setGeneration] = useState<AbilityGenerationState>(initialGeneration);
  const [values, setValues] = useState<AbilityScores>(initialBase);
  const [abilityValueAssignments, setAbilityValueAssignments] = useState<GeneratedAbilityAssignments>(() =>
    initialMethod === 'standardArray' || initialMethod === 'diceRoll'
      ? inferGeneratedAbilityAssignments(initialGeneration.generatedValues, initialBase)
      : {}
  );

  const bonuses = useMemo<Partial<Record<AbilityScore, number>>>(() => {
    const next: Partial<Record<AbilityScore, number>> = {};
    if (bonusMode === 'twoOne') {
      if (bonusAbilities[0]) next[bonusAbilities[0]] = 2;
      if (bonusAbilities[1] && bonusAbilities[1] !== bonusAbilities[0]) next[bonusAbilities[1]] = 1;
    } else {
      for (const ability of bonusAbilities.slice(0, 3)) next[ability] = 1;
    }
    return next;
  }, [bonusAbilities, bonusMode]);

  if (!character || !id) return <Screen title="Não encontrado" onBack={() => router.back()} />;

  const changeMethod = (next: AbilityGenerationMethod) => {
    setMethod(next);
    const state = next === 'standardArray'
      ? standardArrayState()
      : next === 'pointBuy'
        ? pointBuyState()
        : next === 'diceRoll'
          ? rollAbilitySet()
          : { method: 'manual' as const, generatedValues: ABILITY_ORDER.map((ability) => values[ability]) };
    setGeneration(state);
    setAbilityValueAssignments({});
    setValues(next === 'standardArray' || next === 'diceRoll' ? emptyAbilityScores() : abilityScoresFromValues(state.generatedValues));
  };

  const assignGeneratedValue = (ability: AbilityScore, valueIndex: number) => {
    if (isGeneratedValueAssignedElsewhere(abilityValueAssignments, ability, valueIndex)) return;
    const wasSelected = abilityValueAssignments[ability] === valueIndex;
    setAbilityValueAssignments((current) => toggleGeneratedAbilityAssignment(current, ability, valueIndex));
    setValues((current) => ({
      ...current,
      [ability]: wasSelected ? 10 : (generation.generatedValues[valueIndex] ?? 10)
    }));
  };

  const generatedMode = method === 'standardArray' || method === 'diceRoll';
  const generatedAssignmentsComplete = !generatedMode || areGeneratedAbilitiesFullyAssigned(abilityValueAssignments, generation.generatedValues);
  const finalValues = ABILITY_ORDER.reduce((result, ability) => ({
    ...result,
    [ability]: Math.min(20, values[ability] + (bonuses[ability] ?? 0))
  }), {} as AbilityScores);
  const valid = (method !== 'pointBuy' || isValidPointBuy(values)) && generatedAssignmentsComplete;

  return (
    <Screen eyebrow={getCharacterDisplayName(character)} title="Atributos" subtitle="Refaça Standard Array, Point Buy, 4d6 ou ajuste manualmente." onBack={() => router.back()}>
      <View style={styles.chips}>
        <Chip label="Standard Array" selected={method === 'standardArray'} onPress={() => changeMethod('standardArray')} />
        <Chip label="Point Buy" selected={method === 'pointBuy'} onPress={() => changeMethod('pointBuy')} />
        <Chip label="4d6" selected={method === 'diceRoll'} onPress={() => changeMethod('diceRoll')} />
        <Chip label="Manual" selected={method === 'manual'} onPress={() => changeMethod('manual')} />
      </View>

      {method === 'diceRoll' ? <Button label="Rolar novamente" secondary onPress={() => changeMethod('diceRoll')} /> : null}
      {method === 'pointBuy' ? <Text style={{ color: valid ? colors.onSurfaceVariant : colors.error }}>Pontos usados: {pointBuySpent(values)}/{POINT_BUY_BUDGET}</Text> : null}
      {method === 'standardArray' ? (
        <Card variant="outlined" title="Valores disponíveis" subtitle="Atribua cada valor uma única vez.">
          <Text style={{ color: colors.onSurfaceVariant }}>{generation.generatedValues.join(' · ')}</Text>
        </Card>
      ) : null}
      {method === 'diceRoll' ? (
        <Card variant="outlined" title="Resultados da rolagem" subtitle="Cada resultado pode ser atribuído a um único atributo.">
          {(generation.diceRolls ?? []).map((roll, index) => (
            <Text key={`roll-${index}`} style={{ color: colors.onSurfaceVariant }}>
              Rolagem {index + 1}: {roll.rolls.join(', ')} · descarta {roll.discarded} · total {roll.total}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card variant="hero" title="Aumento de atributo da origem" subtitle="A sugestão do background pode ser substituída sem trocar o background.">
        <View style={styles.chips}>
          <Chip label="+2/+1" selected={bonusMode === 'twoOne'} onPress={() => { setBonusMode('twoOne'); setBonusAbilities((current) => current.length >= 2 ? current.slice(0, 2) : ['STR', 'DEX']); }} />
          <Chip label="+1/+1/+1" selected={bonusMode === 'threeOnes'} onPress={() => { setBonusMode('threeOnes'); setBonusAbilities((current) => current.length >= 3 ? current.slice(0, 3) : ['STR', 'DEX', 'CON']); }} />
        </View>
        <View style={styles.chips}>
          {ABILITY_ORDER.map((ability) => {
            const selected = bonusAbilities.includes(ability);
            const max = bonusMode === 'twoOne' ? 2 : 3;
            return (
              <Chip
                key={ability}
                label={`${ability}${selected ? ` +${bonuses[ability] ?? 0}` : ''}`}
                selected={selected}
                onPress={() => setBonusAbilities((current) => current.includes(ability) ? current.filter((entry) => entry !== ability) : [...current.slice(-(max - 1)), ability])}
              />
            );
          })}
        </View>
      </Card>

      {ABILITY_ORDER.map((ability) => {
        const selectedIndex = abilityValueAssignments[ability];
        const hasGeneratedValue = generatedMode && typeof selectedIndex === 'number';
        const finalLabel = generatedMode && !hasGeneratedValue ? '—' : String(finalValues[ability]);
        const baseLabel = generatedMode && !hasGeneratedValue ? '—' : String(values[ability]);
        const modifierLabel = generatedMode && !hasGeneratedValue
          ? '—'
          : `${getAbilityModifier(finalValues, ability) >= 0 ? '+' : ''}${getAbilityModifier(finalValues, ability)}`;
        return (
          <Card key={ability} variant="filled" title={`${ability} · final ${finalLabel}`} subtitle={`Base ${baseLabel} + origem ${bonuses[ability] ?? 0} · modificador ${modifierLabel}`}>
            {generatedMode ? (
              <View style={styles.chips}>
                {generation.generatedValues.map((value, index) => {
                  const selected = selectedIndex === index;
                  const unavailable = isGeneratedValueAssignedElsewhere(abilityValueAssignments, ability, index);
                  return (
                    <Chip
                      key={`${value}-${index}`}
                      label={method === 'diceRoll' ? `#${index + 1} · ${value}` : String(value)}
                      selected={selected}
                      disabled={unavailable}
                      accessibilityHint={selected ? 'Toque novamente para remover este valor.' : unavailable ? 'Este valor já está em outro atributo.' : undefined}
                      onPress={() => assignGeneratedValue(ability, index)}
                    />
                  );
                })}
              </View>
            ) : (
              <Field
                label="Valor base"
                keyboardType="number-pad"
                value={String(values[ability])}
                onChangeText={(text) => setValues((current) => ({ ...current, [ability]: Math.max(1, Math.min(20, Number(text) || 0)) }))}
              />
            )}
          </Card>
        );
      })}

      {generatedMode && !generatedAssignmentsComplete ? (
        <Text style={{ color: colors.error }}>Atribua os seis valores antes de salvar. Tocar novamente em um valor selecionado desfaz a escolha.</Text>
      ) : null}

      <Button
        label="Salvar atributos"
        disabled={!valid}
        onPress={() => {
          updateCharacter(id, (current) => ({
            ...current,
            abilities: finalValues,
            abilityScoreBonuses: bonuses,
            abilityGeneration: {
              ...generation,
              method,
              generatedValues: generatedMode ? [...generation.generatedValues] : ABILITY_ORDER.map((ability) => values[ability]),
              pointBuyBudget: method === 'pointBuy' ? POINT_BUY_BUDGET : generation.pointBuyBudget,
              pointBuySpent: method === 'pointBuy' ? pointBuySpent(values) : generation.pointBuySpent
            }
          }));
          router.back();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
});
