import type { Character, CharacterCompendiumLink } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { createEmptyCharacter } from '../data/mockData';
import {
  getClassOrSubclassSpellcastingProfile,
  isSpellItemEligibleForProfile
} from '../characters/spellcastingRules';
import { resolveCharacterSpellAccess } from '../characters/characterSpellAccess';
import { reconcileAutomaticSpellAccess } from '../characters/automaticSpellAccessRules';
import { deriveCharacterSpellSlots } from '../characters/spellSlotProgression';
import { reconcileCharacterBuild } from '../characters/buildReconciliation';
import { itemReferenceMatches } from '../characters/creationData';

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

const classSubclassFixture = (
  classImportId: string,
  subclassImportId: string,
  level: number,
  name = 'Third caster'
): { character: Character; classEntityId: string; subclassEntityId: string; classItem: StoredCompendiumItem; subclassItem: StoredCompendiumItem } => {
  const base = createEmptyCharacter(name);
  const classItem = byImportId(classImportId);
  const subclassItem = byImportId(subclassImportId);
  const classEntityId = `fixture-class:${classImportId}`;
  const subclassEntityId = `fixture-subclass:${subclassImportId}`;
  const addedAt = '2026-08-15T00:00:00.000Z';
  const links: CharacterCompendiumLink[] = [
    {
      id: `${classEntityId}:link`, characterId: base.id, itemId: classItem.id, importItemId: classItem.importItemId,
      packId: classItem.packId, sourceId: classItem.sourceId, itemType: 'class', appliedAs: 'class',
      appliedEntityId: classEntityId, appliedEntityName: classItem.name, status: 'active', addedAt
    },
    {
      id: `${subclassEntityId}:link`, characterId: base.id, itemId: subclassItem.id, importItemId: subclassItem.importItemId,
      packId: subclassItem.packId, sourceId: subclassItem.sourceId, itemType: 'subclass', appliedAs: 'subclass',
      appliedEntityId: subclassEntityId, appliedEntityName: subclassItem.name, status: 'active', addedAt
    }
  ];
  return {
    classEntityId,
    subclassEntityId,
    classItem,
    subclassItem,
    character: {
      ...base,
      level,
      classes: [{ id: classEntityId, name: classItem.name, level }],
      subclasses: [{ id: subclassEntityId, classId: classEntityId, name: subclassItem.name }],
      compendiumLinks: links
    }
  };
};

const hasReference = (references: string[], spellImportId: string): boolean => {
  const spell = byImportId(spellImportId);
  return references.some((reference) => itemReferenceMatches(spell, reference));
};

