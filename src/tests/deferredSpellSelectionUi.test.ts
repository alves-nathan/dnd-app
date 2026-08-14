import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('deferred spell selection UI', () => {
  it('shows spell details and does not require exact counts to finish creation', () => {
    const creation = read('app/characters/new.tsx');
    expect(creation).toContain('SpellChoiceDetails');
    expect(creation).toContain('setFocusedSpellItemId(spellItem.id)');
    expect(creation).toContain('<SpellChoiceDetails');
    expect(creation).toContain('requireExact: false');
    expect(creation).toContain('reconcileSpellAssignmentReferences');
    expect(creation).toContain('effectiveSpellAssignments');
    expect(creation).toContain('descriptionForSelectedItem={getSpellChoiceInlineDescription}');
    expect(creation).toContain('Magias para escolher depois');
  });

  it('keeps a pending spell choice until reconciliation confirms completion', () => {
    const spellScreen = read('app/characters/[id]/spells.tsx');
    expect(spellScreen).toContain('setFocusedCompendiumSpellId(item.id)');
    expect(spellScreen).toContain('<SpellChoiceDetails');
    expect(spellScreen).toContain('descriptionForSelectedItem={getSpellChoiceInlineDescription}');
    expect(spellScreen).not.toContain("if (pendingId) next = { ...next, pendingChoices:");
  });
});
