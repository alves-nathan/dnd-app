import { applyCharacterChoice, previewCharacterChoiceApplication } from '../catalog/characterChoiceApplication';
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
});
