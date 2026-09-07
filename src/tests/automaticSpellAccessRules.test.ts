import type { Character, CharacterCompendiumLink } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
import { reconcileAutomaticSpellAccess } from '../characters/automaticSpellAccessRules';
import { countCharacterSpellsForClass } from '../characters/spellcastingRules';

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

const buildSingleClassSubclass = (classId: string, subclassId: string, level: number): { classEntityId: string; character: Character } => {
  const character = createEmptyCharacter('Automatic spells');
  const classItem = byImportId(classId);
  const subclassItem = byImportId(subclassId);
  const classEntityId = `fixture-class:${classItem.importItemId}`;
  const subclassEntityId = `fixture-subclass:${subclassItem.importItemId}`;
  const addedAt = '2026-08-15T00:00:00.000Z';

  // This fixture intentionally bypasses mapper review gating for the class and
  // subclass. The test exercises automatic spell reconciliation, not whether a
  // needsReview compendium carrier may be applied interactively. Production
  // behavior remains protected by applyCompendiumItemToCharacter.
  const compendiumLinks: CharacterCompendiumLink[] = [
    {
      id: 'fixture-class-link',
      characterId: character.id,
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
    },
    {
      id: 'fixture-subclass-link',
      characterId: character.id,
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
    }
  ];
  const builtCharacter: Character = {
    ...character,
    level,
    classes: [{ id: classEntityId, name: classItem.name, level }],
    subclasses: [{ id: subclassEntityId, classId: classEntityId, name: subclassItem.name }],
    compendiumLinks
  };

  return { classEntityId, character: builtCharacter };
};

describe('automatic spell access reconciliation', () => {
  it('materializes complete Life Domain spells without charging the Cleric normal limit', () => {
    const { character, classEntityId } = buildSingleClassSubclass(
      'phb-2024-class-cleric',
      'phb-2024-subclass-cleric-life-domain',
      3
    );
    const result = reconcileAutomaticSpellAccess(character, items);
    const names = result.character.spells.map((spell) => spell.name);

    expect(names).toEqual(expect.arrayContaining(['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration']));
    expect(names).not.toContain('Revivify');
    expect(result.character.spells.every((spell) => spell.automaticSpellAccessSources?.length)).toBe(true);
    expect(countCharacterSpellsForClass(result.character.spells, classEntityId)).toEqual({ cantrips: 0, prepared: 0 });
  });

  it('removes auto-only spells after the subclass/level source becomes inactive', () => {
    const built = buildSingleClassSubclass(
      'phb-2024-class-cleric',
      'phb-2024-subclass-cleric-life-domain',
      3
    );
    const applied = reconcileAutomaticSpellAccess(built.character, items).character;
    const lowered = {
      ...applied,
      level: 2,
      classes: applied.classes.map((entry) => entry.id === built.classEntityId ? { ...entry, level: 2 } : entry)
    };
    const result = reconcileAutomaticSpellAccess(lowered, items);

    expect(result.removedSpellCount).toBeGreaterThan(0);
    expect(result.character.spells.some((spell) => spell.automaticSpellAccessOnly)).toBe(false);
  });

  it('preserves an existing manual spell when automatic access later disappears', () => {
    const built = buildSingleClassSubclass(
      'phb-2024-class-cleric',
      'phb-2024-subclass-cleric-life-domain',
      3
    );
    const bless = byImportId('phb-2024-spell-bless');
    const approvedBless: StoredCompendiumItem = bless.status === 'validated'
      ? bless
      : {
          ...bless,
          status: 'validated',
          reviewDecision: 'approved',
          reviewedBy: 'Fixture de magia manual',
          reviewedAt: '2026-08-15T00:00:00.000Z'
        };
    const manuallyApplied = applyCompendiumItemToCharacter(built.character, approvedBless);
    if (!manuallyApplied.ok) throw new Error(manuallyApplied.issues.map((issue) => issue.message).join('; '));
    let character = manuallyApplied.character;
    character = {
      ...character,
      spells: character.spells.map((spell) => spell.name === 'Bless' ? {
        ...spell,
        spellcastingClassId: built.classEntityId,
        spellcastingClassName: 'Cleric',
        prepared: true
      } : spell)
    };

    const withAutomatic = reconcileAutomaticSpellAccess(character, items).character;
    const automaticBless = withAutomatic.spells.find((spell) => spell.name === 'Bless')!;
    expect(automaticBless.automaticSpellAccessOnly).toBe(false);
    expect(automaticBless.automaticSpellAccessSources?.length).toBeGreaterThan(0);
    expect(withAutomatic.spells.filter((spell) => spell.name === 'Bless')).toHaveLength(1);

    const repeated = reconcileAutomaticSpellAccess(withAutomatic, items);
    expect(repeated.addedSpellCount).toBe(0);
    expect(repeated.removedSpellCount).toBe(0);
    expect(repeated.character.spells.filter((spell) => spell.name === 'Bless')).toHaveLength(1);

    const lowered = {
      ...withAutomatic,
      level: 2,
      classes: withAutomatic.classes.map((entry) => entry.id === built.classEntityId ? { ...entry, level: 2 } : entry)
    };
    const reconciled = reconcileAutomaticSpellAccess(lowered, items).character;
    const preservedBless = reconciled.spells.find((spell) => spell.name === 'Bless');
    expect(preservedBless).toBeDefined();
    expect(preservedBless?.automaticSpellAccessSources).toBeUndefined();
  });

  it('preserves auto-only spells when a stale spell carrier id was reused by another spell', () => {
    const built = buildSingleClassSubclass(
      'phb-2024-class-cleric',
      'phb-2024-subclass-cleric-life-domain',
      3
    );
    let character = reconcileAutomaticSpellAccess(built.character, items).character;
    const bless = byImportId('phb-2024-spell-bless');
    const cureWounds = byImportId('phb-2024-spell-cure-wounds');
    const blessEntity = character.spells.find((spell) => spell.name === 'Bless')!;
    character = {
      ...character,
      compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'spell' && link.appliedEntityId === blessEntity.id
          ? {
              ...link,
              itemId: cureWounds.id,
              importItemId: bless.importItemId
            }
          : link
      )
    };

    const reconciled = reconcileAutomaticSpellAccess(character, items);

    expect(reconciled.removedSpellCount).toBe(0);
    expect(reconciled.character.spells).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: blessEntity.id, name: 'Bless', automaticSpellAccessOnly: true })
    ]));
  });

});
