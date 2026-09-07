import type { Character, CharacterCompendiumLink, CharacterSubclassChoice } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import { itemReferenceMatches } from '../characters/creationData';
import { resolveCharacterSpellAccess } from '../characters/characterSpellAccess';
import { buildPendingCharacterChoices } from '../characters/buildReconciliation';
import { countCharacterSpellsForClass, spellItemLevel } from '../characters/spellcastingRules';
import {
  canOfferMysticArcanumReplacement,
  getMysticArcanumCandidates,
  getMysticArcanumRequirements,
  reconcileMysticArcanum,
  setMysticArcanumChoice,
  validateMysticArcanumChoices,
  type MysticArcanumChoiceContext
} from '../characters/warlockMysticArcanumRules';
import { buildAvailableActions } from '../rules-engine/actions/buildActions';
import { applyRest, spendResources } from '../rules-engine/resources/resourceManager';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-15T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const warlock = byImportId('phb-2024-class-warlock');
const genie = byImportId('tcoe-2020-subclass-the-genie');

const warlockFixture = (
  level: number,
  options: { genieKind?: 'dao' | 'djinni' | 'efreeti' | 'marid' } = {}
): { character: Character; classEntityId: string; subclassChoices: CharacterSubclassChoice[]; subclassItem?: StoredCompendiumItem } => {
  const base = createEmptyCharacter('Mystic Arcanum');
  const classEntityId = 'fixture-class:warlock';
  const links: CharacterCompendiumLink[] = [{
    id: 'fixture-warlock-link',
    characterId: base.id,
    itemId: warlock.id,
    importItemId: warlock.importItemId,
    packId: warlock.packId,
    sourceId: warlock.sourceId,
    itemType: 'class',
    appliedAs: 'class',
    appliedEntityId: classEntityId,
    appliedEntityName: 'Warlock',
    status: 'active',
    addedAt: '2026-08-15T00:00:00.000Z'
  }];
  const subclassChoices: CharacterSubclassChoice[] = [];
  let subclassItem: StoredCompendiumItem | undefined;
  const subclasses: Character['subclasses'] = [];
  if (options.genieKind) {
    subclassItem = genie;
    const subclassEntityId = 'fixture-subclass:genie';
    links.push({
      id: 'fixture-genie-link',
      characterId: base.id,
      itemId: genie.id,
      importItemId: genie.importItemId,
      packId: genie.packId,
      sourceId: genie.sourceId,
      itemType: 'subclass',
      appliedAs: 'subclass',
      appliedEntityId: subclassEntityId,
      appliedEntityName: genie.name,
      status: 'active',
      addedAt: '2026-08-15T00:00:00.000Z'
    });
    subclasses.push({ id: subclassEntityId, classId: classEntityId, name: genie.name });
    subclassChoices.push({ subclassItemId: genie.id, choiceId: 'genie-kind', optionId: options.genieKind });
  }
  return {
    classEntityId,
    subclassChoices,
    subclassItem,
    character: {
      ...base,
      level,
      classes: [{ id: classEntityId, name: 'Warlock', level }],
      subclasses,
      compendiumLinks: links,
      buildChoices: {
        ...base.buildChoices!,
        subclassChoices,
        mysticArcanumChoices: []
      }
    }
  };
};

const contextsFor = (level: number, genieKind?: 'dao' | 'djinni' | 'efreeti' | 'marid'): MysticArcanumChoiceContext[] => {
  const fixture = warlockFixture(level, genieKind ? { genieKind } : {});
  return getMysticArcanumRequirements({ classItem: warlock, classLevel: level, items }).map((requirement) => ({
    requirement,
    classItem: warlock,
    classLevel: level,
    subclassItem: fixture.subclassItem,
    subclassChoices: fixture.subclassChoices,
    classFeatureChoices: []
  }));
};

const hasImportId = (candidates: StoredCompendiumItem[], importItemId: string): boolean => {
  const spell = byImportId(importItemId);
  return candidates.some((candidate) => candidate.id === spell.id);
};

