import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createDefaultCharacter, defaultCombatState } from '../data/mockData';
import { buildAvailableActions } from '../rules-engine/actions/buildActions';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { validateTurnRotation } from '../rules-engine/turns/validateTurn';
import { CompendiumImportInput } from '../compendium/schemas';
import { TurnRotation } from '../types';

const source = { id: 'engine-source', book: 'Legal Test Source', page: '20', version: '2024', status: 'active' as const, confidence: 'exact' as const };

const buildItem = (kind: CompendiumImportInput['items'][number]['kind'], payload: Record<string, unknown>, name = `Engine ${kind}`) => {
  const pack = buildPersistedCompendiumImport({
    id: `engine-pack-${kind}-${name}`,
    source,
    items: [{ id: `${kind}-${name}`, kind, name, summary: 'Engine integration test item.', source, payload }]
  });
  return pack.items[0]!;
};

describe('compendium engine integration', () => {
  it('turns a validated feature grant into a combat action', () => {
    const character = createDefaultCharacter('Feature User');
    const feature = buildItem('feature', {
      grantsActions: [
        {
          type: 'attack',
          name: 'Imported Strike',
          actionCost: 'bonusAction',
          damageFormula: '1d6 + STR',
          sourceType: 'classFeature',
          attacksCount: 1
        }
      ]
    });

    const applied = applyCompendiumItemToCharacter(character, feature);
    expect(applied.ok).toBe(true);

    const actions = buildAvailableActions(applied.character);
    expect(actions.some((action) => action.name === 'Imported Strike' && action.origin?.kind === 'featureGrant')).toBe(true);
  });

  it('keeps conditional imported damage separate until the rotation enables the condition', () => {
    const character = createDefaultCharacter('Condition User');
    const weapon = buildItem('weapon', {
      damageFormula: '1d8 + STR',
      attackAbility: 'STR',
      conditionalDamage: [
        {
          damageFormula: '1d6',
          application: 'conditional',
          sourceType: 'spell',
          label: 'Marked target',
          condition: { id: 'marked', label: 'Target marked' }
        }
      ]
    });

    const applied = applyCompendiumItemToCharacter(character, weapon);
    const action = buildAvailableActions(applied.character).find((candidate) => candidate.name === weapon.name)!;

    const disabled = analyzeActionDamage({ action, character: applied.character, combatState: defaultCombatState });
    const enabled = analyzeActionDamage({ action, character: applied.character, combatState: defaultCombatState, enabledConditionIds: ['marked'] });

    expect(disabled.conditioned.average).toBe(0);
    expect(enabled.conditioned.average).toBe(3.5);
  });

  it('resolves character-level spell scaling from imported steps', () => {
    const character = { ...createDefaultCharacter('Cantrip User'), level: 5 };
    const spell = buildItem('spell', {
      damageFormula: '1d10',
      level: 0,
      castingTime: 'action',
      scaling: {
        kind: 'characterLevel',
        steps: [
          { minCharacterLevel: 1, formula: '1d10' },
          { minCharacterLevel: 5, formula: '2d10' }
        ]
      }
    });

    const applied = applyCompendiumItemToCharacter(character, spell);
    const action = buildAvailableActions(applied.character).find((candidate) => candidate.name === spell.name)!;
    const result = analyzeActionDamage({ action, character: applied.character, combatState: defaultCombatState });

    expect(result.formula).toBe('2d10');
    expect(result.total.average).toBe(11);
  });

  it('validates resource and once-per-turn costs from imported actions', () => {
    const character = {
      ...createDefaultCharacter('Resource User'),
      resources: [{ id: 'smite', name: 'Smite-like resource', max: 1, current: 1, recharge: 'longRest' as const }]
    };
    const feature = buildItem('feature', {
      grantsActions: [
        {
          type: 'attack',
          name: 'Limited Burst',
          actionCost: 'free',
          damageFormula: '2d8',
          consumes: [{ resourceId: 'smite', amount: 1, label: 'Limited Burst', oncePerTurnKey: 'limited-burst' }]
        }
      ]
    });

    const applied = applyCompendiumItemToCharacter(character, feature);
    const action = buildAvailableActions(applied.character).find((candidate) => candidate.name === 'Limited Burst')!;
    const rotation: TurnRotation = {
      id: 'rotation-resource',
      characterId: applied.character.id,
      name: 'Invalid duplicate resource',
      actions: [
        { id: 'ta1', name: action.name, actionCost: action.actionCost, action },
        { id: 'ta2', name: action.name, actionCost: action.actionCost, action }
      ]
    };

    const validation = validateTurnRotation(rotation, applied.character);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.code === 'RESOURCE_UNAVAILABLE' || issue.code === 'ONCE_PER_TURN_CONFLICT')).toBe(true);
  });
});
