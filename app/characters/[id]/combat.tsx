import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { StatRow } from '../../../src/components/StatRow';
import { IssueList } from '../../../src/components/IssueList';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { buildAvailableActionsResult } from '../../../src/rules-engine/actions/buildActions';
import { analyzeActionDamage } from '../../../src/rules-engine/damage/calculateDamage';
import { defaultCombatState } from '../../../src/data/mockData';
import { spellSlotLabel } from '../../../src/rules-engine/resources/spellSlotManager';
import { activeEffectConditionIds, buildCombatStateWithActiveEffects, getActiveConcentrationEffect } from '../../../src/rules-engine/effects/activeEffects';
import { hasPactOfTheBlade, validatePactWeaponChoice } from '../../../src/characters/pactWeaponRules';
import { reconcileCharacterHitDice, useLifedrinkerHealing } from '../../../src/characters/hitDiceRules';
import { getActiveLoadout, validateEquipmentLoadout } from '../../../src/characters/equipmentLoadoutRules';
import { ammunitionCount } from '../../../src/characters/ammunitionRules';
import { getArmorClass } from '../../../src/rules-engine/characters/derivedStats';
import type { CombatState, CoverLevel, CreatureSize } from '../../../src/types';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function CombatScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const { items: compendiumItems } = useCharacterChoiceBridge();
  const [targetAC, setTargetAC] = useState('15');
  const [distance, setDistance] = useState('5');
  const [targetCount, setTargetCount] = useState('1');
  const [targetSize, setTargetSize] = useState<CreatureSize>('Medium');
  const [cover, setCover] = useState<CoverLevel>('none');
  const [lineOfSight, setLineOfSight] = useState(true);
  const [adjacentSecondaryTarget, setAdjacentSecondaryTarget] = useState(false);


  if (!character) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const { actions, issues } = buildAvailableActionsResult(character);
  const combatState = useMemo<CombatState>(() => buildCombatStateWithActiveEffects(character, {
    ...defaultCombatState,
    targetAC: Number(targetAC) || undefined,
    targetDistanceFeet: Math.max(0, Number(distance) || 0),
    targetCount: Math.max(1, Number(targetCount) || 1),
    targetSize,
    cover,
    lineOfSight,
    adjacentSecondaryTarget
  }), [character, targetAC, distance, targetCount, targetSize, cover, lineOfSight, adjacentSecondaryTarget]);
  const concentrationEffect = getActiveConcentrationEffect(character);
  const activeConditions = activeEffectConditionIds(character);
  const pactOfTheBlade = hasPactOfTheBlade(character, compendiumItems);
  const pactWeapon = character.weapons.find((weapon) => weapon.id === character.buildChoices?.pactWeapon?.weaponEntityId);
  const pactWeaponIssues = pactOfTheBlade ? validatePactWeaponChoice(character, compendiumItems) : [];
  const lifedrinker = character.features.some((feature) => feature.name.trim().toLowerCase() === 'lifedrinker');
  const hitDice = reconcileCharacterHitDice(character).hitDice ?? [];
  const loadout = getActiveLoadout(character);
  const loadoutIssues = validateEquipmentLoadout(character);
  const ammoTypes = Array.from(new Set(actions.filter((action) => action.type === 'attack' && action.ammunitionType).map((action) => action.type === 'attack' ? action.ammunitionType : undefined).filter((entry): entry is string => Boolean(entry))));

  const activateLifedrinkerHealing = (poolId: string) => {
    const result = useLifedrinkerHealing({ character, hitDiePoolId: poolId });
    if (!result.ok) {
      Alert.alert('Lifedrinker indisponível', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateCharacter(character.id, () => result.character);
    Alert.alert('Cura de Lifedrinker', `Rolagem: ${result.dieRoll} + CON. Cura calculada: ${result.amount} PV.${character.hitPoints?.max ? '' : '\nA ficha ainda não possui PV máximo definido; o valor foi registrado no histórico.'}`);
  };

  return (
    <Screen title="Combate" subtitle="Cálculos usam o loadout ativo, munição, distância, cobertura e Weapon Mastery.">
      <Card variant="hero" title="Loadout de combate" subtitle="Troque armadura, escudo e armas na tela de equipamentos.">
        <StatRow label="CA" value={getArmorClass(character)} />
        <StatRow label="Mão principal" value={character.weapons.find((entry) => entry.id === loadout.mainHandWeaponId)?.name ?? 'Livre'} />
        <StatRow label="Mão secundária" value={character.weapons.find((entry) => entry.id === loadout.offHandWeaponId)?.name ?? 'Livre/escudo'} />
        {ammoTypes.map((type) => <StatRow key={type} label={`Munição · ${type}`} value={ammunitionCount(character, type)} />)}
        {loadoutIssues.length ? <IssueList issues={loadoutIssues} /> : null}
        <Button label="Gerenciar loadout e munição" variant="outlined" onPress={() => router.push(`/characters/${character.id}/equipment`)} />
      </Card>

      <Card variant="filled" title="Alvo e posição" subtitle="Alcance longo aplica desvantagem; cobertura aumenta a CA; cobertura total ou falta de linha de visão bloqueiam o ataque.">
        <Field label="CA do alvo" value={targetAC} onChangeText={setTargetAC} keyboardType="number-pad" />
        <Field label="Distância em pés" value={distance} onChangeText={setDistance} keyboardType="number-pad" />
        <Field label="Quantidade de alvos" value={targetCount} onChangeText={setTargetCount} keyboardType="number-pad" />
        <Text style={{ fontWeight: '800' }}>Tamanho do alvo</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as CreatureSize[]).map((value) => (
            <Chip key={value} label={value} selected={targetSize === value} onPress={() => setTargetSize(value)} />
          ))}
        </View>
        <Text style={{ fontWeight: '800' }}>Cobertura</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([['none', 'Nenhuma'], ['half', 'Meia (+2 CA)'], ['threeQuarters', '3/4 (+5 CA)'], ['total', 'Total']] as Array<[CoverLevel, string]>).map(([value, label]) => <Chip key={value} label={label} selected={cover === value} onPress={() => setCover(value)} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="Linha de visão" selected={lineOfSight} onPress={() => setLineOfSight((current) => !current)} />
          <Chip label="Segundo alvo adjacente para Cleave" selected={adjacentSecondaryTarget} onPress={() => setAdjacentSecondaryTarget((current) => !current)} />
        </View>
      </Card>

      <Card title="Recursos disponíveis" subtitle="A engine valida rotações contra estes valores atuais.">
        {character.resources.length === 0 && (character.spellSlots ?? []).length === 0 ? <Text style={{ color: '#64748b' }}>Nenhum recurso limitado ou spell slot cadastrado.</Text> : null}
        {(character.spellSlots ?? []).map((slot) => <StatRow key={`slot-${slot.level}-${slot.poolKind}`} label={`Slot ${spellSlotLabel(slot.level)} · ${slot.poolKind ?? 'manual'}`} value={`${slot.current} / ${slot.max}`} />)}
        {character.resources.map((resource) => <StatRow key={resource.id} label={resource.name} value={`${resource.current} / ${resource.max}`} />)}
        <Button label="Gerenciar recursos e descanso" secondary onPress={() => router.push(`/characters/${character.id}/resources`)} />
      </Card>

      {pactOfTheBlade ? (
        <Card variant={pactWeapon ? 'hero' : 'filled'} title={pactWeapon ? `${pactWeapon.name} · Pact Weapon` : 'Pact Weapon pendente'} subtitle={pactWeapon ? `Usa Carisma · dano ${character.buildChoices?.pactWeapon?.damageType ?? 'normal'}${pactWeapon.magicBonus ? ` · bônus mágico +${pactWeapon.magicBonus}` : ''}` : 'Escolha ou invoque a arma usada por Pact of the Blade antes de calcular seus ataques.'}>
          {pactWeaponIssues.length ? <IssueList issues={pactWeaponIssues} /> : null}
          <Button label={pactWeapon ? 'Trocar ou reinvocar Pact Weapon' : 'Invocar Pact Weapon'} secondary onPress={() => router.push(`/characters/${character.id}/pact-weapon`)} />
        </Card>
      ) : null}

      {lifedrinker ? (
        <Card variant="filled" title="Cura de Lifedrinker" subtitle="Depois de acertar com a Pact Weapon, gaste um Hit Die para recuperar Hit Die + modificador de Constituição.">
          {character.hitPoints ? <StatRow label="PV atual" value={`${character.hitPoints.current} / ${character.hitPoints.max}${character.hitPoints.temporary ? ` (+${character.hitPoints.temporary} temporários)` : ''}`} /> : null}
          {hitDice.map((pool) => <View key={pool.id} style={{ gap: 6 }}><StatRow label={`${pool.className} d${pool.dieSides}`} value={`${pool.current} / ${pool.max}`} /><Button label={`Usar d${pool.dieSides} de ${pool.className}`} variant="outlined" disabled={pool.current <= 0 || !pactWeapon} onPress={() => activateLifedrinkerHealing(pool.id)} /></View>)}
        </Card>
      ) : null}

      <Card title="Efeitos ativos"><StatRow label="Concentração" value={concentrationEffect?.name ?? 'Nenhuma'} /><StatRow label="Condições" value={activeConditions.length ? activeConditions.join(', ') : 'Nenhuma'} /><Button label="Gerenciar efeitos" secondary onPress={() => router.push(`/characters/${character.id}/effects`)} /></Card>
      <IssueList issues={issues} />

      {actions.map((action) => {
        const result = analyzeActionDamage({ action, character, combatState });
        const origin = action.origin?.kind === 'compendiumLink' ? 'compêndio validado' : action.origin?.kind === 'featureGrant' ? 'feature' : action.origin?.kind ?? 'manual';
        return (
          <Card key={action.id} title={action.name} subtitle={`${action.actionCost} · ${action.type} · ${origin}`}>
            <StatRow label="Mínimo" value={result.total.min} />
            <StatRow label="Máximo" value={result.total.max} />
            <StatRow label="Média bruta" value={result.total.average} />
            <StatRow label="Média ponderada por acerto" value={result.weightedAverage === undefined ? '—' : result.weightedAverage.toFixed(2)} />
            <StatRow label="Crítico médio por acerto" value={result.critical.average} />
            {result.ammunitionConsumed?.map((cost) => <StatRow key={`${action.id}-${cost.type}`} label={`Munição por uso · ${cost.type}`} value={cost.amount} />)}
            <View style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', marginTop: 8, paddingTop: 8 }}>
              <Text style={{ fontWeight: '800', color: '#334155' }}>Separação de dano</Text>
              <StatRow label="Dependente de acerto" value={result.hitDependent.average} />
              <StatRow label="Garantido" value={result.guaranteed.average} />
              <StatRow label="Condicionado" value={result.conditioned.average} />
              <StatRow label="Save/mitigação" value={result.saveDependent.average} />
            </View>
            <IssueList issues={result.warnings} />
            {result.masteryEffects?.map((note, index) => <Text key={`${action.id}-mastery-${index}`} style={{ color: '#7c3aed' }}>• {note}</Text>)}
            {action.ruleNotes?.map((note, index) => <Text key={`${action.id}-note-${index}`} style={{ color: '#64748b' }}>• {note}</Text>)}
            <Text style={{ color: '#64748b' }}>Fonte: {result.sourceType}</Text>
          </Card>
        );
      })}
      <Button label="Criar rotação" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
      <Button label="Analisar rotações" secondary onPress={() => router.push(`/characters/${character.id}/analysis`)} />
      <Button label="Combate tático e alvos persistentes" secondary onPress={() => router.push(`/characters/${character.id}/tactical`)} />
      <Button label="Comparar cenários" secondary onPress={() => router.push(`/characters/${character.id}/comparison`)} />
    </Screen>
  );
}
