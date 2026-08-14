import { AttackAction, Character, CombatState, RuleSource, SpellAction, TurnRotation, Weapon, Spell } from '../types';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { createId } from '../utils/id';

export const manualSource: RuleSource = {
  id: 'manual-mvp',
  book: 'Manual entry',
  page: '-',
  version: 'MVP',
  status: 'active',
  confidence: 'manual',
  notes: 'Conteúdo inserido manualmente pelo usuário. Não é uma regra oficial embutida.'
};

export const defaultCombatState: CombatState = {
  rollMode: 'normal',
  targetCount: 1,
  resistanceMultiplier: 1,
  critRange: 20
};

/**
 * Clean character used by the user-facing creation flow. The richer
 * createDefaultCharacter fixture remains available for engine tests and demos.
 */
export const createEmptyCharacter = (name = ''): Character => ({
  id: createId('char'),
  name,
  level: 1,
  classes: [],
  subclasses: [],
  abilityScoreBonuses: {},
  abilityGeneration: { method: 'standardArray', generatedValues: [15, 14, 13, 12, 10, 8] },
  featChoices: [],
  buildChoices: { speciesChoices: [], subclassChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [], eldritchInvocationCounts: {}, eldritchInvocationChoices: [] },
  pendingChoices: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 },
  armors: [],
  armorAccessories: [],
  weapons: [],
  equipment: [],
  magicItems: [],
  feats: [],
  spells: [],
  spellbookEntries: [],
  weaponMasteries: [],
  features: [],
  resources: [],
  spellSlots: [],
  activeEffects: [],
  rotations: [],
  compendiumLinks: []
});

export const createDefaultCharacter = (name = 'Novo Personagem'): Character => {
  const id = createId('char');
  const trainingWeaponId = createId('weapon');
  const trainingSpellId = createId('spell');

  const weapon: Weapon = {
    id: trainingWeaponId,
    name: 'Arma manual',
    weaponType: 'manual',
    attackAbility: 'STR',
    damageAbility: 'STR',
    damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' }),
    source: manualSource,
    quantity: 1,
    equipped: true,
    handsRequired: 1
  };

  const spell: Spell = {
    id: trainingSpellId,
    name: 'Magia ofensiva manual',
    level: 0,
    castingTime: 'action',
    requiresAttackRoll: true,
    targeting: { targets: 1 },
    damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }),
    source: manualSource
  };

  const weaponAction: AttackAction = {
    id: `attack_${weapon.id}`,
    type: 'attack',
    name: weapon.name,
    actionCost: 'action',
    sourceType: 'weapon',
    source: manualSource,
    weaponId: weapon.id,
    attackAbility: 'STR',
    damage: weapon.damage,
    attacksCount: 1,
    tags: ['weapon']
  };

  const spellAction: SpellAction = {
    id: `spell_${spell.id}`,
    type: 'spell',
    name: spell.name,
    actionCost: 'action',
    sourceType: 'spell',
    source: manualSource,
    spellId: spell.id,
    spellLevel: spell.level,
    damage: spell.damage,
    targets: 1,
    tags: ['spell']
  };

  const defaultRotation: TurnRotation = {
    id: createId('rot'),
    characterId: id,
    name: 'Ataque básico',
    favorite: true,
    actions: [{ id: createId('turnAction'), name: weaponAction.name, actionCost: weaponAction.actionCost, action: weaponAction }],
    notes: `A rotação de magia básica pode ser criada usando a ação ${spellAction.name}.`
  };

  return {
    id,
    name,
    level: 1,
    classes: [{ id: createId('class'), name: 'Classe manual', level: 1, source: manualSource }],
    subclasses: [],
    abilityScoreBonuses: {},
    abilityGeneration: { method: 'manual', generatedValues: [16, 14, 14, 10, 10, 10] },
    featChoices: [],
    buildChoices: { speciesChoices: [], subclassChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [], eldritchInvocationCounts: {}, eldritchInvocationChoices: [] },
    pendingChoices: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
    abilities: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 10 },
    armors: [],
    armorAccessories: [],
    weapons: [weapon],
    equipment: [],
    magicItems: [],
    feats: [],
    spells: [spell],
    spellbookEntries: [],
    weaponMasteries: [],
    features: [],
    resources: [],
    spellSlots: [],
    activeEffects: [],
    rotations: [defaultRotation],
    compendiumLinks: []
  };
};