describe('Warlock Mystic Arcanum', () => {
  it.each([
    [10, []],
    [11, [6]],
    [13, [6, 7]],
    [15, [6, 7, 8]],
    [17, [6, 7, 8, 9]]
  ])('exposes the correct independent arcanum thresholds at Warlock %i', (level, spellLevels) => {
    expect(getMysticArcanumRequirements({ classItem: warlock, classLevel: level as number, items }).map((entry) => entry.spellLevel)).toEqual(spellLevels);
  });

  it('keeps 6th-9th level arcanum candidates outside normal Pact Magic selection', () => {
    const context = contextsFor(11)[0]!;
    const candidates = getMysticArcanumCandidates({ ...context, items });
    expect(hasImportId(candidates, 'phb-2024-spell-arcane-gate')).toBe(true);
    expect(candidates.every((item) => spellItemLevel(item) === 6)).toBe(true);

    const access = resolveCharacterSpellAccess({ classItem: warlock, classLevel: 17, items });
    const arcaneGate = byImportId('phb-2024-spell-arcane-gate');
    expect(access.normalSelectionSpellReferences.some((reference) => itemReferenceMatches(arcaneGate, reference))).toBe(false);
  });

  it.each(['dao', 'djinni', 'efreeti', 'marid'] as const)('lets %s Genie choose Wish as the 9th-level arcanum but never as normal Pact Magic', (genieKind) => {
    const level17 = contextsFor(17, genieKind);
    const ninth = level17.find((context) => context.requirement.spellLevel === 9)!;
    const candidates = getMysticArcanumCandidates({ ...ninth, items });
    expect(hasImportId(candidates, 'phb-2024-spell-wish')).toBe(true);

    const access = resolveCharacterSpellAccess({
      classItem: warlock,
      classLevel: 17,
      subclassItem: genie,
      subclassChoices: ninth.subclassChoices,
      items
    });
    const wish = byImportId('phb-2024-spell-wish');
    expect(access.expandedListSpellReferences.some((reference) => itemReferenceMatches(wish, reference))).toBe(true);
    expect(access.normalSelectionSpellReferences.some((reference) => itemReferenceMatches(wish, reference))).toBe(false);
  });

  it('does not offer Wish to a non-Genie Warlock', () => {
    const ninth = contextsFor(17).find((context) => context.requirement.spellLevel === 9)!;
    expect(hasImportId(getMysticArcanumCandidates({ ...ninth, items }), 'phb-2024-spell-wish')).toBe(false);
  });

  it('offers one optional same-level replacement only after a Warlock that already has an Arcanum gains another Warlock level', () => {
    const sixth = contextsFor(11)[0]!;
    const choices = setMysticArcanumChoice([], sixth.requirement, byImportId('phb-2024-spell-arcane-gate').id);
    expect(canOfferMysticArcanumReplacement({ classItem: warlock, beforeClassLevel: 10, afterClassLevel: 11, choices: [] })).toBe(false);
    expect(canOfferMysticArcanumReplacement({ classItem: warlock, beforeClassLevel: 11, afterClassLevel: 12, choices })).toBe(true);
    expect(canOfferMysticArcanumReplacement({ classItem: warlock, beforeClassLevel: 11, afterClassLevel: 11, choices })).toBe(false);
  });

  it('requires exactly one eligible spell for each unlocked arcanum', () => {
    const contexts = contextsFor(13);
    expect(validateMysticArcanumChoices(contexts, [], items, true).filter((issue) => issue.code === 'MYSTIC_ARCANUM_CHOICE_REQUIRED')).toHaveLength(2);
    const sixth = contexts.find((context) => context.requirement.spellLevel === 6)!;
    const seventh = contexts.find((context) => context.requirement.spellLevel === 7)!;
    const choices = setMysticArcanumChoice(
      setMysticArcanumChoice([], sixth.requirement, byImportId('phb-2024-spell-arcane-gate').id),
      seventh.requirement,
      byImportId('phb-2024-spell-forcecage').id
    );
    expect(validateMysticArcanumChoices(contexts, choices, items, true)).toEqual([]);
  });

  it('materializes an arcanum as a no-slot action with its own Long Rest resource', () => {
    const fixture = warlockFixture(11);
    const context = contextsFor(11)[0]!;
    const spellItem = byImportId('phb-2024-spell-arcane-gate');
    const character: Character = {
      ...fixture.character,
      buildChoices: {
        ...fixture.character.buildChoices!,
        mysticArcanumChoices: setMysticArcanumChoice([], context.requirement, spellItem.id)
      }
    };
    const result = reconcileMysticArcanum(character, items);
    const spell = result.character.spells.find((entry) => entry.name === 'Arcane Gate')!;
    expect(spell).toBeDefined();
    expect(spell.mysticArcanumOnly).toBe(true);
    expect(spell.spellcastingClassId).toBe(fixture.classEntityId);
    expect(countCharacterSpellsForClass(result.character.spells, fixture.classEntityId)).toEqual({ cantrips: 0, prepared: 0 });

    const resource = result.character.resources.find((entry) => entry.id === spell.mysticArcanumFreeCastResourceId)!;
    expect(resource).toMatchObject({ max: 1, current: 1, recharge: 'longRest' });

    const spellActions = buildAvailableActions(result.character).filter((action) => action.type === 'spell' && action.spellId === spell.id);
    expect(spellActions).toHaveLength(1);
    expect(spellActions[0]).toMatchObject({ consumesSpellSlot: false, castAtSlotLevel: 6 });
    expect(spellActions[0]?.tags).toEqual(expect.arrayContaining(['mystic-arcanum', 'free-cast']));
    expect(spellActions[0]?.consumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: resource.id, amount: 1 })
    ]));

    const spent = spendResources({ character: result.character, costs: spellActions[0]?.consumes ?? [], reason: 'Mystic Arcanum test' });
    expect(spent.character.resources.find((entry) => entry.id === resource.id)?.current).toBe(0);
    expect(applyRest(spent.character, 'shortRest').character.resources.find((entry) => entry.id === resource.id)?.current).toBe(0);
    expect(applyRest(spent.character, 'longRest').character.resources.find((entry) => entry.id === resource.id)?.current).toBe(1);
  });

  it('prunes the choice, spell, and resource when the Warlock falls below the arcanum threshold', () => {
    const fixture = warlockFixture(11);
    const context = contextsFor(11)[0]!;
    const selected: Character = {
      ...fixture.character,
      buildChoices: {
        ...fixture.character.buildChoices!,
        mysticArcanumChoices: setMysticArcanumChoice([], context.requirement, byImportId('phb-2024-spell-arcane-gate').id)
      }
    };
    const applied = reconcileMysticArcanum(selected, items).character;
    const lowered: Character = {
      ...applied,
      level: 10,
      classes: applied.classes.map((entry) => entry.id === fixture.classEntityId ? { ...entry, level: 10 } : entry)
    };
    const result = reconcileMysticArcanum(lowered, items);
    expect(result.character.buildChoices?.mysticArcanumChoices).toEqual([]);
    expect(result.character.spells.some((spell) => spell.mysticArcanumChoiceId)).toBe(false);
    expect(result.character.resources.some((resource) => resource.id.startsWith('warlock-arcanum:'))).toBe(false);
    expect(result.removedSpellCount).toBe(1);
  });

  it('replaces an auto-only arcanum with another spell of the same requirement without duplicates', () => {
    const fixture = warlockFixture(11);
    const context = contextsFor(11)[0]!;
    let character: Character = {
      ...fixture.character,
      buildChoices: {
        ...fixture.character.buildChoices!,
        mysticArcanumChoices: setMysticArcanumChoice([], context.requirement, byImportId('phb-2024-spell-arcane-gate').id)
      }
    };
    character = reconcileMysticArcanum(character, items).character;
    character = {
      ...character,
      buildChoices: {
        ...character.buildChoices!,
        mysticArcanumChoices: setMysticArcanumChoice(character.buildChoices?.mysticArcanumChoices, context.requirement, byImportId('phb-2024-spell-circle-of-death').id)
      }
    };
    const replaced = reconcileMysticArcanum(character, items);
    expect(replaced.character.spells.some((spell) => spell.name === 'Arcane Gate')).toBe(false);
    expect(replaced.character.spells.filter((spell) => spell.name === 'Circle of Death')).toHaveLength(1);
    expect(replaced.character.resources.find((resource) => resource.id.startsWith('warlock-arcanum:'))?.name).toContain('Circle of Death');
    const repeated = reconcileMysticArcanum(replaced.character, items);
    expect(repeated.addedSpellCount).toBe(0);
    expect(repeated.removedSpellCount).toBe(0);
  });

  it('creates required pending choices for unlocked but unselected arcanum levels', () => {
    const fixture = warlockFixture(13);
    const pending = buildPendingCharacterChoices(fixture.character, items).filter((choice) => choice.kind === 'mysticArcanum');
    expect(pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceEntityId: fixture.classEntityId, requiredCount: 1, title: expect.stringContaining('6º') }),
      expect.objectContaining({ sourceEntityId: fixture.classEntityId, requiredCount: 1, title: expect.stringContaining('7º') })
    ]));
  });
});
