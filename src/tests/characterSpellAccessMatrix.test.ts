import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  getSpellAccessRequirementsFromFeature,
  resolveCharacterSpellAccess
} from '../characters/characterSpellAccess';
import { itemReferenceMatches } from '../characters/creationData';
import { getCompendiumClassReference } from '../compendium/classProgression';
import { PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE } from '../characters/phb2024SubclassSpellGrantBridge';

const allBundledItems = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-14T00:00:00.000Z'
  }).items
);

const findByImportId = (id: string): StoredCompendiumItem => {
  const item = allBundledItems.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const findClass = (name: string): StoredCompendiumItem => {
  const item = allBundledItems.find((candidate) => candidate.type === 'class' && candidate.name === name);
  if (!item) throw new Error(`Classe ausente: ${name}`);
  return item;
};

const hasReference = (references: string[], importId: string): boolean => {
  const spell = findByImportId(importId);
  return references.some((reference) => itemReferenceMatches(spell, reference));
};

const baseCasterMatrix: Array<[string, number]> = [
  ['Artificer', 1],
  ['Bard', 1],
  ['Cleric', 1],
  ['Druid', 1],
  ['Paladin', 2],
  ['Ranger', 2],
  ['Sorcerer', 1],
  ['Warlock', 1],
  ['Wizard', 1]
];

describe('character spell access semantic matrix', () => {
  it.each(baseCasterMatrix)('keeps %s base spell access distinct from automatic grants', (className: string, classLevel: number) => {
    const resolution = resolveCharacterSpellAccess({
      classItem: findClass(className),
      classLevel,
      items: allBundledItems
    });

    expect(resolution.classListSpellReferences.length).toBeGreaterThan(0);
    expect(resolution.normalSelectionSpellReferences.length).toBeGreaterThan(0);
    for (const automaticReference of [
      ...resolution.alwaysPreparedSpellReferences,
      ...resolution.grantedSpellReferences
    ]) {
      expect(resolution.normalSelectionSpellReferences).not.toContain(automaticReference);
    }
  });

  it('classifies base-class automatic spells without charging the normal selection pool', () => {
    const druid = resolveCharacterSpellAccess({ classItem: findClass('Druid'), classLevel: 1, items: allBundledItems });
    const paladin = resolveCharacterSpellAccess({ classItem: findClass('Paladin'), classLevel: 2, items: allBundledItems });
    const ranger = resolveCharacterSpellAccess({ classItem: findClass('Ranger'), classLevel: 2, items: allBundledItems });

    expect(hasReference(druid.alwaysPreparedSpellReferences, 'phb-2024-spell-speak-with-animals')).toBe(true);
    expect(hasReference(paladin.alwaysPreparedSpellReferences, 'phb-2024-spell-divine-smite')).toBe(true);
    expect(hasReference(ranger.alwaysPreparedSpellReferences, 'phb-2024-spell-hunter-s-mark')).toBe(true);

    expect(hasReference(druid.normalSelectionSpellReferences, 'phb-2024-spell-speak-with-animals')).toBe(false);
    expect(hasReference(paladin.normalSelectionSpellReferences, 'phb-2024-spell-divine-smite')).toBe(false);
    expect(hasReference(ranger.normalSelectionSpellReferences, 'phb-2024-spell-hunter-s-mark')).toBe(false);
  });

  it('models Lore Bard Magical Discoveries as two bonus choices without mutating the normal Bard limit', () => {
    const bard = findClass('Bard');
    const lore = findByImportId('phb-2024-subclass-bard-college-of-lore');

    const before = resolveCharacterSpellAccess({ classItem: bard, classLevel: 5, subclassItem: lore, items: allBundledItems });
    expect(before.bonusChoiceRequirements.some((requirement) => requirement.source.name === 'Magical Discoveries')).toBe(false);

    const atSix = resolveCharacterSpellAccess({ classItem: bard, classLevel: 6, subclassItem: lore, items: allBundledItems });
    const requirement = atSix.bonusChoiceRequirements.find((candidate) => candidate.source.name === 'Magical Discoveries');
    expect(requirement).toMatchObject({
      count: 2,
      sourceClassNames: ['cleric', 'druid', 'wizard'],
      countsAgainstNormalLimit: false,
      countsAsClassName: 'Bard',
      activation: { kind: 'automatic' }
    });
  });

  it('models Nature Domain Acolyte of Nature as a bonus Druid cantrip on the Cleric chassis', () => {
    const cleric = findClass('Cleric');
    const nature = findByImportId('phb-2014-subclass-cleric-nature-domain');
    const resolution = resolveCharacterSpellAccess({
      classItem: cleric,
      classLevel: 3,
      subclassItem: nature,
      items: allBundledItems
    });
    const requirement = resolution.bonusChoiceRequirements.find((candidate) => candidate.source.name === 'Acolyte of Nature');

    expect(requirement).toMatchObject({
      count: 1,
      sourceClassNames: ['Druid'],
      spellLevel: 0,
      countsAgainstNormalLimit: false,
      countsAsClassName: 'cleric'
    });
  });

  it('detects PHB 2024 class-feature options that add bonus cantrips without activating them prematurely', () => {
    const paladin = findClass('Paladin');
    const ranger = findClass('Ranger');
    const cleric = findClass('Cleric');
    const druid = findClass('Druid');

    const paladinResolution = resolveCharacterSpellAccess({ classItem: paladin, classLevel: 2, items: allBundledItems });
    const blessedWarrior = paladinResolution.bonusChoiceRequirements.find((candidate) => candidate.activation.optionId === 'blessed-warrior');
    expect(blessedWarrior).toMatchObject({
      count: 2,
      sourceClassNames: ['cleric'],
      spellLevel: 0,
      countsAgainstNormalLimit: false,
      activation: { kind: 'featureOption', optionId: 'blessed-warrior' }
    });
    expect(paladinResolution.activeBonusChoiceRequirements).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ activation: expect.objectContaining({ optionId: 'blessed-warrior' }) })
    ]));
    const activePaladinResolution = resolveCharacterSpellAccess({
      classItem: paladin,
      classLevel: 2,
      items: allBundledItems,
      classFeatureChoices: [{
        classItemId: paladin.id,
        featureItemId: blessedWarrior!.activation.featureItemId!,
        optionId: 'blessed-warrior'
      }]
    });
    expect(activePaladinResolution.activeBonusChoiceRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 2, activation: expect.objectContaining({ optionId: 'blessed-warrior' }) })
    ]));

    const rangerResolution = resolveCharacterSpellAccess({ classItem: ranger, classLevel: 2, items: allBundledItems });
    const druidicWarrior = rangerResolution.bonusChoiceRequirements.find((candidate) => candidate.activation.optionId === 'druidic-warrior');
    expect(druidicWarrior).toMatchObject({ count: 2, sourceClassNames: ['druid'], spellLevel: 0 });

    const clericResolution = resolveCharacterSpellAccess({ classItem: cleric, classLevel: 1, items: allBundledItems });
    const thaumaturge = clericResolution.bonusChoiceRequirements.find((candidate) => candidate.activation.optionId === 'thaumaturge');
    expect(thaumaturge).toMatchObject({ count: 1, sourceClassNames: ['Cleric'], spellLevel: 0 });

    const druidResolution = resolveCharacterSpellAccess({ classItem: druid, classLevel: 1, items: allBundledItems });
    const magician = druidResolution.bonusChoiceRequirements.find((candidate) => candidate.activation.optionId === 'magician');
    expect(magician).toMatchObject({ count: 1, sourceClassNames: ['Druid'], spellLevel: 0 });
  });

  it('keeps expanded lists separate from always-prepared spells', () => {
    const warlock = findClass('Warlock');
    const fathomless = findByImportId('tcoe-2020-subclass-the-fathomless');
    const fathomlessResolution = resolveCharacterSpellAccess({
      classItem: warlock,
      classLevel: 3,
      subclassItem: fathomless,
      items: allBundledItems
    });
    expect(hasReference(fathomlessResolution.expandedListSpellReferences, 'phb-2024-spell-thunderwave')).toBe(true);
    expect(hasReference(fathomlessResolution.alwaysPreparedSpellReferences, 'phb-2024-spell-thunderwave')).toBe(false);

    const celestial = findByImportId('phb-2024-subclass-warlock-celestial-patron');
    const celestialResolution = resolveCharacterSpellAccess({
      classItem: warlock,
      classLevel: 3,
      subclassItem: celestial,
      items: allBundledItems
    });
    expect(hasReference(celestialResolution.alwaysPreparedSpellReferences, 'phb-2024-spell-cure-wounds')).toBe(true);
    expect(hasReference(celestialResolution.alwaysPreparedSpellReferences, 'phb-2024-spell-guiding-bolt')).toBe(true);
    expect(hasReference(celestialResolution.alwaysPreparedSpellReferences, 'phb-2024-spell-wall-of-fire')).toBe(false);
  });

  it('recognizes Artificer subclass spell progression as always prepared and level-gated', () => {
    const artificer = findClass('Artificer');
    const alchemist = findByImportId('forge-artificer-2025-subclass-alchemist');

    const level3 = resolveCharacterSpellAccess({ classItem: artificer, classLevel: 3, subclassItem: alchemist, items: allBundledItems });
    expect(hasReference(level3.alwaysPreparedSpellReferences, 'phb-2024-spell-healing-word')).toBe(true);
    expect(hasReference(level3.alwaysPreparedSpellReferences, 'phb-2024-spell-flaming-sphere')).toBe(false);

    const level5 = resolveCharacterSpellAccess({ classItem: artificer, classLevel: 5, subclassItem: alchemist, items: allBundledItems });
    expect(hasReference(level5.alwaysPreparedSpellReferences, 'phb-2024-spell-flaming-sphere')).toBe(true);
  });

  it("classifies Artificer Tinker's Magic Mending as a granted cantrip", () => {
    const artificer = resolveCharacterSpellAccess({
      classItem: findClass('Artificer'),
      classLevel: 1,
      items: allBundledItems
    });

    expect(hasReference(artificer.grantedSpellReferences, 'phb-2024-spell-mending')).toBe(true);
    expect(hasReference(artificer.normalSelectionSpellReferences, 'phb-2024-spell-mending')).toBe(false);
    expect(artificer.featureSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'granted', featureName: "Artificer: Tinker's Magic" })
    ]));
  });

  it.each([
    ['dao', 'phb-2024-spell-sanctuary'],
    ['djinni', 'phb-2024-spell-thunderwave'],
    ['efreeti', 'phb-2024-spell-burning-hands'],
    ['marid', 'phb-2024-spell-fog-cloud']
  ] as const)('keeps Genie common list plus the %s patron-specific expanded list', (kind: 'dao' | 'djinni' | 'efreeti' | 'marid', exclusiveSpellId: string) => {
    const warlock = findClass('Warlock');
    const genie = findByImportId('tcoe-2020-subclass-the-genie');
    const resolution = resolveCharacterSpellAccess({
      classItem: warlock,
      classLevel: 17,
      subclassItem: genie,
      subclassChoices: [{ subclassItemId: genie.id, choiceId: 'genie-kind', optionId: kind }],
      items: allBundledItems
    });

    expect(hasReference(resolution.expandedListSpellReferences, 'phb-2024-spell-detect-evil-and-good')).toBe(true);
    expect(hasReference(resolution.expandedListSpellReferences, exclusiveSpellId)).toBe(true);
    expect(hasReference(resolution.expandedListSpellReferences, 'phb-2024-spell-wish')).toBe(true);
    // Pact Magic caps normal spell selection at level 5. Wish remains semantic expanded-list
    // evidence for the future Mystic Arcanum flow, not a normal Pact Magic choice.
    expect(hasReference(resolution.normalSelectionSpellReferences, 'phb-2024-spell-wish')).toBe(false);
  });

  it('recognizes Circle of the Land as conditional spell access instead of guessing a land list', () => {
    const druid = findClass('Druid');
    const land = findByImportId('phb-2024-subclass-druid-circle-of-the-land');
    const resolution = resolveCharacterSpellAccess({ classItem: druid, classLevel: 3, subclassItem: land, items: allBundledItems });

    expect(resolution.conditionalRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'landChoice', source: expect.objectContaining({ name: 'Circle of the Land Spells' }) })
    ]));
  });

  it('resolves all 78 bundled subclasses on their current class chassis and inventories non-caster spell rules', () => {
    const subclassMatrix = allBundledItems.flatMap((subclass) => {
      if (subclass.type !== 'subclass') return [];
      const classReference = getCompendiumClassReference(subclass);
      const classItem = classReference
        ? allBundledItems.find((candidate) => candidate.type === 'class' && itemReferenceMatches(candidate, classReference))
        : undefined;
      if (!classItem) throw new Error(`Classe-base ausente para ${subclass.name}: ${classReference ?? 'sem referência'}`);
      return [{ classItem, subclass }];
    });

    expect(subclassMatrix).toHaveLength(78);
    for (const { classItem, subclass } of subclassMatrix) {
      const resolution = resolveCharacterSpellAccess({
        classItem,
        classLevel: 20,
        subclassItem: subclass,
        items: allBundledItems
      });
      const references = [
        ...resolution.classListSpellReferences,
        ...resolution.expandedListSpellReferences,
        ...resolution.alwaysPreparedSpellReferences,
        ...resolution.grantedSpellReferences,
        ...resolution.catalogBridgeSpellReferences
      ];
      const unresolved = references.filter((reference) =>
        !allBundledItems.some((item) => item.type === 'spell' && itemReferenceMatches(item, reference))
      );
      expect(unresolved).toEqual([]);
    }

    const eldritchKnight = subclassMatrix.find(({ subclass }) => subclass.importItemId === 'phb-2024-subclass-fighter-eldritch-knight');
    const arcaneTrickster = subclassMatrix.find(({ subclass }) => subclass.importItemId === 'phb-2024-subclass-rogue-arcane-trickster');
    expect(eldritchKnight).toBeDefined();
    expect(arcaneTrickster).toBeDefined();
    for (const pair of [eldritchKnight, arcaneTrickster]) {
      if (!pair) continue;
      const resolution = resolveCharacterSpellAccess({
        classItem: pair.classItem,
        classLevel: 20,
        subclassItem: pair.subclass,
        items: allBundledItems
      });
      expect(resolution.featureSignals.some((signal) => signal.kind === 'subclassSpellcasting')).toBe(true);
    }
  });

  it('keeps all 35 PHB 2024 runtime subclass spell-grant carriers canonicalized to installed Compendium ids', () => {
    expect(PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE).toHaveLength(35);
    for (const bridgeEntry of PHB2024_SUBCLASS_SPELL_GRANT_BRIDGE) {
      expect(findByImportId(bridgeEntry.classId).type).toBe('class');
      expect(findByImportId(bridgeEntry.subclassId).type).toBe('subclass');
      for (const reference of bridgeEntry.groups.flatMap((group) => group.spellReferences)) {
        expect(findByImportId(reference).type).toBe('spell');
      }
    }
  });


  it('can classify imported feature shapes before those choices are wired into the UI', () => {
    const paladin = findClass('Paladin');
    const blessedWarrior = findByImportId('tcoe-2020-feature-fighting-style-blessed-warrior');
    const requirements = getSpellAccessRequirementsFromFeature(blessedWarrior, paladin, allBundledItems);

    expect(requirements.bonusChoiceRequirements).toEqual([
      expect.objectContaining({
        count: 2,
        sourceClassNames: ['Cleric'],
        spellLevel: 0,
        countsAsClassName: 'Paladin',
        spellcastingAbility: 'CHA',
        countsAgainstNormalLimit: false
      })
    ]);
  });
});

