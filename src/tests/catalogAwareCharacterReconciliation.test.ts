import { buildPersistedCompendiumImport } from '../compendium/importer';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import {
  canonicalizeCharacterCompendiumLinks,
  createCharacterLinkCatalogFingerprint,
  reconcileCharactersAgainstCurrentCatalog
} from '../characters/catalogAwareCharacterReconciliation';
import { createEmptyCharacter } from '../data/mockData';

const source = {
  id: 'catalog-aware-reconciliation-source',
  book: 'Catalog-aware reconciliation',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const pack = buildPersistedCompendiumImport({
  id: 'catalog-aware-reconciliation-pack',
  source,
  items: [
    {
      id: 'fighter-canonical',
      kind: 'class',
      name: 'Fighter',
      source,
      payload: { progression: [{ level: 1, featureIds: ['second-wind-canonical'] }] }
    },
    {
      id: 'wizard-carrier',
      kind: 'class',
      name: 'Wizard',
      source,
      payload: { progression: [] }
    },
    {
      id: 'second-wind-canonical',
      kind: 'feature',
      name: 'Second Wind',
      source,
      payload: {
        sourceType: 'classFeature',
        classId: 'fighter-canonical',
        resource: { id: 'second-wind-canonical-resource', max: 1, recharge: 'shortRest' }
      }
    }
  ]
});

const item = (id: string) => pack.items.find((entry) => entry.importItemId === id)!;

describe('catalog-aware character reconciliation', () => {
  it('canonicalizes a stale reused carrier before running destructive reconciliation', () => {
    const applied = applyCompendiumItemToCharacter(createEmptyCharacter('Legacy Fighter'), item('fighter-canonical'));
    const classEntityId = applied.link!.appliedEntityId;
    const stale = {
      ...applied.character,
      compendiumLinks: (applied.character.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'class' && link.appliedEntityId === classEntityId
          ? {
              ...link,
              itemId: item('wizard-carrier').id,
              importItemId: item('fighter-canonical').importItemId
            }
          : link
      )
    };

    const result = reconcileCharactersAgainstCurrentCatalog([stale], pack.items);
    const migrated = result.characters[0]!;
    const classLink = migrated.compendiumLinks?.find((link) => link.appliedEntityId === classEntityId)!;

    expect(classLink.itemId).toBe(item('fighter-canonical').id);
    expect(classLink.importItemId).toBe(item('fighter-canonical').importItemId);
    expect(result.repairedLinkCount).toBe(1);
    expect(result.unresolvedLinkCount).toBe(0);
    expect(migrated.classes.some((entry) => entry.id === classEntityId && entry.name === 'Fighter')).toBe(true);
    expect(migrated.features.map((feature) => feature.name)).toContain('Second Wind');
  });

  it('defers destructive reconciliation when an active legacy link is unresolved', () => {
    const character = createEmptyCharacter('Ambiguous legacy');
    character.features = [{
      id: 'legacy-feature-entity',
      name: 'Legacy Feature',
      sourceType: 'classFeature'
    }];
    character.compendiumLinks = [{
      id: 'legacy-link',
      characterId: character.id,
      itemId: 'missing-carrier',
      importItemId: 'missing-logical-id',
      packId: 'legacy-pack',
      sourceId: 'legacy-source',
      itemType: 'feature',
      appliedAs: 'feature',
      appliedEntityId: 'legacy-feature-entity',
      appliedEntityName: 'Legacy Feature',
      status: 'active',
      addedAt: '2026-01-01T00:00:00.000Z'
    }];

    const canonicalized = canonicalizeCharacterCompendiumLinks(character, pack.items);
    const result = reconcileCharactersAgainstCurrentCatalog([character], pack.items);

    expect(canonicalized.unresolvedLinkCount).toBe(1);
    expect(result.unresolvedLinkCount).toBe(1);
    expect(result.characters[0]!.features).toEqual(character.features);
    expect(result.characters[0]!.compendiumLinks).toEqual(character.compendiumLinks);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHARACTER_CATALOG_RECONCILIATION_DEFERRED' })
    ]));
  });

  it('does not invalidate the identity fingerprint for editorial-only changes', () => {
    const original = createCharacterLinkCatalogFingerprint(pack.items);
    const editoriallyChanged = pack.items.map((entry) => ({
      ...entry,
      status: 'needsReview' as const,
      reviewDecision: 'pending' as const,
      reviewNotes: 'Editorial note only'
    }));
    const editorial = createCharacterLinkCatalogFingerprint(editoriallyChanged);
    const carrierChanged = createCharacterLinkCatalogFingerprint(pack.items.map((entry) =>
      entry.importItemId === 'fighter-canonical' ? { ...entry, id: `${entry.id}-new-carrier` } : entry
    ));

    expect(editorial).toBe(original);
    expect(carrierChanged).not.toBe(original);
  });
});
