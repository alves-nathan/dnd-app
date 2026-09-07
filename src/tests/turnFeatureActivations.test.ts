import { buildTurnFeatureActivationOptions, instantiateTurnFeatureActivation } from '../characters/turnFeatureActivationRules';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { applyAutomaticSpeciesProgression, getSpeciesChoiceRequirements, setSpeciesChoiceOption } from '../characters/speciesChoiceRules';
import { createDefaultCharacter } from '../data/mockData';
import { costsFromRotation, spendRotationResources } from '../rules-engine/resources/resourceManager';
import { parseDamageFormula } from '../rules-engine/dice/parser';
import { resolveTurnFeatureActivations } from '../rules-engine/turns/turnFeatureActivations';
import { validateTurnRotation } from '../rules-engine/turns/validateTurn';
import type { AttackAction, Character, SpellAction, TurnFeatureActivation, TurnRotation } from '../types';
import { useCharacterStore } from '../store/characterStore';
import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';

const spell = (params: Partial<SpellAction> & Pick<SpellAction, 'id' | 'name'>): SpellAction => {
  const { id, name, ...overrides } = params;
  return {
    id,
    type: 'spell',
    name,
    actionCost: 'action',
    sourceType: 'spell',
    spellId: id,
    spellLevel: 0,
    range: '60 ft',
    components: { verbal: true, somatic: true, material: false },
    damage: parseDamageFormula('1d8', { defaultSourceType: 'spell' }),
    ...overrides
  };
};

const modifier = (id: string, targetActionId: string, kind: NonNullable<TurnFeatureActivation['modifier']>, cost = 1): TurnFeatureActivation => ({
  id,
  kind: 'actionModifier',
  name: id,
  targetActionId,
  modifier: kind,
  actionCost: 'free',
  consumes: [{ resourceId: 'metamagic-points', amount: cost, label: id }]
});

const rotationFor = (character: Character, actions: TurnRotation['actions'], activations: TurnFeatureActivation[] = []): TurnRotation => ({
  id: 'rotation',
  characterId: character.id,
  name: 'Feature activation rotation',
  actions,
  activations
});

const buildFireGoliath = () => {
  const source = { id: 'goliath-turn-source', book: 'Goliath Turn Test', version: '2024', status: 'active' as const, confidence: 'exact' as const };
  const pack = buildPersistedCompendiumImport({
    id: 'goliath-turn-pack',
    source,
    items: [
      { id: 'goliath-turn-species', kind: 'species', name: 'Goliath', source, payload: { featureIds: ['goliath-turn-ancestry'] } },
      {
        id: 'goliath-turn-ancestry',
        kind: 'feature',
        name: 'Giant Ancestry',
        source,
        payload: {
          sourceType: 'speciesTrait',
          speciesId: 'goliath-turn-species',
          engineKey: 'species.goliath.giant_ancestry',
          choiceRequired: true,
          resource: { id: 'goliath-giant-ancestry', name: 'Giant Ancestry', max: 'PB', recharge: 'longRest' },
          options: {
            'fires-burn': { trigger: 'hitWithAttackRollAndDealDamage', extraDamage: '1d10 fire' },
            'stones-endurance': { actionCost: 'reaction', trigger: 'takeDamage', damageReduction: '1d12 + CON' }
          }
        }
      }
    ]
  });
  const species = pack.items.find((item) => item.type === 'species')!;
  const requirement = getSpeciesChoiceRequirements(species, pack.items, 5)[0]!;
  const applied = applyCompendiumItemToCharacter(createDefaultCharacter('Fire Goliath'), species);
  const selectedChoice = setSpeciesChoiceOption([], requirement, 'fires-burn')[0]!;
  const withChoice: Character = {
    ...applied.character,
    level: 5,
    buildChoices: {
      ...applied.character.buildChoices!,
      // Persisted v25 characters normalize official/catalog references while
      // the current Compendium requirement still carries the active carrier id.
      speciesChoices: [{
        ...selectedChoice,
        speciesItemId: normalizeCharacterChoiceReference(selectedChoice.speciesItemId),
        featureItemId: normalizeCharacterChoiceReference(selectedChoice.featureItemId)
      }]
    }
  };
  const progressed = applyAutomaticSpeciesProgression(withChoice, pack.items).character;
  return { character: progressed, items: pack.items };
};

