import type {
  Character,
  RuleValidationIssue,
  TurnAction,
  TurnRotation,
  Weapon,
  WeaponInteractionKind
} from '../types';
import { getActiveLoadout, getEquippedArmorAccessories, isShieldArmor, weaponHandsRequired } from './equipmentLoadoutRules';
import { validateSpellComponents, type SpellHandState } from './spellComponentRules';
import { turnExtraActionAllowance } from '../rules-engine/turns/turnFeatureActivations';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const hasFeatureNamed = (character: Character, name: string): boolean =>
  character.features.some((feature) => normalize(feature.name) === normalize(name));

const hasFeatNamed = (character: Character, name: string): boolean =>
  character.feats.some((feat) => normalize(feat.name) === normalize(name));

const classLevel = (character: Character, name: string): number =>
  character.classes.find((entry) => normalize(entry.name) === normalize(name))?.level ?? 0;

export const attackActionCapacity = (character: Character): number => {
  let result = 1;
  const fighter = classLevel(character, 'fighter');
  if (fighter >= 20) result = Math.max(result, 4);
  else if (fighter >= 11) result = Math.max(result, 3);
  else if (fighter >= 5) result = Math.max(result, 2);

  for (const name of ['barbarian', 'monk', 'paladin', 'ranger']) {
    if (classLevel(character, name) >= 5) result = Math.max(result, 2);
  }
  const valorBard = character.subclasses.some((entry) => normalize(entry.name).includes('valor'));
  if (valorBard && classLevel(character, 'bard') >= 6) result = Math.max(result, 2);

  // Imported and homebrew progression features can define the Attack action capacity
  // explicitly. This keeps custom classes compatible without relying on their name.
  for (const feature of character.features) {
    if (feature.attackActionAttackCount !== undefined) {
      result = Math.max(result, Math.max(1, Math.floor(feature.attackActionAttackCount)));
    }
  }

  if (hasFeatureNamed(character, 'Devouring Blade')) result = Math.max(result, 3);
  else if (hasFeatureNamed(character, 'Thirsting Blade')) result = Math.max(result, 2);
  return result;
};

export const turnActionAttackCount = (entry: TurnAction): number => {
  if (entry.action.type !== 'attack') return Math.max(1, entry.repeat ?? 1);
  const base = entry.attackCountOverride ?? entry.action.attacksCount ?? 1;
  return Math.max(0, Math.floor(base)) * Math.max(1, entry.repeat ?? 1);
};

interface HandState extends SpellHandState {
  mainHandWeaponId?: string;
  offHandWeaponId?: string;
  droppedWeaponIds: Set<string>;
}

const initialHandState = (character: Character): HandState => {
  const loadout = getActiveLoadout(character);
  return {
    mainHandWeaponId: loadout.mainHandWeaponId,
    offHandWeaponId: loadout.offHandWeaponId,
    heldFocusEquipmentId: loadout.heldFocusEquipmentId,
    shieldEquipped: getEquippedArmorAccessories(character).some(isShieldArmor),
    droppedWeaponIds: new Set<string>()
  };
};

const heldHandForWeapon = (state: HandState, weaponId: string): 'main' | 'off' | undefined =>
  state.mainHandWeaponId === weaponId ? 'main' : state.offHandWeaponId === weaponId ? 'off' : undefined;

const clearWeapon = (state: HandState, weaponId?: string): void => {
  if (!weaponId) return;
  if (state.mainHandWeaponId === weaponId) state.mainHandWeaponId = undefined;
  if (state.offHandWeaponId === weaponId) state.offHandWeaponId = undefined;
};

const handOccupied = (state: HandState, hand: 'main' | 'off'): boolean => {
  if (hand === 'main') return Boolean(state.mainHandWeaponId);
  return Boolean(state.offHandWeaponId || state.shieldEquipped || state.heldFocusEquipmentId);
};

const firstFreeHand = (state: HandState): 'main' | 'off' | undefined => {
  if (!handOccupied(state, 'main')) return 'main';
  if (!handOccupied(state, 'off')) return 'off';
  return undefined;
};

const interactionWeight = (kind: WeaponInteractionKind): number => kind === 'swap' ? 2 : kind === 'drop' ? 0 : 1;

