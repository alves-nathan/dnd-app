import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  applyAutomaticClassProgression,
  isProgressionOwnedFeatureItem
} from '../compendium/classProgression';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createDefaultCharacter, createEmptyCharacter } from '../data/mockData';

const source = {
  id: 'progression-source',
  book: 'Progression Test',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

describe('automatic class progression', () => {
  const persisted =
    buildPersistedCompendiumImport({
      id: 'progression-pack',
      source,
      items: [
        {
          id: 'fighter',
          kind: 'class',
          name: 'Fighter',
          source,
          payload: {
            level: 1,
            hitDie: 10,
            progression: [
              {
                level: 1,
                featureIds: [
                  'fighter-level-one'
                ]
              },
              {
                level: 2,
                featureIds: [
                  'fighter-level-two'
                ]
              },
              {
                level: 4,
                featureIds: [
                  'fighter-asi'
                ]
              }
            ]
          }
        },
        {
          id: 'fighter-level-one',
          kind: 'feature',
          name: 'Level One Feature',
          source,
          payload: {
            sourceType: 'classFeature',
            classId: 'fighter'
          }
        },
        {
          id: 'fighter-level-two',
          kind: 'feature',
          name: 'Level Two Feature',
          source,
          payload: {
            sourceType: 'classFeature',
            classId: 'fighter'
          }
        },
        {
          id: 'fighter-asi',
          kind: 'feature',
          name: 'Ability Score Improvement',
          source,
          payload: {
            sourceType: 'classFeature',
            classId: 'fighter',
            featChoice: true
          }
        }
      ]
    });

  it('applies deterministic features at the attained level', () => {
    const classItem =
      persisted.items.find(
        (item) => item.type === 'class'
      )!;

    const initial =
      createDefaultCharacter('Progression Hero');

    const withClass =
      applyCompendiumItemToCharacter(
        initial,
        classItem
      );

    expect(withClass.ok).toBe(true);

    const firstProgression =
      applyAutomaticClassProgression(
        withClass.character,
        persisted.items
      );

    expect(
      firstProgression.character.features
        .some(
          (feature) =>
            feature.name ===
            'Level One Feature'
        )
    ).toBe(true);

    expect(
      firstProgression.appliedItems
    ).toHaveLength(1);
  });

  it('is idempotent and adds only newly unlocked features', () => {
    const classItem =
      persisted.items.find(
        (item) => item.type === 'class'
      )!;

    let character =
      applyCompendiumItemToCharacter(
        createDefaultCharacter(
          'Level Two Hero'
        ),
        classItem
      ).character;

    character =
      applyAutomaticClassProgression(
        character,
        persisted.items
      ).character;

    const classEntityId =
      character.compendiumLinks?.find(
        (link) =>
          link.appliedAs === 'class'
      )?.appliedEntityId;

    character = {
      ...character,
      classes: character.classes.map(
        (entry) =>
          entry.id === classEntityId
            ? {
                ...entry,
                level: 2
              }
            : entry
      ),
      level: 2
    };

    const second =
      applyAutomaticClassProgression(
        character,
        persisted.items
      );

    expect(
      second.character.features.filter(
        (feature) =>
          feature.name ===
          'Level One Feature'
      )
    ).toHaveLength(1);

    expect(
      second.character.features.filter(
        (feature) =>
          feature.name ===
          'Level Two Feature'
      )
    ).toHaveLength(1);

    const repeated =
      applyAutomaticClassProgression(
        second.character,
        persisted.items
      );

    expect(repeated.appliedItems).toHaveLength(0);
  });

  it('keeps Ability Score Improvement as one pending choice', () => {
    const classItem =
      persisted.items.find(
        (item) => item.type === 'class'
      )!;

    let character =
      applyCompendiumItemToCharacter(
        createDefaultCharacter('ASI Hero'),
        classItem
      ).character;

    const classEntityId =
      character.compendiumLinks?.find(
        (link) =>
          link.appliedAs === 'class'
      )?.appliedEntityId;

    character = {
      ...character,
      classes: character.classes.map(
        (entry) =>
          entry.id === classEntityId
            ? {
                ...entry,
                level: 4
              }
            : entry
      ),
      level: 4
    };

    const result =
      applyAutomaticClassProgression(
        character,
        persisted.items
      );

    expect(
      result.choiceItems.map(
        (item) => item.name
      )
    ).toEqual([
      'Ability Score Improvement'
    ]);

    expect(
      result.character.features.some(
        (feature) =>
          feature.name ===
          'Ability Score Improvement'
      )
    ).toBe(false);
  });

  it('identifies internal progression features', () => {
    const feature =
      persisted.items.find(
        (item) =>
          item.importItemId ===
          'fighter-level-one'
      )!;

    expect(
      isProgressionOwnedFeatureItem(
        feature,
        persisted.items
      )
    ).toBe(true);
  });

  it('materializes review-pending automatic features and reconciles their resources without changing Compendium editorial state', () => {
    const reviewSource = {
      ...source,
      status: 'needsReview' as const,
      confidence: 'importedNeedsReview' as const
    };
    const bardPack = buildPersistedCompendiumImport({
      id: 'bard-review-pack',
      source,
      items: [
        {
          id: 'bard',
          kind: 'class',
          name: 'Bard',
          source,
          payload: {
            hitDie: 8,
            progression: [
              { level: 1, featureIds: ['bardic-inspiration'] },
              { level: 5, featureIds: ['font-of-inspiration'] }
            ]
          }
        },
        {
          id: 'bardic-inspiration',
          kind: 'feature',
          name: 'Bardic Inspiration',
          source: reviewSource,
          payload: {
            sourceType: 'classFeature',
            classId: 'bard',
            resource: {
              id: 'bardic-inspiration',
              name: 'Bardic Inspiration',
              minimum: 1,
              recharge: 'longRest',
              max: { kind: 'custom', formula: 'CHA' }
            }
          }
        },
        {
          id: 'font-of-inspiration',
          kind: 'feature',
          name: 'Font of Inspiration',
          source: reviewSource,
          payload: {
            sourceType: 'classFeature',
            classId: 'bard',
            resourceUpdates: [{ resourceId: 'bardic-inspiration', recharge: 'shortOrLongRest' }]
          }
        }
      ]
    });
    const classItem = bardPack.items.find((item) => item.type === 'class')!;
    const originalBardicItem = bardPack.items.find((item) => item.importItemId === 'bardic-inspiration')!;
    expect(originalBardicItem.status).toBe('needsReview');

    let character = applyCompendiumItemToCharacter(createDefaultCharacter('Review Bard'), classItem).character;
    const classEntityId = character.compendiumLinks?.find((link) => link.appliedAs === 'class')?.appliedEntityId;
    character = {
      ...character,
      level: 5,
      abilities: { ...character.abilities, CHA: 18 },
      classes: character.classes.map((entry) => entry.id === classEntityId ? { ...entry, level: 5 } : entry)
    };

    const result = applyAutomaticClassProgression(character, bardPack.items);
    expect(result.appliedItems.map((item) => item.name)).toEqual(['Bardic Inspiration', 'Font of Inspiration']);
    expect(result.character.features.map((feature) => feature.name)).toEqual(expect.arrayContaining(['Bardic Inspiration', 'Font of Inspiration']));
    expect(result.character.resources).toContainEqual(expect.objectContaining({
      id: 'bardic-inspiration',
      max: 4,
      current: 4,
      recharge: 'shortRest'
    }));
    expect(result.character.compendiumLinks?.find((link) => link.appliedEntityName === 'Bardic Inspiration')).toEqual(
      expect.objectContaining({ status: 'active', manualReviewRequired: true })
    );
    expect(originalBardicItem.status).toBe('needsReview');

    const repeated = applyAutomaticClassProgression(result.character, bardPack.items);
    expect(repeated.appliedItems).toHaveLength(0);
    expect(repeated.character.resources.filter((resource) => resource.id === 'bardic-inspiration')).toHaveLength(1);
  });

  it('keeps disabled automatic progression features blocked', () => {
    const classItem = persisted.items.find((item) => item.type === 'class')!;
    const disabledItems = persisted.items.map((item) =>
      item.importItemId === 'fighter-level-one'
        ? { ...item, status: 'disabled' as const }
        : item
    );
    const withClass = applyCompendiumItemToCharacter(createDefaultCharacter('Disabled Feature Hero'), classItem).character;
    const result = applyAutomaticClassProgression(withClass, disabledItems);

    expect(result.character.features.some((feature) => feature.name === 'Level One Feature')).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('PROGRESSION_FEATURE_DISABLED');
  });

  it('repairs subclass progression from an older subclass entity even when its compendium link is missing', () => {
    const glamourPack = buildPersistedCompendiumImport({
      id: 'glamour-repair-pack',
      source,
      items: [
        { id: 'bard-repair', kind: 'class', name: 'Bard', source, payload: { level: 1, progression: [] } },
        { id: 'glamour-repair', kind: 'subclass', name: 'College of Glamour', source, payload: { classId: 'bard-repair', progression: [
          { level: 3, featureIds: ['beguiling-repair'] },
          { level: 3, featureIds: ['mantle-inspiration-repair'] },
          { level: 6, featureIds: ['majesty-repair'] }
        ] } },
        { id: 'beguiling-repair', kind: 'feature', name: 'Beguiling Magic', summary: 'Controle feérico de uso limitado.', source, payload: { sourceType: 'subclassFeature', classId: 'bard-repair', subclassId: 'glamour-repair', resource: { id: 'glamour-beguiling-magic', recharge: 'longRest' } } },
        { id: 'mantle-inspiration-repair', kind: 'feature', name: 'Mantle of Inspiration', summary: 'Gasta Bardic Inspiration para proteger aliados.', source, payload: { sourceType: 'subclassFeature', classId: 'bard-repair', subclassId: 'glamour-repair', consumes: [{ resourceId: 'bardic-inspiration', amount: 1 }] } },
        { id: 'majesty-repair', kind: 'feature', name: 'Mantle of Majesty', summary: 'Presença majestosa de uso limitado.', source, payload: { sourceType: 'subclassFeature', classId: 'bard-repair', subclassId: 'glamour-repair', resource: { id: 'mantle-of-majesty', recharge: 'longRest' } } }
      ]
    });
    const classItem = glamourPack.items.find((item) => item.importItemId === 'bard-repair')!;
    let character = applyCompendiumItemToCharacter(createDefaultCharacter('Legacy Glamour'), classItem).character;
    const classEntity = character.classes[0]!;
    character = {
      ...character,
      level: 7,
      classes: [{ ...classEntity, level: 7 }],
      subclasses: [{ id: 'legacy-glamour-entity', classId: classEntity.id, name: 'College of Glamour', source }]
    };

    const result = applyAutomaticClassProgression(character, glamourPack.items);
    expect(result.character.features.map((feature) => feature.name)).toEqual(expect.arrayContaining([
      'Beguiling Magic', 'Mantle of Inspiration', 'Mantle of Majesty'
    ]));
    expect(result.character.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'glamour-beguiling-magic', max: 1 }),
      expect.objectContaining({ id: 'mantle-of-majesty', max: 1 })
    ]));
    expect(result.character.compendiumLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ appliedAs: 'subclass', appliedEntityId: 'legacy-glamour-entity', status: 'active' })
    ]));
  });



  it('repairs an active subclass link whose persisted carrier id became stale', () => {
    const glamourPack = buildPersistedCompendiumImport({
      id: 'glamour-active-stale-link-pack',
      source,
      items: [
        { id: 'bard-active-stale', kind: 'class', name: 'Bard', source, payload: { level: 1, progression: [] } },
        { id: 'glamour-active-stale', kind: 'subclass', name: 'College of Glamour', source, payload: { classId: 'bard-active-stale', progression: [
          { level: 3, featureIds: ['beguiling-active-stale', 'mantle-inspiration-active-stale'] },
          { level: 6, featureIds: ['majesty-active-stale'] }
        ] } },
        { id: 'beguiling-active-stale', kind: 'feature', name: 'Beguiling Magic', summary: 'Controle feérico de uso limitado.', source, payload: { sourceType: 'subclassFeature', classId: 'bard-active-stale', subclassId: 'glamour-active-stale', resource: { id: 'glamour-beguiling-magic', recharge: 'longRest' } } },
        { id: 'mantle-inspiration-active-stale', kind: 'feature', name: 'Mantle of Inspiration', summary: 'Gasta Bardic Inspiration para proteger aliados.', source, payload: { sourceType: 'subclassFeature', classId: 'bard-active-stale', subclassId: 'glamour-active-stale', consumes: [{ resourceId: 'bardic-inspiration', amount: 1 }] } },
        { id: 'majesty-active-stale', kind: 'feature', name: 'Mantle of Majesty', summary: 'Presença majestosa de uso limitado.', source, payload: { sourceType: 'subclassFeature', classId: 'bard-active-stale', subclassId: 'glamour-active-stale', resource: { id: 'mantle-of-majesty', recharge: 'longRest' } } }
      ]
    });

    const classItem = glamourPack.items.find((item) => item.importItemId === 'bard-active-stale')!;
    const subclassItem = glamourPack.items.find((item) => item.importItemId === 'glamour-active-stale')!;

    let character = applyCompendiumItemToCharacter(
      createEmptyCharacter('Active stale Glamour'),
      classItem
    ).character;
    const classEntity = character.classes[0]!;
    character = {
      ...character,
      level: 7,
      classes: [{ ...classEntity, level: 7 }]
    };
    character = applyCompendiumItemToCharacter(character, subclassItem).character;
    const subclassEntity = character.subclasses.find((entry) => entry.name === 'College of Glamour')!;

    character = {
      ...character,
      features: [],
      resources: [],
      compendiumLinks: (character.compendiumLinks ?? [])
        .filter((link) => link.appliedAs !== 'feature')
        .map((link) =>
          link.appliedAs === 'subclass' && link.appliedEntityId === subclassEntity.id
            ? {
                ...link,
                itemId: 'obsolete-persisted-subclass-carrier',
                importItemId: subclassItem.importItemId,
                status: 'active' as const
              }
            : link
        )
    };

    const repaired = applyAutomaticClassProgression(character, glamourPack.items).character;

    expect(repaired.subclasses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: subclassEntity.id,
        classId: classEntity.id,
        name: 'College of Glamour'
      })
    ]));
    expect(repaired.features.map((feature) => feature.name)).toEqual(expect.arrayContaining([
      'Beguiling Magic',
      'Mantle of Inspiration',
      'Mantle of Majesty'
    ]));
    expect(repaired.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'glamour-beguiling-magic', max: 1 }),
      expect.objectContaining({ id: 'mantle-of-majesty', max: 1 })
    ]));
  });


  it('recovers subclass progression from a unique removed subclass tombstone', () => {
    const glamourPack = buildPersistedCompendiumImport({
      id: 'glamour-tombstone-pack',
      source,
      items: [
        {
          id: 'bard-tombstone',
          kind: 'class',
          name: 'Bard',
          source,
          payload: { level: 1, progression: [] }
        },
        {
          id: 'glamour-tombstone',
          kind: 'subclass',
          name: 'College of Glamour',
          source,
          payload: {
            classId: 'bard-tombstone',
            progression: [
              {
                level: 3,
                featureIds: [
                  'beguiling-tombstone',
                  'mantle-inspiration-tombstone'
                ]
              },
              {
                level: 6,
                featureIds: ['majesty-tombstone']
              }
            ]
          }
        },
        {
          id: 'beguiling-tombstone',
          kind: 'feature',
          name: 'Beguiling Magic',
          summary: 'Controle feérico de uso limitado.',
          source,
          payload: {
            sourceType: 'subclassFeature',
            classId: 'bard-tombstone',
            subclassId: 'glamour-tombstone',
            resource: {
              id: 'glamour-beguiling-magic',
              recharge: 'longRest'
            }
          }
        },
        {
          id: 'mantle-inspiration-tombstone',
          kind: 'feature',
          name: 'Mantle of Inspiration',
          summary: 'Gasta Bardic Inspiration para proteger aliados.',
          source,
          payload: {
            sourceType: 'subclassFeature',
            classId: 'bard-tombstone',
            subclassId: 'glamour-tombstone',
            consumes: [
              {
                resourceId: 'bardic-inspiration',
                amount: 1
              }
            ]
          }
        },
        {
          id: 'majesty-tombstone',
          kind: 'feature',
          name: 'Mantle of Majesty',
          summary: 'Presença majestosa de uso limitado.',
          source,
          payload: {
            sourceType: 'subclassFeature',
            classId: 'bard-tombstone',
            subclassId: 'glamour-tombstone',
            resource: {
              id: 'mantle-of-majesty',
              recharge: 'longRest'
            }
          }
        }
      ]
    });

    const classItem = glamourPack.items.find(
      (item) => item.importItemId === 'bard-tombstone'
    )!;
    const subclassItem = glamourPack.items.find(
      (item) => item.importItemId ===
        'glamour-tombstone'
    )!;

    let character = applyCompendiumItemToCharacter(
      createEmptyCharacter('Tombstoned Glamour'),
      classItem
    ).character;
    const classEntity = character.classes[0]!;
    character = {
      ...character,
      level: 7,
      classes: [{ ...classEntity, level: 7 }]
    };
    character = applyCompendiumItemToCharacter(
      character,
      subclassItem
    ).character;
    character = applyAutomaticClassProgression(
      character,
      glamourPack.items
    ).character;

    const subclassEntity = character.subclasses.find(
      (entry) => entry.name === 'College of Glamour'
    )!;
    const glamourFeatureNames = new Set([
      'Beguiling Magic',
      'Mantle of Inspiration',
      'Mantle of Majesty'
    ]);

    character = {
      ...character,
      subclasses: character.subclasses.filter(
        (entry) => entry.id !== subclassEntity.id
      ),
      features: character.features.filter(
        (feature) =>
          !glamourFeatureNames.has(feature.name)
      ),
      resources: character.resources.filter(
        (resource) =>
          ![
            'glamour-beguiling-magic',
            'mantle-of-majesty'
          ].includes(resource.id)
      ),
      compendiumLinks: (
        character.compendiumLinks ?? []
      ).map((link) =>
        (
          link.appliedAs === 'subclass' &&
          link.appliedEntityId ===
            subclassEntity.id
        ) || (
          link.appliedAs === 'feature' &&
          glamourFeatureNames.has(
            link.appliedEntityName
          )
        )
          ? { ...link, status: 'removed' as const }
          : link
      )
    };

    const repaired = applyAutomaticClassProgression(
      character,
      glamourPack.items
    ).character;

    expect(repaired.subclasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: subclassEntity.id,
          classId: classEntity.id,
          name: 'College of Glamour'
        })
      ])
    );
    expect(repaired.features.map(
      (feature) => feature.name
    )).toEqual(
      expect.arrayContaining([
        'Beguiling Magic',
        'Mantle of Inspiration',
        'Mantle of Majesty'
      ])
    );
    expect(repaired.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'glamour-beguiling-magic',
          max: 1
        }),
        expect.objectContaining({
          id: 'mantle-of-majesty',
          max: 1
        })
      ])
    );
    expect(repaired.compendiumLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appliedAs: 'subclass',
          appliedEntityId: subclassEntity.id,
          status: 'active'
        })
      ])
    );
  });

});