describe('turn feature activations', () => {
  it('applies Quickened, Distant and Subtle as deterministic rotation-local spell transforms', () => {
    const character = createDefaultCharacter('Metamagic');
    const base = spell({ id: 'spell-fire', name: 'Fire Spell', spellLevel: 0, range: '60 ft', components: { verbal: true, somatic: true, material: true } });
    const entry = { id: 'turn-spell', name: base.name, actionCost: 'action' as const, action: base };

    const quickened = resolveTurnFeatureActivations(rotationFor(character, [entry], [modifier('quickened', base.id, 'quickenedSpell', 2)]));
    expect(quickened.issues).toEqual([]);
    expect(quickened.rotation.actions[0]?.actionCost).toBe('bonusAction');
    expect(quickened.rotation.actions[0]?.action.actionCost).toBe('bonusAction');
    expect(entry.action.actionCost).toBe('action');

    const distant = resolveTurnFeatureActivations(rotationFor(character, [entry], [modifier('distant', base.id, 'distantSpell')]));
    expect(distant.issues).toEqual([]);
    expect(distant.rotation.actions[0]?.action.type === 'spell' ? distant.rotation.actions[0].action.range : undefined).toBe('120 ft');

    const touch = spell({ id: 'touch-spell', name: 'Touch Spell', range: 'Touch' });
    const distantTouch = resolveTurnFeatureActivations(rotationFor(character, [{ id: 'touch-turn', name: touch.name, actionCost: 'action', action: touch }], [modifier('distant-touch', touch.id, 'distantSpell')]));
    expect(distantTouch.rotation.actions[0]?.action.type === 'spell' ? distantTouch.rotation.actions[0].action.range : undefined).toBe('30 ft');

    const subtle = resolveTurnFeatureActivations(rotationFor(character, [entry], [modifier('subtle', base.id, 'subtleSpell')]));
    const subtleSpell = subtle.rotation.actions[0]?.action;
    expect(subtleSpell?.type).toBe('spell');
    if (subtleSpell?.type === 'spell') {
      expect(subtleSpell.components).toEqual({ verbal: false, somatic: false, material: true });
      expect(subtleSpell.ruleNotes?.join(' ')).toContain('Material foi preservado');
    }
  });

  it('enforces the 2024 Quickened Spell level-1+ spell restriction', () => {
    const character = {
      ...createDefaultCharacter('Quickened'),
      resources: [{ id: 'metamagic-points', name: 'Sorcery Points', max: 2, current: 2, recharge: 'longRest' as const }]
    };
    const quickenedCantrip = spell({ id: 'cantrip', name: 'Cantrip', spellLevel: 0 });
    const levelled = spell({ id: 'levelled', name: 'Levelled Spell', spellLevel: 1, consumesSpellSlot: false });
    const rotation = rotationFor(character, [
      { id: 'turn-cantrip', name: quickenedCantrip.name, actionCost: 'action', action: quickenedCantrip },
      { id: 'turn-levelled', name: levelled.name, actionCost: 'action', action: levelled }
    ], [modifier('quickened', quickenedCantrip.id, 'quickenedSpell', 2)]);

    const validation = validateTurnRotation(rotation, character);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'METAMAGIC_QUICKENED_LEVELLED_SPELL_CONFLICT', severity: 'error' })
    ]));
  });

  it('enforces the 2024 one-spell-slot-per-turn casting limit independently of Metamagic', () => {
    const character = {
      ...createDefaultCharacter('Slot Caster'),
      spellSlots: [{ id: 'slot-1', level: 1 as const, max: 2, current: 2, recharge: 'longRest' as const }]
    };
    const first = spell({ id: 'slot-spell-a', name: 'Slot Spell A', spellLevel: 1, minimumSlotLevel: 1, consumesSpellSlot: true });
    const second = spell({ id: 'slot-spell-b', name: 'Slot Spell B', spellLevel: 1, minimumSlotLevel: 1, consumesSpellSlot: true, actionCost: 'bonusAction' });
    const rotation = rotationFor(character, [
      { id: 'slot-a-turn', name: first.name, actionCost: 'action', action: first, selectedSpellSlotLevel: 1 },
      { id: 'slot-b-turn', name: second.name, actionCost: 'bonusAction', action: second, selectedSpellSlotLevel: 1 }
    ]);

    expect(validateTurnRotation(rotation, character).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SPELL_SLOT_CAST_LIMIT_PER_TURN', severity: 'error' })
    ]));
  });

  it('models Action Surge as an extra non-Magic Action and spends its resource through the rotation transaction layer', () => {
    const base = createDefaultCharacter('Fighter');
    const weapon = base.weapons[0]!;
    const action = base.rotations[0]!.actions[0]!.action as AttackAction;
    const character: Character = {
      ...base,
      classes: [{ ...base.classes[0]!, name: 'Fighter', level: 5 }],
      features: [{ id: 'action-surge-feature', name: 'Action Surge', sourceType: 'classFeature', source: base.classes[0]!.source, resource: { id: 'fighter-action-surge', name: 'Action Surge', max: 1, current: 1, recharge: 'shortRest' } }],
      resources: [{ id: 'fighter-action-surge', name: 'Action Surge', max: 1, current: 1, recharge: 'shortRest' }]
    };
    const activation: TurnFeatureActivation = {
      id: 'action-surge',
      kind: 'extraAction',
      name: 'Action Surge',
      actionCost: 'free',
      consumes: [{ resourceId: 'fighter-action-surge', amount: 1, label: 'Action Surge', oncePerTurnKey: 'fighter-action-surge' }],
      extraActionCount: 1,
      prohibitsMagicAction: true
    };
    const rotation = rotationFor(character, [{ id: 'fighter-attacks', name: weapon.name, actionCost: 'action', action, attackCountOverride: 4 }], [activation]);

    expect(validateTurnRotation(rotation, character).issues.some((entry) => entry.code === 'ATTACK_ACTION_CAPACITY_EXCEEDED')).toBe(false);
    expect(costsFromRotation(rotation)).toEqual(expect.arrayContaining([expect.objectContaining({ resourceId: 'fighter-action-surge', amount: 1 })]));
    expect(spendRotationResources(character, rotation).character.resources.find((entry) => entry.id === 'fighter-action-surge')?.current).toBe(0);

    const withoutSurge = { ...rotation, activations: [] };
    expect(validateTurnRotation(withoutSurge, character).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ATTACK_ACTION_CAPACITY_EXCEEDED' })
    ]));
  });

  it('rejects using the Action Surge extra action for a second Magic action', () => {
    const character = { ...createDefaultCharacter('Eldritch Fighter'), resources: [{ id: 'fighter-action-surge', name: 'Action Surge', max: 1, current: 1, recharge: 'shortRest' as const }] };
    const first = spell({ id: 'spell-a', name: 'Spell A', spellLevel: 0 });
    const second = spell({ id: 'spell-b', name: 'Spell B', spellLevel: 0 });
    const rotation = rotationFor(character, [
      { id: 'spell-a-turn', name: first.name, actionCost: 'action', action: first },
      { id: 'spell-b-turn', name: second.name, actionCost: 'action', action: second }
    ], [{
      id: 'action-surge', kind: 'extraAction', name: 'Action Surge', actionCost: 'free',
      consumes: [{ resourceId: 'fighter-action-surge', amount: 1, oncePerTurnKey: 'fighter-action-surge' }],
      extraActionCount: 1, prohibitsMagicAction: true
    }]);

    expect(validateTurnRotation(rotation, character).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACTION_SURGE_MAGIC_ACTION_RESTRICTION', severity: 'error' })
    ]));
  });

  it('builds only deterministic Action Surge and persisted Metamagic Adept turn options', () => {
    const base = createDefaultCharacter('Feat Caster');
    const actionSpell = spell({ id: 'spell-action', name: 'Action Spell', actionCost: 'action', range: '60 ft' });
    const selfSpell = spell({ id: 'spell-self', name: 'Self Spell', actionCost: 'action', range: 'Self' });
    const character: Character = {
      ...base,
      features: [{ id: 'action-surge-feature', name: 'Action Surge', sourceType: 'classFeature', source: base.classes[0]!.source, resource: { id: 'fighter-action-surge', name: 'Action Surge', max: 1, current: 1, recharge: 'shortRest' } }],
      featChoices: [{
        id: 'metamagic-choice', featEntityId: 'feat-metamagic', featItemId: 'tcoe-2020-feat-metamagic-adept', instanceIndex: 0,
        metamagicOptionIds: [
          'feat-option-phb2024-metamagic-quickened-spell',
          'feat-option-phb2024-metamagic-distant-spell'
        ]
      }]
    };

    const options = buildTurnFeatureActivationOptions(character, [], [actionSpell, selfSpell]);
    expect(options.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Action Surge', 'Quickened Spell', 'Distant Spell']));
    expect(options.some((entry) => entry.name === 'Subtle Spell')).toBe(false);
    expect(options.some((entry) => entry.name === 'Heightened Spell')).toBe(false);
    expect(options.find((entry) => entry.name === 'Distant Spell')?.eligibleActionIds).toEqual([actionSpell.id]);
    expect(instantiateTurnFeatureActivation(options.find((entry) => entry.name === 'Quickened Spell')!, actionSpell.id).targetActionId).toBe(actionSpell.id);
  });

  it('rejects multiple non-stackable Metamagic modifiers on the same spell', () => {
    const character = createDefaultCharacter('Too Much Metamagic');
    const target = spell({ id: 'spell-target', name: 'Target Spell' });
    const rotation = rotationFor(character, [{ id: 'turn-target', name: target.name, actionCost: 'action', action: target }], [
      modifier('quickened', target.id, 'quickenedSpell', 2),
      modifier('distant', target.id, 'distantSpell')
    ]);
    expect(resolveTurnFeatureActivations(rotation).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'METAMAGIC_MULTIPLE_OPTIONS', severity: 'error' })
    ]));
  });

  it('builds Fire Giant Ancestry as an executable on-hit activation and spends the shared ancestry pool', () => {
    const { character, items } = buildFireGoliath();
    const attack: AttackAction = {
      id: 'greatsword-fire-test',
      type: 'attack',
      name: 'Greatsword',
      actionCost: 'action',
      sourceType: 'weapon',
      attackAbility: 'STR',
      damage: parseDamageFormula('2d6 + STR', { defaultSourceType: 'weapon' }),
      damageTypes: ['slashing'],
      attacksCount: 2
    };

    const option = buildTurnFeatureActivationOptions(character, items, [attack])
      .find((entry) => entry.name === "Giant Ancestry · Fire's Burn");
    expect(option).toBeDefined();
    expect(option?.eligibleActionIds).toContain(attack.id);

    const activation = instantiateTurnFeatureActivation(option!, attack.id);
    const rotation = rotationFor(character, [{ id: 'greatsword-turn', name: attack.name, actionCost: 'action', action: attack }], [activation]);
    const resolved = resolveTurnFeatureActivations(rotation);
    const resolvedAction = resolved.rotation.actions[0]!.action as AttackAction;
    const bonus = resolvedAction.damage.components.find((component) => component.id.startsWith(`${activation.id}:damage:`));

    expect(resolved.issues).toEqual([]);
    expect(resolvedAction.damageTypes).toEqual(expect.arrayContaining(['slashing', 'fire']));
    expect(bonus?.dice).toEqual({ count: 1, sides: 10, rerollLessThanOrEqual: undefined });
    expect(bonus?.sourceType).toBe('speciesFeature');
    expect(bonus?.condition?.oncePerTurnKey).toBe(activation.id);
    expect(costsFromRotation(rotation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: 'goliath-giant-ancestry', amount: 1 })
    ]));

    const before = character.resources.find((resource) => resource.id === 'goliath-giant-ancestry')?.current;
    const spent = spendRotationResources(character, rotation).character;
    expect(spent.resources.find((resource) => resource.id === 'goliath-giant-ancestry')?.current).toBe((before ?? 0) - 1);
  });

  it('allows Fire Giant Ancestry and one Metamagic modifier to coexist on the same eligible spell attack', () => {
    const { character, items } = buildFireGoliath();
    const spellAttack = spell({ id: 'fire-bolt-goliath', name: 'Fire Bolt', attacksCount: 1, damage: parseDamageFormula('1d10', { defaultSourceType: 'spell' }) });
    const withMetamagic: Character = {
      ...character,
      featChoices: [{
        id: 'meta-choice',
        featEntityId: 'meta-feat',
        featItemId: 'tcoe-2020-feat-metamagic-adept',
        instanceIndex: 0,
        metamagicOptionIds: ['feat-option-phb2024-metamagic-distant-spell']
      }],
      resources: [
        ...character.resources,
        { id: 'feat_metamagic_meta-feat', name: 'Sorcery Points', max: 2, current: 2, recharge: 'longRest' as const }
      ]
    };
    const options = buildTurnFeatureActivationOptions(withMetamagic, items, [spellAttack]);
    const fire = options.find((entry) => entry.name === "Giant Ancestry · Fire's Burn")!;
    const distant = options.find((entry) => entry.name === 'Distant Spell')!;
    const rotation = rotationFor(withMetamagic, [{ id: 'spell-turn', name: spellAttack.name, actionCost: 'action', action: spellAttack }], [
      instantiateTurnFeatureActivation(fire, spellAttack.id),
      instantiateTurnFeatureActivation(distant, spellAttack.id)
    ]);

    const resolved = resolveTurnFeatureActivations(rotation);
    expect(resolved.issues).toEqual([]);
    const action = resolved.rotation.actions[0]!.action;
    expect(action.type).toBe('spell');
    if (action.type === 'spell') {
      expect(action.range).toBe('120 ft');
      expect(action.damageTypes).toContain('fire');
      expect(action.damage?.components.some((component) => component.condition?.oncePerTurnKey?.includes('giant-ancestry'))).toBe(true);
    }
  });


  it('spends tactical-only activation costs from the transient rotation override instead of the persisted rotation snapshot', () => {
    const base = createDefaultCharacter('Transient Action Surge');
    const storedRotation = base.rotations[0]!;
    const character: Character = {
      ...base,
      resources: [{ id: 'fighter-action-surge', name: 'Action Surge', max: 1, current: 1, recharge: 'shortRest' }]
    };
    const activation: TurnFeatureActivation = {
      id: 'transient-action-surge',
      kind: 'extraAction',
      name: 'Action Surge',
      actionCost: 'free',
      consumes: [{ resourceId: 'fighter-action-surge', amount: 1, label: 'Action Surge' }],
      extraActionCount: 1,
      prohibitsMagicAction: true
    };
    const override: TurnRotation = { ...storedRotation, activations: [activation] };

    useCharacterStore.setState({ characters: [character] });
    useCharacterStore.getState().spendRotationResources(character.id, storedRotation.id, override);
    expect(useCharacterStore.getState().characters[0]?.resources.find((resource) => resource.id === 'fighter-action-surge')?.current).toBe(0);
    useCharacterStore.setState({ characters: [] });
  });

});
