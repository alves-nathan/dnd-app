import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { reconcileCharacterSnapshot } from '../characters/characterReconciliation';
import { applyCharacterHitPointConfiguration } from '../characters/hitPointRules';
import { createEmptyCharacter } from '../data/mockData';

const source = {
  id: 'character-reconciliation-source',
  book: 'Character Reconciliation Test',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const pack = buildPersistedCompendiumImport({
  id: 'character-reconciliation-pack',
  source,
  items: [
    {
      id: 'fighter',
      kind: 'class',
      name: 'Fighter',
      source,
      payload: {
        hitDie: 10,
        progression: [
          { level: 1, featureIds: ['second-wind'] },
          { level: 5, featureIds: ['extra-attack'] }
        ]
      }
    },
    {
      id: 'champion',
      kind: 'subclass',
      name: 'Champion',
      source,
      payload: {
        classId: 'fighter',
        progression: [{ level: 3, featureIds: ['improved-critical'] }]
      }
    },
    {
      id: 'second-wind',
      kind: 'feature',
      name: 'Second Wind',
      source,
      payload: {
        sourceType: 'classFeature',
        classId: 'fighter',
        levelGained: 1,
        resource: { id: 'second-wind-resource', max: 1, recharge: 'shortRest' }
      }
    },
    {
      id: 'extra-attack',
      kind: 'feature',
      name: 'Extra Attack',
      source,
      payload: { sourceType: 'classFeature', classId: 'fighter', levelGained: 5 }
    },
    {
      id: 'improved-critical',
      kind: 'feature',
      name: 'Improved Critical',
      source,
      payload: { sourceType: 'subclassFeature', subclassId: 'champion', levelGained: 3 }
    }
  ]
});

const item = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

const fighterAtLevelFive = () => {
  const classResult = applyCompendiumItemToCharacter(createEmptyCharacter('Fighter 5'), item('fighter'));
  const classEntityId = classResult.link!.appliedEntityId;
  let character = {
    ...classResult.character,
    level: 5,
    classes: classResult.character.classes.map((entry) =>
      entry.id === classEntityId ? { ...entry, level: 5 } : entry
    )
  };
  character = applyCompendiumItemToCharacter(character, item('champion')).character;
  return { character, classEntityId };
};

describe('character reconciliation service', () => {
  it('orchestrates progression cleanup before build reconciliation', () => {
    const built = fighterAtLevelFive();
    const levelFive = reconcileCharacterSnapshot(built.character, pack.items);

    expect(levelFive.character.features.map((feature) => feature.name)).toEqual(expect.arrayContaining([
      'Second Wind',
      'Extra Attack',
      'Improved Critical'
    ]));

    const lowered = {
      ...levelFive.character,
      level: 2,
      classes: levelFive.character.classes.map((entry) =>
        entry.id === built.classEntityId ? { ...entry, level: 2 } : entry
      )
    };
    const result = reconcileCharacterSnapshot(lowered, pack.items);

    expect(result.character.subclasses).toHaveLength(0);
    expect(result.character.features.map((feature) => feature.name)).toContain('Second Wind');
    expect(result.character.features.map((feature) => feature.name)).not.toContain('Extra Attack');
    expect(result.character.features.map((feature) => feature.name)).not.toContain('Improved Critical');
    expect(result.summary.removedSubclassCount).toBe(1);
    expect(result.summary.removedFeatureCount).toBeGreaterThanOrEqual(1);
    expect(result.stages.map((stage) => stage.stage)).toEqual(['progression', 'build']);
  });

  it('is idempotent and preserves spent resources and current damage', () => {
    const built = fighterAtLevelFive();
    const materialized = reconcileCharacterSnapshot(built.character, pack.items).character;
    const configured = applyCharacterHitPointConfiguration(materialized, { method: 'fixed' }, pack.items);
    const resource = configured.resources.find((entry) => entry.name === 'Second Wind')!;
    const maxHitPoints = configured.hitPoints!.max;
    const damagedAndSpent = {
      ...configured,
      hitPoints: {
        ...configured.hitPoints!,
        current: Math.max(0, maxHitPoints - 7)
      },
      resources: configured.resources.map((entry) =>
        entry.id === resource.id ? { ...entry, current: 0 } : entry
      )
    };
    const inputSnapshot = JSON.parse(JSON.stringify(damagedAndSpent));

    const first = reconcileCharacterSnapshot(damagedAndSpent, pack.items);
    const second = reconcileCharacterSnapshot(first.character, pack.items);

    expect(damagedAndSpent).toEqual(inputSnapshot);
    expect(first.character.resources.find((entry) => entry.id === resource.id)?.current).toBe(0);
    expect(first.character.hitPoints?.current).toBe(Math.max(0, maxHitPoints - 7));
    expect(second.character).toEqual(first.character);
    expect(second.changed).toBe(false);
  });

  it('reports a stable snapshot as unchanged', () => {
    const built = fighterAtLevelFive();
    const first = reconcileCharacterSnapshot(built.character, pack.items);
    const second = reconcileCharacterSnapshot(first.character, pack.items);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.summary.removedSubclassCount).toBe(0);
    expect(second.summary.removedFeatureCount).toBe(0);
    expect(second.summary.removedFeatCount).toBe(0);
    expect(second.summary.removedSpellCount).toBe(0);
  });
});
