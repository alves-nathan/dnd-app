import { backgroundSuggestions } from '../characters/creationData';
import { getClassSpellcastingProfile, isSpellItemEligibleForProfile } from '../characters/spellcastingRules';
import { applyAutomaticClassProgression, getSubclassUnlockLevel } from '../compendium/classProgression';
import { prepareCoreCharacterContentSnapshot } from '../compendium/coreCharacterContentPreparation';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createDefaultCharacter } from '../data/mockData';
import { phbCriticalRelationshipsFixture } from '../fixtures/phbCriticalRelationships';

describe('PHB critical relationships fixture', () => {
  const persisted = buildPersistedCompendiumImport(phbCriticalRelationshipsFixture);
  const byImportId = (id: string) => persisted.items.find((item) => item.importItemId === id)!;

  it('keeps exactly one selectable Ability Score Improvement feat', () => {
    const selectable = persisted.items.filter((item) => item.type === 'feat' && item.name === 'Ability Score Improvement');
    const internal = persisted.items.filter((item) => item.type === 'feature' && item.name === 'Ability Score Improvement');
    expect(selectable).toHaveLength(1);
    expect(internal).toHaveLength(1);
  });

  it('prepares classes, subclasses and their referenced progression features', () => {
    const prepared = prepareCoreCharacterContentSnapshot({
      sources: [persisted.source],
      packs: [persisted.pack],
      items: persisted.items.map((item) => ({ ...item, status: 'needsReview' as const, reviewDecision: 'pending' as const })),
      enabledSourceIds: []
    });
    expect(prepared.snapshot.items.find((item) => item.importItemId === 'champion')?.status).toBe('validated');
    expect(prepared.snapshot.items.find((item) => item.importItemId === 'champion-improved-critical')?.status).toBe('validated');
    expect(prepared.snapshot.enabledSourceIds).toContain(persisted.source.id);
  });

  it('links subclass unlock and applies deterministic class/subclass features', () => {
    const fighter = byImportId('fighter');
    const champion = byImportId('champion');
    let character = applyCompendiumItemToCharacter(createDefaultCharacter('Fixture Hero'), fighter).character;
    const classLink = character.compendiumLinks?.find((link) => link.appliedAs === 'class')!;
    character = {
      ...character,
      classes: character.classes.map((entry) => entry.id === classLink.appliedEntityId ? { ...entry, level: 3 } : entry),
      level: 3
    };
    character = applyCompendiumItemToCharacter(character, champion).character;
    const progression = applyAutomaticClassProgression(character, persisted.items);
    expect(getSubclassUnlockLevel(champion)).toBe(3);
    expect(progression.character.features.some((feature) => feature.name === 'Second Wind')).toBe(true);
    expect(progression.character.features.some((feature) => feature.name === 'Improved Critical')).toBe(true);
    expect(progression.choiceItems.map((item) => item.name)).toEqual(expect.arrayContaining(['Weapon Mastery', 'Fighter Subclass']));
  });

  it('preserves background suggestions and Wizard spellbook eligibility', () => {
    const suggestions = backgroundSuggestions(byImportId('acolyte'));
    expect(suggestions.abilityOptions).toEqual(['INT', 'WIS', 'CHA']);
    expect(suggestions.featIds).toContain('magic-initiate-cleric');
    expect(suggestions.proficiencies.skills).toEqual(['Insight', 'Religion']);

    const wizard = byImportId('wizard');
    const profile = getClassSpellcastingProfile(wizard, 1)!;
    expect(profile.preparationMode).toBe('spellbook');
    expect(profile.spellbookMinimumSpellCount).toBe(6);
    expect(isSpellItemEligibleForProfile(byImportId('fire-bolt'), profile)).toBe(true);
    expect(isSpellItemEligibleForProfile(byImportId('magic-missile'), profile)).toBe(true);
  });
});
