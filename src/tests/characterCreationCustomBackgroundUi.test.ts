import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('custom background character creation UI', () => {
  it('offers a custom background with controlled choices for all mechanical parts', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('testID="background-custom"');
    expect(creation).toContain('testIDPrefix="custom-background-ability"');
    expect(creation).toContain('testIDPrefix="custom-background-skill"');
    expect(creation).toContain('testIDPrefix="custom-background-tool"');
    expect(creation).toContain('items={originFeatCandidates}');
    expect(creation).toContain('getCustomBackgroundEquipmentCandidates(items, enabledSourceIds)');
    expect(creation).toContain('CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER');
    expect(creation).toContain('Usar somente 50 GP');
  });

  it('validates catalog equipment before adding it and persists custom background choices', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('const addCustomBackgroundEquipment = async');
    expect(creation).toContain('await validateSelectedCompendiumItems([candidate.item])');
    expect(creation).toContain('customBackground: isCustomBackground ? customBackground : undefined');
  });
});
