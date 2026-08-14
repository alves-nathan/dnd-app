import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('rule-driven choice UI contract', () => {
  it('uses selectors instead of free text for feat proficiencies', () => {
    const creation = read('app/characters/new.tsx');
    const featEditor = read('app/characters/[id]/feats.tsx');

    for (const source of [creation, featEditor]) {
      expect(source).toContain('<ChoiceChipSelector');
      expect(source).not.toContain('<Field label={`Perícias');
      expect(source).not.toContain('<Field label={`Ferramentas');
      expect(source).not.toContain('<Field label={`Expertise');
    }
  });

  it('uses controlled selectors for class tools, background tools and origin languages', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('testIDPrefix="class-tool"');
    expect(creation).toContain('testIDPrefix="background-tool"');
    expect(creation).toContain('testIDPrefix="origin-language"');
    expect(creation).not.toContain('<Field label="Idiomas adicionais"');
  });
});
