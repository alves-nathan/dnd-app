import type { Character, CharacterCompendiumLink } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import { resolveCharacterSpellAccess } from '../characters/characterSpellAccess';
import { reconcileAutomaticSpellAccess } from '../characters/automaticSpellAccessRules';
import {
  getSubclassChoiceRequirements,
  setSubclassChoiceOption
} from '../characters/subclassChoiceRules';
import { classifySpellAccessFeature } from '../characters/spellAccessFeatureClassifier';
import { buildAvailableActionsResult } from '../rules-engine/actions/buildActions';

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

const buildClassSubclass = (
  classId: string,
  subclassId: string | undefined,
  level: number
): { classEntityId: string; character: Character; classItem: StoredCompendiumItem; subclassItem?: StoredCompendiumItem } => {
  const base = createEmptyCharacter('FIX43 fixture');
  const classItem = byImportId(classId);
  const subclassItem = subclassId ? byImportId(subclassId) : undefined;
  const classEntityId = `fixture-class:${classItem.importItemId}`;
  const subclassEntityId = subclassItem ? `fixture-subclass:${subclassItem.importItemId}` : undefined;
  const addedAt = '2026-08-15T00:00:00.000Z';
  const links: CharacterCompendiumLink[] = [{
    id: 'fixture-class-link',
    characterId: base.id,
    itemId: classItem.id,
    importItemId: classItem.importItemId,
    packId: classItem.packId,
    sourceId: classItem.sourceId,
    itemType: 'class',
    appliedAs: 'class',
    appliedEntityId: classEntityId,
    appliedEntityName: classItem.name,
    status: 'active',
    addedAt
  }];
  if (subclassItem && subclassEntityId) links.push({
    id: 'fixture-subclass-link',
    characterId: base.id,
    itemId: subclassItem.id,
    importItemId: subclassItem.importItemId,
    packId: subclassItem.packId,
    sourceId: subclassItem.sourceId,
    itemType: 'subclass',
    appliedAs: 'subclass',
    appliedEntityId: subclassEntityId,
    appliedEntityName: subclassItem.name,
    status: 'active',
    addedAt
  });
  return {
    classEntityId,
    classItem,
    subclassItem,
    character: {
      ...base,
      level,
      classes: [{ id: classEntityId, name: classItem.name, level }],
      subclasses: subclassItem && subclassEntityId
        ? [{ id: subclassEntityId, classId: classEntityId, name: subclassItem.name }]
        : [],
      compendiumLinks: links
    }
  };
};

