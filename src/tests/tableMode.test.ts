import { createDefaultCharacter } from '../data/mockData';
import { buildTableModeSummary, createTableModeScenario, findTableModeCard } from '../table/tableMode';
import { createExampleLibraryBundle } from '../fixtures/exampleLibrary';

describe('table mode summary', () => {
  it('creates ready cards for default favorite rotations', () => {
    const character = createDefaultCharacter('Mesa');
    const summary = buildTableModeSummary(character, createTableModeScenario(character.id));

    expect(summary.rotationCards.length).toBeGreaterThan(0);
    expect(summary.favoriteCards.length).toBeGreaterThan(0);
    expect(summary.rotationCards[0].status).toBe('ready');
    expect(summary.rotationCards[0].canExecute).toBe(true);
  });

  it('summarizes resources, spell slots and active effects from example fixtures', () => {
    const bundle = createExampleLibraryBundle();
    const character = bundle.characters[0];
    const scenario = bundle.scenarios.find((item) => item.characterId === character.id) ?? createTableModeScenario(character.id);
    const summary = buildTableModeSummary(character, scenario);

    expect(summary.resources.length).toBeGreaterThan(0);
    expect(summary.activeEffects.length).toBeGreaterThan(0);
    expect(summary.suggestedNextSteps.length).toBeGreaterThan(0);
  });

  it('marks rotations as blocked when required resources are empty', () => {
    const bundle = createExampleLibraryBundle();
    const character = bundle.characters[0];
    const spent = {
      ...character,
      resources: character.resources.map((resource) => ({ ...resource, current: 0 }))
    };
    const summary = buildTableModeSummary(spent, createTableModeScenario(spent.id));
    const burst = summary.rotationCards.find((card) => card.resourceText.includes('Foco'));

    expect(burst?.status).toBe('blocked');
    expect(burst?.canExecute).toBe(false);
  });

  it('finds cards by rotation id', () => {
    const character = createDefaultCharacter('Busca');
    const summary = buildTableModeSummary(character);
    const card = findTableModeCard(summary, character.rotations[0].id);

    expect(card?.name).toBe(character.rotations[0].name);
  });
});
