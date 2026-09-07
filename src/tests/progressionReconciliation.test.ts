import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { applyAutomaticClassProgression } from '../compendium/classProgression';
import { reconcileCharacterProgression } from '../characters/progressionReconciliation';
import { createDefaultCharacter } from '../data/mockData';

const source = { id: 'reconcile-source', book: 'Rules', version: '2024', status: 'active' as const, confidence: 'exact' as const };
const persisted = buildPersistedCompendiumImport({
  id: 'reconcile-pack', source,
  items: [
    { id: 'fighter', kind: 'class', name: 'Fighter', source, payload: { level: 1, progression: [{ level: 1, featureIds: ['second-wind'] }, { level: 5, featureIds: ['extra-attack'] }] } },
    { id: 'champion', kind: 'subclass', name: 'Champion', source, payload: { classId: 'fighter', progression: [{ level: 3, featureIds: ['improved-critical'] }] } },
    { id: 'second-wind', kind: 'feature', name: 'Second Wind', source, payload: { sourceType: 'classFeature', classId: 'fighter', levelGained: 1 } },
    { id: 'extra-attack', kind: 'feature', name: 'Extra Attack', source, payload: { sourceType: 'classFeature', classId: 'fighter', levelGained: 5, resource: { id: 'extra-resource', max: 1 } } },
    { id: 'improved-critical', kind: 'feature', name: 'Improved Critical', source, payload: { sourceType: 'classFeature', subclassId: 'champion', levelGained: 3 } }
  ]
});
const item = (id: string) => persisted.items.find((entry) => entry.importItemId === id)!;

describe('progression reconciliation', () => {
  it('removes subclass and higher-level features after a level reduction', () => {
    let character = createDefaultCharacter('Reconcile');
    const classResult = applyCompendiumItemToCharacter(character, item('fighter'));
    character = classResult.character;
    const classId = classResult.link!.appliedEntityId;
    character = { ...character, classes: character.classes.map((entry) => entry.id === classId ? { ...entry, level: 5 } : entry), level: 5 };
    character = applyCompendiumItemToCharacter(character, item('champion')).character;
    character = applyAutomaticClassProgression(character, persisted.items).character;
    expect(character.features.some((feature) => feature.name === 'Extra Attack')).toBe(true);
    expect(character.subclasses).toHaveLength(1);

    character = { ...character, classes: character.classes.map((entry) => entry.id === classId ? { ...entry, level: 2 } : entry), level: 2 };
    const result = reconcileCharacterProgression(character, persisted.items);
    expect(result.character.subclasses).toHaveLength(0);
    expect(result.character.features.some((feature) => feature.name === 'Extra Attack')).toBe(false);
    expect(result.character.features.some((feature) => feature.name === 'Second Wind')).toBe(true);
    expect(result.removedSubclassCount).toBe(1);
    expect(result.removedFeatureCount).toBeGreaterThanOrEqual(1);
  });

  it('preserves class progression when a stale carrier id was reused by another class', () => {
    const collisionPack = buildPersistedCompendiumImport({
      id: 'class-link-collision-pack',
      source,
      items: [
        { id: 'fighter-collision', kind: 'class', name: 'Fighter', source, payload: { progression: [{ level: 1, featureIds: ['second-wind-collision'] }] } },
        { id: 'wizard-collision', kind: 'class', name: 'Wizard', source, payload: { progression: [] } },
        { id: 'second-wind-collision', kind: 'feature', name: 'Second Wind', source, payload: { sourceType: 'classFeature', classId: 'fighter-collision' } }
      ]
    });
    const collisionItem = (id: string) => collisionPack.items.find((entry) => entry.importItemId === id)!;
    let character = applyCompendiumItemToCharacter(createDefaultCharacter('Stale class carrier'), collisionItem('fighter-collision')).character;
    character = applyAutomaticClassProgression(character, collisionPack.items).character;
    const originalFeature = character.features.find((feature) => feature.name === 'Second Wind')!;

    character = {
      ...character,
      compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'class'
          ? {
              ...link,
              itemId: collisionItem('wizard-collision').id,
              importItemId: collisionItem('fighter-collision').importItemId
            }
          : link
      )
    };

    const result = reconcileCharacterProgression(character, collisionPack.items);

    expect(result.removedFeatureCount).toBe(0);
    expect(result.character.features).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: originalFeature.id, name: 'Second Wind' })
    ]));
  });

  it('preserves a valid subclass when its stale carrier id was reused by another subclass', () => {
    const collisionPack = buildPersistedCompendiumImport({
      id: 'subclass-link-collision-pack',
      source,
      items: [
        { id: 'fighter-subclass-collision', kind: 'class', name: 'Fighter', source, payload: { progression: [] } },
        { id: 'wizard-subclass-collision', kind: 'class', name: 'Wizard', source, payload: { progression: [] } },
        { id: 'champion-collision', kind: 'subclass', name: 'Champion', source, payload: { classId: 'fighter-subclass-collision', progression: [{ level: 3, featureIds: ['improved-critical-collision'] }] } },
        { id: 'bladesinger-collision', kind: 'subclass', name: 'Bladesinger', source, payload: { classId: 'wizard-subclass-collision', progression: [] } },
        { id: 'improved-critical-collision', kind: 'feature', name: 'Improved Critical', source, payload: { sourceType: 'subclassFeature', subclassId: 'champion-collision' } }
      ]
    });
    const collisionItem = (id: string) => collisionPack.items.find((entry) => entry.importItemId === id)!;
    const classResult = applyCompendiumItemToCharacter(
      createDefaultCharacter('Stale subclass carrier'),
      collisionItem('fighter-subclass-collision')
    );
    let character = classResult.character;
    const classEntityId = classResult.link!.appliedEntityId;
    character = {
      ...character,
      level: 5,
      classes: character.classes.map((entry) => entry.id === classEntityId ? { ...entry, level: 5 } : entry)
    };
    character = applyCompendiumItemToCharacter(character, collisionItem('champion-collision')).character;
    character = applyAutomaticClassProgression(character, collisionPack.items).character;
    const subclassEntity = character.subclasses.find((entry) => entry.name === 'Champion')!;

    character = {
      ...character,
      compendiumLinks: (character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'subclass' && link.appliedEntityId === subclassEntity.id
          ? {
              ...link,
              itemId: collisionItem('bladesinger-collision').id,
              importItemId: collisionItem('champion-collision').importItemId
            }
          : link
      )
    };

    const result = reconcileCharacterProgression(character, collisionPack.items);

    expect(result.removedSubclassCount).toBe(0);
    expect(result.character.subclasses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: subclassEntity.id, name: 'Champion', classId: classEntityId })
    ]));
    expect(result.character.features.map((feature) => feature.name)).toContain('Improved Critical');
  });

});
