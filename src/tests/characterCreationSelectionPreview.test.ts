import fs from 'node:fs';
import path from 'node:path';
import type { CompendiumImportItem } from '../compendium/importDomain';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  getClassFeaturePreview,
  getClassSelectionDescription,
  getSpeciesFeaturePreview,
  getSpeciesSelectionDescription
} from '../characters/selectionPreview';

interface RawCompendiumPack {
  id: string;
  items: CompendiumImportItem[];
}

const root = path.resolve(__dirname, '../..');
const rawPack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json') as RawCompendiumPack;
const items: StoredCompendiumItem[] = rawPack.items.map((entry) => ({
  id: `${rawPack.id}:${entry.id}`,
  importItemId: entry.id,
  packId: rawPack.id,
  sourceId: entry.source.id,
  type: entry.kind,
  name: entry.name,
  summary: entry.summary,
  version: entry.source.version,
  rawJson: entry,
  normalizedJson: entry.payload,
  tags: [entry.kind, entry.name.toLowerCase()],
  status: 'validated',
  reviewDecision: 'approved',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z'
}));

const item = (id: string): StoredCompendiumItem => {
  const found = items.find((candidate) => candidate.importItemId === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
};

describe('character creation class/species selection preview', () => {
  it('uses the class level and falls back to total level when it is not defined', () => {
    const warlock = item('phb-2024-class-warlock');
    const level2 = getClassFeaturePreview(warlock, items, 2, 5).map((entry) => entry.name);
    expect(level2).toEqual(expect.arrayContaining(['Eldritch Invocations', 'Pact Magic', 'Magical Cunning']));
    expect(level2).not.toContain('Warlock Subclass');

    const fallbackLevel3 = getClassFeaturePreview(warlock, items, undefined, 3).map((entry) => entry.name);
    expect(fallbackLevel3).toContain('Warlock Subclass');
  });

  it('limits species traits by the character total level', () => {
    const aasimar = item('phb-2024-species-aasimar');
    const level2 = getSpeciesFeaturePreview(aasimar, items, 2).map((entry) => entry.name);
    expect(level2).toEqual(expect.arrayContaining(['Celestial Resistance', 'Healing Hands']));
    expect(level2).not.toContain('Celestial Revelation');

    const level3 = getSpeciesFeaturePreview(aasimar, items, 3).map((entry) => entry.name);
    expect(level3).toContain('Celestial Revelation');
  });

  it('provides concise mechanical descriptions for selected classes and species', () => {
    const classDescription = getClassSelectionDescription(item('phb-2024-class-warlock'));
    expect(classDescription).toContain('Dado de Vida d8');
    expect(classDescription).toContain('Carisma');
    expect(classDescription).toContain('Pact Magic');

    const speciesDescription = getSpeciesSelectionDescription(item('phb-2024-species-aasimar'));
    expect(speciesDescription).toContain('Humanoide');
    expect(speciesDescription).toContain('deslocamento 30 ft');
  });

  it('wires class and species previews into character creation', () => {
    const creation = fs.readFileSync(path.resolve(root, 'app/characters/new.tsx'), 'utf8');
    expect(creation).toContain('Features até o nível {previewLevel}');
    expect(creation).toContain('Traits e features até o nível {desiredLevel}');
    expect(creation).toContain('getClassFeaturePreview');
    expect(creation).toContain('getSpeciesFeaturePreview');
  });
});
