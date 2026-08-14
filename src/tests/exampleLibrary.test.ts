import { backupToJson, parseCharacterDataBackup } from '../backup/characterBackup';
import { validateCompendiumJson } from '../compendium/importer';
import { createExampleLibraryBundle, exampleCompendiumImportJson, summarizeExampleLibrary } from '../fixtures/exampleLibrary';
import { compareRotationsForScenario } from '../rules-engine/turns/compareRotations';

describe('example library fixtures', () => {
  it('builds a stable demonstration bundle', () => {
    const bundle = createExampleLibraryBundle();
    const summary = summarizeExampleLibrary(bundle);

    expect(summary.characterCount).toBe(2);
    expect(summary.scenarioCount).toBe(4);
    expect(summary.compendiumItemCount).toBe(4);
    expect(summary.highlights.length).toBeGreaterThan(3);
  });

  it('ships a compendium fixture accepted by the real importer', () => {
    const preview = validateCompendiumJson(exampleCompendiumImportJson());
    expect(preview.ok).toBe(true);
    expect(preview.data?.items.map((item) => item.kind)).toEqual(['weapon', 'spell', 'spell', 'feature']);
  });

  it('ships character fixtures that can be analyzed by the engine', () => {
    const bundle = createExampleLibraryBundle();
    const character = bundle.characters[0];
    const scenario = bundle.scenarios.find((item) => item.characterId === character.id)!;
    const comparison = compareRotationsForScenario(character.rotations, character, scenario);

    expect(comparison.rows.length).toBe(character.rotations.length);
    expect(comparison.bestByAverageRotationId).toBeTruthy();
    expect(comparison.rows.some((row) => row.resourcesConsumed.length > 0)).toBe(true);
  });

  it('ships a character backup fixture accepted by the restore parser', () => {
    const bundle = createExampleLibraryBundle();
    const json = backupToJson(bundle.characterBackup);
    const parsed = parseCharacterDataBackup(json);

    expect(parsed.ok).toBe(true);
    expect(parsed.backup?.summary.characterCount).toBe(2);
    expect(parsed.backup?.summary.scenarioCount).toBe(4);
  });
});