const applyWeaponInteraction = (
  state: HandState,
  entry: TurnAction,
  character: Character,
  issues: RuleValidationIssue[]
): void => {
  const operation = entry.weaponOperation;
  if (!operation) return;
  const weapon = operation.weaponId ? character.weapons.find((candidate) => candidate.id === operation.weaponId) : undefined;

  if (operation.kind !== 'drop' && operation.kind !== 'stow' && !weapon) {
    issues.push({ severity: 'error', code: 'WEAPON_INTERACTION_WEAPON_MISSING', message: `A interação antes/depois de "${entry.name}" aponta para uma arma inexistente.` });
    return;
  }

  if (operation.kind === 'stow' || operation.kind === 'drop') {
    if (!operation.weaponId || !heldHandForWeapon(state, operation.weaponId)) {
      issues.push({ severity: 'error', code: 'WEAPON_INTERACTION_NOT_HELD', message: `Não é possível ${operation.kind === 'drop' ? 'deixar cair' : 'guardar'} a arma configurada em "${entry.name}" porque ela não está em uma mão.` });
      return;
    }
    clearWeapon(state, operation.weaponId);
    if (operation.kind === 'drop') state.droppedWeaponIds.add(operation.weaponId);
    return;
  }

  if (operation.kind === 'swap') {
    const hand = operation.hand ?? 'main';
    const current = hand === 'main' ? state.mainHandWeaponId : state.offHandWeaponId;
    if (current) clearWeapon(state, current);
    if (handOccupied(state, hand)) {
      issues.push({ severity: 'error', code: 'WEAPON_SWAP_HAND_OCCUPIED', message: `A mão ${hand === 'main' ? 'principal' : 'secundária'} não ficou livre para concluir a troca em "${entry.name}".` });
      return;
    }
    if (hand === 'main') state.mainHandWeaponId = weapon!.id;
    else state.offHandWeaponId = weapon!.id;
    return;
  }

  if (operation.kind === 'pickup' && !state.droppedWeaponIds.has(weapon!.id)) {
    issues.push({ severity: 'warning', code: 'WEAPON_PICKUP_NOT_TRACKED', message: `${weapon!.name} não havia sido registrada como caída nesta rotação; a coleta foi mantida como interação manual.` });
  }
  const hand = operation.hand ?? firstFreeHand(state);
  if (!hand || handOccupied(state, hand)) {
    issues.push({ severity: 'error', code: 'WEAPON_INTERACTION_NO_FREE_HAND', message: `Não há uma mão livre para ${operation.kind === 'pickup' ? 'recolher' : 'sacar'} ${weapon!.name} antes/depois de "${entry.name}".` });
    return;
  }
  if (hand === 'main') state.mainHandWeaponId = weapon!.id;
  else state.offHandWeaponId = weapon!.id;
  state.droppedWeaponIds.delete(weapon!.id);
};

const isThrown = (weapon: Weapon): boolean =>
  (weapon.properties ?? []).some((property) => normalize(property) === 'thrown') || weapon.weaponType === 'thrown';

const isLoading = (entry: TurnAction): boolean => entry.action.type === 'attack' && (
  entry.action.loading === true || Boolean(entry.action.tags?.some((tag) => normalize(tag) === 'loading'))
);

const isLight = (entry: TurnAction): boolean => entry.action.type === 'attack' && (
  entry.action.light === true || Boolean(entry.action.tags?.some((tag) => normalize(tag) === 'light'))
);

const validateAttackHands = (
  state: HandState,
  entry: TurnAction,
  character: Character,
  issues: RuleValidationIssue[]
): void => {
  const action = entry.action;
  if (action.type !== 'attack' || !action.weaponId || action.tags?.includes('pact-familiar')) return;
  const weapon = character.weapons.find((candidate) => candidate.id === action.weaponId);
  if (!weapon) return;
  let held = heldHandForWeapon(state, weapon.id);
  if (!held && isThrown(weapon)) {
    const hand = firstFreeHand(state);
    if (!hand) {
      issues.push({ severity: 'error', code: 'THROWN_WEAPON_NO_FREE_HAND', message: `${weapon.name} pode ser sacada como parte do ataque arremessado, mas não existe uma mão livre.` });
      return;
    }
    if (hand === 'main') state.mainHandWeaponId = weapon.id;
    else state.offHandWeaponId = weapon.id;
    held = hand;
  }
  if (!held) {
    issues.push({ severity: 'error', code: 'ROTATION_WEAPON_NOT_HELD', message: `${entry.name} usa ${weapon.name}, mas a arma não está em uma mão neste ponto da sequência.` });
    return;
  }

  const required = action.handsRequired ?? (action.weaponGrip === 'twoHanded' ? 2 : weaponHandsRequired(weapon));
  if (required === 2) {
    const otherOccupied = held === 'main'
      ? Boolean(state.offHandWeaponId || state.shieldEquipped || state.heldFocusEquipmentId)
      : Boolean(state.mainHandWeaponId);
    if (otherOccupied) issues.push({
      severity: 'error',
      code: 'TWO_HANDED_ATTACK_HAND_BLOCKED',
      message: `${entry.name} exige duas mãos no momento do ataque. Libere a outra mão${state.shieldEquipped ? ' removendo o escudo do loadout' : ''}.`
    });
  }

  if (isThrown(weapon)) clearWeapon(state, weapon.id);
};

