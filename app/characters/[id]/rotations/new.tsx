import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../../src/components/Screen';
import { Field } from '../../../../src/components/Field';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { Chip } from '../../../../src/components/Chip';
import { useCharacterStore } from '../../../../src/store/characterStore';
import { useCombatScenarioStore } from '../../../../src/store/combatScenarioStore';
import { buildAvailableActions } from '../../../../src/rules-engine/actions/buildActions';
import type { CharacterAction, DamageCondition, TacticalMovement, TurnAction, TurnRotation, WeaponInteractionKind, WeaponInteractionTiming } from '../../../../src/types';
import { createId } from '../../../../src/utils/id';
import { isSpellSlotLevel, spellSlotLabel, toSpellSlotLevel } from '../../../../src/rules-engine/resources/spellSlotManager';
import { getActiveLoadout, isWeaponEquipped } from '../../../../src/characters/equipmentLoadoutRules';
import { attackActionCapacity } from '../../../../src/characters/interactionEconomyRules';
import { normalizeCombatScenario } from '../../../../src/rules-engine/turns/tacticalCombat';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const actionConditions = (action: CharacterAction): DamageCondition[] => {
  const seen = new Set<string>();
  return (action.damage?.components ?? [])
    .map((component) => component.condition)
    .filter((condition): condition is DamageCondition => Boolean(condition))
    .filter((condition) => {
      if (seen.has(condition.id)) return false;
      seen.add(condition.id);
      return true;
    });
};

const defaultSlotText = (action: CharacterAction): string => {
  if (action.type !== 'spell') return '';
  const slot = toSpellSlotLevel(action.castAtSlotLevel ?? action.minimumSlotLevel ?? action.spellLevel);
  return slot ? String(slot) : '';
};

type MovementMode = 'none' | TacticalMovement['kind'];
type DraftWeaponOperationKind = 'none' | Exclude<WeaponInteractionKind, 'swap'>;
interface DraftWeaponOperation { kind: DraftWeaponOperationKind; timing: WeaponInteractionTiming; weaponId?: string; hand?: 'main' | 'off'; }

