import type {
  Character,
  CharacterCompendiumLink,
  CharacterFeatChoice,
  CharacterSpeciesChoice,
  Feature,
  Spell
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import {
  getFeatChoiceSchema,
  getFeatGenericSpellChoiceCount,
  isSpellItemEligibleForGenericFeatChoice
} from '../characters/featChoiceRules';
import {
  getCharacterFeatSpellListReferences
} from '../characters/spellListRules';
import {
  getSpeciesChoiceRequirements,
  setSpeciesChoiceOption,
  setSpeciesChoiceSpellcastingAbility
} from '../characters/speciesChoiceRules';
import { reconcileExternalSpellGrants } from '../characters/externalSpellGrantRules';
import { reconcileAutomaticSpellAccess } from '../characters/automaticSpellAccessRules';
import { resolveCharacterSpellAccess } from '../characters/characterSpellAccess';
import { spellCountsAgainstNormalClassLimit } from '../characters/spellcastingRules';
import { buildAvailableActionsResult } from '../rules-engine/actions/buildActions';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-16T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const activeLink = (
  character: Character,
  item: StoredCompendiumItem,
  appliedAs: CharacterCompendiumLink['appliedAs'],
  entityId: string
): CharacterCompendiumLink => ({
  id: `link:${appliedAs}:${entityId}`,
  characterId: character.id,
  itemId: item.id,
  importItemId: item.importItemId,
  packId: item.packId,
  sourceId: item.sourceId,
  itemType: appliedAs,
  appliedAs,
  appliedEntityId: entityId,
  appliedEntityName: item.name,
  status: 'active',
  addedAt: '2026-08-16T00:00:00.000Z'
});

const withSpecies = (
  speciesImportId: string,
  level: number,
  choices: CharacterSpeciesChoice[]
): Character => {
  const base = createEmptyCharacter('Species fixture');
  const species = byImportId(speciesImportId);
  return {
    ...base,
    level,
    species: { id: 'species-entity', name: species.name, features: [] },
    compendiumLinks: [activeLink(base, species, 'species', 'species-entity')],
    buildChoices: { ...base.buildChoices!, speciesChoices: choices }
  };
};

const withFeat = (
  featImportId: string,
  level: number,
  choice: CharacterFeatChoice
): Character => {
  const base = createEmptyCharacter('Feat fixture');
  const feat = byImportId(featImportId);
  return {
    ...base,
    level,
    feats: [{ id: choice.featEntityId, name: feat.name }],
    featChoices: [choice],
    compendiumLinks: [activeLink(base, feat, 'feat', choice.featEntityId)]
  };
};

const approved = (item: StoredCompendiumItem): StoredCompendiumItem => ({
  ...item,
  status: 'validated',
  reviewDecision: 'approved',
  reviewedBy: 'FIX44 test',
  reviewedAt: '2026-08-16T00:00:00.000Z'
});

const addManualSpell = (character: Character, spellImportId: string): Character => {
  const spell = byImportId(spellImportId);
  const result = applyCompendiumItemToCharacter(character, approved(spell));
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('; '));
  return result.character;
};

