import fs from 'fs';
import path from 'path';

describe('character creation draft reset wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/characters/new.tsx'), 'utf8');

  it('uses an in-screen confirmation flow instead of relying on Alert callbacks', () => {
    expect(source).toContain('testID="character-creation-discard-draft"');
    expect(source).toContain('testID="character-creation-discard-confirm"');
    expect(source).toContain('setDiscardDraftConfirmationVisible(true)');
  });

  it('resets every draft field that previously survived a discard', () => {
    expect(source).toContain('setSelectedSpeciesFeatId(undefined)');
    expect(source).toContain('setBackgroundChoices([])');
    expect(source).toContain('setAbilityValueAssignments({})');
    expect(source).toContain('setFocusedSpellItemId(undefined)');
    expect(source).toContain('setBaseAbilities(emptyAbilityScores())');
  });

  it('pauses draft autosave while storage and state are being reset', () => {
    const resetStart = source.indexOf('const discardCreationDraft = async () => {');
    const resetEnd = source.indexOf('const footer = (', resetStart);
    const resetBody = source.slice(resetStart, resetEnd);
    expect(resetBody).toContain('discardingDraftRef.current = true');
    expect(resetBody).toContain('setDraftHydrated(false)');
    expect(resetBody).toContain('await characterCreationDraftRepository.clear()');
    expect(resetBody).toContain('discardingDraftRef.current = false');
    expect(resetBody).toContain('setDraftHydrated(true)');
  });
});
