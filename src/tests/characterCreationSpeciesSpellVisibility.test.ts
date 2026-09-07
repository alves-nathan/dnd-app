import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('character creation species spell visibility', () => {
  it('shows species-granted spells even when the selected class has no spellcasting profile', () => {
    const creation = read('app/characters/new.tsx');

    expect(creation).toContain('getSpeciesGrantedSpellReferences');
    expect(creation).toContain('const speciesGrantedSpellItems = useMemo(');
    expect(creation).toContain('title="Sem conjuração de classe"');
    expect(creation).toContain('Magias concedidas pela espécie');
    expect(creation).toContain('a espécie concede as magias automáticas exibidas abaixo');
  });

  it('does not duplicate species grants inside a spellcasting class automatic-spell card', () => {
    const creation = read('app/characters/new.tsx');

    expect(creation).toContain("entry.source.kind !== 'species'");
    expect(creation).toContain("entry.kind === 'alwaysPrepared' || entry.kind === 'granted'");
  });
});
