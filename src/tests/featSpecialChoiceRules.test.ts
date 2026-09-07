import type { StoredCompendiumItem } from '../compendium/types';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import {
  applyFeatChoiceEffects,
  emptyFeatChoice,
  getFeatChoiceSchema,
  validateFeatChoice
} from '../characters/featChoiceRules';
import {
  getEldritchAdeptInvocationCandidates,
  getFightingStyleFeatChoiceCandidates,
  getMartialAdeptManeuverOptions,
  getMetamagicFeatOptions,
  validateEldritchAdeptInvocationChoice,
  validateFightingStyleFeatChoice,
  validateManeuverFeatChoice,
  validateMetamagicFeatChoice,
  reconcileFeatSubchoiceResources
} from '../characters/featSubchoiceRules';
import { getEffectiveEldritchInvocationCounts } from '../characters/eldritchInvocationRules';
import { validateFeatPrerequisites } from '../characters/characterBuildRules';

const phbPack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const tashaPack = require('../../assets/compendium/tcoe-2020-2024-compatible-import-pack-v2-canonical.json');
const phb2014Pack = require('../../assets/compendium/phb-2014-2024-compatible-delta-v2-canonical.json');

const toStoredItems = (pack: any, packId: string): StoredCompendiumItem[] => pack.items.map((item: any) => ({
  id: item.id,
  importItemId: item.id,
  packId,
  sourceId: item.source?.id ?? 'unknown',
  type: item.kind,
  name: item.name,
  summary: item.summary,
  rawJson: item,
  normalizedJson: item.payload ?? {},
  tags: item.payload?.tags ?? item.tags ?? [],
  status: 'validated',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z'
}));

const items = [
  ...toStoredItems(phbPack, 'phb'),
  ...toStoredItems(tashaPack, 'tasha'),
  ...toStoredItems(phb2014Pack, 'phb2014')
];
const enabledSourceIds = Array.from(new Set(items.map((item) => item.sourceId)));
const byId = (id: string): StoredCompendiumItem => {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`Missing test item ${id}`);
  return found;
};

const eldritchAdept = byId('tcoe-2020-feat-eldritch-adept');
const fightingInitiate = byId('tcoe-2020-feat-fighting-initiate');
const metamagicAdept = byId('tcoe-2020-feat-metamagic-adept');
const martialAdept = byId('phb-2014-feat-martial-adept');
const archery = byId('phb-2024-feat-archery');
const armorOfShadows = byId('phb-2024-feature-warlock-armor-of-shadows');
const ascendantStep = byId('phb-2024-feature-warlock-ascendant-step');
const pactOfTheBlade = byId('phb-2024-feature-warlock-pact-of-the-blade');
const wizard = byId('phb-2024-class-wizard');
const fighter = byId('phb-2024-class-fighter');
const warlock = byId('phb-2024-class-warlock');

const applyParentFeat = (featItem: StoredCompendiumItem) => {
  const result = applyCompendiumItemToCharacter(createEmptyCharacter('Feat Test'), featItem);
  if (!result.ok || !result.link) throw new Error(`Could not apply ${featItem.name}`);
  return { character: result.character, featEntityId: result.link.appliedEntityId };
};

