import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  applyAutomaticClassProgression,
  isProgressionOwnedFeatureItem
} from '../compendium/classProgression';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createDefaultCharacter } from '../data/mockData';

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
});
