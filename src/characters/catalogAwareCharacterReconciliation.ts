import type { Character, CharacterCompendiumLink, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  findCompendiumItemForCharacterLink,
  getCompendiumItemReferenceCandidates
} from '../compendium/characterLinkIdentity';
import { reconcileCharacterSnapshot } from './characterReconciliation';

const CHARACTER_LINK_ITEM_TYPES = new Set<StoredCompendiumItem['type']>([
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'weapon',
  'armor',
  'equipment',
  'magicItem',
  'spell',
  'feature'
]);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const metadataForItem = (item: StoredCompendiumItem): Record<string, unknown> =>
  asRecord(item.normalizedJson.__characterChoice);

const linkSnapshot = (link: CharacterCompendiumLink): string => JSON.stringify(link);

const canonicalizeResolvedLink = (
  link: CharacterCompendiumLink,
  item: StoredCompendiumItem
): CharacterCompendiumLink => {
  const metadata = metadataForItem(item);
  const metadataOrigin = asString(metadata.origin);
  const catalogEntityId = asString(metadata.catalogEntityId) ?? link.catalogEntityId;
  return {
    ...link,
    itemId: item.id,
    importItemId: item.importItemId,
    packId: item.packId,
    sourceId: item.sourceId,
    itemType: item.type as CharacterCompendiumLink['itemType'],
    choiceId: asString(metadata.choiceId) ?? item.id,
    catalogEntityId,
    catalogSnapshotId: asString(metadata.catalogSnapshotId) ?? link.catalogSnapshotId,
    origin: metadataOrigin === 'catalog' || metadataOrigin === 'compendium'
      ? metadataOrigin
      : (catalogEntityId ? 'catalog' : link.origin),
    manualReviewRequired: asBoolean(metadata.manualReviewRequired) ?? link.manualReviewRequired
  };
};

export interface CharacterLinkCanonicalizationResult {
  character: Character;
  changed: boolean;
  repairedLinkCount: number;
  unresolvedLinkCount: number;
  issues: RuleValidationIssue[];
}

/**
 * Repairs only persisted Compendium link carriers that can be resolved without
 * ambiguity. Unresolved links are deliberately retained byte-for-byte so a
 * later catalog can recover them; active unresolved links are reported rather
 * than guessed or deleted.
 */
export const canonicalizeCharacterCompendiumLinks = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterLinkCanonicalizationResult => {
  let repairedLinkCount = 0;
  let unresolvedLinkCount = 0;
  const issues: RuleValidationIssue[] = [];
  const links = (character.compendiumLinks ?? []).map((link) => {
    const resolved = findCompendiumItemForCharacterLink(items, link);
    if (!resolved) {
      if (link.status !== 'removed') {
        unresolvedLinkCount += 1;
        issues.push({
          severity: 'warning',
          code: 'CHARACTER_CATALOG_LINK_UNRESOLVED',
          message: `Vínculo de ${link.appliedEntityName || link.itemId} não pôde ser resolvido de forma inequívoca no Compendium atual.`
        });
      }
      return link;
    }
    const canonical = canonicalizeResolvedLink(link, resolved);
    if (linkSnapshot(canonical) !== linkSnapshot(link)) repairedLinkCount += 1;
    return canonical;
  });

  const changed = repairedLinkCount > 0;
  return {
    character: changed ? { ...character, compendiumLinks: links } : character,
    changed,
    repairedLinkCount,
    unresolvedLinkCount,
    issues
  };
};

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Fingerprints only fields that participate in character-link identity.
 * Editorial status/review changes intentionally do not invalidate character
 * migrations, preserving the separation between Compendium maintenance and
 * owned-character state.
 */
export const createCharacterLinkCatalogFingerprint = (
  items: StoredCompendiumItem[]
): string => {
  const entries = items
    .filter((item) => CHARACTER_LINK_ITEM_TYPES.has(item.type))
    .map((item) => [
      item.type,
      item.id,
      item.importItemId,
      ...getCompendiumItemReferenceCandidates(item).sort()
    ].join('\u001f'))
    .sort();
  return `character-links-v1:${entries.length}:${fnv1a(entries.join('\u001e'))}`;
};

export interface CatalogAwareCharacterReconciliationResult {
  characters: Character[];
  changedCharacterIds: string[];
  repairedLinkCount: number;
  unresolvedLinkCount: number;
  issues: RuleValidationIssue[];
}

/**
 * Catalog-aware migration pass. Link carriers are canonicalized first, then
 * the FIX55B reconciliation service materializes/removes derived mechanics
 * against the safely resolved snapshot.
 */
export const reconcileCharactersAgainstCurrentCatalog = (
  characters: Character[],
  items: StoredCompendiumItem[]
): CatalogAwareCharacterReconciliationResult => {
  const changedCharacterIds: string[] = [];
  let repairedLinkCount = 0;
  let unresolvedLinkCount = 0;
  const issues: RuleValidationIssue[] = [];

  const nextCharacters = characters.map((character) => {
    const links = canonicalizeCharacterCompendiumLinks(character, items);
    repairedLinkCount += links.repairedLinkCount;
    unresolvedLinkCount += links.unresolvedLinkCount;
    issues.push(...links.issues);

    // A destructive reconciliation pass must never run while an active link is
    // unresolved or ambiguous. Keep the safely canonicalized links, preserve
    // owned mechanics, and retry on a later hydration/catalog identity change.
    if (links.unresolvedLinkCount > 0) {
      issues.push({
        severity: 'warning',
        code: 'CHARACTER_CATALOG_RECONCILIATION_DEFERRED',
        message: `Reconciliação de ${character.name || character.id} adiada porque existem vínculos ativos não resolvidos.`
      });
      if (links.changed) changedCharacterIds.push(character.id);
      return links.character;
    }

    const reconciliation = reconcileCharacterSnapshot(links.character, items);
    issues.push(...reconciliation.issues);
    if (links.changed || reconciliation.changed) changedCharacterIds.push(character.id);
    return reconciliation.character;
  });

  return {
    characters: nextCharacters,
    changedCharacterIds,
    repairedLinkCount,
    unresolvedLinkCount,
    issues
  };
};