describe('FIX39 automatic/expanded subclass spell tables', () => {
  const automaticCases: Array<{
    className: string;
    classLevel: number;
    subclassId: string;
    expected: string[];
    notYet?: string[];
  }> = [
    {
      className: 'Cleric',
      classLevel: 3,
      subclassId: 'phb-2024-subclass-cleric-life-domain',
      expected: ['phb-2024-spell-bless', 'phb-2024-spell-aid'],
      notYet: ['phb-2024-spell-revivify']
    },
    {
      className: 'Druid',
      classLevel: 3,
      subclassId: 'phb-2024-subclass-druid-circle-of-the-moon',
      expected: ['phb-2024-spell-starry-wisp', 'phb-2024-spell-cure-wounds', 'phb-2024-spell-moonbeam'],
      notYet: ['phb-2024-spell-conjure-animals']
    },
    {
      className: 'Paladin',
      classLevel: 3,
      subclassId: 'phb-2024-subclass-paladin-oath-of-devotion',
      expected: ['phb-2024-spell-protection-from-evil-and-good', 'phb-2024-spell-shield-of-faith'],
      notYet: ['phb-2024-spell-aid']
    },
    {
      className: 'Ranger',
      classLevel: 3,
      subclassId: 'phb-2024-subclass-ranger-fey-wanderer',
      expected: ['phb-2024-spell-charm-person'],
      notYet: ['phb-2024-spell-misty-step']
    },
    {
      className: 'Sorcerer',
      classLevel: 3,
      subclassId: 'phb-2024-subclass-sorcerer-clockwork-sorcery',
      expected: ['phb-2024-spell-alarm', 'phb-2024-spell-aid'],
      notYet: ['phb-2024-spell-dispel-magic']
    },
    {
      className: 'Warlock',
      classLevel: 3,
      subclassId: 'phb-2024-subclass-warlock-archfey-patron',
      expected: ['phb-2024-spell-calm-emotions', 'phb-2024-spell-phantasmal-force'],
      notYet: ['phb-2024-spell-blink']
    }
  ];

  it.each(automaticCases)('materializes complete automatic spell access for $subclassId', ({
    className,
    classLevel,
    subclassId,
    expected,
    notYet = []
  }) => {
    const resolution = resolveCharacterSpellAccess({
      classItem: findClass(className),
      classLevel,
      subclassItem: findByImportId(subclassId),
      items: allBundledItems
    });

    for (const reference of expected) {
      expect(hasReference([
        ...resolution.alwaysPreparedSpellReferences,
        ...resolution.grantedSpellReferences
      ], reference)).toBe(true);
      expect(hasReference(resolution.normalSelectionSpellReferences, reference)).toBe(false);
    }
    for (const reference of notYet) {
      expect(hasReference([
        ...resolution.alwaysPreparedSpellReferences,
        ...resolution.grantedSpellReferences
      ], reference)).toBe(false);
    }
  });

  it('does not leak all four Circle of the Land tables before the terrain-choice phase', () => {
    const resolution = resolveCharacterSpellAccess({
      classItem: findClass('Druid'),
      classLevel: 9,
      subclassItem: findByImportId('phb-2024-subclass-druid-circle-of-the-land'),
      items: allBundledItems
    });
    expect(resolution.conditionalRequirements.some((requirement) => requirement.mode === 'landChoice')).toBe(true);
    expect(resolution.catalogBridgeAppliedAutomaticSpellReferences).toHaveLength(0);
    expect(hasReference(resolution.alwaysPreparedSpellReferences, 'phb-2024-spell-fireball')).toBe(false);
    expect(hasReference(resolution.alwaysPreparedSpellReferences, 'phb-2024-spell-sleet-storm')).toBe(false);
  });

  it('keeps legacy Fathomless and all Genie variants as expanded lists rather than automatic spells', () => {
    const warlock = findClass('Warlock');
    const fathomless = findByImportId('tcoe-2020-subclass-the-fathomless');
    const fathomlessResolution = resolveCharacterSpellAccess({
      classItem: warlock,
      classLevel: 5,
      subclassItem: fathomless,
      items: allBundledItems
    });
    expect(hasReference(fathomlessResolution.expandedListSpellReferences, 'phb-2024-spell-thunderwave')).toBe(true);
    expect(hasReference(fathomlessResolution.alwaysPreparedSpellReferences, 'phb-2024-spell-thunderwave')).toBe(false);

    const genie = findByImportId('tcoe-2020-subclass-the-genie');
    for (const kind of ['dao', 'djinni', 'efreeti', 'marid']) {
      const resolution = resolveCharacterSpellAccess({
        classItem: warlock,
        classLevel: 5,
        subclassItem: genie,
        subclassChoices: [{ subclassItemId: genie.id, choiceId: 'genie-kind', optionId: kind }],
        items: allBundledItems
      });
      expect(resolution.expandedListSpellReferences.length).toBeGreaterThan(0);
      expect(resolution.catalogBridgeAppliedAutomaticSpellReferences).toHaveLength(0);
    }
  });

  it('gates Great Old One Hex at level 10 instead of exposing the low-level spell early', () => {
    const warlock = findClass('Warlock');
    const goo = findByImportId('phb-2024-subclass-warlock-great-old-one-patron');
    const level9 = resolveCharacterSpellAccess({ classItem: warlock, classLevel: 9, subclassItem: goo, items: allBundledItems });
    const level10 = resolveCharacterSpellAccess({ classItem: warlock, classLevel: 10, subclassItem: goo, items: allBundledItems });
    expect(hasReference(level9.alwaysPreparedSpellReferences, 'phb-2024-spell-hex')).toBe(false);
    expect(hasReference(level10.alwaysPreparedSpellReferences, 'phb-2024-spell-hex')).toBe(true);
  });
});
