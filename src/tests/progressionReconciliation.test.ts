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
});