describe('subclass spellcasting profiles', () => {
  it('does not turn base Fighter/Rogue into spellcasters before an eligible subclass is active', () => {
    expect(getClassOrSubclassSpellcastingProfile(byImportId('phb-2024-class-fighter'), 3, undefined, items)).toBeUndefined();
    expect(getClassOrSubclassSpellcastingProfile(byImportId('phb-2024-class-rogue'), 3, undefined, items)).toBeUndefined();
  });

  it('models Eldritch Knight as an INT Wizard-list third caster', () => {
    const fighter = byImportId('phb-2024-class-fighter');
    const eldritchKnight = byImportId('phb-2024-subclass-fighter-eldritch-knight');

    expect(getClassOrSubclassSpellcastingProfile(fighter, 2, eldritchKnight, items)).toBeUndefined();
    expect(getClassOrSubclassSpellcastingProfile(fighter, 3, eldritchKnight, items)).toMatchObject({
      className: 'Fighter', ability: 'INT', progression: 'thirdCaster', preparationMode: 'known',
      cantripLimit: 2, preparedSpellLimit: 3, maxSpellLevel: 1,
      spellListClassNames: ['Wizard'], slotCounts: { '1': 2 }
    });
    expect(getClassOrSubclassSpellcastingProfile(fighter, 10, eldritchKnight, items)).toMatchObject({
      cantripLimit: 3, preparedSpellLimit: 7, maxSpellLevel: 2, slotCounts: { '1': 4, '2': 3 }
    });
    expect(getClassOrSubclassSpellcastingProfile(fighter, 20, eldritchKnight, items)).toMatchObject({
      cantripLimit: 3, preparedSpellLimit: 13, maxSpellLevel: 4,
      slotCounts: { '1': 4, '2': 3, '3': 3, '4': 1 }
    });
  });

  it('models Arcane Trickster with the same third-caster chassis and keeps Mage Hand outside normal cantrip choices', () => {
    const rogue = byImportId('phb-2024-class-rogue');
    const arcaneTrickster = byImportId('phb-2024-subclass-rogue-arcane-trickster');
    const profile = getClassOrSubclassSpellcastingProfile(rogue, 3, arcaneTrickster, items)!;
    expect(profile).toMatchObject({
      className: 'Rogue', ability: 'INT', progression: 'thirdCaster', cantripLimit: 2,
      preparedSpellLimit: 3, spellListClassNames: ['Wizard']
    });

    const access = resolveCharacterSpellAccess({ classItem: rogue, classLevel: 3, subclassItem: arcaneTrickster, items });
    expect(access.classListSpellReferences.length).toBeGreaterThan(0);
    expect(hasReference(access.grantedSpellReferences, 'phb-2024-spell-mage-hand')).toBe(true);
    expect(hasReference(access.normalSelectionSpellReferences, 'phb-2024-spell-mage-hand')).toBe(false);
    expect(hasReference(access.normalSelectionSpellReferences, 'phb-2024-spell-fire-bolt')).toBe(true);
  });

  it('uses Wizard-list eligibility without making Cleric-only spells legal', () => {
    const fighter = byImportId('phb-2024-class-fighter');
    const eldritchKnight = byImportId('phb-2024-subclass-fighter-eldritch-knight');
    const profile = getClassOrSubclassSpellcastingProfile(fighter, 3, eldritchKnight, items)!;
    expect(isSpellItemEligibleForProfile(byImportId('phb-2024-spell-fire-bolt'), profile)).toBe(true);
    expect(isSpellItemEligibleForProfile(byImportId('phb-2024-spell-sacred-flame'), profile)).toBe(false);
  });

  it('materializes Arcane Trickster Mage Hand automatically and does not charge the normal cantrip limit', () => {
    const built = classSubclassFixture(
      'phb-2024-class-rogue',
      'phb-2024-subclass-rogue-arcane-trickster',
      3
    );
    const reconciled = reconcileAutomaticSpellAccess(built.character, items).character;
    const mageHand = reconciled.spells.find((spell) => spell.name === 'Mage Hand');
    expect(mageHand).toBeDefined();
    expect(mageHand?.spellcastingClassId).toBe(built.classEntityId);
    expect(mageHand?.automaticSpellAccessOnly).toBe(true);
    expect(mageHand?.automaticSpellAccessSources?.length).toBeGreaterThan(0);
  });

  it('derives single-class and multiclass slots from third-caster contribution', () => {
    const ek3 = classSubclassFixture(
      'phb-2024-class-fighter',
      'phb-2024-subclass-fighter-eldritch-knight',
      3
    );
    const single = deriveCharacterSpellSlots(ek3.character, items);
    expect(single.effectiveCasterLevel).toBe(1);
    expect(single.pools).toEqual(expect.arrayContaining([
      expect.objectContaining({ poolKind: 'spellcasting', level: 1, max: 2 })
    ]));

    const wizardItem = byImportId('phb-2024-class-wizard');
    const wizardEntityId = 'fixture-class:wizard';
    const multiclass: Character = {
      ...ek3.character,
      level: 4,
      classes: [...ek3.character.classes, { id: wizardEntityId, name: 'Wizard', level: 1 }],
      compendiumLinks: [
        ...(ek3.character.compendiumLinks ?? []),
        {
          id: 'fixture-wizard-link', characterId: ek3.character.id, itemId: wizardItem.id,
          importItemId: wizardItem.importItemId, packId: wizardItem.packId, sourceId: wizardItem.sourceId,
          itemType: 'class', appliedAs: 'class', appliedEntityId: wizardEntityId, appliedEntityName: 'Wizard',
          status: 'active', addedAt: '2026-08-15T00:00:00.000Z'
        }
      ]
    };
    const combined = deriveCharacterSpellSlots(multiclass, items);
    expect(combined.effectiveCasterLevel).toBe(2);
    expect(combined.pools).toEqual(expect.arrayContaining([
      expect.objectContaining({ poolKind: 'spellcasting', level: 1, max: 3 })
    ]));
  });

  it('creates a spell-selection pending choice for an empty Eldritch Knight sheet', () => {
    const built = classSubclassFixture(
      'phb-2024-class-fighter',
      'phb-2024-subclass-fighter-eldritch-knight',
      3
    );
    const reconciled = reconcileCharacterBuild(built.character, items).character;
    expect(reconciled.pendingChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'spellSelection', sourceEntityId: built.classEntityId, requiredCount: 5, currentCount: 0
      })
    ]));
    expect(reconciled.spellSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ poolKind: 'spellcasting', level: 1, max: 2 })
    ]));
  });
});
