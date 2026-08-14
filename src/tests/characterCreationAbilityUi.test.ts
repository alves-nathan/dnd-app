import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('character creation ability and background proficiency UI', () => {
  it('shows rolled results before assignment and makes generated values exclusive and reversible', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('title="Resultados da rolagem"');
    expect(creation).toContain('Rolagem {index + 1}:');
    expect(creation).toContain('setAbilityValueAssignments({})');
    expect(creation).toContain('isGeneratedValueAssignedElsewhere(abilityValueAssignments, ability, index)');
    expect(creation).toContain('selected={selected}');
    expect(creation).toContain('disabled={unavailable}');
    expect(creation).toContain('Tocar novamente no valor selecionado desfaz a atribuição');
  });

  it('renders background skill proficiencies as already selected and excludes them from class choices', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('title={`Perícias de ${selectedBackground.name}`}');
    expect(creation).toContain('Concedidas automaticamente pelo background e já consideradas na ficha.');
    expect(creation).toContain('backgroundDefaults.proficiencies.skills.includes(skill)');
    expect(creation).toContain('speciesChoiceProficiencyGrants.skills.includes(skill)');
    expect(creation).toContain('const grantedByOrigin = grantedByBackground || grantedBySpecies;');
    expect(creation).toContain('disabled={grantedByOrigin');
  });
});
