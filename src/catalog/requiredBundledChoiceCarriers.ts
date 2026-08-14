import { REQUIRED_CHARACTER_CREATION_BUNDLED_PACKS } from '../compendium/bundledCompendium';
import type { CompendiumImportItem } from '../compendium/importDomain';
import type { StoredCompendiumItem } from '../compendium/types';

interface TrustedBundledPackShape {
  id: string;
  items: CompendiumImportItem[];
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z';

const toFallbackCarrier = (
  packId: string,
  item: CompendiumImportItem
): StoredCompendiumItem => ({
  id: `bundled-fallback:${item.id}`,
  importItemId: item.id,
  packId,
  sourceId: item.source.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  version: item.source.version,
  rawJson: item,
  normalizedJson: {
    ...item.payload,
    id: item.id,
    name: item.name,
    type: item.kind,
    sourceId: item.source.id,
    sourceStatus: item.source.status,
    sourceConfidence: item.source.confidence,
    requiresReview: false,
    __bundledMechanicalFallback: true
  },
  tags: Array.from(new Set([
    item.kind,
    item.name.toLowerCase(),
    item.source.id,
    'bundled-mechanical-fallback'
  ])),
  status: 'validated',
  reviewDecision: 'approved',
  reviewNotes: 'Payload mecânico básico fornecido diretamente pelo bundle do aplicativo como fallback não persistente.',
  reviewedBy: 'Bundle básico do aplicativo',
  reviewedAt: FALLBACK_TIMESTAMP,
  createdAt: FALLBACK_TIMESTAMP,
  updatedAt: FALLBACK_TIMESTAMP
});

let cachedRequiredCarriers: StoredCompendiumItem[] | undefined;

/**
 * Trusted, non-persistent carriers for required character-creation content.
 * They are used only when the local compendium has no canonical item with the
 * same import id. This keeps the creation flow usable even if an old/corrupt
 * snapshot retains pack metadata while some PHB rows are missing.
 */
export const requiredBundledChoiceCarriers = (): StoredCompendiumItem[] => {
  if (cachedRequiredCarriers) return cachedRequiredCarriers;
  cachedRequiredCarriers = REQUIRED_CHARACTER_CREATION_BUNDLED_PACKS.flatMap((definition) => {
    const pack = definition.load() as TrustedBundledPackShape;
    return pack.items.map((item) => toFallbackCarrier(pack.id, item));
  });
  return cachedRequiredCarriers;
};

export const mergeRequiredBundledChoiceCarriers = (
  persistedItems: StoredCompendiumItem[]
): StoredCompendiumItem[] => {
  const representedCanonicalIds = new Set(
    persistedItems.flatMap((item) => [item.importItemId, item.id])
  );
  const missingFallbacks = requiredBundledChoiceCarriers().filter(
    (item) => !representedCanonicalIds.has(item.importItemId)
  );
  return missingFallbacks.length ? [...persistedItems, ...missingFallbacks] : persistedItems;
};