describe('external spell grants', () => {
  it('materializes Elf lineage spells with the chosen ability, free casts, and slot-cast modality', () => {
    const elf = byImportId('phb-2024-species-elf');
    const requirement = getSpeciesChoiceRequirements(elf, items, 5).find((entry) => entry.kind === 'lineage')!;
    let choices = setSpeciesChoiceOption([], requirement, 'drow');
    choices = setSpeciesChoiceSpellcastingAbility(choices, requirement, 'CHA');

    const result = reconcileExternalSpellGrants(withSpecies('phb-2024-species-elf', 5, choices), items);
    expect(result.character.spells.map((spell) => spell.name)).toEqual(expect.arrayContaining([
      'Dancing Lights', 'Faerie Fire', 'Darkness'
    ]));
    const darkness = result.character.spells.find((spell) => spell.name === 'Darkness')!;
    expect(darkness.spellcastingAbility).toBe('CHA');
    expect(darkness.externalSpellGrantOnly).toBe(true);
    expect(darkness.freeCastGrants).toHaveLength(1);
    expect(darkness.externalSpellGrantSources?.[0]).toMatchObject({ kind: 'species', canUseSpellSlots: true });

    const actions = buildAvailableActionsResult(result.character).actions.filter((action) => action.type === 'spell' && action.name.includes('Darkness'));
    expect(actions.some((action) => action.type === 'spell' && action.consumesSpellSlot)).toBe(true);
    expect(actions.some((action) => action.type === 'spell' && !action.consumesSpellSlot && action.consumes?.some((cost) => cost.resourceId.includes('species_free_cast')))).toBe(true);
  });

  it('uses PB for Forest Gnome Speak with Animals and does not invent a spell-slot cast', () => {
    const gnome = byImportId('phb-2024-species-gnome');
    const requirement = getSpeciesChoiceRequirements(gnome, items, 5).find((entry) => entry.kind === 'lineage')!;
    let choices = setSpeciesChoiceOption([], requirement, 'forest-gnome');
    choices = setSpeciesChoiceSpellcastingAbility(choices, requirement, 'WIS');
    const result = reconcileExternalSpellGrants(withSpecies('phb-2024-species-gnome', 5, choices), items);
    const speak = result.character.spells.find((spell) => spell.name === 'Speak with Animals')!;
    const resource = result.character.resources.find((entry) => entry.id.includes('species_free_cast') && entry.name.includes('Speak with Animals'));
    expect(speak.freeCastGrants).toHaveLength(1);
    expect(resource?.max).toBe(3);
    expect(speak.externalSpellGrantSources?.[0]?.canUseSpellSlots).toBe(false);
    const actions = buildAvailableActionsResult(result.character).actions.filter((action) => action.type === 'spell' && action.name.includes('Speak with Animals'));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'spell', consumesSpellSlot: false });
  });

  it('exposes and reconciles Astral Elf and Khoravar species spell choices', () => {
    const astralElf = byImportId('spelljammer-2022-species-astral-elf');
    const astralRequirement = getSpeciesChoiceRequirements(astralElf, items, 1).find((entry) => entry.kind === 'spell')!;
    expect(astralRequirement.options.map((entry) => entry.label)).toEqual(['Dancing Lights', 'Light', 'Sacred Flame']);
    let astralChoices = setSpeciesChoiceOption([], astralRequirement, astralRequirement.options.find((entry) => entry.label === 'Sacred Flame')!.id);
    astralChoices = setSpeciesChoiceSpellcastingAbility(astralChoices, astralRequirement, 'WIS');
    const astral = reconcileExternalSpellGrants(withSpecies('spelljammer-2022-species-astral-elf', 1, astralChoices), items).character;
    expect(astral.spells.find((spell) => spell.name === 'Sacred Flame')).toMatchObject({ spellcastingAbility: 'WIS', externalSpellGrantOnly: true });

    const khoravar = byImportId('forge-artificer-2025-species-khoravar');
    const feyGift = getSpeciesChoiceRequirements(khoravar, items, 1).find((entry) => entry.kind === 'spell')!;
    expect(feyGift.options.map((entry) => entry.label)).toEqual(['Friends']);
    let khoravarChoices = setSpeciesChoiceOption([], feyGift, feyGift.options[0]!.id);
    khoravarChoices = setSpeciesChoiceSpellcastingAbility(khoravarChoices, feyGift, 'CHA');
    const built = reconcileExternalSpellGrants(withSpecies('forge-artificer-2025-species-khoravar', 1, khoravarChoices), items).character;
    expect(built.spells.find((spell) => spell.name === 'Friends')).toMatchObject({ spellcastingAbility: 'CHA', externalSpellGrantOnly: true });

    const wizard = byImportId('phb-2024-class-wizard');
    const creationAccess = resolveCharacterSpellAccess({
      classItem: wizard,
      classLevel: 3,
      items,
      speciesItem: khoravar,
      speciesChoices: khoravarChoices,
      characterLevel: 3
    });
    const friends = byImportId('phb-2024-spell-friends');
    expect(creationAccess.grantedSpellReferences).toContain(friends.importItemId);
    expect(creationAccess.normalSelectionSpellReferences).not.toContain(friends.importItemId);
  });

  it('keeps Magic Initiate normal slot casting separate from its one free level-1 cast', () => {
    const feat = byImportId('phb-2024-feat-magic-initiate');
    const choice: CharacterFeatChoice = {
      id: 'magic-choice', featEntityId: 'magic-feat', featItemId: feat.id, instanceIndex: 0,
      spellList: 'Wizard', spellcastingAbility: 'INT',
      spellItemIds: [
        byImportId('phb-2024-spell-light').id,
        byImportId('phb-2024-spell-mage-hand').id,
        byImportId('phb-2024-spell-shield').id
      ]
    };
    const result = reconcileExternalSpellGrants(withFeat('phb-2024-feat-magic-initiate', 1, choice), items).character;
    expect(result.spells.every((spell) => !spellCountsAgainstNormalClassLimit(spell))).toBe(true);
    const shield = result.spells.find((spell) => spell.name === 'Shield')!;
    expect(shield.freeCastGrants).toHaveLength(1);
    const actions = buildAvailableActionsResult(result).actions.filter((action) => action.type === 'spell' && action.name.includes('Shield'));
    const normal = actions.find((action) => action.type === 'spell' && action.consumesSpellSlot);
    const free = actions.find((action) => action.type === 'spell' && !action.consumesSpellSlot);
    expect(normal).toBeDefined();
    expect(normal?.consumes?.some((cost) => cost.resourceId.startsWith('feat_free_cast_'))).toBe(false);
    expect(free?.consumes?.some((cost) => cost.resourceId === 'feat_free_cast_magic-feat')).toBe(true);
  });

  it('overlays a feat grant onto an existing spell without duplication and restores prior prepared state when removed', () => {
    let base = createEmptyCharacter('Overlay fixture');
    base = addManualSpell(base, 'phb-2024-spell-misty-step');
    const manualMisty = base.spells.find((spell) => spell.name === 'Misty Step')!;
    base = { ...base, spells: base.spells.map((spell) => spell.id === manualMisty.id ? { ...spell, prepared: false } : spell) };
    const feat = byImportId('phb-2024-feat-fey-touched');
    const choice: CharacterFeatChoice = {
      id: 'fey-choice', featEntityId: 'fey-feat', featItemId: feat.id, instanceIndex: 0,
      abilityScoreIncreases: { CHA: 1 },
      spellItemIds: [byImportId('phb-2024-spell-command').id]
    };
    const active: Character = {
      ...base,
      feats: [{ id: 'fey-feat', name: feat.name }],
      featChoices: [choice],
      compendiumLinks: [...(base.compendiumLinks ?? []), activeLink(base, feat, 'feat', 'fey-feat')]
    };
    const granted = reconcileExternalSpellGrants(active, items).character;
    expect(granted.spells.filter((spell) => spell.name === 'Misty Step')).toHaveLength(1);
    const misty = granted.spells.find((spell) => spell.name === 'Misty Step')!;
    expect(misty.externalSpellGrantOnly).toBe(false);
    expect(misty.externalSpellGrantPreparedOnly).toBe(true);
    expect(misty.prepared).toBe(true);

    const removedFeat: Character = {
      ...granted,
      feats: [], featChoices: [],
      compendiumLinks: (granted.compendiumLinks ?? []).map((link) => link.appliedAs === 'feat' ? { ...link, status: 'removed' as const } : link)
    };
    const cleaned = reconcileExternalSpellGrants(removedFeat, items).character;
    expect(cleaned.spells.filter((spell) => spell.name === 'Misty Step')).toHaveLength(1);
    expect(cleaned.spells.find((spell) => spell.name === 'Misty Step')?.prepared).toBe(false);
    expect(cleaned.spells.find((spell) => spell.name === 'Misty Step')?.externalSpellGrantSources).toBeUndefined();
  });

  it('supports Dragonmark direct grants and adds Spells of the Mark to normal class candidate lists', () => {
    const feat = byImportId('forge-artificer-2025-feat-mark-of-detection');
    const choice: CharacterFeatChoice = {
      id: 'mark-choice', featEntityId: 'mark-feat', featItemId: feat.id, instanceIndex: 0, spellcastingAbility: 'WIS'
    };
    const result = reconcileExternalSpellGrants(withFeat('forge-artificer-2025-feat-mark-of-detection', 3, choice), items).character;
    expect(result.spells.map((spell) => spell.name)).toEqual(expect.arrayContaining(['Detect Magic', 'Detect Poison and Disease', 'See Invisibility']));
    expect(result.spells.every((spell) => spell.spellcastingAbility === 'WIS')).toBe(true);
    const expanded = getCharacterFeatSpellListReferences(result, items);
    expect(expanded).toEqual(expect.arrayContaining([
      'phb-2024-spell-identify',
      'phb-2024-spell-detect-thoughts',
      'phb-2024-spell-legend-lore'
    ]));
    expect(expanded).not.toContain('phb-2024-spell-detect-magic');
  });

  it('materializes Dragonmark cantrip grants without charging a class cantrip limit', () => {
    const feat = byImportId('forge-artificer-2025-feat-mark-of-making');
    const choice: CharacterFeatChoice = {
      id: 'making-choice', featEntityId: 'making-feat', featItemId: feat.id, instanceIndex: 0, spellcastingAbility: 'INT'
    };
    const result = reconcileExternalSpellGrants(withFeat('forge-artificer-2025-feat-mark-of-making', 1, choice), items).character;
    const mending = result.spells.find((spell) => spell.name === 'Mending');
    expect(mending).toBeDefined();
    expect(mending?.externalSpellGrantOnly).toBe(true);
    expect(mending && spellCountsAgainstNormalClassLimit(mending)).toBe(false);
  });

  it('models Ritual Caster as PB level-1 ritual choices sharing one Quick Ritual resource', () => {
    const feat = byImportId('phb-2024-feat-ritual-caster');
    const schema = getFeatChoiceSchema(feat);
    const level5 = { level: 5, classes: [] };
    expect(getFeatGenericSpellChoiceCount(schema, level5)).toBe(3);
    expect(isSpellItemEligibleForGenericFeatChoice(byImportId('phb-2024-spell-find-familiar'), schema)).toBe(true);
    expect(isSpellItemEligibleForGenericFeatChoice(byImportId('phb-2024-spell-shield'), schema)).toBe(false);

    const choice: CharacterFeatChoice = {
      id: 'ritual-choice', featEntityId: 'ritual-feat', featItemId: feat.id, instanceIndex: 0,
      abilityScoreIncreases: { INT: 1 },
      spellItemIds: [
        byImportId('phb-2024-spell-find-familiar').id,
        byImportId('phb-2024-spell-detect-magic').id,
        byImportId('phb-2024-spell-comprehend-languages').id
      ]
    };
    const result = reconcileExternalSpellGrants(withFeat('phb-2024-feat-ritual-caster', 5, choice), items).character;
    expect(result.spells).toHaveLength(3);
    expect(result.resources.filter((resource) => resource.id === 'feat_quick_ritual_ritual-feat')).toHaveLength(1);
    const quickActions = buildAvailableActionsResult(result).actions.filter((action) => action.type === 'spell' && action.tags?.includes('free-cast'));
    expect(quickActions).toHaveLength(3);
    expect(quickActions.every((action) => action.type === 'spell' && action.consumes?.some((cost) => cost.resourceId === 'feat_quick_ritual_ritual-feat'))).toBe(true);
  });

  it('reconciles custom direct grants over existing spells and preserves invocation grants outside normal limits', () => {
    let base = createEmptyCharacter('Custom fixture');
    base = addManualSpell(base, 'phb-2024-spell-fire-bolt');
    const customFeature: Feature = {
      id: 'custom-feature', name: 'DM Gift', sourceType: 'manual', custom: true,
      customRules: { grantedSpellItemIds: [byImportId('phb-2024-spell-fire-bolt').id] }
    };
    const granted = reconcileExternalSpellGrants({ ...base, features: [customFeature] }, items).character;
    expect(granted.spells.filter((spell) => spell.name === 'Fire Bolt')).toHaveLength(1);
    expect(granted.spells.find((spell) => spell.name === 'Fire Bolt')?.externalSpellGrantSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'feature', sourceEntityId: 'custom-feature' })
    ]));
    expect(spellCountsAgainstNormalClassLimit(granted.spells.find((spell) => spell.name === 'Fire Bolt')!)).toBe(false);

    const invocationSpell: Spell = {
      ...granted.spells.find((spell) => spell.name === 'Fire Bolt')!,
      id: 'invocation-spell',
      externalSpellGrantSources: undefined,
      externalSpellGrantOnly: undefined,
      grantedByInvocationItemId: 'invocation-test'
    };
    expect(spellCountsAgainstNormalClassLimit(invocationSpell)).toBe(false);
  });

  it('keeps a spell stable when automatic and external grants overlap, transferring cleanup ownership between them', () => {
    const base = createEmptyCharacter('Rock Gnome Artificer');
    const artificer = byImportId('forge-artificer-2025-class-artificer');
    const gnome = byImportId('phb-2024-species-gnome');
    const gnomeRequirement = getSpeciesChoiceRequirements(gnome, items, 1).find((entry) => entry.kind === 'lineage')!;
    let speciesChoices = setSpeciesChoiceOption([], gnomeRequirement, 'rock-gnome');
    speciesChoices = setSpeciesChoiceSpellcastingAbility(speciesChoices, gnomeRequirement, 'INT');
    const classEntityId = 'artificer-entity';
    const character: Character = {
      ...base,
      level: 1,
      classes: [{ id: classEntityId, name: artificer.name, level: 1 }],
      species: { id: 'gnome-entity', name: gnome.name, features: [] },
      buildChoices: { ...base.buildChoices!, speciesChoices },
      compendiumLinks: [
        activeLink(base, artificer, 'class', classEntityId),
        activeLink(base, gnome, 'species', 'gnome-entity')
      ]
    };
    const automatic = reconcileAutomaticSpellAccess(character, items).character;
    const both = reconcileExternalSpellGrants(automatic, items).character;
    expect(both.spells.filter((spell) => spell.name === 'Mending')).toHaveLength(1);
    expect(both.spells.find((spell) => spell.name === 'Mending')).toEqual(expect.objectContaining({
      automaticSpellAccessOnly: true,
      externalSpellGrantSources: expect.any(Array)
    }));

    const withoutArtificer: Character = {
      ...both,
      classes: [],
      compendiumLinks: (both.compendiumLinks ?? []).map((link) => link.appliedAs === 'class' ? { ...link, status: 'removed' as const } : link)
    };
    const automaticRemoved = reconcileAutomaticSpellAccess(withoutArtificer, items).character;
    const speciesOnly = reconcileExternalSpellGrants(automaticRemoved, items).character;
    expect(speciesOnly.spells.filter((spell) => spell.name === 'Mending')).toHaveLength(1);
    expect(speciesOnly.spells.find((spell) => spell.name === 'Mending')?.automaticSpellAccessSources).toBeUndefined();
    expect(speciesOnly.spells.find((spell) => spell.name === 'Mending')?.externalSpellGrantOnly).toBe(true);

    const withoutSpecies: Character = {
      ...speciesOnly,
      species: undefined,
      buildChoices: { ...speciesOnly.buildChoices!, speciesChoices: [] },
      compendiumLinks: (speciesOnly.compendiumLinks ?? []).map((link) => link.appliedAs === 'species' ? { ...link, status: 'removed' as const } : link)
    };
    const none = reconcileExternalSpellGrants(withoutSpecies, items).character;
    expect(none.spells.some((spell) => spell.name === 'Mending')).toBe(false);
  });

});
