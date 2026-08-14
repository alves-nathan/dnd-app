import { BUNDLED_COMPENDIUM_PACKS, serializeBundledCompendiumPack } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport, validateCompendiumJson } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter, defaultCombatState, manualSource } from '../data/mockData';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { buildSpellAction, buildWeaponAttackAction } from '../rules-engine/actions/buildActions';
import { analyzeActionDamage } from '../rules-engine/damage/calculateDamage';
import { spellSlotCostsFromTurnAction } from '../rules-engine/resources/spellSlotManager';
import type { Character, CharacterCompendiumLink, Feature } from '../types';

const link = (params: { characterId: string; itemId: string; entityId: string; name: string; appliedAs: 'feature' | 'spell' | 'weapon' }): CharacterCompendiumLink => ({
  id: `link-${params.itemId}`,
  characterId: params.characterId,
  itemId: params.itemId,
  importItemId: params.itemId,
  packId: 'test-pack',
  sourceId: manualSource.id,
  itemType: params.appliedAs,
  appliedAs: params.appliedAs,
  appliedEntityId: params.entityId,
  appliedEntityName: params.name,
  status: 'active',
  addedAt: new Date(0).toISOString()
});

const invocationFeature = (id: string, name: string): Feature => ({ id, name, sourceType: 'classFeature', source: manualSource });

const buildWarlock = (): Character => {
  const character = createEmptyCharacter('Invocation Warlock');
  const warlockClassId = 'class-warlock';
  const agonizingFeature = invocationFeature('feature-agonizing', 'Agonizing Blast');
  const spearFeature = invocationFeature('feature-spear', 'Eldritch Spear');
  const repellingFeature = invocationFeature('feature-repelling', 'Repelling Blast');
  const lifedrinkerFeature = invocationFeature('feature-lifedrinker', 'Lifedrinker');
  const smiteFeature = invocationFeature('feature-smite', 'Eldritch Smite');
  const thirstingFeature = invocationFeature('feature-thirsting', 'Thirsting Blade');
  return {
    ...character,
    level: 5,
    classes: [{ id: warlockClassId, name: 'Warlock', level: 5, source: manualSource }],
    abilities: { ...character.abilities, CHA: 18 },
    features: [agonizingFeature, spearFeature, repellingFeature, lifedrinkerFeature, smiteFeature, thirstingFeature],
    spells: [{
      id: 'spell-eldritch-blast',
      name: 'Eldritch Blast',
      level: 0,
      castingTime: 'action',
      range: '120 ft',
      requiresAttackRoll: true,
      damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }),
      scaling: {
        kind: 'characterLevel',
        steps: [
          { minCharacterLevel: 1, formula: parseDamageFormula('1d10', { defaultSourceType: 'spell' }), attacksCount: 1 },
          { minCharacterLevel: 5, formula: parseDamageFormula('1d10', { defaultSourceType: 'spell' }), attacksCount: 2 }
        ]
      },
      targeting: { targets: 1 },
      spellcastingClassId: warlockClassId,
      spellcastingClassName: 'Warlock',
      source: manualSource
    }],
    weapons: [{
      id: 'weapon-pact',
      name: 'Longsword',
      weaponType: 'melee',
      damage: parseDamageFormula('1d8 + STR', { defaultSourceType: 'weapon' }),
      pactWeapon: true,
      pactWeaponDamageType: 'radiant',
      source: manualSource
    }],
    spellSlots: [{ level: 3, max: 2, current: 2, recharge: 'shortRest', poolKind: 'pactMagic', sourceClassId: warlockClassId, sourceClassName: 'Warlock' }],
    compendiumLinks: [
      link({ characterId: character.id, itemId: 'invocation-agonizing', entityId: agonizingFeature.id, name: agonizingFeature.name, appliedAs: 'feature' }),
      link({ characterId: character.id, itemId: 'invocation-spear', entityId: spearFeature.id, name: spearFeature.name, appliedAs: 'feature' }),
      link({ characterId: character.id, itemId: 'invocation-repelling', entityId: repellingFeature.id, name: repellingFeature.name, appliedAs: 'feature' }),
      link({ characterId: character.id, itemId: 'invocation-lifedrinker', entityId: lifedrinkerFeature.id, name: lifedrinkerFeature.name, appliedAs: 'feature' }),
      link({ characterId: character.id, itemId: 'invocation-smite', entityId: smiteFeature.id, name: smiteFeature.name, appliedAs: 'feature' }),
      link({ characterId: character.id, itemId: 'invocation-thirsting', entityId: thirstingFeature.id, name: thirstingFeature.name, appliedAs: 'feature' }),
      link({ characterId: character.id, itemId: 'eldritch-blast-item', entityId: 'spell-eldritch-blast', name: 'Eldritch Blast', appliedAs: 'spell' }),
      link({ characterId: character.id, itemId: 'pact-weapon-item', entityId: 'weapon-pact', name: 'Longsword', appliedAs: 'weapon' })
    ],
    buildChoices: {
      ...(character.buildChoices!),
      eldritchInvocationChoices: [
        { id: 'choice-agonizing', invocationItemId: 'invocation-agonizing', instanceIndex: 0, targetCantripItemId: 'eldritch-blast-item' },
        { id: 'choice-spear', invocationItemId: 'invocation-spear', instanceIndex: 0, targetCantripItemId: 'eldritch-blast-item' },
        { id: 'choice-repelling', invocationItemId: 'invocation-repelling', instanceIndex: 0, targetCantripItemId: 'eldritch-blast-item' },
        { id: 'choice-lifedrinker', invocationItemId: 'invocation-lifedrinker', instanceIndex: 0, lifedrinkerDamageType: 'radiant' }
      ]
    }
  };
};