export default function NewRotationScreen() {
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((item) => item.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const allScenarios = useCombatScenarioStore((state) => state.scenarios);
  const ensureDefaultScenario = useCombatScenarioStore((state) => state.ensureDefaultScenario);
  const scenarios = useMemo(() => allScenarios.filter((scenario) => scenario.characterId === id).map(normalizeCombatScenario), [allScenarios, id]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>();
  const [name, setName] = useState('Rotação manual');
  const [selected, setSelected] = useState<CharacterAction[]>([]);
  const [enabledConditions, setEnabledConditions] = useState<Record<string, string[]>>({});
  const [spellSlots, setSpellSlots] = useState<Record<string, string>>({});
  const [spellOrigins, setSpellOrigins] = useState<Record<string, 'self' | 'gazeTarget'>>({});
  const [weaponOperations, setWeaponOperations] = useState<Record<string, DraftWeaponOperation>>({});
  const [attackCounts, setAttackCounts] = useState<Record<string, string>>({});
  const [targetsByAction, setTargetsByAction] = useState<Record<string, string>>({});
  const [movementModes, setMovementModes] = useState<Record<string, MovementMode>>({});
  const [movementDistances, setMovementDistances] = useState<Record<string, string>>({});
  const actions = useMemo(() => (character ? buildAvailableActions(character, { includeStowedWeapons: true }) : []), [character]);
  const maxAttackActionAttacks = character ? attackActionCapacity(character) : 1;

  useEffect(() => {
    if (!id) return;
    const scenario = ensureDefaultScenario(id);
    setSelectedScenarioId((current) => current ?? scenario.id);
  }, [ensureDefaultScenario, id]);

  if (!character || !id) return <Screen title="Não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];
  const targets = selectedScenario?.targets ?? [];

  const toggleAction = (action: CharacterAction) => {
    setSelected((current) => (current.some((item) => item.id === action.id) ? current.filter((item) => item.id !== action.id) : [...current, action]));
    if (!targetsByAction[action.id] && targets[0]) setTargetsByAction((current) => ({ ...current, [action.id]: targets[0].id }));
    if (action.type === 'attack') {
      setAttackCounts((current) => ({ ...current, [action.id]: current[action.id] ?? String(Math.max(1, Math.min(maxAttackActionAttacks, action.attacksCount ?? 1))) }));
    }
    if (action.type === 'attack' && action.weaponId && !isWeaponEquipped(character, action.weaponId) && !action.thrownWeapon) {
      setWeaponOperations((current) => ({ ...current, [action.id]: { kind: 'draw', timing: 'before', weaponId: action.weaponId, hand: 'main' } }));
    }
    if (action.type === 'spell' && !spellSlots[action.id]) {
      setSpellSlots((current) => ({ ...current, [action.id]: defaultSlotText(action) }));
    }
  };

  const moveSelectedAction = (actionId: string, offset: -1 | 1) => {
    setSelected((current) => {
      const index = current.findIndex((entry) => entry.id === actionId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const toggleCondition = (action: CharacterAction, conditionId: string) => {
    setEnabledConditions((current) => {
      const currentForAction = current[action.id] ?? [];
      const next = currentForAction.includes(conditionId)
        ? currentForAction.filter((entry) => entry !== conditionId)
        : [...currentForAction, conditionId];
      return { ...current, [action.id]: next };
    });
  };

  const save = () => {
    const turnActions: TurnAction[] = selected.map((action) => {
      const slotNumber = Number(spellSlots[action.id] ?? defaultSlotText(action));
      const selectedSpellSlotLevel = action.type === 'spell' && isSpellSlotLevel(slotNumber) ? slotNumber : undefined;
      const movementMode = movementModes[action.id] ?? 'none';
      const movementDistance = Math.max(0, Number(movementDistances[action.id]) || 0);
      return {
        id: createId('turnAction'),
        name: action.name,
        actionCost: action.actionCost,
        action,
        actionRef: action.origin,
        enabledConditionIds: enabledConditions[action.id],
        selectedSpellSlotLevel,
        spellOrigin: action.type === 'spell' ? (spellOrigins[action.id] ?? 'self') : undefined,
        weaponOperation: weaponOperations[action.id]?.kind && weaponOperations[action.id]?.kind !== 'none'
          ? {
              kind: weaponOperations[action.id]!.kind as Exclude<WeaponInteractionKind, 'swap'>,
              timing: weaponOperations[action.id]!.timing,
              weaponId: weaponOperations[action.id]!.weaponId ?? (action.type === 'attack' ? action.weaponId : undefined),
              hand: weaponOperations[action.id]!.hand
            }
          : undefined,
        attackCountOverride: action.type === 'attack'
          ? Math.max(1, Math.min(maxAttackActionAttacks, Number(attackCounts[action.id]) || 1))
          : undefined,
        targetId: targetsByAction[action.id] ?? targets[0]?.id,
        movement: movementMode !== 'none' && movementDistance > 0 ? {
          kind: movementMode,
          distanceFeet: movementDistance,
          targetId: targetsByAction[action.id] ?? targets[0]?.id
        } : undefined
      };
    });
    const rotation: TurnRotation = { id: createId('rot'), characterId: id, name, favorite: true, actions: turnActions };
    updateCharacter(id, (current) => ({ ...current, rotations: [...current.rotations, rotation] }));
    router.replace(`/characters/${id}/tactical`);
  };

  return (
    <Screen title="Criar rotação" subtitle="Monte a sequência em ordem. Ataques podem compartilhar a mesma Ação de Ataque, com trocas de arma e validação de mãos/componentes.">
      <Field label="Nome da rotação" value={name} onChangeText={setName} />
      <Card variant="hero" title="Economia de interação" subtitle={`A build permite ${maxAttackActionAttacks} ataque(s) por Ação de Ataque. Cada ataque permite sacar ou guardar uma arma; deixar cair não consome essa interação.`}>
        <Text>Selecione as ações na ordem em que ocorrerão. Para trocar entre ataques, guarde após um ataque e saque antes do seguinte.</Text>
      </Card>
      {selected.length ? (
        <Card variant="filled" title="Ordem da rotação" subtitle="A validação de mãos, movimento, componentes e trocas segue exatamente esta sequência.">
          {selected.map((action, index) => {
            const operation = weaponOperations[action.id];
            const operationLabel = operation?.kind && operation.kind !== 'none'
              ? ` · ${operation.kind} ${operation.timing === 'after' ? 'depois' : 'antes'}`
              : '';
            return (
              <View key={`order-${action.id}`} style={{ gap: 6, paddingVertical: 6 }}>
                <Text style={{ fontWeight: '800' }}>{index + 1}. {action.name}{operationLabel}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Button label="Mover para cima" variant="text" disabled={index === 0} onPress={() => moveSelectedAction(action.id, -1)} />
                  <Button label="Mover para baixo" variant="text" disabled={index === selected.length - 1} onPress={() => moveSelectedAction(action.id, 1)} />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
      <Card variant="filled" title="Cenário e alvos" subtitle="Os alvos escolhidos ficam vinculados às ações. Em outro cenário, a engine usa o alvo principal quando o ID não existir.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {scenarios.map((scenario) => <Chip key={scenario.id} label={scenario.name} selected={scenario.id === selectedScenario?.id} onPress={() => setSelectedScenarioId(scenario.id)} />)}
        </View>
        <Button label="Gerenciar alvos e mapa tático" variant="outlined" onPress={() => router.push(`/characters/${id}/tactical`)} />
      </Card>
      {actions.map((action) => {
        const active = selected.some((item) => item.id === action.id);
        const conditions = actionConditions(action);
        const activeConditions = enabledConditions[action.id] ?? [];
        const minimumSlot = action.type === 'spell' ? toSpellSlotLevel(action.minimumSlotLevel ?? action.spellLevel) : undefined;
        const chosenSlot = Number(spellSlots[action.id] ?? defaultSlotText(action));
        const selectedTarget = targets.find((target) => target.id === targetsByAction[action.id]) ?? targets[0];
        const movementMode = movementModes[action.id] ?? 'none';
        return (
          <Card key={action.id} title={action.name} subtitle={`${action.actionCost} · ${action.type}`}>
            <Text>{active ? 'Selecionado para esta rotação' : 'Disponível para adicionar à rotação'}</Text>
            <Button
              label={active ? 'Remover da rotação' : 'Adicionar à rotação'}
              variant={active ? 'outlined' : 'filled'}
              onPress={() => toggleAction(action)}
            />
            {action.type === 'attack' && action.weaponId ? (
              <Text style={{ color: isWeaponEquipped(character, action.weaponId) ? '#166534' : '#92400e' }}>
                {isWeaponEquipped(character, action.weaponId) ? 'Arma no loadout ativo' : 'Arma guardada'}
              </Text>
            ) : null}
            {active ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Alvo desta ação</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {targets.map((target) => <Chip key={target.id} label={`${target.name} · ${Math.abs(target.positionFeet - (selectedScenario?.actorPositionFeet ?? 0))} ft`} selected={selectedTarget?.id === target.id} onPress={() => setTargetsByAction((current) => ({ ...current, [action.id]: target.id }))} />)}
                </View>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Movimento antes da ação</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {([['none', 'Sem movimento'], ['approach', 'Aproximar'], ['retreat', 'Afastar'], ['reposition', 'Reposicionar']] as Array<[MovementMode, string]>).map(([value, label]) => <Chip key={value} label={label} selected={movementMode === value} onPress={() => setMovementModes((current) => ({ ...current, [action.id]: value }))} />)}
                </View>
                {movementMode !== 'none' ? <Field label="Pés de movimento" value={movementDistances[action.id] ?? ''} onChangeText={(text) => setMovementDistances((current) => ({ ...current, [action.id]: text }))} keyboardType="number-pad" /> : null}
              </View>
            ) : null}
            {active && action.type === 'attack' ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Ataques com esta opção</Text>
                <Field label={`Quantidade nesta sequência (máximo da Ação de Ataque: ${maxAttackActionAttacks})`} value={attackCounts[action.id] ?? '1'} onChangeText={(text) => setAttackCounts((current) => ({ ...current, [action.id]: text }))} keyboardType="number-pad" />
                {action.weaponGrip === 'twoHanded' ? <Text>Duas mãos precisam estar livres no momento de cada ataque.</Text> : null}
                {action.loading ? <Text>Loading limita esta arma a um disparo por ação, bônus ou reação, salvo exceção.</Text> : null}
                {action.thrownWeapon && action.weaponId && !isWeaponEquipped(character, action.weaponId) ? <Text style={{ color: '#166534' }}>Arma Thrown: pode ser sacada como parte do próprio ataque.</Text> : null}
              </View>
            ) : null}
            {active ? (() => {
              const operation = weaponOperations[action.id] ?? { kind: 'none' as const, timing: 'before' as const };
              const initialLoadout = getActiveLoadout(character);
              const heldWeaponIds = [initialLoadout.mainHandWeaponId, initialLoadout.offHandWeaponId].filter((entry): entry is string => Boolean(entry));
              return (
                <View style={{ gap: 6, marginTop: 8 }}>
                  <Text style={{ color: '#334155', fontWeight: '800' }}>Interação com arma</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {([['none', 'Nenhuma'], ['draw', 'Sacar'], ['stow', 'Guardar'], ['drop', 'Deixar cair'], ['pickup', 'Recolher']] as Array<[DraftWeaponOperationKind, string]>).map(([kind, label]) => <Chip key={kind} label={label} selected={operation.kind === kind} onPress={() => setWeaponOperations((current) => ({ ...current, [action.id]: { ...operation, kind, weaponId: kind === 'draw' || kind === 'pickup' ? (action.type === 'attack' ? action.weaponId : operation.weaponId) : (operation.weaponId ?? heldWeaponIds[0]) } }))} />)}
                  </View>
                  {operation.kind !== 'none' ? (
                    <>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        <Chip label="Antes" selected={operation.timing === 'before'} onPress={() => setWeaponOperations((current) => ({ ...current, [action.id]: { ...operation, timing: 'before' } }))} />
                        <Chip label="Depois" selected={operation.timing === 'after'} onPress={() => setWeaponOperations((current) => ({ ...current, [action.id]: { ...operation, timing: 'after' } }))} />
                        <Chip label="Mão principal" selected={(operation.hand ?? 'main') === 'main'} onPress={() => setWeaponOperations((current) => ({ ...current, [action.id]: { ...operation, hand: 'main' } }))} />
                        <Chip label="Mão secundária" selected={operation.hand === 'off'} onPress={() => setWeaponOperations((current) => ({ ...current, [action.id]: { ...operation, hand: 'off' } }))} />
                      </View>
                      <Text style={{ color: '#334155', fontWeight: '700' }}>Arma da interação</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {character.weapons.map((weapon) => <Chip key={weapon.id} label={weapon.name} selected={operation.weaponId === weapon.id} onPress={() => setWeaponOperations((current) => ({ ...current, [action.id]: { ...operation, weaponId: weapon.id } }))} />)}
                      </View>
                    </>
                  ) : null}
                </View>
              );
            })() : null}
            {active && action.type === 'spell' && action.components ? (
              <View style={{ gap: 4, marginTop: 8 }}>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Componentes</Text>
                <Text>{[action.components.verbal ? 'V' : '', action.components.somatic ? 'S' : '', action.components.material ? 'M' : ''].filter(Boolean).join(', ') || 'Nenhum'}{action.materialDescription ? ` · ${action.materialDescription}` : ''}</Text>
              </View>
            ) : null}
            {active && action.type === 'spell' && action.gazeCastingOriginAvailable ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Origem da conjuração</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip label="Espaço do Warlock" selected={(spellOrigins[action.id] ?? 'self') === 'self'} onPress={() => setSpellOrigins((current) => ({ ...current, [action.id]: 'self' }))} />
                  <Chip label={`Espaço de ${action.gazeTargetName ?? 'criatura conectada'}`} selected={spellOrigins[action.id] === 'gazeTarget'} onPress={() => setSpellOrigins((current) => ({ ...current, [action.id]: 'gazeTarget' }))} />
                </View>
              </View>
            ) : null}
            {active && action.type === 'spell' && minimumSlot ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Slot da magia</Text>
                <Field label={`Slot usado (${spellSlotLabel(minimumSlot)} ou maior)`} value={spellSlots[action.id] ?? defaultSlotText(action)} onChangeText={(text) => setSpellSlots((current) => ({ ...current, [action.id]: text }))} keyboardType="number-pad" />
                {!isSpellSlotLevel(chosenSlot) || chosenSlot < minimumSlot ? <Text style={{ color: '#b91c1c' }}>Escolha um slot de 1 a 9 igual ou superior ao nível da magia.</Text> : null}
              </View>
            ) : null}
            {active && action.ruleNotes?.length ? (
              <View style={{ gap: 4, marginTop: 8 }}>
                {action.ruleNotes.map((note, index) => <Text key={`${action.id}-note-${index}`} style={{ color: '#475569' }}>• {note}</Text>)}
              </View>
            ) : null}
            {active && conditions.length ? (
              <View style={{ gap: 6, marginTop: 8 }}>
                <Text style={{ color: '#334155', fontWeight: '800' }}>Condições desta ação</Text>
                {conditions.map((condition) => {
                  const conditionActive = activeConditions.includes(condition.id) || Boolean(condition.defaultEnabled);
                  return <Button key={condition.id} label={`${conditionActive ? 'Desativar' : 'Ativar'}: ${condition.label}`} secondary={!conditionActive} disabled={condition.defaultEnabled} onPress={() => toggleCondition(action, condition.id)} />;
                })}
              </View>
            ) : null}
          </Card>
        );
      })}
      <Button label="Salvar rotação" onPress={save} disabled={!selected.length} />
    </Screen>
  );
}
