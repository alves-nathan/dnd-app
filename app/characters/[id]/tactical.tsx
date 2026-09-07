import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Field } from '../../../src/components/Field';
import { IssueList } from '../../../src/components/IssueList';
import { Screen } from '../../../src/components/Screen';
import { StatRow } from '../../../src/components/StatRow';
import { useCharacterStore } from '../../../src/store/characterStore';
import { useCombatScenarioStore } from '../../../src/store/combatScenarioStore';
import { useCompendiumStore } from '../../../src/store/compendiumStore';
import { useCharacterChoiceBridge } from '../../../src/catalog/useCharacterChoiceBridge';
import { useAppTheme } from '../../../src/theme';
import { analyzeTurnRotation } from '../../../src/rules-engine/turns/analyzeTurn';
import { buildAvailableActions } from '../../../src/rules-engine/actions/buildActions';
import {
  effectiveTargetSpeed,
  normalizeCombatScenario,
  recoverAutomaticBattlefieldItems,
  recoverBattlefieldItem,
  resolveTacticalRotation,
  spendRotationThrownWeapons
} from '../../../src/rules-engine/turns/tacticalCombat';
import {
  actorParticipantId,
  cancelReadyAction,
  declinePendingReaction,
  eligibleOpportunityAttackActions,
  eligibleWarCasterReactionSpells,
  endTacticalTurn,
  ensureTacticalParticipants,
  moveTargetDuringTurn,
  recordTargetAttack,
  recordTargetSavingThrow,
  rechargeTargetStatBlockResource,
  resolvePendingReaction,
  resolveTargetStatBlockAction,
  setReadyAction,
  standTargetFromProne,
  startTacticalTurn,
  targetParticipantId,
  triggerReadyAction
} from '../../../src/rules-engine/turns/turnCycle';
import { eligibleTacticalCreatureStatBlocks, projectCreatureStatBlockToTacticalTarget, statBlockActionDamageRange } from '../../../src/characters/tacticalStatBlockRules';
import { getArmorClass } from '../../../src/rules-engine/characters/derivedStats';
import { attackActionCapacity } from '../../../src/characters/interactionEconomyRules';
import { buildTurnFeatureActivationOptions, instantiateTurnFeatureActivation, type TurnFeatureActivationOption } from '../../../src/characters/turnFeatureActivationRules';
import { getCharacterMetamagicSources } from '../../../src/characters/metamagicRules';
import { turnExtraActionAllowance } from '../../../src/rules-engine/turns/turnFeatureActivations';
import { createId } from '../../../src/utils/id';
import {
  describeTacticalAreaTemplate,
  tacticalActionSupportsMultipleTargets,
  tacticalActionTargetLimit,
  toggleTacticalTargetId
} from '../../../src/rules-engine/targeting/areaTemplates';
import {
  actorMapPoint,
  pointInTerrainRegion,
  tacticalDistanceToTarget,
  tacticalTargetsInsideArea,
  targetMapPoint
} from '../../../src/rules-engine/targeting/spatialMap';
import type {
  BattlefieldRecoveryMode,
  CharacterAction,
  CoverLevel,
  CreatureSize,
  SpellAction,
  TacticalDiagonalRule,
  TacticalTerrainRegion,
  SpellSlotLevel,
  TacticalActionResolution,
  TurnFeatureActivation
} from '../../../src/types';

const getId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const slots: SpellSlotLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const activationExclusiveGroup = (activation: TurnFeatureActivation): string => {
  if (activation.modifier === 'quickenedSpell' || activation.modifier === 'distantSpell' || activation.modifier === 'subtleSpell') return 'metamagic';
  return activation.modifier ?? activation.kind;
};

const isGiantAncestryFiresBurnActivation = (activation: TurnFeatureActivation): boolean =>
  activation.modifier === 'giantAncestryFiresBurn';

const actionDescription = (action?: CharacterAction): string => {
  if (!action) return '';
  const notes = action.ruleNotes?.join(' ') ?? '';
  if (action.type === 'spell') return [action.range ? `Alcance ${action.range}.` : '', notes].filter(Boolean).join(' ');
  return [action.range ? `Alcance ${action.range.normal}${action.range.long ? `/${action.range.long}` : ''} ft.` : 'Ataque corpo a corpo.', notes].filter(Boolean).join(' ');
};