describe('conditional and special spell access', () => {
  it('requires exactly one Circle of the Land terrain table and exposes all four options', () => {
    const land = byImportId('phb-2024-subclass-druid-circle-of-the-land');
    const requirements = getSubclassChoiceRequirements(land, items, 3);
    const requirement = requirements.find((entry) => entry.choiceId === 'land-spell-list');

    expect(requirement).toBeDefined();
    expect(requirement?.options.map((option) => option.id)).toEqual(['arid', 'polar', 'temperate', 'tropical']);
    expect(requirement?.options.find((option) => option.id === 'arid')?.summary).toContain('Fire Bolt');
    expect(requirement?.options.find((option) => option.id === 'polar')?.summary).toContain('Ray of Frost');
  });

  it('activates only the selected Circle of the Land table and gates rows by class level', () => {
    const druid = byImportId('phb-2024-class-druid');
    const land = byImportId('phb-2024-subclass-druid-circle-of-the-land');
    const requirement = getSubclassChoiceRequirements(land, items, 3).find((entry) => entry.choiceId === 'land-spell-list')!;
    const arid = setSubclassChoiceOption([], requirement, 'arid');

    const level3 = resolveCharacterSpellAccess({
      classItem: druid,
      classLevel: 3,
      items,
      subclassItem: land,
      subclassChoices: arid
    });
    expect(level3.alwaysPreparedSpellReferences).toEqual(expect.arrayContaining([
      'phb-2024-spell-blur',
      'phb-2024-spell-burning-hands',
      'phb-2024-spell-fire-bolt'
    ]));
    expect(level3.alwaysPreparedSpellReferences).not.toContain('phb-2024-spell-fireball');
    expect(level3.alwaysPreparedSpellReferences).not.toContain('phb-2024-spell-ray-of-frost');

    const level5 = resolveCharacterSpellAccess({
      classItem: druid,
      classLevel: 5,
      items,
      subclassItem: land,
      subclassChoices: arid
    });
    expect(level5.alwaysPreparedSpellReferences).toContain('phb-2024-spell-fireball');
    expect(level5.normalSelectionSpellReferences).not.toContain('phb-2024-spell-fireball');
  });

  it('reconciles a changed Circle of the Land choice without keeping the previous table', () => {
    const built = buildClassSubclass(
      'phb-2024-class-druid',
      'phb-2024-subclass-druid-circle-of-the-land',
      5
    );
    const requirement = getSubclassChoiceRequirements(built.subclassItem, items, 5).find((entry) => entry.choiceId === 'land-spell-list')!;
    const aridChoices = setSubclassChoiceOption([], requirement, 'arid');
    const aridCharacter: Character = {
      ...built.character,
      buildChoices: {
        ...built.character.buildChoices!,
        subclassChoices: aridChoices
      }
    };
    const arid = reconcileAutomaticSpellAccess(aridCharacter, items).character;
    expect(arid.spells.map((spell) => spell.name)).toEqual(expect.arrayContaining(['Fire Bolt', 'Burning Hands', 'Fireball']));

    const polarChoices = setSubclassChoiceOption(aridChoices, requirement, 'polar');
    const polar = reconcileAutomaticSpellAccess({
      ...arid,
      buildChoices: { ...arid.buildChoices!, subclassChoices: polarChoices }
    }, items).character;
    expect(polar.spells.map((spell) => spell.name)).toEqual(expect.arrayContaining(['Ray of Frost', 'Fog Cloud', 'Sleet Storm']));
    expect(polar.spells.map((spell) => spell.name)).not.toContain('Fireball');
    expect(polar.spells.map((spell) => spell.name)).not.toContain('Burning Hands');
  });

  it('materializes Wild Heart ritual grants even though Barbarian is not a normal spellcaster', () => {
    const built = buildClassSubclass(
      'phb-2024-class-barbarian',
      'phb-2024-subclass-barbarian-path-of-the-wild-heart',
      3
    );
    const access = resolveCharacterSpellAccess({
      classItem: built.classItem,
      classLevel: 3,
      items,
      subclassItem: built.subclassItem
    });
    expect(access.grantedSpellReferences).toEqual(expect.arrayContaining([
      'phb-2024-spell-beast-sense',
      'phb-2024-spell-speak-with-animals'
    ]));
    expect(access.normalSelectionSpellReferences).toHaveLength(0);

    const reconciled = reconcileAutomaticSpellAccess(built.character, items).character;
    const ritualNames = reconciled.spells.filter((spell) => spell.ritualOnly).map((spell) => spell.name);
    expect(ritualNames).toEqual(expect.arrayContaining(['Beast Sense', 'Speak with Animals']));
    expect(reconciled.spells.every((spell) => spell.spellcastingAbility === 'WIS')).toBe(true);

    const actions = buildAvailableActionsResult(reconciled).actions.filter((action) => action.type === 'spell');
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions.every((action) => action.type === 'spell' && action.consumesSpellSlot === false)).toBe(true);
  });

  it("materializes Tinker's Magic Mending as a granted cantrip outside normal Artificer limits", () => {
    const built = buildClassSubclass('forge-artificer-2025-class-artificer', undefined, 1);
    const access = resolveCharacterSpellAccess({
      classItem: built.classItem,
      classLevel: 1,
      items
    });
    expect(access.grantedSpellReferences).toContain('phb-2024-spell-mending');
    expect(access.normalSelectionSpellReferences).not.toContain('phb-2024-spell-mending');

    const reconciled = reconcileAutomaticSpellAccess(built.character, items).character;
    const mending = reconciled.spells.find((spell) => spell.name === 'Mending');
    expect(mending?.automaticSpellAccessOnly).toBe(true);
  });

  it('classifies direct spell references as special rules instead of normal spell-list grants', () => {
    const starMap = classifySpellAccessFeature(byImportId('phb-2024-feature-druid-circle-of-the-stars-star-map'));
    const feyReinforcements = classifySpellAccessFeature(byImportId('phb-2024-feature-ranger-fey-wanderer-fey-reinforcements'));
    const telekineticMaster = classifySpellAccessFeature(byImportId('phb-2024-feature-fighter-psi-warrior-telekinetic-master'));

    expect(starMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'specialSpellReference', details: expect.objectContaining({ mode: 'specialCast' }) })
    ]));
    expect(feyReinforcements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'specialSpellReference', details: expect.objectContaining({ mode: 'modifier' }) })
    ]));
    expect(telekineticMaster).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'specialSpellReference', details: expect.objectContaining({ mode: 'reference' }) })
    ]));
  });
});