export const validateRotationInteractionEconomy = (
  rotation: TurnRotation,
  character: Character
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const state = initialHandState(character);
  const baseAttackCapacity = attackActionCapacity(character);
  const attackCapacity = baseAttackCapacity * (1 + turnExtraActionAllowance(rotation));
  let weaponAttackCount = 0;
  let generalInteractions = 0;
  let nickUsed = false;
  let previousLightWeaponId: string | undefined;
  const loadingByCost = new Map<string, number>();

  for (const entry of rotation.actions) {
    const attackCount = turnActionAttackCount(entry);
    const operation = entry.weaponOperation;
    const operationWeight = operation ? interactionWeight(operation.kind) : 0;
    const isWeaponAttackInAttackAction = entry.action.type === 'attack' && Boolean(entry.action.weaponId) && entry.actionCost === 'action' && !entry.action.tags?.includes('pact-familiar');

    if (isWeaponAttackInAttackAction) weaponAttackCount += attackCount;
    if (operation) {
      if (isWeaponAttackInAttackAction) {
        if (operationWeight > attackCount) issues.push({
          severity: 'error',
          code: 'WEAPON_INTERACTION_LIMIT_EXCEEDED',
          message: `${entry.name} possui ${attackCount} ataque(s), mas a operação ${operation.kind} consome ${operationWeight} interação(ões) de equipar/guardar. Divida a sequência entre ataques.`
        });
      } else if (operation.kind !== 'drop') {
        generalInteractions += operationWeight;
        if (generalInteractions > 1) issues.push({ severity: 'error', code: 'GENERAL_OBJECT_INTERACTION_EXCEEDED', message: 'A rotação usa mais de uma interação geral de objeto fora da Ação de Ataque.' });
      }
    }

    if (operation?.timing !== 'after') applyWeaponInteraction(state, entry, character, issues);

    if (entry.action.type === 'attack') {
      validateAttackHands(state, entry, character, issues);
      const loadingKey = `${entry.actionCost}`;
      if (isLoading(entry) && !hasFeatNamed(character, 'Crossbow Expert')) {
        const total = (loadingByCost.get(loadingKey) ?? 0) + attackCount;
        loadingByCost.set(loadingKey, total);
        if (total > 1) issues.push({ severity: 'error', code: 'LOADING_ATTACK_LIMIT', message: `${entry.name} possui Loading e só pode disparar uma vez quando usa ${entry.actionCost}, salvo regra que ignore Loading.` });
      }

      const lightExtra = entry.action.tags?.includes('light-extra-attack') || entry.action.tags?.includes('nick-extra-attack');
      if (lightExtra) {
        if (!previousLightWeaponId || previousLightWeaponId === entry.action.weaponId) issues.push({
          severity: 'error',
          code: 'LIGHT_EXTRA_ATTACK_PREREQUISITE',
          message: `${entry.name} exige um ataque anterior, na mesma Ação de Ataque, com outra arma Light.`
        });
        if (entry.action.tags?.includes('nick-extra-attack')) {
          if (nickUsed) issues.push({ severity: 'error', code: 'NICK_ONCE_PER_TURN', message: 'Nick só pode mover um ataque Light para a Ação de Ataque uma vez por turno.' });
          nickUsed = true;
        }
      }
      if (isLight(entry) && !lightExtra && entry.action.weaponId) previousLightWeaponId = entry.action.weaponId;
    }

    if (entry.action.type === 'spell') issues.push(...validateSpellComponents(character, entry.action, state));
    if (operation?.timing === 'after') applyWeaponInteraction(state, entry, character, issues);
  }

  if (weaponAttackCount > attackCapacity) issues.push({
    severity: 'error',
    code: 'ATTACK_ACTION_CAPACITY_EXCEEDED',
    message: turnExtraActionAllowance(rotation) > 0
      ? `A rotação usa ${weaponAttackCount} ataques, mas ${1 + turnExtraActionAllowance(rotation)} Ações de Ataque permitem no máximo ${attackCapacity} ataque(s) nesta build.`
      : `A rotação usa ${weaponAttackCount} ataques na Ação de Ataque, mas a build permite ${attackCapacity}.`
  });

  return issues;
};