describe('feat special choice rules', () => {
  it('models all four imported feat choice families as supported structured subchoices', () => {
    const eldritchSchema = getFeatChoiceSchema(eldritchAdept);
    expect(eldritchSchema.kinds).toEqual(expect.arrayContaining(['eldritchInvocation']));
    expect(eldritchSchema.eldritchInvocationChoiceCount).toBe(1);
    expect(eldritchSchema.spellcastingAbilityOptions).toEqual(['INT', 'WIS', 'CHA']);
    expect(eldritchSchema.unsupportedChoiceTypes).toEqual([]);

    const fightingSchema = getFeatChoiceSchema(fightingInitiate);
    expect(fightingSchema.kinds).toEqual(expect.arrayContaining(['fightingStyle']));
    expect(fightingSchema.fightingStyleChoiceCount).toBe(1);
    expect(fightingSchema.unsupportedChoiceTypes).toEqual([]);

    const metamagicSchema = getFeatChoiceSchema(metamagicAdept);
    expect(metamagicSchema.kinds).toEqual(expect.arrayContaining(['metamagic']));
    expect(metamagicSchema.metamagicChoiceCount).toBe(2);
    expect(metamagicSchema.unsupportedChoiceTypes).toEqual([]);

    const martialSchema = getFeatChoiceSchema(martialAdept);
    expect(martialSchema.kinds).toEqual(expect.arrayContaining(['maneuver']));
    expect(martialSchema.maneuverChoiceCount).toBe(2);
    expect(martialSchema.unsupportedChoiceTypes).toEqual([]);
  });

  it('applies Fighting Initiate as a parent-scoped Fighting Style without allowing duplicates', () => {
    const { character: base, featEntityId } = applyParentFeat(fightingInitiate);
    const character = {
      ...base,
      level: 4,
      proficiencies: { ...base.proficiencies, weapons: ['martial'] }
    };
    const choice = {
      ...emptyFeatChoice(fightingInitiate.id, featEntityId, 0),
      fightingStyleItemId: archery.id
    };

    expect(validateFightingStyleFeatChoice(choice, items, character)).toEqual([]);
    expect(validateFeatChoice(fightingInitiate, choice, character.abilities, items, character)).toEqual([]);

    const applied = applyFeatChoiceEffects(character, fightingInitiate, choice, items);
    const nestedStyle = applied.feats.find((feat) => feat.grantedByFeatEntityId === featEntityId && feat.name === 'Archery');
    expect(nestedStyle).toBeTruthy();
    expect(applied.featChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ featEntityId, fightingStyleItemId: archery.id })
    ]));
    expect(applied.compendiumLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: archery.id, status: 'active', notes: expect.stringContaining(`feat-subchoice:${featEntityId}:fighting-style`) })
    ]));
    expect(getFightingStyleFeatChoiceCandidates(items, enabledSourceIds, applied, featEntityId).map((item) => item.id)).toContain(archery.id);

    const directStyleResult = applyCompendiumItemToCharacter(character, archery);
    if (!directStyleResult.ok) throw new Error('Could not apply direct Archery style');
    expect(validateFightingStyleFeatChoice(choice, items, directStyleResult.character)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_FIGHTING_STYLE_ALREADY_KNOWN' })
    ]));
  });

  it('lets a non-Warlock spellcaster take a prerequisite-free Eldritch Adept invocation and materializes its mechanics', () => {
    const { character: base, featEntityId } = applyParentFeat(eldritchAdept);
    const character = {
      ...base,
      level: 4,
      classes: [{ id: 'wizard-class', name: 'Wizard', level: 4 }],
      companions: [{
        id: 'class-pact-companion',
        name: 'Existing class familiar',
        sourceCreatureItemId: 'existing-creature',
        grantedByInvocationItemId: 'existing-class-pact-chain',
        variant: 'special' as const,
        armorClass: 13,
        hitPoints: { current: 1, max: 1 },
        speed: {},
        traits: [],
        actions: [],
        resources: [],
        activeEffects: [],
        transactions: [],
        initiative: 'own' as const,
        command: 'forgoOneAttack' as const,
        canAttack: true,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z'
      }]
    };
    const choice = {
      ...emptyFeatChoice(eldritchAdept.id, featEntityId, 0),
      eldritchInvocationItemId: armorOfShadows.id,
      spellcastingAbility: 'INT' as const
    };

    const candidateIds = getEldritchAdeptInvocationCandidates(items, enabledSourceIds, character, featEntityId).map((item) => item.id);
    expect(candidateIds).toContain(armorOfShadows.id);
    expect(candidateIds).not.toContain(ascendantStep.id);
    expect(validateEldritchAdeptInvocationChoice(choice, items, character)).toEqual([]);
    expect(validateFeatChoice(eldritchAdept, choice, character.abilities, items, character)).toEqual([]);

    const applied = applyFeatChoiceEffects(character, eldritchAdept, choice, items);
    const mageArmor = applied.spells.find((spell) => spell.name === 'Mage Armor' && spell.grantedByFeatEntityId === featEntityId);
    expect(mageArmor).toEqual(expect.objectContaining({
      spellcastingClassName: 'Eldritch Adept',
      spellcastingAbility: 'INT',
      grantedByInvocationItemId: armorOfShadows.id,
      invocationUsage: 'atWill',
      freeCast: true
    }));
    expect(applied.buildChoices?.eldritchInvocationCounts ?? {}).toEqual({});
    expect(getEffectiveEldritchInvocationCounts(applied)[armorOfShadows.id]).toBe(1);
    expect(applied.companions?.map((companion) => companion.id)).toContain('class-pact-companion');
    expect(applied.compendiumLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: armorOfShadows.id, status: 'active', notes: expect.stringContaining(`feat-subchoice:${featEntityId}:eldritch-invocation`) })
    ]));
  });

  it('admits prerequisite invocations through Eldritch Adept only for a Warlock who meets them', () => {
    const { character: base, featEntityId } = applyParentFeat(eldritchAdept);
    const wizardCharacter = { ...base, level: 5, classes: [{ id: 'wizard-class', name: 'Wizard', level: 5 }] };
    const warlockCharacter = { ...base, level: 5, classes: [{ id: 'warlock-class', name: 'Warlock', level: 5 }] };

    expect(getEldritchAdeptInvocationCandidates(items, enabledSourceIds, wizardCharacter, featEntityId).map((item) => item.id)).not.toContain(ascendantStep.id);
    expect(getEldritchAdeptInvocationCandidates(items, enabledSourceIds, warlockCharacter, featEntityId).map((item) => item.id)).toContain(ascendantStep.id);

    const choice = {
      ...emptyFeatChoice(eldritchAdept.id, featEntityId, 0),
      eldritchInvocationItemId: ascendantStep.id,
      spellcastingAbility: 'CHA' as const
    };
    expect(validateEldritchAdeptInvocationChoice(choice, items, wizardCharacter)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_ELDRITCH_INVOCATION_WARLOCK_REQUIRED' })
    ]));
    expect(validateEldritchAdeptInvocationChoice(choice, items, warlockCharacter)).toEqual([]);
  });

  it('uses the complete current Metamagic catalog and the 2024-first Martial Adept maneuver catalog', () => {
    const metamagic = getMetamagicFeatOptions(enabledSourceIds);
    expect(metamagic).toHaveLength(10);
    expect(new Set(metamagic.map((option) => option.name)).size).toBe(10);
    expect(metamagic.find((option) => option.name === 'Heightened Spell')?.sorceryPointCost).toBe(2);
    expect(metamagic.find((option) => option.name === 'Twinned Spell')?.sorceryPointCost).toBe(1);

    const phbOnlyManeuvers = getMartialAdeptManeuverOptions(['phb-2024']);
    expect(phbOnlyManeuvers).toHaveLength(20);
    expect(phbOnlyManeuvers.map((option) => option.name)).not.toContain('Brace');

    const expandedManeuvers = getMartialAdeptManeuverOptions(enabledSourceIds);
    expect(expandedManeuvers).toHaveLength(23);
    expect(new Set(expandedManeuvers.map((option) => option.name)).size).toBe(23);
    expect(expandedManeuvers.map((option) => option.name)).toEqual(expect.arrayContaining([
      'Ambush',
      'Brace',
      'Grappling Strike',
      'Quick Toss',
      'Trip Attack'
    ]));

    const catalogAliasedManeuvers = getMartialAdeptManeuverOptions([
      'phb-2024',
      'catalog:tashas-cauldron-of-everything'
    ]);
    expect(catalogAliasedManeuvers).toHaveLength(23);
    expect(catalogAliasedManeuvers.map((option) => option.name)).toEqual(expect.arrayContaining([
      'Brace',
      'Grappling Strike',
      'Quick Toss'
    ]));
  });

  it('validates exactly two distinct options for Metamagic Adept and Martial Adept', () => {
    const metamagic = getMetamagicFeatOptions(enabledSourceIds);
    const maneuvers = getMartialAdeptManeuverOptions(enabledSourceIds);

    const metamagicChoice = {
      ...emptyFeatChoice(metamagicAdept.id, 'metamagic-feat', 0),
      metamagicOptionIds: [metamagic[0]!.id, metamagic[1]!.id]
    };
    expect(validateMetamagicFeatChoice(metamagicChoice, 2)).toEqual([]);
    expect(validateFeatChoice(metamagicAdept, metamagicChoice, createEmptyCharacter().abilities, items)).toEqual([]);
    expect(validateMetamagicFeatChoice({ ...metamagicChoice, metamagicOptionIds: [metamagic[0]!.id, metamagic[0]!.id] }, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_METAMAGIC_CHOICE_COUNT' }),
      expect.objectContaining({ code: 'FEAT_METAMAGIC_DUPLICATE' })
    ]));

    const maneuverChoice = {
      ...emptyFeatChoice(martialAdept.id, 'martial-feat', 0),
      maneuverOptionIds: [maneuvers[0]!.id, maneuvers[1]!.id]
    };
    expect(validateManeuverFeatChoice(maneuverChoice, 2)).toEqual([]);
    expect(validateFeatChoice(martialAdept, maneuverChoice, createEmptyCharacter().abilities, items)).toEqual([]);
    expect(validateManeuverFeatChoice({ ...maneuverChoice, maneuverOptionIds: [maneuvers[0]!.id] }, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEAT_MANEUVER_CHOICE_COUNT' })
    ]));
  });

  it('materializes feat-scoped Sorcery Points and Superiority Die resources', () => {
    const metamagicOptions = getMetamagicFeatOptions(enabledSourceIds);
    const metamagicParent = applyParentFeat(metamagicAdept);
    const metamagicChoice = {
      ...emptyFeatChoice(metamagicAdept.id, metamagicParent.featEntityId, 0),
      metamagicOptionIds: [metamagicOptions[0]!.id, metamagicOptions[5]!.id]
    };
    const withMetamagic = applyFeatChoiceEffects(metamagicParent.character, metamagicAdept, metamagicChoice, items);
    expect(withMetamagic.resources).toEqual(expect.arrayContaining([expect.objectContaining({
      id: `feat_metamagic_${metamagicParent.featEntityId}`,
      max: 2,
      current: 2,
      recharge: 'longRest',
      sourceFeatEntityId: metamagicParent.featEntityId,
      notes: expect.stringContaining('Careful Spell')
    })]));
    expect(withMetamagic.resources.find((resource) => resource.id === `feat_metamagic_${metamagicParent.featEntityId}`)?.notes).toContain('Quickened Spell');

    const maneuverOptions = getMartialAdeptManeuverOptions(enabledSourceIds);
    const martialParent = applyParentFeat(martialAdept);
    const maneuverChoice = {
      ...emptyFeatChoice(martialAdept.id, martialParent.featEntityId, 0),
      maneuverOptionIds: [maneuverOptions.find((option) => option.name === 'Brace')!.id, maneuverOptions.find((option) => option.name === 'Trip Attack')!.id]
    };
    const withManeuvers = applyFeatChoiceEffects(martialParent.character, martialAdept, maneuverChoice, items);
    expect(withManeuvers.resources).toEqual(expect.arrayContaining([expect.objectContaining({
      id: `feat_superiority_die_${martialParent.featEntityId}`,
      max: 1,
      current: 1,
      recharge: 'shortRest',
      sourceFeatEntityId: martialParent.featEntityId,
      notes: expect.stringContaining('Brace')
    })]));
    expect(withManeuvers.resources.find((resource) => resource.id === `feat_superiority_die_${martialParent.featEntityId}`)?.notes).toContain('Trip Attack');
  });

  it('repairs missing feat-scoped resources from persisted subselections and preserves spent uses', () => {
    const metamagicOptions = getMetamagicFeatOptions(enabledSourceIds);
    const metamagicParent = applyParentFeat(metamagicAdept);
    const choice = {
      ...emptyFeatChoice(metamagicAdept.id, metamagicParent.featEntityId, 0),
      metamagicOptionIds: [metamagicOptions[0]!.id, metamagicOptions[5]!.id]
    };
    const applied = applyFeatChoiceEffects(metamagicParent.character, metamagicAdept, choice, items);
    const resourceId = `feat_metamagic_${metamagicParent.featEntityId}`;
    const withoutDerivedResource = {
      ...applied,
      resources: applied.resources.filter((resource) => resource.id !== resourceId)
    };

    const repaired = reconcileFeatSubchoiceResources(withoutDerivedResource, items);
    expect(repaired.resources).toEqual(expect.arrayContaining([expect.objectContaining({
      id: resourceId,
      max: 2,
      current: 2,
      sourceFeatEntityId: metamagicParent.featEntityId
    })]));

    const spent = {
      ...repaired,
      resources: repaired.resources.map((resource) => resource.id === resourceId ? { ...resource, current: 1 } : resource)
    };
    expect(reconcileFeatSubchoiceResources(spent, items).resources.find((resource) => resource.id === resourceId)?.current).toBe(1);
  });

  it('repairs feat resources when persisted links use canonical catalog-prefixed references', () => {
    const metamagicOptions = getMetamagicFeatOptions(enabledSourceIds);
    const metamagicParent = applyParentFeat(metamagicAdept);
    const choice = {
      ...emptyFeatChoice(metamagicAdept.id, metamagicParent.featEntityId, 0),
      metamagicOptionIds: [metamagicOptions[0]!.id, metamagicOptions[5]!.id]
    };
    const applied = applyFeatChoiceEffects(metamagicParent.character, metamagicAdept, choice, items);
    const resourceId = `feat_metamagic_${metamagicParent.featEntityId}`;
    const canonicalized = {
      ...applied,
      resources: applied.resources.filter((resource) => resource.id !== resourceId),
      compendiumLinks: (applied.compendiumLinks ?? []).map((link) =>
        link.appliedEntityId === metamagicParent.featEntityId
          ? { ...link, itemId: `catalog:${metamagicAdept.id}`, choiceId: `catalog:${metamagicAdept.id}`, origin: 'catalog' as const }
          : link
      )
    };

    const repaired = reconcileFeatSubchoiceResources(canonicalized, items);

    expect(repaired.resources).toEqual(expect.arrayContaining([expect.objectContaining({
      id: resourceId,
      max: 2,
      current: 2
    })]));
  });

  it('enforces the parent feat prerequisites for spellcasting and martial-weapon proficiency', () => {
    const abilities = { STR: 10, DEX: 10, CON: 10, INT: 16, WIS: 12, CHA: 10 } as const;
    const emptyProficiencies = createEmptyCharacter().proficiencies;

    expect(validateFeatPrerequisites({
      featItem: eldritchAdept,
      totalLevel: 4,
      abilities,
      proficiencies: emptyProficiencies,
      classEntries: [{ item: fighter, level: 4 }],
      allItems: items
    })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FEAT_SPELLCASTING_PREREQUISITE' })]));
    expect(validateFeatPrerequisites({
      featItem: eldritchAdept,
      totalLevel: 4,
      abilities,
      proficiencies: emptyProficiencies,
      classEntries: [{ item: wizard, level: 4 }],
      allItems: items
    })).toEqual([]);

    expect(validateFeatPrerequisites({
      featItem: fightingInitiate,
      totalLevel: 4,
      abilities,
      proficiencies: emptyProficiencies,
      classEntries: [{ item: fighter, level: 4 }],
      allItems: items
    })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FEAT_MARTIAL_WEAPON_PROFICIENCY_PREREQUISITE' })]));
    expect(validateFeatPrerequisites({
      featItem: fightingInitiate,
      totalLevel: 4,
      abilities,
      proficiencies: { ...emptyProficiencies, weapons: ['martial'] },
      classEntries: [{ item: fighter, level: 4 }],
      allItems: items
    })).toEqual([]);

    const pactBladeWarlockBase = createEmptyCharacter('Blade Warlock');
    const pactBladeWarlock = {
      ...pactBladeWarlockBase,
      level: 5,
      classes: [{ id: 'warlock-class', name: 'Warlock', level: 5 }],
      buildChoices: {
        ...pactBladeWarlockBase.buildChoices!,
        eldritchInvocationCounts: { [pactOfTheBlade.id]: 1 }
      }
    };
    expect(validateFeatPrerequisites({
      featItem: fightingInitiate,
      totalLevel: 5,
      abilities,
      proficiencies: emptyProficiencies,
      classEntries: [{ item: warlock, level: 5 }],
      allItems: items,
      character: pactBladeWarlock
    })).toEqual([]);
  });
});
