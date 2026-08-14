import type { Character, CombatScenario, TacticalTarget } from '../types';
import { createEmptyCharacter, defaultCombatState, manualSource } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { ensureTacticalParticipants } from '../rules-engine/turns/turnCycle';
import { normalizeCombatScenario } from '../rules-engine/turns/tacticalCombat';

export const E2E_TACTICAL_CHARACTER_ID = 'e2e-tactical-mobile-character';
export const E2E_TACTICAL_SCENARIO_ID = 'e2e-tactical-mobile-scenario';
export const E2E_TACTICAL_TARGET_ID = 'e2e-tactical-mobile-target';
export const E2E_TACTICAL_READY_SPELL_ID = 'e2e-tactical-ready-spell';
export const E2E_TACTICAL_WAR_CASTER_SPELL_ID = 'e2e-tactical-war-caster-spell';

const generatedAt = '2026-08-11T12:00:00.000Z';

export const createE2ETacticalMobileCharacter = (): Character => ({
  ...createEmptyCharacter('E2E Tactical Hero'),
  id: E2E_TACTICAL_CHARACTER_ID,
  level: 4,
  classes: [{ id: 'e2e-tactical-wizard', name: 'Wizard', level: 4, source: manualSource }],
  abilities: { STR: 14, DEX: 14, CON: 16, INT: 18, WIS: 12, CHA: 10 },
  proficiencies: {
    skills: [], expertiseSkills: [], tools: [], weapons: ['Longsword'], armor: [], languages: [], savingThrows: ['INT', 'WIS']
  },
  hitPoints: { current: 32, max: 32, temporary: 0 },
  feats: [{ id: 'e2e-tactical-war-caster', name: 'War Caster', source: manualSource, features: [] }],
  weapons: [{
    id: 'e2e-tactical-longsword',
    name: 'E2E Longsword',
    weaponType: 'melee',
    damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' }),
    quantity: 1,
    equipped: true,
    handsRequired: 1,
    range: { normal: 5, unit: 'ft' },
    attackAbility: 'STR',
    damageAbility: 'STR',
    mastery: 'Sap',
    source: manualSource
  }],
  weaponMasteries: [{
    id: 'e2e-tactical-mastery-sap',
    sourceKind: 'manual',
    weaponName: 'E2E Longsword',
    mastery: 'Sap'
  }],
  spells: [{
    id: E2E_TACTICAL_WAR_CASTER_SPELL_ID,
    name: 'E2E Fire Bolt',
    level: 0,
    school: 'Evocation',
    castingTime: 'action',
    range: '120 ft',
    components: { verbal: true, somatic: true, material: false },
    requiresAttackRoll: true,
    damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }),
    targeting: { targets: 1, description: 'One creature' },
    concentration: false,
    source: manualSource,
    spellcastingClassName: 'Wizard'
  }, {
    id: E2E_TACTICAL_READY_SPELL_ID,
    name: 'E2E Arcane Lance',
    level: 1,
    school: 'Evocation',
    castingTime: 'action',
    range: '60 ft',
    components: { verbal: true, somatic: true, material: false },
    requiresAttackRoll: true,
    damage: parseDamageFormula('2d6', { defaultSourceType: 'spell' }),
    targeting: { targets: 1, description: 'One creature' },
    concentration: false,
    source: manualSource,
    spellcastingClassName: 'Wizard'
  }],
  spellSlots: [{
    id: 'e2e-tactical-slot-level-1',
    level: 1,
    max: 1,
    current: 1,
    recharge: 'longRest',
    poolKind: 'spellcasting',
    sourceClassId: 'e2e-tactical-wizard',
    sourceClassName: 'Wizard',
    source: manualSource
  }],
  activeEffects: [{
    id: 'e2e-tactical-concentration',
    name: 'E2E Concentration',
    kind: 'spell',
    sourceType: 'spell',
    source: manualSource,
    status: 'active',
    concentration: true,
    conditionIds: [],
    duration: { unit: 'manual', expiresOn: 'manual' },
    notes: 'Concentração preparada para validar dano e salvaguarda no E2E móvel.',
    createdAt: generatedAt
  }]
});

const createTarget = (): TacticalTarget => ({
  id: E2E_TACTICAL_TARGET_ID,
  name: 'E2E Training Orc',
  armorClass: 13,
  hitPoints: { current: 30, max: 30, temporary: 0 },
  initiative: 15,
  size: 'Medium',
  positionFeet: 5,
  speedFeet: 30,
  cover: 'none',
  lineOfSight: true,
  conditions: [],
  effects: [{
    id: 'e2e-tactical-sap',
    kind: 'sap',
    label: 'Sap',
    sourceCharacterId: E2E_TACTICAL_CHARACTER_ID,
    sourceActionId: 'attack_e2e-tactical-longsword',
    expiry: 'afterTargetAttack',
    remainingUses: 1,
    appliedRound: 1,
    appliedAt: generatedAt,
    notes: 'Pré-aplicado para validar consumo no próximo ataque do alvo.'
  }]
});

export const createE2ETacticalMobileScenario = (character = createE2ETacticalMobileCharacter()): CombatScenario => {
  const normalized = normalizeCombatScenario({
    id: E2E_TACTICAL_SCENARIO_ID,
    characterId: character.id,
    name: 'E2E Fechamento móvel',
    combatState: {
      ...defaultCombatState,
      targetAC: 13,
      targetDistanceFeet: 5,
      targetSize: 'Medium',
      cover: 'none',
      lineOfSight: true
    },
    favorite: true,
    notes: 'Fixture nativa para iniciativa, Sap/concentração, oportunidade/War Caster e Ready.',
    targets: [createTarget()],
    actorPositionFeet: 0,
    actorSpeedFeet: 30,
    spatialMode: 'linear',
    diagonalRule: 'fiveFeet',
    terrainRegions: [],
    difficultTerrain: false,
    round: 1,
    battlefieldItems: [],
    tacticalLog: [],
    participants: [],
    turnPhase: 'idle',
    readyActions: [],
    createdAt: generatedAt,
    updatedAt: generatedAt
  });
  const withParticipants = ensureTacticalParticipants(normalized, character.name);
  return {
    ...withParticipants,
    participants: (withParticipants.participants ?? []).map((participant) => ({
      ...participant,
      initiative: participant.kind === 'character' ? 20 : 15,
      hasActed: false,
      reactionAvailable: true,
      movementSpentFeet: 0
    }))
  };
};
