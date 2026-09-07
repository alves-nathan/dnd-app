import { applyCharacterChoice, characterChoiceMatchesLink, previewCharacterChoiceApplication } from '../catalog/characterChoiceApplication';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import { createEmptyCharacter } from '../data/mockData';

const choice = (manualReviewRequired = false): CharacterChoiceItem => ({
  choiceId: 'catalog:phb-2024-class-wizard',
  entityId: 'phb-2024-class-wizard',
  kind: 'class',
  name: 'Wizard',
  sourceBookId: 'phb-2024',
  sourceLabel: 'PHB 2024',
  origin: 'catalog',
  catalogSnapshotId: 'catalog-fixture',
  catalogEntityId: 'phb-2024-class-wizard',
  ownerIds: [],
  searchableText: 'wizard',
  available: true,
  blockedReasons: [],
  manualReviewRequired,
  payload: { level: 1, hitDie: 6 },
  provenance: {
    origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: 'catalog-fixture',
    catalogVersion: '4.8.0', catalogEntityId: 'phb-2024-class-wizard', legacyItemIds: ['phb-2024-class-wizard'], overrideAuthorized: false
  }
});

describe('APP-03 character choice application', () => {
  it('applies official content with provenance and snapshot', () => {
    const initial = createEmptyCharacter('Wizard');
    const result = applyCharacterChoice({ character: initial, choice: choice() });

    expect(result.ok).toBe(true);
    expect(result.character.catalogSnapshotId).toBe('catalog-fixture');
    expect(result.character.classes[0]?.name).toBe('Wizard');
    expect(result.character.compendiumLinks?.[0]).toMatchObject({
      itemId: 'catalog:phb-2024-class-wizard',
      choiceId: 'catalog:phb-2024-class-wizard',
      origin: 'catalog',
      catalogEntityId: 'phb-2024-class-wizard',
      catalogSnapshotId: 'catalog-fixture',
      status: 'active'
    });
  });

  it('is idempotent and preserves editorial warnings without blocking first application', () => {
    const first = applyCharacterChoice({ character: createEmptyCharacter('Wizard'), choice: choice(true) });
    expect(first.ok).toBe(true);
    expect(first.issues.some((issue) => issue.code === 'CHARACTER_CHOICE_EDITORIAL_REVIEW')).toBe(true);
    expect(first.character.compendiumLinks?.[0]?.manualReviewRequired).toBe(true);
    expect(first.character.compendiumLinks?.[0]?.status).toBe('active');

    const preview = previewCharacterChoiceApplication({ character: first.character, choice: choice(true) });
    expect(preview.ok).toBe(false);
    expect(preview.alreadyApplied).toBe(true);
  });

  it('does not treat unrelated local links with no catalogEntityId as the same choice', () => {
    const localChoice: CharacterChoiceItem = {
      ...choice(true),
      choiceId: 'compendium:tcoe-2020-feat-fighting-initiate',
      entityId: 'tcoe-2020-feat-fighting-initiate',
      kind: 'feat',
      name: 'Fighting Initiate',
      origin: 'compendium',
      catalogSnapshotId: undefined,
      catalogEntityId: undefined,
      compendiumItemId: 'tcoe-2020-feat-fighting-initiate',
      provenance: {
        origin: 'compendium',
        sourceId: 'tcoe-2020',
        packId: 'tcoe-2020-2024-compatible-import-pack-v2',
        legacyItemIds: ['tcoe-2020-feat-fighting-initiate'],
        overrideAuthorized: false
      }
    };
    const character = createEmptyCharacter('Warlock');
    character.compendiumLinks = [{
      id: 'unrelated-link',
      characterId: character.id,
      itemId: 'compendium:spelljammer-2022-species-giff',
      importItemId: 'spelljammer-2022-species-giff',
      packId: 'spelljammer',
      sourceId: 'spelljammer',
      itemType: 'species',
      appliedAs: 'species',
      appliedEntityId: 'species-giff',
      appliedEntityName: 'Giff',
      status: 'active',
      addedAt: new Date(0).toISOString(),
      origin: 'compendium'
    }];

    const preview = previewCharacterChoiceApplication({ character, choice: localChoice });
    expect(preview.alreadyApplied).toBe(false);
    expect(preview.ok).toBe(true);
    expect(characterChoiceMatchesLink(character.compendiumLinks[0]!, localChoice)).toBe(false);

    const applied = applyCharacterChoice({ character, choice: localChoice });
    expect(applied.ok).toBe(true);
    expect(applied.character.feats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Fighting Initiate' })
    ]));
    expect(applied.link).toMatchObject({ appliedAs: 'feat', appliedEntityName: 'Fighting Initiate' });
  });

  it('matches a local choice through its explicit legacy item identity', () => {
    const localChoice: CharacterChoiceItem = {
      ...choice(true),
      choiceId: 'compendium:tcoe-2020-feat-metamagic-adept',
      entityId: 'tcoe-2020-feat-metamagic-adept',
      kind: 'feat',
      name: 'Metamagic Adept',
      origin: 'compendium',
      catalogSnapshotId: undefined,
      catalogEntityId: undefined,
      compendiumItemId: 'tcoe-2020-feat-metamagic-adept',
      provenance: {
        origin: 'compendium',
        sourceId: 'tcoe-2020',
        packId: 'tcoe-2020-2024-compatible-import-pack-v2',
        legacyItemIds: ['tcoe-2020-feat-metamagic-adept'],
        overrideAuthorized: false
      }
    };
    const character = createEmptyCharacter('Wizard');
    const link = {
      id: 'legacy-link',
      characterId: character.id,
      itemId: 'tcoe-2020-feat-metamagic-adept',
      importItemId: 'tcoe-2020-feat-metamagic-adept',
      packId: 'tcoe-2020-2024-compatible-import-pack-v2',
      sourceId: 'tcoe-2020',
      itemType: 'feat' as const,
      appliedAs: 'feat' as const,
      appliedEntityId: 'feat-metamagic',
      appliedEntityName: 'Metamagic Adept',
      status: 'active' as const,
      addedAt: new Date(0).toISOString(),
      origin: 'compendium' as const
    };

    expect(characterChoiceMatchesLink(link, localChoice)).toBe(true);
  });

});
