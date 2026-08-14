import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('subclass choice UI contracts', () => {
  it('requires internal subclass configuration during character creation', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('SubclassChoiceEditor');
    expect(creation).toContain('subclassChoiceRequirements');
    expect(creation).toContain('subclassChoiceIssues.length === 0');
    expect(creation).toContain('subclassChoices,');
    expect(creation).toContain('subclassSpellReferencesByClassItemId');
    expect(creation).toContain('additionalSpellReferencesByClassItemId');
    expect(creation).toContain('allowResolvedOverride');
  });

  it('surfaces internal subclass configuration on the character sheet and classes screen', () => {
    const sheet = read('app/characters/[id]/index.tsx');
    const classes = read('app/characters/[id]/classes.tsx');
    expect(sheet).toContain('Configuração de subclasse');
    expect(sheet).toContain('getCharacterSubclassChoiceSummaries');
    expect(classes).toContain('Configuração de subclasses');
    expect(classes).toContain('SubclassChoiceEditor');
    const spells = read('app/characters/[id]/spells.tsx');
    expect(spells).toContain('getCharacterSubclassSpellListReferences');
  });

  it('shows Pact Weapon only when Pact of the Blade is actually selected', () => {
    const sheet = read('app/characters/[id]/index.tsx');
    expect(sheet).toContain('hasPactOfTheBlade');
    expect(sheet).toContain('pactOfTheBlade ?');
    expect(sheet).toContain('label="Pact Weapon"');
  });
});
