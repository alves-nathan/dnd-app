import type { CatalogSnapshot, RuntimeCatalogEntry } from './types';
import type { StoredCompendiumItem } from '../compendium/types';
import type { CharacterChoiceKind } from './characterChoiceTypes';
import { normalizeSearchText } from './utils';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean => value === true;

export const normalizeChoiceName = (value: string): string => normalizeSearchText(value);

export const mapCatalogKindToChoiceKind = (
  kind: string,
  carrierType?: StoredCompendiumItem['type']
): CharacterChoiceKind | undefined => {
  if (carrierType) return carrierType;
  if (kind === 'class') return 'class';
  if (kind === 'subclass') return 'subclass';
  if (kind === 'species') return 'species';
  if (kind === 'background') return 'background';
  if (kind === 'feat') return 'feat';
  if (kind === 'spell') return 'spell';
  if (kind === 'weapon') return 'weapon';
  if (kind === 'armor') return 'armor';
  if (kind === 'equipment' || kind === 'tool') return 'equipment';
  if (kind === 'magicItem') return 'magicItem';
  if (kind === 'condition') return 'condition';
  if (kind === 'creatureStatBlock' || kind === 'creatureTemplate') return 'creatureStatBlock';
  if (kind.toLowerCase().includes('feature') || kind === 'rule') return 'feature';
  return undefined;
};

export const explicitCatalogEntityIdForItem = (
  item: StoredCompendiumItem
): string | undefined => {
  const normalized = asRecord(item.normalizedJson);
  const raw = asRecord(item.rawJson);
  const rawPayload = asRecord(raw.payload);
  return (
    asString(normalized.catalogEntityId) ??
    asString(normalized.officialEntityId) ??
    asString(normalized.catalogId) ??
    asString(rawPayload.catalogEntityId) ??
    asString(rawPayload.officialEntityId) ??
    asString(rawPayload.catalogId)
  );
};

export const itemAuthorizesCatalogOverride = (
  item: StoredCompendiumItem
): boolean => {
  const normalized = asRecord(item.normalizedJson);
  const rawPayload = asRecord(asRecord(item.rawJson).payload);
  return (
    asBoolean(normalized.catalogOverride) ||
    asBoolean(normalized.overrideOfficial) ||
    asBoolean(rawPayload.catalogOverride) ||
    asBoolean(rawPayload.overrideOfficial)
  );
};

export const localSourceBookId = (
  item: StoredCompendiumItem,
  snapshot: CatalogSnapshot
): string | undefined => {
  const source = asRecord(item.rawJson.source);
  const candidates = [
    asString(source.id),
    asString(item.sourceId),
    asString(source.book),
    asString(item.version) && asString(source.book)
      ? `${asString(source.book)}-${asString(item.version)}`
      : undefined
  ].filter((entry): entry is string => Boolean(entry));

  return candidates.find((candidate) => snapshot.manifest.sourceBooks.includes(candidate));
};

export const localSourceLabel = (item: StoredCompendiumItem): string => {
  const source = asRecord(item.rawJson.source);
  const book = asString(source.book);
  const version = asString(source.version) ?? item.version;
  if (book && version) return `${book.toUpperCase()} ${version}`;
  if (book) return book.toUpperCase();
  return item.sourceId;
};

export const fallbackDeduplicationKey = (
  kind: CharacterChoiceKind,
  sourceBookId: string | undefined,
  name: string
): string => `${kind}:${sourceBookId ?? 'unscoped'}:${normalizeChoiceName(name)}`;

export const catalogEntryFallbackKey = (
  entry: RuntimeCatalogEntry,
  kind: CharacterChoiceKind
): string => fallbackDeduplicationKey(kind, entry.sourceBookId ?? undefined, entry.displayName);

export const canonicalCatalogEntityIdForItem = (
  item: StoredCompendiumItem,
  snapshot: CatalogSnapshot,
  fallbackEntryIdsByKey: ReadonlyMap<string, readonly string[]>
): { entityId?: string; ambiguous: boolean; resolution: 'explicit' | 'alias' | 'id' | 'fallback' | 'none' } => {
  const explicit = explicitCatalogEntityIdForItem(item);
  const directCandidates = [
    explicit,
    item.importItemId,
    asString(asRecord(item.rawJson).id),
    item.id.includes(':') ? item.id.slice(item.id.lastIndexOf(':') + 1) : undefined
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of directCandidates) {
    const resolved = resolveCatalogAlias(candidate, snapshot);
    if (snapshot.entryById.has(resolved)) {
      return {
        entityId: resolved,
        ambiguous: false,
        resolution: candidate === explicit ? 'explicit' : resolved !== candidate ? 'alias' : 'id'
      };
    }
  }

  const kind = mapCatalogKindToChoiceKind(item.type, item.type);
  if (!kind) return { ambiguous: false, resolution: 'none' };
  const key = fallbackDeduplicationKey(kind, localSourceBookId(item, snapshot), item.name);
  const candidates = fallbackEntryIdsByKey.get(key) ?? [];
  if (candidates.length === 1) {
    return { entityId: candidates[0], ambiguous: false, resolution: 'fallback' };
  }
  if (candidates.length > 1) return { ambiguous: true, resolution: 'none' };
  return { ambiguous: false, resolution: 'none' };
};

export const resolveCatalogAlias = (
  entityId: string,
  snapshot: CatalogSnapshot,
  maxDepth = 16
): string => {
  let current = entityId;
  const visited = new Set<string>();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (visited.has(current)) return current;
    visited.add(current);
    const alias = snapshot.aliases.get(current);
    if (!alias || alias.status !== 'active') return current;
    current = alias.to;
  }
  return current;
};

export const collectOwnerIds = (
  payload: Record<string, unknown>,
  entry: RuntimeCatalogEntry | undefined,
  snapshot: CatalogSnapshot
): string[] => {
  const values = new Set<string>();
  const add = (value: unknown) => {
    const text = asString(value);
    if (text) values.add(resolveCatalogAlias(text, snapshot));
  };
  const addArray = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(add);
  };

  add(payload.classId);
  add(payload.parentClassId);
  add(payload.ownerId);
  add(payload.speciesId);
  add(payload.backgroundId);
  addArray(payload.ownerIds);
  addArray(payload.sourceEntityIds);

  if (entry) {
    for (const edge of snapshot.dependenciesFrom.get(entry.entityId) ?? []) {
      if (
        edge.strength === 'ownership' ||
        edge.relation.toLowerCase().includes('owner') ||
        edge.relation.toLowerCase().includes('class')
      ) {
        values.add(edge.toId);
      }
    }
  }
  return Array.from(values);
};