export default function TacticalCombatScreen() {
  const { colors } = useAppTheme();
  const id = getId(useLocalSearchParams().id);
  const character = useCharacterStore((state) => state.characters.find((entry) => entry.id === id));
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const spendRotationResources = useCharacterStore((state) => state.spendRotationResources);
  const allScenarios = useCombatScenarioStore((state) => state.scenarios);
  const ensureDefaultScenario = useCombatScenarioStore((state) => state.ensureDefaultScenario);
  const updateScenario = useCombatScenarioStore((state) => state.updateScenario);
  const addTarget = useCombatScenarioStore((state) => state.addTarget);
  const updateTarget = useCombatScenarioStore((state) => state.updateTarget);
  const removeTarget = useCombatScenarioStore((state) => state.removeTarget);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const characterChoiceBridge = useCharacterChoiceBridge();
  const characterRuleItems = characterChoiceBridge.items.length ? characterChoiceBridge.items : compendiumItems;
  const enabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const scenarios = useMemo(() => allScenarios.filter((scenario) => scenario.characterId === id).map(normalizeCombatScenario), [allScenarios, id]);
  const tacticalCreatureCandidates = useMemo(
    () => eligibleTacticalCreatureStatBlocks(compendiumItems, enabledSourceIds),
    [compendiumItems, enabledSourceIds]
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>();
  const [selectedRotationId, setSelectedRotationId] = useState<string>();
  const [hitsByAction, setHitsByAction] = useState<Record<string, string>>({});
  const [targetsByAction, setTargetsByAction] = useState<Record<string, string>>({});
  const [multiTargetsByAction, setMultiTargetsByAction] = useState<Record<string, string[]>>({});
  const [targetHitsByAction, setTargetHitsByAction] = useState<Record<string, Record<string, string>>>({});
  const [targetDamageByAction, setTargetDamageByAction] = useState<Record<string, Record<string, string>>>({});
  const [targetSavesByAction, setTargetSavesByAction] = useState<Record<string, Record<string, 'success' | 'failure' | 'pending'>>>({});
  const [toppleByAction, setToppleByAction] = useState<Record<string, 'success' | 'failure' | 'pending'>>({});
  const [newTargetName, setNewTargetName] = useState('Novo alvo');
  const [targetAttackName, setTargetAttackName] = useState('Ataque');
  const [targetAttackHit, setTargetAttackHit] = useState(true);
  const [targetAttackDamage, setTargetAttackDamage] = useState('0');
  const [concentrationSave, setConcentrationSave] = useState<'success' | 'failure' | 'pending'>('pending');
  const [targetMoveDistance, setTargetMoveDistance] = useState('5');
  const [targetMoveDirection, setTargetMoveDirection] = useState<'towardActor' | 'awayFromActor'>('awayFromActor');
  const [saveAbility, setSaveAbility] = useState('DEX');
  const [saveDC, setSaveDC] = useState('');
  const [saveResult, setSaveResult] = useState<'success' | 'failure'>('failure');
  const [failureCondition, setFailureCondition] = useState('');
  const [readyTrigger, setReadyTrigger] = useState('Quando o alvo se aproximar ou atacar');
  const [selectedReadyActionId, setSelectedReadyActionId] = useState<string>();
  const [readySlotLevel, setReadySlotLevel] = useState<SpellSlotLevel | undefined>();
  const [selectedReactionActionId, setSelectedReactionActionId] = useState<string>();
  const [reactionSlotLevel, setReactionSlotLevel] = useState<SpellSlotLevel | undefined>();
  const [reactionHit, setReactionHit] = useState(true);
  const [reactionDamage, setReactionDamage] = useState('0');
  const [creatureSearch, setCreatureSearch] = useState('');
  const [targetDamageMode, setTargetDamageMode] = useState<'average' | 'roll'>('average');
  const [newTerrainLabel, setNewTerrainLabel] = useState('Terreno difícil');
  const [newTerrainShape, setNewTerrainShape] = useState<TacticalTerrainRegion['shape']>('rectangle');
  const [newTerrainX, setNewTerrainX] = useState('0');
  const [newTerrainY, setNewTerrainY] = useState('0');
  const [newTerrainWidth, setNewTerrainWidth] = useState('10');
  const [newTerrainHeight, setNewTerrainHeight] = useState('10');
  const [newTerrainRadius, setNewTerrainRadius] = useState('10');
  const [activationOverridesByRotation, setActivationOverridesByRotation] = useState<Record<string, TurnFeatureActivation[]>>({});
  const [attackCountOverridesByRotation, setAttackCountOverridesByRotation] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!id) return;
    const scenario = ensureDefaultScenario(id);
    setSelectedScenarioId((current) => current ?? scenario.id);
  }, [ensureDefaultScenario, id]);

  useEffect(() => {
    if (!character?.rotations.length) return;
    setSelectedRotationId((current) => current ?? character.rotations[0].id);
  }, [character?.rotations]);

  if (!character || !id) return <Screen title="Personagem não encontrado"><Button label="Voltar" onPress={() => router.back()} /></Screen>;

  const storedScenario = scenarios.find((entry) => entry.id === selectedScenarioId) ?? scenarios[0];
  const scenario = storedScenario ? ensureTacticalParticipants(storedScenario, character.name) : undefined;
  const storedRotation = character.rotations.find((entry) => entry.id === selectedRotationId) ?? character.rotations[0];
  const selectedActivations = storedRotation
    ? (activationOverridesByRotation[storedRotation.id] ?? storedRotation.activations ?? [])
    : [];
  const attackOverrides = storedRotation ? (attackCountOverridesByRotation[storedRotation.id] ?? {}) : {};
  const rotation = storedRotation ? {
    ...storedRotation,
    activations: selectedActivations,
    actions: storedRotation.actions.map((entry) => {
      const draft = attackOverrides[entry.id];
      if (entry.action.type !== 'attack' || draft === undefined) return entry;
      const parsed = Number(draft);
      return Number.isFinite(parsed) ? { ...entry, attackCountOverride: Math.max(1, Math.floor(parsed)) } : entry;
    })
  } : undefined;
  const rotationActivationOptions = storedRotation
    ? buildTurnFeatureActivationOptions(character, characterRuleItems, storedRotation.actions.map((entry) => entry.action))
    : [];
  const maxTacticalAttackCount = attackActionCapacity(character) * (1 + (rotation ? turnExtraActionAllowance(rotation) : 0));
  const metamagicSources = getCharacterMetamagicSources(character, characterRuleItems);
  const analysis = scenario && rotation ? analyzeTurnRotation(rotation, character, scenario) : undefined;
  const allIssues = analysis ? [
    ...analysis.validation.issues,
    ...analysis.resourceAvailability.issues,
    ...analysis.spellSlotAvailability.issues,
    ...(analysis.ammunitionAvailability?.issues ?? [])
  ] : [];
  const availableActions = buildAvailableActions(character, { includeStowedWeapons: false });
  const readyEligibleActions = availableActions.filter((action) => action.actionCost === 'action');
  const opportunityActions = eligibleOpportunityAttackActions(character);
  const warCasterSpells = eligibleWarCasterReactionSpells(character);
  const selectedReadyAction = readyEligibleActions.find((action) => action.id === selectedReadyActionId);
  const pendingReady = scenario?.pendingReaction?.kind === 'ready'
    ? scenario.readyActions?.find((entry) => entry.id === scenario.pendingReaction?.readyActionId)
    : undefined;
  const pendingReactionActions = pendingReady
    ? availableActions.filter((action) => action.id === pendingReady.actionId)
    : [...opportunityActions, ...warCasterSpells];
  const selectedReactionAction = pendingReactionActions.find((action) => action.id === selectedReactionActionId) ?? pendingReactionActions[0];
  const activeParticipant = scenario?.participants?.find((participant) => participant.id === scenario.activeParticipantId);
  const activeTarget = activeParticipant?.kind === 'target' && activeParticipant.targetId
    ? scenario?.targets?.find((target) => target.id === activeParticipant.targetId)
    : undefined;
  const normalizedCreatureSearch = creatureSearch.trim().toLowerCase();
  const visibleCreatureCandidates = tacticalCreatureCandidates
    .filter((item) => !normalizedCreatureSearch || [item.name, item.summary ?? '', item.importItemId].join(' ').toLowerCase().includes(normalizedCreatureSearch))
    .slice(0, normalizedCreatureSearch ? 20 : 8);
  const characterArmorClass = getArmorClass(character);
  const activeConcentration = character.activeEffects.find((effect) => effect.status === 'active' && effect.concentration);
  const spellSlotSummary = character.spellSlots.length
    ? character.spellSlots
      .slice()
      .sort((left, right) => left.level - right.level)
      .map((pool) => `${pool.level}º ${pool.current}/${pool.max}`)
      .join(' · ')
    : 'Nenhum';

  const toggleTacticalActivation = (option: TurnFeatureActivationOption, targetActionId?: string) => {
    if (!storedRotation) return;
    const activation = instantiateTurnFeatureActivation(option, targetActionId);
    setActivationOverridesByRotation((currentMap) => {
      const current = currentMap[storedRotation.id] ?? storedRotation.activations ?? [];
      const alreadySelected = current.some((entry) => entry.id === activation.id);
      if (alreadySelected) {
        return { ...currentMap, [storedRotation.id]: current.filter((entry) => entry.id !== activation.id) };
      }
      if (option.targetMode === 'action' && targetActionId) {
        const group = activationExclusiveGroup(activation);
        return {
          ...currentMap,
          [storedRotation.id]: [
            ...current.filter((entry) => !(
              entry.kind === 'actionModifier'
              && entry.targetActionId === targetActionId
              && activationExclusiveGroup(entry) === group
            )),
            activation
          ]
        };
      }
      return { ...currentMap, [storedRotation.id]: [...current, activation] };
    });
  };

  const persistTurnResult = (result: { scenario: typeof scenario; character: typeof character; issues: Array<{ severity: string; message: string }> }) => {
    if (!scenario || !result.scenario) return;
    if (result.issues.some((entry) => entry.severity === 'error')) {
      Alert.alert('Não foi possível concluir', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateCharacter(character.id, () => result.character);
    updateScenario(scenario.id, () => result.scenario!);
  };

  const startTurn = (participantId: string) => {
    if (!scenario) return;
    persistTurnResult(startTacticalTurn({ scenario, character, participantId }));
  };

  const endTurn = () => {
    if (!scenario) return;
    persistTurnResult(endTacticalTurn({ scenario, character }));
  };

  const resolveTargetAttack = () => {
    if (!scenario || !activeTarget) return;
    const result = recordTargetAttack({
      scenario,
      character,
      targetId: activeTarget.id,
      attackName: targetAttackName,
      hit: targetAttackHit,
      damage: Number(targetAttackDamage) || 0,
      concentrationSave
    });
    persistTurnResult(result);
    if (!result.issues.some((entry) => entry.severity === 'error')) {
      Alert.alert('Ataque registrado', `${result.rollMode === 'disadvantage' ? 'Sap aplicou desvantagem e foi consumido.\n' : ''}${result.concentrationDC ? `CD de concentração: ${result.concentrationDC}.` : 'Sem teste de concentração.'}`);
    }
  };

  const resolveImportedTargetAction = (targetId: string, actionId: string) => {
    if (!scenario) return;
    const result = resolveTargetStatBlockAction({
      scenario,
      character,
      targetId,
      actionId,
      damageMode: targetDamageMode,
      concentrationSave
    });
    persistTurnResult(result);
    if (result.issues.some((entry) => entry.severity === 'error')) return;
    const details = result.action?.type === 'attack'
      ? `${result.attackRolls?.length ? `Rolagem ${result.attackRolls.join(' / ')}${result.rollMode === 'disadvantage' ? ' (desvantagem)' : ''}. ` : ''}${result.hit ? `Acertou CA ${result.characterArmorClass}${result.critical ? ' com crítico' : ''}` : `Errou CA ${result.characterArmorClass}`}${result.damage ? ` e causou ${result.damage} de dano` : ''}.`
      : result.action?.type === 'saveEffect'
        ? `Salvaguarda ${result.action.saveAbility}: ${result.saveRoll} + ${result.saveBonus} = ${result.saveTotal} contra CD ${result.saveDC} — ${result.saveSuccess ? 'sucesso' : 'falha'}${result.damage ? `; ${result.damage} de dano` : ''}.`
        : `${result.action?.name ?? 'Ação'} registrada.`;
    Alert.alert('Ação do stat block resolvida', `${details}${result.concentrationDC ? `\nCD de concentração: ${result.concentrationDC}.` : ''}`);
  };

  const rechargeImportedTargetResource = (targetId: string, resourceId: string) => {
    if (!scenario) return;
    const result = rechargeTargetStatBlockResource({ scenario, targetId, resourceId });
    if (result.issues.some((entry) => entry.severity === 'error')) {
      Alert.alert('Recarga indisponível', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateScenario(scenario.id, () => result.scenario);
    Alert.alert('Recurso do alvo', result.roll ? `Rolagem de recarga: d6 ${result.roll}. ${result.recharged ? 'Recurso recuperado.' : 'Ainda indisponível.'}` : result.recharged ? 'Recurso recuperado.' : 'O recurso já estava disponível.');
  };

  const addCreatureTarget = (item: typeof tacticalCreatureCandidates[number]) => {
    if (!scenario) return;
    const positionFeet = 10 + (scenario.targets?.length ?? 0) * 5;
    const projection = projectCreatureStatBlockToTacticalTarget(item, { positionFeet });
    const created = addTarget(scenario.id, {
      ...projection.target,
      mapPosition: scenario.spatialMode === 'map2d' ? { xFeet: positionFeet, yFeet: 0 } : projection.target.mapPosition
    });
    if (created) {
      setCreatureSearch('');
      Alert.alert('Alvo adicionado', `${item.name} foi criado a partir do creature stat block com ${projection.actions.length} ação(ões) estruturada(s).`);
    }
  };

  const setSpatialMode = (mode: 'linear' | 'map2d') => {
    if (!scenario) return;
    updateScenario(scenario.id, (current) => ({
      ...current,
      spatialMode: mode,
      actorMapPosition: mode === 'map2d' ? actorMapPoint(current) : current.actorMapPosition,
      targets: (current.targets ?? []).map((target) => mode === 'map2d' && !target.mapPosition
        ? { ...target, mapPosition: targetMapPoint(target) }
        : target)
    }));
  };

  const addTerrainRegion = () => {
    if (!scenario) return;
    const region: TacticalTerrainRegion = {
      id: createId('terrain'),
      label: newTerrainLabel.trim() || 'Terreno difícil',
      shape: newTerrainShape,
      xFeet: Number(newTerrainX) || 0,
      yFeet: Number(newTerrainY) || 0,
      widthFeet: newTerrainShape === 'rectangle' ? Math.max(0, Number(newTerrainWidth) || 0) : undefined,
      heightFeet: newTerrainShape === 'rectangle' ? Math.max(0, Number(newTerrainHeight) || 0) : undefined,
      radiusFeet: newTerrainShape === 'circle' ? Math.max(0, Number(newTerrainRadius) || 0) : undefined,
      movementMultiplier: 2
    };
    updateScenario(scenario.id, (current) => ({ ...current, terrainRegions: [...(current.terrainRegions ?? []), region] }));
  };

  const moveActiveTarget = () => {
    if (!scenario || !activeTarget) return;
    const result = moveTargetDuringTurn({
      scenario,
      characterName: character.name,
      targetId: activeTarget.id,
      distanceFeet: Number(targetMoveDistance) || 0,
      direction: targetMoveDirection
    });
    if (result.issues.some((entry) => entry.severity === 'error')) {
      Alert.alert('Movimento inválido', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateScenario(scenario.id, () => result.scenario);
    if (result.opportunityProvoked) Alert.alert('Reação disponível', 'O alvo saiu do alcance e provocou um ataque de oportunidade.');
  };

  const standActiveTarget = () => {
    if (!scenario || !activeTarget) return;
    const result = standTargetFromProne({ scenario, characterName: character.name, targetId: activeTarget.id });
    if (result.issues.some((entry) => entry.severity === 'error')) {
      Alert.alert('Não foi possível levantar', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateScenario(scenario.id, () => result.scenario);
  };

  const saveActiveTarget = () => {
    if (!scenario || !activeTarget) return;
    updateScenario(scenario.id, () => recordTargetSavingThrow({
      scenario,
      characterName: character.name,
      targetId: activeTarget.id,
      ability: saveAbility,
      dc: Number(saveDC) || undefined,
      result: saveResult,
      failureCondition
    }));
  };

  const prepareReady = () => {
    if (!scenario || !selectedReadyActionId) return;
    const result = setReadyAction({
      scenario,
      character,
      actionId: selectedReadyActionId,
      trigger: readyTrigger,
      targetId: scenario.targets?.[0]?.id,
      selectedSlotLevel: readySlotLevel
    });
    persistTurnResult(result);
  };

  const triggerReady = (readyActionId: string) => {
    if (!scenario) return;
    const result = triggerReadyAction({ scenario, character, readyActionId, targetId: scenario.targets?.[0]?.id });
    if (result.issues.length) {
      Alert.alert('Reação indisponível', result.issues.map((entry) => entry.message).join('\n'));
      return;
    }
    updateScenario(scenario.id, () => result.scenario);
  };

  const resolveReaction = () => {
    if (!scenario || !selectedReactionAction) return;
    const result = resolvePendingReaction({
      scenario,
      character,
      actionId: selectedReactionAction.id,
      selectedSlotLevel: reactionSlotLevel,
      hit: reactionHit,
      damage: Number(reactionDamage) || 0
    });
    persistTurnResult(result);
  };

  const resolveTurn = () => {
    if (!scenario || !rotation) return;
    if (allIssues.some((issue) => issue.severity === 'error')) {
      Alert.alert('Rotação indisponível', allIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('\n'));
      return;
    }
    const resolutions: TacticalActionResolution[] = rotation.actions.map((entry) => {
      const primaryTargetId = targetsByAction[entry.id] ?? entry.targetId ?? scenario.targets?.[0]?.id;
      const multiTarget = tacticalActionSupportsMultipleTargets(entry.action);
      const selectedIds = multiTarget
        ? (multiTargetsByAction[entry.id]?.length ? multiTargetsByAction[entry.id] : primaryTargetId ? [primaryTargetId] : [])
        : primaryTargetId ? [primaryTargetId] : [];
      const orderedIds = entry.action.type === 'attack' && entry.action.mastery?.property === 'cleave' && primaryTargetId
        ? [primaryTargetId, ...selectedIds.filter((targetId) => targetId !== primaryTargetId).slice(0, 1)]
        : selectedIds;
      return {
        actionId: entry.id,
        targetId: primaryTargetId,
        confirmedHits: Math.max(0, Number(hitsByAction[entry.id]) || 0),
        toppleSave: toppleByAction[entry.id] ?? 'pending',
        targetResults: orderedIds.map((targetId) => ({
          targetId,
          confirmedHits: Math.max(0, Number(targetHitsByAction[entry.id]?.[targetId] ?? (targetId === primaryTargetId ? hitsByAction[entry.id] : '0')) || 0),
          saveResult: targetSavesByAction[entry.id]?.[targetId] ?? 'pending',
          damage: Math.max(0, Number(targetDamageByAction[entry.id]?.[targetId]) || 0)
        }))
      };
    });
    const fireWithoutHit = selectedActivations.find((activation) => {
      if (!isGiantAncestryFiresBurnActivation(activation) || !activation.targetActionId) return false;
      const targetEntry = rotation.actions.find((entry) => entry.action.id === activation.targetActionId || entry.id === activation.targetActionId);
      if (!targetEntry) return false;
      const resolution = resolutions.find((entry) => entry.actionId === targetEntry.id);
      if (!resolution) return true;
      const totalHits = resolution.targetResults?.length
        ? resolution.targetResults.reduce((sum, entry) => sum + Math.max(0, entry.confirmedHits ?? 0), 0)
        : Math.max(0, resolution.confirmedHits ?? 0);
      return totalHits <= 0;
    });
    if (fireWithoutHit) {
      Alert.alert('Giant Ancestry · Fire\'s Burn', 'Fire\'s Burn só pode ser usado depois de pelo menos um acerto confirmado que cause dano. Confirme o acerto ou desative a feature nesta ação.');
      return;
    }
    const result = resolveTacticalRotation({ character, rotation, scenario, resolutions });
    if (result.issues.some((issue) => issue.severity === 'error')) {
      Alert.alert('Movimento inválido', result.issues.map((issue) => issue.message).join('\n'));
      return;
    }
    spendRotationResources(character.id, rotation.id, rotation);
    updateCharacter(character.id, (current) => spendRotationThrownWeapons(current, rotation));
    updateScenario(scenario.id, () => result.scenario);
    if (storedRotation) {
      setActivationOverridesByRotation((current) => {
        const next = { ...current };
        delete next[storedRotation.id];
        return next;
      });
      setAttackCountOverridesByRotation((current) => {
        const next = { ...current };
        delete next[storedRotation.id];
        return next;
      });
    }
    Alert.alert('Turno aplicado', `Movimento: ${result.movement.movementSpentFeet}/${result.movement.speedFeet} pés.\n${result.effects.filter((event) => event.applied).length} efeito(s) tático(s) aplicado(s).`);
  };

  const recoverAutomatic = () => {
    if (!scenario) return;
    const result = recoverAutomaticBattlefieldItems({ character, scenario });
    updateCharacter(character.id, () => result.character);
    updateScenario(scenario.id, () => result.scenario);
    Alert.alert('Recuperação automática', `${result.recovered} recuperado(s) e ${result.lost} perdido(s).`);
  };

  const recoverItem = (itemId: string) => {
    if (!scenario) return;
    const result = recoverBattlefieldItem({ character, scenario, battlefieldItemId: itemId });
    updateCharacter(character.id, () => result.character);
    updateScenario(scenario.id, () => result.scenario);
    Alert.alert('Recuperação concluída', `${result.recovered} recuperado(s) e ${result.lost} perdido(s).`);
  };

  return (
    <Screen title="Combate tático" subtitle="Ciclo de turnos, ações dos alvos, reações, Ready, concentração e continuidade tática.">
      <Card variant="hero" title="Cenário ativo" subtitle="Cada cenário possui alvos, posições, iniciativa, round, efeitos e itens no campo.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {scenarios.map((entry) => <Chip key={entry.id} label={entry.name} selected={entry.id === scenario?.id} onPress={() => setSelectedScenarioId(entry.id)} />)}
        </View>
        {scenario ? (
          <>
            <StatRow testID="tactical-round-status" label="Round" value={scenario.round ?? 1} />
            <StatRow testID="tactical-active-turn-status" label="Turno ativo" value={activeParticipant?.name ?? 'Nenhum'} />
            <Text style={{ fontWeight: '800' }}>Espaço tático</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Linear" selected={scenario.spatialMode !== 'map2d'} onPress={() => setSpatialMode('linear')} />
              <Chip label="Mapa 2D" selected={scenario.spatialMode === 'map2d'} onPress={() => setSpatialMode('map2d')} />
            </View>
            {scenario.spatialMode === 'map2d' ? (
              <>
                <Text style={{ color: colors.onSurfaceVariant }}>Coordenadas em pés. O modo linear permanece salvo e pode ser reativado a qualquer momento.</Text>
                <Field label="Personagem · X (ft)" value={String(actorMapPoint(scenario).xFeet)} onChangeText={(text) => updateScenario(scenario.id, (current) => ({ ...current, actorMapPosition: { ...actorMapPoint(current), xFeet: Number(text) || 0 } }))} />
                <Field label="Personagem · Y (ft)" value={String(actorMapPoint(scenario).yFeet)} onChangeText={(text) => updateScenario(scenario.id, (current) => ({ ...current, actorMapPosition: { ...actorMapPoint(current), yFeet: Number(text) || 0 } }))} />
                <Text style={{ fontWeight: '800' }}>Distância diagonal</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {([['fiveFeet', 'Diagonal = 5 ft'], ['alternating5_10', 'Alternar 5/10'], ['euclidean', 'Euclidiana']] as Array<[TacticalDiagonalRule, string]>).map(([rule, label]) => (
                    <Chip key={rule} label={label} selected={(scenario.diagonalRule ?? 'fiveFeet') === rule} onPress={() => updateScenario(scenario.id, (current) => ({ ...current, diagonalRule: rule }))} />
                  ))}
                </View>
              </>
            ) : (
              <Field label="Posição do personagem (ft)" value={String(scenario.actorPositionFeet ?? 0)} onChangeText={(text) => updateScenario(scenario.id, (current) => ({ ...current, actorPositionFeet: Math.max(0, Number(text) || 0) }))} keyboardType="number-pad" />
            )}
            <Field label="Speed do personagem" value={String(scenario.actorSpeedFeet ?? 30)} onChangeText={(text) => updateScenario(scenario.id, (current) => ({ ...current, actorSpeedFeet: Math.max(0, Number(text) || 0) }))} keyboardType="number-pad" />
            <Chip label="Todo o campo é terreno difícil" selected={Boolean(scenario.difficultTerrain)} onPress={() => updateScenario(scenario.id, (current) => ({ ...current, difficultTerrain: !current.difficultTerrain }))} />
            <Button label="Editar cenários completos" variant="text" onPress={() => router.push(`/characters/${character.id}/comparison`)} />
          </>
        ) : null}
      </Card>

      <Card title="Estado do personagem" subtitle="Resumo persistente para conferir recursos, concentração e dano durante o ciclo tático.">
        <Text testID="tactical-character-hp" accessibilityLabel={`Pontos de vida: ${character.hitPoints?.current ?? 0} de ${character.hitPoints?.max ?? 0}`}>
          PV: {character.hitPoints?.current ?? 0}/{character.hitPoints?.max ?? 0}{character.hitPoints?.temporary ? ` · ${character.hitPoints.temporary} temporários` : ''}
        </Text>
        <Text testID="tactical-character-concentration" accessibilityLabel={`Concentração: ${activeConcentration?.name ?? 'nenhuma'}`}>
          Concentração: {activeConcentration?.name ?? 'Nenhuma'}
        </Text>
        <Text testID="tactical-character-spell-slots" accessibilityLabel={`Slots de magia: ${spellSlotSummary}`}>
          Slots: {spellSlotSummary}
        </Text>
      </Card>

      {scenario?.spatialMode === 'map2d' ? (
        <Card title="Mapa 2D e terreno" subtitle="Regiões de terreno difícil afetam o custo de movimento apenas quando o trajeto realmente as atravessa.">
          {(scenario.terrainRegions ?? []).length ? (scenario.terrainRegions ?? []).map((region) => (
            <Card key={region.id} variant="outlined" title={region.label} subtitle={region.shape === 'circle' ? `Círculo · centro (${region.xFeet}, ${region.yFeet}) · raio ${region.radiusFeet ?? 0} ft` : `Retângulo · origem (${region.xFeet}, ${region.yFeet}) · ${region.widthFeet ?? 0} × ${region.heightFeet ?? 0} ft`}>
              <StatRow label="Multiplicador de movimento" value={`${region.movementMultiplier}×`} />
              <Button label="Remover região" variant="text" onPress={() => updateScenario(scenario.id, (current) => ({ ...current, terrainRegions: (current.terrainRegions ?? []).filter((entry) => entry.id !== region.id) }))} />
            </Card>
          )) : <Text style={{ color: colors.onSurfaceVariant }}>Nenhuma região de terreno configurada.</Text>}
          <Card variant="filled" title="Adicionar região de terreno difícil" subtitle="Use coordenadas em pés. Retângulos usam X/Y como canto inicial; círculos usam X/Y como centro.">
            <Field label="Nome" value={newTerrainLabel} onChangeText={setNewTerrainLabel} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Retângulo" selected={newTerrainShape === 'rectangle'} onPress={() => setNewTerrainShape('rectangle')} />
              <Chip label="Círculo" selected={newTerrainShape === 'circle'} onPress={() => setNewTerrainShape('circle')} />
            </View>
            <Field label="X (ft)" value={newTerrainX} onChangeText={setNewTerrainX} />
            <Field label="Y (ft)" value={newTerrainY} onChangeText={setNewTerrainY} />
            {newTerrainShape === 'rectangle' ? (
              <>
                <Field label="Largura (ft)" value={newTerrainWidth} onChangeText={setNewTerrainWidth} keyboardType="number-pad" />
                <Field label="Altura (ft)" value={newTerrainHeight} onChangeText={setNewTerrainHeight} keyboardType="number-pad" />
              </>
            ) : <Field label="Raio (ft)" value={newTerrainRadius} onChangeText={setNewTerrainRadius} keyboardType="number-pad" />}
            <Button label="Adicionar terreno difícil" onPress={addTerrainRegion} />
          </Card>
        </Card>
      ) : null}

      {scenario ? (
        <Card title="Ordem de turno" subtitle="O round avança automaticamente somente depois que todos os participantes encerram seus turnos.">
          {(scenario.participants ?? []).map((participant) => (
            <Card key={participant.id} variant="outlined" title={participant.name} subtitle={`${participant.kind === 'character' ? 'Personagem' : 'Alvo'} · iniciativa ${participant.initiative} · ${participant.hasActed ? 'já agiu' : 'aguardando'}`}>
              <Field label="Iniciativa" value={String(participant.initiative)} onChangeText={(text) => updateScenario(scenario.id, (current) => ({
                ...current,
                participants: ensureTacticalParticipants(current, character.name).participants?.map((entry) => entry.id === participant.id ? { ...entry, initiative: Number(text) || 0 } : entry)
              }))} keyboardType="number-pad" />
              <StatRow label="Reação" value={participant.reactionAvailable ? 'Disponível' : 'Usada'} />
              <StatRow label="Movimento gasto" value={`${participant.movementSpentFeet} ft`} />
              <Button
                testID={participant.kind === 'character' ? 'tactical-start-turn-character' : `tactical-start-turn-target-${participant.targetId}`}
                label={scenario.activeParticipantId === participant.id ? 'Turno em andamento' : 'Iniciar turno'}
                variant="outlined"
                onPress={() => startTurn(participant.id)}
                disabled={Boolean(scenario.activeParticipantId) || participant.hasActed}
              />
            </Card>
          ))}
          <Button testID="tactical-end-turn" label="Encerrar turno ativo" onPress={endTurn} disabled={!scenario.activeParticipantId} />
        </Card>
      ) : null}

      {activeTarget && scenario ? (
        <Card variant="hero" title={`Turno de ${activeTarget.name}`} subtitle="Registre ataques, movimento, salvaguardas e condições reais do alvo.">
          {activeTarget.statBlockActions?.some((action) => action.section !== 'reaction') ? (
            <Card variant="outlined" title="Ações do stat block" subtitle={`Resolução automática contra CA ${characterArmorClass}; use o formulário manual para fórmulas dependentes de caster/spell level.`}>
              <Text style={{ fontWeight: '800' }}>Dano automático</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Chip label="Médio" selected={targetDamageMode === 'average'} onPress={() => setTargetDamageMode('average')} />
                <Chip label="Rolar dados" selected={targetDamageMode === 'roll'} onPress={() => setTargetDamageMode('roll')} />
              </View>
              {activeTarget.statBlockActions.filter((action) => action.section !== 'reaction').map((action) => {
                const damage = statBlockActionDamageRange(action);
                const resource = action.resourceId ? activeTarget.statBlockResources?.find((entry) => entry.id === action.resourceId) : undefined;
                const unresolved = action.type === 'attack' && action.attackBonus === undefined
                  ? `Bônus dinâmico: ${action.attackBonusFormula ?? 'não resolvido'}`
                  : action.type === 'saveEffect' && (!action.saveAbility || action.saveDC === undefined)
                    ? `Salvaguarda dinâmica: ${action.saveAbility ?? '?'} / ${action.saveDCFormula ?? '?'}`
                    : undefined;
                const mechanics = [
                  action.section === 'bonusAction' ? 'Ação bônus' : 'Ação',
                  action.attackBonus !== undefined ? `+${action.attackBonus} para atingir` : undefined,
                  action.saveAbility && action.saveDC !== undefined ? `${action.saveAbility} CD ${action.saveDC}` : undefined,
                  action.reach ? `alcance ${action.reach}` : action.range ? `alcance ${action.range}` : undefined,
                  action.damageFormula ? `${action.damageFormula}${action.damageType ? ` ${action.damageType}` : ''}` : undefined,
                  action.damageFormula && !damage.unresolvedTokens.length ? `média ${damage.average.toFixed(1)}` : undefined,
                  resource ? `usos ${resource.current}/${resource.max}` : undefined
                ].filter(Boolean).join(' · ');
                return (
                  <Card key={action.id} variant="filled" title={action.name} subtitle={mechanics || action.summary || 'Ação estruturada do stat block.'}>
                    {action.summary ? <Text>{action.summary}</Text> : null}
                    {unresolved ? <Text>{unresolved}. Use o registro manual abaixo.</Text> : null}
                    <Button
                      label={resource?.current === 0 ? 'Sem usos disponíveis' : action.type === 'attack' ? 'Rolar ataque' : action.type === 'saveEffect' ? 'Rolar salvaguarda' : 'Registrar ação'}
                      onPress={() => resolveImportedTargetAction(activeTarget.id, action.id)}
                      disabled={Boolean(unresolved) || resource?.current === 0}
                    />
                  </Card>
                );
              })}
            </Card>
          ) : null}

          <Card variant="outlined" title="Ataque manual contra o personagem" subtitle="Use para ações sem automação completa. Sap é aplicado automaticamente ao próximo ataque e removido depois da rolagem.">
            <Field testID="tactical-target-attack-name" label="Nome do ataque" value={targetAttackName} onChangeText={setTargetAttackName} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip testID="tactical-target-attack-hit" label="Acertou" selected={targetAttackHit} onPress={() => setTargetAttackHit(true)} />
              <Chip testID="tactical-target-attack-miss" label="Errou" selected={!targetAttackHit} onPress={() => setTargetAttackHit(false)} />
            </View>
            <Field testID="tactical-target-attack-damage" label="Dano sofrido" value={targetAttackDamage} onChangeText={setTargetAttackDamage} keyboardType="number-pad" />
            <Text style={{ fontWeight: '800' }}>Teste de concentração</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([['pending', 'Pendente'], ['success', 'Sucesso'], ['failure', 'Falha']] as const).map(([value, label]) => <Chip key={value} testID={`tactical-concentration-${value}`} label={label} selected={concentrationSave === value} onPress={() => setConcentrationSave(value)} />)}
            </View>
            <Button testID="tactical-target-attack-resolve" label="Registrar ataque e dano" onPress={resolveTargetAttack} />
          </Card>

          <Card variant="outlined" title="Movimento do alvo" subtitle={`Speed efetiva ${effectiveTargetSpeed(activeTarget)} ft. Slow e terreno difícil reduzem o deslocamento real.`}>
            <Field testID="tactical-target-move-distance" label="Distância do movimento" value={targetMoveDistance} onChangeText={setTargetMoveDistance} keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip testID="tactical-target-move-toward" label="Aproximar" selected={targetMoveDirection === 'towardActor'} onPress={() => setTargetMoveDirection('towardActor')} />
              <Chip testID="tactical-target-move-away" label="Afastar" selected={targetMoveDirection === 'awayFromActor'} onPress={() => setTargetMoveDirection('awayFromActor')} />
            </View>
            <Button testID="tactical-target-move-apply" label="Aplicar movimento" onPress={moveActiveTarget} />
            {activeTarget.conditions.includes('prone') ? <Button label="Levantar de Prone (metade da Speed)" variant="outlined" onPress={standActiveTarget} /> : null}
          </Card>

          <Card variant="outlined" title="Salvaguarda do alvo" subtitle="Registre o resultado e uma condição opcional em caso de falha.">
            <Field label="Habilidade" value={saveAbility} onChangeText={setSaveAbility} />
            <Field label="CD" value={saveDC} onChangeText={setSaveDC} keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Sucesso" selected={saveResult === 'success'} onPress={() => setSaveResult('success')} />
              <Chip label="Falha" selected={saveResult === 'failure'} onPress={() => setSaveResult('failure')} />
            </View>
            <Field label="Condição em caso de falha" value={failureCondition} onChangeText={setFailureCondition} placeholder="Ex.: frightened" />
            <Button label="Registrar salvaguarda" onPress={saveActiveTarget} />
          </Card>
        </Card>
      ) : null}

      {scenario && (scenario.targets ?? []).some((target) => target.statBlockActions?.some((action) => action.section === 'reaction')) ? (
        <Card title="Reações dos alvos" subtitle="Dispare manualmente quando o gatilho do stat block ocorrer. A reação do alvo é consumida até o início do próximo turno dele.">
          {(scenario.targets ?? []).flatMap((target) => {
            const participant = scenario.participants?.find((entry) => entry.id === targetParticipantId(target.id));
            return (target.statBlockActions ?? []).filter((action) => action.section === 'reaction').map((action) => {
              const resource = action.resourceId ? target.statBlockResources?.find((entry) => entry.id === action.resourceId) : undefined;
              return (
                <Card key={`${target.id}:${action.id}`} variant="outlined" title={`${target.name} · ${action.name}`} subtitle={action.trigger ? `Gatilho: ${action.trigger}` : action.summary ?? 'Reação do stat block.'}>
                  {action.summary ? <Text>{action.summary}</Text> : null}
                  <StatRow label="Reação" value={participant?.reactionAvailable ? 'Disponível' : 'Usada'} />
                  {resource ? <StatRow label="Usos" value={`${resource.current}/${resource.max}`} /> : null}
                  <Button label="Usar reação" onPress={() => resolveImportedTargetAction(target.id, action.id)} disabled={!participant?.reactionAvailable || resource?.current === 0} />
                </Card>
              );
            });
          })}
        </Card>
      ) : null}

      {scenario?.pendingReaction ? (
        <Card variant="hero" title="Reação pendente" subtitle={scenario.pendingReaction.trigger}>
          {pendingReactionActions.length ? pendingReactionActions.map((action) => (
            <Card key={action.id} variant="outlined" title={action.name} subtitle={action.type === 'spell' ? 'War Caster / Ready' : 'Ataque de oportunidade'}>
              <Text>{actionDescription(action) || 'Ação elegível para esta reação.'}</Text>
              <Button testID={`tactical-reaction-select-${action.id}`} label={selectedReactionAction?.id === action.id ? 'Selecionada' : 'Usar esta ação'} variant="outlined" onPress={() => setSelectedReactionActionId(action.id)} />
            </Card>
          )) : <Text>Nenhuma ação elegível foi encontrada.</Text>}
          {selectedReactionAction?.type === 'spell' && selectedReactionAction.consumesSpellSlot !== false ? (
            <>
              <Text style={{ fontWeight: '800' }}>Slot da reação</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {slots.filter((level) => character.spellSlots.some((pool) => pool.level === level && pool.current > 0) && level >= (selectedReactionAction.minimumSlotLevel ?? selectedReactionAction.spellLevel ?? 1)).map((level) => <Chip key={level} label={`${level}º`} selected={reactionSlotLevel === level} onPress={() => setReactionSlotLevel(level)} />)}
              </View>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Acertou" selected={reactionHit} onPress={() => setReactionHit(true)} />
            <Chip label="Errou" selected={!reactionHit} onPress={() => setReactionHit(false)} />
          </View>
          <Field testID="tactical-reaction-damage" label="Dano real da reação" value={reactionDamage} onChangeText={setReactionDamage} keyboardType="number-pad" />
          <Button testID="tactical-reaction-resolve" label="Resolver reação" onPress={resolveReaction} disabled={!selectedReactionAction} />
          <Button label="Ignorar reação" variant="text" onPress={() => updateScenario(scenario.id, () => declinePendingReaction(scenario, character.name))} />
        </Card>
      ) : null}

      {scenario && activeParticipant?.id === actorParticipantId(character.id) ? (
        <Card title="Ready" subtitle="Prepare uma ação e um gatilho. Quando o gatilho ocorrer, a execução usa sua reação.">
          {readyEligibleActions.map((action) => (
            <Card key={action.id} variant="outlined" title={action.name} subtitle={action.type === 'spell' ? 'Magia com tempo de Ação' : 'Ação preparada'}>
              <Text>{actionDescription(action) || 'Pode ser preparada com Ready.'}</Text>
              <Button testID={`tactical-ready-select-${action.id}`} label={selectedReadyActionId === action.id ? 'Selecionada' : 'Selecionar'} variant="outlined" onPress={() => setSelectedReadyActionId(action.id)} />
            </Card>
          ))}
          {selectedReadyAction?.type === 'spell' && selectedReadyAction.consumesSpellSlot !== false ? (
            <>
              <Text style={{ fontWeight: '800' }}>Slot comprometido ao preparar</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {slots.filter((level) => character.spellSlots.some((pool) => pool.level === level && pool.current > 0) && level >= (selectedReadyAction.minimumSlotLevel ?? selectedReadyAction.spellLevel ?? 1)).map((level) => <Chip key={level} testID={`tactical-ready-slot-${level}`} label={`${level}º`} selected={readySlotLevel === level} onPress={() => setReadySlotLevel(level)} />)}
              </View>
            </>
          ) : null}
          <Field testID="tactical-ready-trigger" label="Gatilho perceptível" value={readyTrigger} onChangeText={setReadyTrigger} />
          <Text style={{ color: colors.onSurfaceVariant }}>Magias preparadas gastam o slot e iniciam concentração no momento do Ready, não quando o gatilho dispara.</Text>
          <Button testID="tactical-ready-prepare" label="Preparar ação" onPress={prepareReady} disabled={!selectedReadyActionId} />
        </Card>
      ) : null}

      {scenario?.readyActions?.length ? (
        <Card title="Ações preparadas" subtitle="Dispare manualmente quando o gatilho descrito ocorrer.">
          {scenario.readyActions.map((ready) => (
            <Card key={ready.id} variant="outlined" title={ready.actionName} subtitle={ready.trigger}>
              <Text>{ready.resourcesCommitted ? 'Recursos já comprometidos.' : 'Recursos serão gastos ao resolver.'}</Text>
              <Button testID="tactical-ready-trigger-now" label="O gatilho ocorreu" onPress={() => triggerReady(ready.id)} disabled={Boolean(scenario.pendingReaction)} />
              <Button label="Cancelar Ready" variant="text" onPress={() => persistTurnResult(cancelReadyAction({ scenario, character, readyActionId: ready.id }))} />
            </Card>
          ))}
        </Card>
      ) : null}

      {scenario ? (
        <Card title="Alvos persistentes" subtitle={scenario.spatialMode === 'map2d' ? 'Distâncias usam as coordenadas X/Y e a regra diagonal escolhida; cobertura e linha de visão continuam individuais por alvo.' : 'Posição é medida em linha; PV são opcionais e permitem aplicar dano real de reações.'}>
          {(scenario.targets ?? []).map((target) => (
            <Card key={target.id} variant="outlined" title={target.name} subtitle={`${tacticalDistanceToTarget(scenario, target)} ft · Speed ${effectiveTargetSpeed(target)}/${target.speedFeet}${scenario.spatialMode === 'map2d' ? ` · (${targetMapPoint(target).xFeet}, ${targetMapPoint(target).yFeet})` : ''}`}>
              <Field label="Nome" value={target.name} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, name: text }))} />
              <Field label="CA" value={target.armorClass === undefined ? '' : String(target.armorClass)} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, armorClass: text ? Number(text) || undefined : undefined }))} keyboardType="number-pad" />
              <Field label="PV atuais" value={target.hitPoints ? String(target.hitPoints.current) : ''} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, hitPoints: { current: Math.max(0, Number(text) || 0), max: current.hitPoints?.max ?? Math.max(0, Number(text) || 0), temporary: current.hitPoints?.temporary ?? 0 } }))} keyboardType="number-pad" />
              <Field label="PV máximos" value={target.hitPoints ? String(target.hitPoints.max) : ''} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, hitPoints: { current: current.hitPoints?.current ?? 0, max: Math.max(0, Number(text) || 0), temporary: current.hitPoints?.temporary ?? 0 } }))} keyboardType="number-pad" />
              {scenario.spatialMode === 'map2d' ? (
                <>
                  <Field label="X (ft)" value={String(targetMapPoint(target).xFeet)} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, mapPosition: { ...targetMapPoint(current), xFeet: Number(text) || 0 } }))} />
                  <Field label="Y (ft)" value={String(targetMapPoint(target).yFeet)} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, mapPosition: { ...targetMapPoint(current), yFeet: Number(text) || 0 } }))} />
                  <StatRow label="Terreno na posição" value={(scenario.terrainRegions ?? []).filter((region) => pointInTerrainRegion(targetMapPoint(target), region)).map((region) => region.label).join(', ') || 'Normal'} />
                </>
              ) : <Field label="Posição (ft)" value={String(target.positionFeet)} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, positionFeet: Math.max(0, Number(text) || 0) }))} keyboardType="number-pad" />}
              <Field label="Speed base" value={String(target.speedFeet)} onChangeText={(text) => updateTarget(scenario.id, target.id, (current) => ({ ...current, speedFeet: Math.max(0, Number(text) || 0) }))} keyboardType="number-pad" />
              <Text style={{ fontWeight: '800' }}>Tamanho</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as CreatureSize[]).map((size) => <Chip key={size} label={size} selected={target.size === size} onPress={() => updateTarget(scenario.id, target.id, (current) => ({ ...current, size }))} />)}
              </View>
              <Text style={{ fontWeight: '800' }}>Cobertura</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {([['none', 'Nenhuma'], ['half', 'Meia'], ['threeQuarters', '3/4'], ['total', 'Total']] as Array<[CoverLevel, string]>).map(([cover, label]) => <Chip key={cover} label={label} selected={target.cover === cover} onPress={() => updateTarget(scenario.id, target.id, (current) => ({ ...current, cover }))} />)}
                <Chip label="Linha de visão" selected={target.lineOfSight} onPress={() => updateTarget(scenario.id, target.id, (current) => ({ ...current, lineOfSight: !current.lineOfSight }))} />
              </View>
              {target.effects.length || target.conditions.length ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontWeight: '800' }}>Condições e efeitos</Text>
                  {target.effects.map((effect) => <Text key={effect.id}>• {effect.label}{effect.kind === 'slow' ? ` · Speed efetiva ${effectiveTargetSpeed(target)}` : ''}</Text>)}
                  {target.conditions.map((condition) => <Text key={condition}>• {condition}</Text>)}
                </View>
              ) : <Text style={{ color: colors.onSurfaceVariant }}>Sem condições persistentes.</Text>}
              {target.sourceCreatureItemId ? (
                <View style={{ gap: 6 }}>
                  <StatRow label="Stat block" value={target.sourceCreatureImportItemId ?? target.sourceCreatureItemId} />
                  <StatRow label="Ações importadas" value={target.statBlockActions?.length ?? 0} />
                  {(target.statBlockResources ?? []).map((resource) => (
                    <Card key={resource.id} variant="filled" title={resource.name} subtitle={`${resource.current}/${resource.max} uso(s) · ${resource.recharge === 'rechargeRoll' ? `recarga ${resource.rechargeMin ?? 6}-${resource.rechargeMax ?? 6}` : resource.recharge === 'longRest' ? 'recupera no descanso longo/dia' : 'recarga manual'}`}>
                      <Button
                        label={resource.current >= resource.max ? 'Disponível' : resource.recharge === 'rechargeRoll' ? 'Rolar recarga' : 'Restaurar usos'}
                        variant="outlined"
                        disabled={resource.current >= resource.max}
                        onPress={() => rechargeImportedTargetResource(target.id, resource.id)}
                      />
                    </Card>
                  ))}
                </View>
              ) : null}
              <Button label="Remover alvo" variant="text" onPress={() => removeTarget(scenario.id, target.id)} disabled={(scenario.targets?.length ?? 0) <= 1} />
            </Card>
          ))}
          <Card variant="filled" title="Adicionar alvo do compêndio" subtitle={`${tacticalCreatureCandidates.length} creature stat block(s) disponíveis nas fontes ativas.`}>
            <Field label="Buscar criatura" value={creatureSearch} onChangeText={setCreatureSearch} placeholder="Ex.: Wolf, Imp, Skeleton" />
            {visibleCreatureCandidates.map((item) => {
              const projection = projectCreatureStatBlockToTacticalTarget(item);
              return (
                <Card key={item.id} variant="outlined" title={item.name} subtitle={`${projection.target.size ?? 'Medium'} · CA ${projection.target.armorClass ?? '?'} · PV ${projection.target.hitPoints?.max ?? '?'} · ${projection.actions.length} ação(ões)`}>
                  <Button label="Adicionar este stat block" onPress={() => addCreatureTarget(item)} />
                </Card>
              );
            })}
            {!visibleCreatureCandidates.length ? <Text>Nenhum creature stat block corresponde à busca.</Text> : null}
          </Card>
          <Field label="Nome do novo alvo manual" value={newTargetName} onChangeText={setNewTargetName} />
          <Button label="Adicionar alvo manual" onPress={() => { const positionFeet = 10 + (scenario.targets?.length ?? 0) * 5; addTarget(scenario.id, { name: newTargetName, positionFeet, mapPosition: scenario.spatialMode === 'map2d' ? { xFeet: positionFeet, yFeet: 0 } : undefined }); }} />
        </Card>
      ) : null}

      <Card variant="filled" title="Resolver rotação do personagem" subtitle="Informe acertos confirmados para aplicar Weapon Mastery e movimento forçado.">
        {character.rotations.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {character.rotations.map((entry) => <Chip key={entry.id} label={entry.name} selected={entry.id === rotation?.id} onPress={() => setSelectedRotationId(entry.id)} />)}
          </View>
        ) : <Text>Nenhuma rotação criada.</Text>}
        {rotation && rotationActivationOptions.some((option) => option.targetMode === 'turn') ? (
          <Card variant="outlined" title="Ativações desta resolução" subtitle="Ative recursos de turno sem precisar recriar a rotação salva.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {rotationActivationOptions.filter((option) => option.targetMode === 'turn').map((option) => {
                const activation = instantiateTurnFeatureActivation(option);
                const selected = selectedActivations.some((entry) => entry.id === activation.id);
                return <Chip key={option.id} label={option.name} selected={selected} onPress={() => toggleTacticalActivation(option)} />;
              })}
            </View>
            {rotationActivationOptions.filter((option) => option.targetMode === 'turn').map((option) => (
              <Text key={`${option.id}:summary`} style={{ color: colors.onSurfaceVariant }}>• {option.name}: {option.summary}</Text>
            ))}
          </Card>
        ) : null}
        {metamagicSources.length ? (
          <Card variant="outlined" title="Metamagic" subtitle="As ativações abaixo são limitadas às opções selecionadas em cada fonte do personagem.">
            {metamagicSources.map((source) => (
              <Text key={source.id} style={{ color: colors.onSurfaceVariant }}>
                {source.label}: {source.selectedOptionIds.length}/{source.optionLimit} selecionada(s)
              </Text>
            ))}
            <Button label="Configurar Metamagic" variant="outlined" onPress={() => router.push(`/characters/${character.id}/metamagic`)} />
          </Card>
        ) : null}
        {rotation && scenario ? rotation.actions.map((entry, index) => {
          const targetId = targetsByAction[entry.id] ?? entry.targetId ?? scenario.targets?.[0]?.id;
          const hasTopple = entry.action.type === 'attack' && entry.action.mastery?.property === 'topple';
          const supportsMultipleTargets = tacticalActionSupportsMultipleTargets(entry.action);
          const targetLimit = tacticalActionTargetLimit(entry.action);
          const selectedTargetIds = supportsMultipleTargets
            ? (multiTargetsByAction[entry.id]?.length ? multiTargetsByAction[entry.id] : targetId ? [targetId] : [])
            : targetId ? [targetId] : [];
          const areaDescription = entry.action.type === 'spell' ? describeTacticalAreaTemplate(entry.action.area) : undefined;
          const areaMembership = entry.action.type === 'spell' && entry.action.area
            ? tacticalTargetsInsideArea(scenario, entry.action.area, targetId)
            : undefined;
          const tracksHits = entry.action.type === 'attack' || (entry.action.type === 'spell' && ((entry.action.attacksCount ?? 0) > 0 || entry.action.forcedMovementFt));
          const actionActivationOptions = rotationActivationOptions.filter((option) => option.targetMode === 'action' && option.eligibleActionIds.includes(entry.action.id));
          return (
            <Card key={entry.id} variant="outlined" title={`${index + 1}. ${entry.name}`} subtitle={`${entry.action.type} · ${supportsMultipleTargets ? 'múltiplos alvos' : 'alvo único'} · resultado real`}>
              {entry.action.type === 'attack' ? (
                <Field
                  label={`Ataques nesta resolução (máximo com ativações atuais: ${maxTacticalAttackCount})`}
                  value={attackOverrides[entry.id] ?? String(entry.attackCountOverride ?? entry.action.attacksCount ?? 1)}
                  onChangeText={(text) => storedRotation && setAttackCountOverridesByRotation((current) => ({
                    ...current,
                    [storedRotation.id]: { ...(current[storedRotation.id] ?? {}), [entry.id]: text }
                  }))}
                  keyboardType="number-pad"
                />
              ) : null}
              {actionActivationOptions.length ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontWeight: '800' }}>Ativações desta ação</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {actionActivationOptions.map((option) => {
                      const activation = instantiateTurnFeatureActivation(option, entry.action.id);
                      const selected = selectedActivations.some((candidate) => candidate.id === activation.id);
                      return <Chip key={option.id} label={option.name} selected={selected} onPress={() => toggleTacticalActivation(option, entry.action.id)} />;
                    })}
                  </View>
                  {actionActivationOptions.map((option) => <Text key={`${entry.id}:${option.id}:summary`} style={{ color: colors.onSurfaceVariant }}>• {option.name}: {option.summary}</Text>)}
                </View>
              ) : null}
              {areaDescription ? <Text style={{ fontWeight: '800' }}>Área: {areaDescription}</Text> : null}
              {entry.action.type === 'spell' && entry.action.targetDescription ? <Text>{entry.action.targetDescription}</Text> : null}
              <Text style={{ fontWeight: '800' }}>{supportsMultipleTargets ? 'Alvo de referência' : 'Alvo'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(scenario.targets ?? []).map((target) => <Chip key={target.id} label={target.name} selected={targetId === target.id} onPress={() => {
                  setTargetsByAction((current) => ({ ...current, [entry.id]: target.id }));
                  if (entry.action.type === 'attack' && entry.action.mastery?.property === 'cleave') {
                    setMultiTargetsByAction((current) => ({
                      ...current,
                      [entry.id]: [target.id, ...(current[entry.id] ?? []).filter((candidate) => candidate !== target.id).slice(0, 1)]
                    }));
                  }
                }} />)}
              </View>
              {supportsMultipleTargets ? (
                <>
                  <Text style={{ fontWeight: '800' }}>Alvos afetados{targetLimit ? ` · máximo ${targetLimit}` : ''}</Text>
                  <Text style={{ color: colors.onSurfaceVariant }}>{entry.action.type === 'spell' && entry.action.area
                    ? scenario.spatialMode === 'map2d'
                      ? areaMembership?.automatic
                        ? 'O mapa pode calcular automaticamente os alvos pela geometria e pelo alvo de referência; você ainda pode ajustar a seleção manualmente.'
                        : `Seleção manual necessária: ${areaMembership?.reason ?? 'geometria não inferível com segurança.'}`
                      : 'Como o cenário usa posição linear, marque manualmente quem está dentro da área mostrada acima.'
                    : entry.action.type === 'attack' ? 'Cleave permite um alvo secundário adjacente ao alvo principal.' : 'Distribua ataques/raios entre os alvos selecionados.'}</Text>
                  {entry.action.type === 'spell' && entry.action.area && areaMembership?.automatic ? (
                    <Button label={`Selecionar pela área (${areaMembership.targetIds.length})`} variant="outlined" onPress={() => setMultiTargetsByAction((current) => ({ ...current, [entry.id]: areaMembership.targetIds }))} />
                  ) : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(scenario.targets ?? []).map((target) => {
                      const selected = selectedTargetIds.includes(target.id);
                      const cleavePrimary = entry.action.type === 'attack' && entry.action.mastery?.property === 'cleave' && target.id === targetId;
                      return <Chip key={target.id} label={cleavePrimary ? `${target.name} · principal` : target.name} selected={selected || cleavePrimary} disabled={cleavePrimary} onPress={() => setMultiTargetsByAction((current) => ({
                        ...current,
                        [entry.id]: toggleTacticalTargetId(current[entry.id]?.length ? current[entry.id] : targetId ? [targetId] : [], target.id, targetLimit)
                      }))} />;
                    })}
                  </View>
                </>
              ) : null}
              {!supportsMultipleTargets && tracksHits ? <Field label="Acertos confirmados" value={hitsByAction[entry.id] ?? '0'} onChangeText={(text) => setHitsByAction((current) => ({ ...current, [entry.id]: text }))} keyboardType="number-pad" /> : null}
              {supportsMultipleTargets ? selectedTargetIds.map((selectedTargetId) => {
                const selectedTarget = scenario.targets?.find((target) => target.id === selectedTargetId);
                if (!selectedTarget) return null;
                const isPrimary = selectedTargetId === targetId;
                return (
                  <Card key={`${entry.id}:${selectedTargetId}`} variant="filled" title={selectedTarget.name} subtitle={isPrimary ? 'Alvo de referência' : entry.action.type === 'attack' ? 'Alvo secundário' : 'Alvo afetado'}>
                    {tracksHits ? <Field label="Acertos neste alvo" value={targetHitsByAction[entry.id]?.[selectedTargetId] ?? (isPrimary ? hitsByAction[entry.id] ?? '0' : '0')} onChangeText={(text) => setTargetHitsByAction((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? {}), [selectedTargetId]: text } }))} keyboardType="number-pad" /> : null}
                    {entry.action.type === 'spell' && entry.action.saveAbility ? (
                      <>
                        <Text style={{ fontWeight: '800' }}>Salvaguarda de {entry.action.saveAbility}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {([['pending', 'Pendente'], ['success', 'Sucesso'], ['failure', 'Falha']] as const).map(([value, label]) => <Chip key={value} label={label} selected={(targetSavesByAction[entry.id]?.[selectedTargetId] ?? 'pending') === value} onPress={() => setTargetSavesByAction((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? {}), [selectedTargetId]: value } }))} />)}
                        </View>
                        {entry.action.saveSuccessDamage === 'half' ? <Text style={{ color: colors.onSurfaceVariant }}>Em sucesso, o app aplicará metade do dano informado abaixo.</Text> : entry.action.saveSuccessDamage === 'none' ? <Text style={{ color: colors.onSurfaceVariant }}>Em sucesso, o dano informado abaixo será reduzido a zero.</Text> : null}
                      </>
                    ) : null}
                    {entry.action.damage ? <Field label="Dano total rolado/declarado" value={targetDamageByAction[entry.id]?.[selectedTargetId] ?? '0'} onChangeText={(text) => setTargetDamageByAction((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? {}), [selectedTargetId]: text } }))} keyboardType="number-pad" /> : null}
                    {entry.action.type === 'spell' && entry.action.conditionIds?.length ? <Text>Condições em falha/acerto aplicável: {entry.action.conditionIds.join(', ')}</Text> : null}
                    {selectedTarget.hitPoints ? <StatRow label="PV atuais" value={`${selectedTarget.hitPoints.current}/${selectedTarget.hitPoints.max}`} /> : <Text style={{ color: colors.onSurfaceVariant }}>PV não definidos; o dano será registrado no histórico sem alterar PV.</Text>}
                  </Card>
                );
              }) : null}
              {entry.movement ? <Text>Movimento antes da ação: {entry.movement.kind} {entry.movement.distanceFeet} ft{scenario.difficultTerrain ? ' (todo o campo difícil)' : scenario.spatialMode === 'map2d' && (scenario.terrainRegions?.length ?? 0) > 0 ? ' (custo depende das regiões atravessadas)' : ''}.</Text> : null}
              {hasTopple ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {([['pending', 'Save pendente'], ['success', 'Passou'], ['failure', 'Falhou / Prone']] as const).map(([value, label]) => <Chip key={value} label={label} selected={(toppleByAction[entry.id] ?? 'pending') === value} onPress={() => setToppleByAction((current) => ({ ...current, [entry.id]: value }))} />)}
                </View>
              ) : null}
            </Card>
          );
        }) : null}
        {analysis?.movement ? <StatRow label="Movimento previsto" value={`${analysis.movement.movementSpentFeet}/${analysis.movement.speedFeet} ft${analysis.movement.difficultTerrain ? ' · terreno difícil' : ''}`} /> : null}
        {allIssues.length ? <IssueList issues={allIssues} /> : null}
        <Button label="Resolver, gastar recursos e aplicar turno" onPress={resolveTurn} disabled={!rotation || !scenario || allIssues.some((issue) => issue.severity === 'error')} />
      </Card>

      {scenario?.battlefieldItems?.length ? (
        <Card title="Pós-combate: projéteis e armas no campo" subtitle="Munições usam 50% de recuperação por padrão; armas arremessadas usam 100%.">
          <Button label="Resolver todas as recuperações automáticas" variant="outlined" onPress={recoverAutomatic} disabled={!scenario.battlefieldItems.some((item) => item.recoveryMode === 'automatic')} />
          {scenario.battlefieldItems.map((item) => (
            <Card key={item.id} variant="outlined" title={`${item.label} ×${item.quantity}`} subtitle={item.kind === 'ammunition' ? 'Munição disparada' : 'Arma arremessada'}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {([['automatic', 'Automática'], ['manual', 'Manual'], ['none', 'Não recuperar']] as Array<[BattlefieldRecoveryMode, string]>).map(([mode, label]) => <Chip key={mode} label={label} selected={item.recoveryMode === mode} onPress={() => updateScenario(scenario.id, (current) => ({ ...current, battlefieldItems: (current.battlefieldItems ?? []).map((entry) => entry.id === item.id ? { ...entry, recoveryMode: mode } : entry) }))} />)}
              </View>
              <Field label="Percentual recuperável" value={String(item.recoveryPercent)} onChangeText={(text) => updateScenario(scenario.id, (current) => ({ ...current, battlefieldItems: (current.battlefieldItems ?? []).map((entry) => entry.id === item.id ? { ...entry, recoveryPercent: Math.max(0, Math.min(100, Number(text) || 0)) } : entry) }))} keyboardType="number-pad" />
              <Button label="Resolver recuperação" onPress={() => recoverItem(item.id)} disabled={item.recoveryMode === 'none'} />
            </Card>
          ))}
        </Card>
      ) : null}

      {scenario?.tacticalLog?.length ? (
        <Card title="Histórico tático" subtitle="Ataques, dano, concentração, reações, movimento e transições de turno.">
          {scenario.tacticalLog.slice(-20).reverse().map((entry) => <Text key={entry.id}>R{entry.round} · {entry.message}</Text>)}
        </Card>
      ) : null}

      <Button label="Criar nova rotação" variant="outlined" onPress={() => router.push(`/characters/${character.id}/rotations/new`)} />
      <Button label="Análise de dano" variant="outlined" onPress={() => router.push(`/characters/${character.id}/analysis`)} />
      <Button label="Voltar à ficha" variant="text" onPress={() => router.push(`/characters/${character.id}`)} />
    </Screen>
  );
}
