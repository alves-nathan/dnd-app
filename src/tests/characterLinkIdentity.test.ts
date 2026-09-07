import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  characterLinkMatchesCompendiumItem,
  characterLinkMatchesReference,
  findCompendiumItemForCharacterLink,
  sameLogicalCompendiumItem
} from '../compendium/characterLinkIdentity';
import type { CharacterCompendiumLink } from '../types';

const source = {
  id: 'identity-source',
  book: 'Identity Test',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const persisted = buildPersistedCompendiumImport({
  id: 'identity-pack',
  source,
  items: [
    { id: 'fighter', kind: 'class', name: 'Fighter', source, payload: {} },
    { id: 'wizard', kind: 'class', name: 'Wizard', source, payload: {} },
    { id: 'champion', kind: 'subclass', name: 'Champion', source, payload: { classId: 'fighter' } }
  ]
});

const item = (id: string) => persisted.items.find((entry) => entry.importItemId === id)!;

const linkFor = (
  targetId: string,
  overrides: Partial<CharacterCompendiumLink> = {}
): CharacterCompendiumLink => {
  const target = item(targetId);
  return {
    id: `link-${targetId}`,
    characterId: 'identity-character',
    itemId: target.id,
    importItemId: target.importItemId,
    packId: target.packId,
    sourceId: target.sourceId,
    itemType: target.type as CharacterCompendiumLink['itemType'],
    appliedAs: target.type as CharacterCompendiumLink['appliedAs'],
    appliedEntityId: `${targetId}-entity`,
    appliedEntityName: target.name,
    status: 'active',
    addedAt: '2026-08-19T00:00:00.000Z',
    ...overrides
  };
};

describe('canonical character link identity', () => {
  it('prefers stable import identity when a stale carrier id now resolves to another item', () => {
    const fighter = item('fighter');
    const wizard = item('wizard');
    const stale = linkFor('fighter', {
      itemId: wizard.id,
      importItemId: fighter.importItemId
    });

    expect(findCompendiumItemForCharacterLink(persisted.items, stale)).toBe(fighter);
    expect(characterLinkMatchesCompendiumItem(persisted.items, stale, fighter)).toBe(true);
    expect(characterLinkMatchesCompendiumItem(persisted.items, stale, wizard)).toBe(false);
  });

  it('uses catalog identity ahead of conflicting lower-priority references', () => {
    const fighter = item('fighter');
    const wizard = item('wizard');
    const catalogLink = linkFor('fighter', {
      itemId: wizard.id,
      importItemId: wizard.importItemId,
      choiceId: `catalog:${fighter.importItemId}`,
      catalogEntityId: fighter.importItemId,
      origin: 'catalog'
    });

    expect(findCompendiumItemForCharacterLink(persisted.items, catalogLink)).toBe(fighter);
    expect(characterLinkMatchesReference(persisted.items, catalogLink, `catalog:${fighter.importItemId}`)).toBe(true);
  });

  it('treats catalog/compendium prefixes as aliases of the persisted logical reference', () => {
    const fighter = item('fighter');
    const catalogCarrier = {
      ...fighter,
      id: `catalog:${fighter.importItemId}`,
      normalizedJson: {
        ...fighter.normalizedJson,
        __characterChoice: {
          origin: 'catalog',
          choiceId: `catalog:${fighter.importItemId}`,
          entityId: fighter.importItemId,
          catalogEntityId: fighter.importItemId
        }
      }
    };

    expect(sameLogicalCompendiumItem(fighter, catalogCarrier)).toBe(true);
  });

  it('does not guess when the best character-link identity is genuinely ambiguous', () => {
    const ambiguousItems = [item('fighter'), item('wizard')].map((candidate) => ({
      ...candidate,
      normalizedJson: {
        ...candidate.normalizedJson,
        __characterChoice: {
          choiceId: 'catalog:ambiguous-class'
        }
      }
    }));
    const ambiguousLink = linkFor('fighter', {
      itemId: 'obsolete-carrier',
      importItemId: 'obsolete-import-id',
      choiceId: 'catalog:ambiguous-class'
    });

    expect(findCompendiumItemForCharacterLink(ambiguousItems, ambiguousLink)).toBeUndefined();
  });

});