describe('Warlock invocation action mechanics', () => {
  it('applies Agonizing Blast, Eldritch Spear, Repelling Blast and beam scaling', () => {
    const character = buildWarlock();
    const action = buildSpellAction(character, 'spell-eldritch-blast')!;
    expect(action.attacksCount).toBe(2);
    expect(action.range).toBe('270 ft');
    expect(action.forcedMovementFt).toBe(10);
    expect(action.damage?.components.some((component) => component.kind === 'abilityModifier' && component.ability === 'CHA')).toBe(true);
    const damage = analyzeActionDamage({ action, character, combatState: defaultCombatState });
    expect(damage.total.average).toBe(19);
  });

  it('applies Lifedrinker once per turn and spends Pact Magic only when Eldritch Smite is enabled', () => {
    const character = buildWarlock();
    const action = buildWeaponAttackAction(character, 'weapon-pact')!;
    expect(action.attacksCount).toBe(2);
    expect(action.damage.components.some((component) => component.condition?.id === 'warlock-lifedrinker')).toBe(true);
    expect(action.damage.components.some((component) => component.condition?.id === 'warlock-eldritch-smite')).toBe(true);

    const withoutSmite = spellSlotCostsFromTurnAction({ id: 'turn-1', name: 'Pact attack', actionCost: 'action', action, enabledConditionIds: ['warlock-lifedrinker'] });
    expect(withoutSmite).toEqual([]);
    const withSmite = spellSlotCostsFromTurnAction({ id: 'turn-2', name: 'Pact smite', actionCost: 'action', action, enabledConditionIds: ['warlock-lifedrinker', 'warlock-eldritch-smite'] });
    expect(withSmite).toEqual(expect.arrayContaining([expect.objectContaining({ slotLevel: 3, poolKind: 'pactMagic', amount: 1 })]));

    const damage = analyzeActionDamage({
      action,
      character,
      combatState: defaultCombatState,
      enabledConditionIds: ['warlock-lifedrinker']
    });
    expect(damage.conditioned.average).toBe(3.5);
  });
  it('maps Eldritch Blast beam scaling from the bundled PHB payload', () => {
    const pack = BUNDLED_COMPENDIUM_PACKS.find((candidate) =>
      candidate.id === 'phb-2024-full-consolidated-import-pack-v5-complete-invocations'
    );
    expect(pack).toBeDefined();

    const preview = validateCompendiumJson(serializeBundledCompendiumPack(pack!));
    expect(preview.ok).toBe(true);
    expect(preview.data).toBeDefined();

    const persisted = buildPersistedCompendiumImport(preview.data!);
    const imported = persisted.items.find((item) => item.importItemId === 'phb-2024-spell-eldritch-blast');
    expect(imported).toBeDefined();

    const character = {
      ...createEmptyCharacter('Bundled Eldritch Blast'),
      level: 5,
      classes: [{ id: 'class-warlock', name: 'Warlock', level: 5, source: manualSource }]
    };
    const result = applyCompendiumItemToCharacter(character, { ...imported!, status: 'validated' });
    expect(result.ok).toBe(true);
    expect(result.link).toBeDefined();

    const action = buildSpellAction(result.character, result.link!.appliedEntityId);
    expect(action?.attacksCount).toBe(2);
    expect(action?.damage?.unresolvedTokens ?? []).not.toContain('each');

    const damage = analyzeActionDamage({ action: action!, character: result.character, combatState: defaultCombatState });
    expect(damage.total.average).toBe(11);
  });

});
