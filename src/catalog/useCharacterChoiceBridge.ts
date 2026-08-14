import { useMemo } from 'react';
import type { CompendiumItemSearchFilters, StoredCompendiumItem } from '../compendium/types';
import type { Character, CharacterPendingChoice } from '../types';
import { useCatalogStore } from '../store/catalogStore';
import { useCompendiumStore } from '../store/compendiumStore';
import { characterChoiceToMapperItem } from './catalogCompendiumAdapter';
import { listCharacterChoices } from './characterChoiceBridge';
import type { CharacterChoiceItem } from './characterChoiceTypes';
import { resolveCharacterPendingChoice, type CharacterPendingChoiceResolution } from './characterDependencyResolver';
import { mergeRequiredBundledChoiceCarriers } from './requiredBundledChoiceCarriers';

export interface CharacterChoiceBridgeView {
  status: 'loading' | 'ready' | 'failed';
  catalogSnapshotId?: string;
  catalogVersion?: string;
  choices: CharacterChoiceItem[];
  items: StoredCompendiumItem[];
  enabledSourceIds: string[];
  hiddenDuplicateCount: number;
  unavailableCount: number;
  searchItems: (query: string, filters?: CompendiumItemSearchFilters) => StoredCompendiumItem[];
  choiceForItemId: (itemId: string) => CharacterChoiceItem | undefined;
  resolvePendingChoice: (character: Character, pendingChoice: CharacterPendingChoice) => CharacterPendingChoiceResolution | undefined;
}

const itemMatches = (
  item: StoredCompendiumItem,
  query: string,
  filters: CompendiumItemSearchFilters | undefined,
  enabledSourceIds: Set<string>
): boolean => {
  if (filters?.types?.length && !filters.types.includes(item.type)) return false;
  if (filters?.statuses?.length && !filters.statuses.includes(item.status)) return false;
  if (filters?.sourceIds?.length && !filters.sourceIds.includes(item.sourceId)) return false;
  if (filters?.onlyEnabled && !enabledSourceIds.has(item.sourceId)) return false;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [item.name, item.summary ?? '', item.type, item.sourceId, ...item.tags].join(' ').toLowerCase();
  return normalized.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
};

export const useCharacterChoiceBridge = (): CharacterChoiceBridgeView => {
  const catalogStatus = useCatalogStore((state) => state.status);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const catalogError = useCatalogStore((state) => state.lastError);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const localEnabledSourceIds = useCompendiumStore((state) => state.enabledSourceIds);
  const compendiumHydrated = useCompendiumStore((state) => state.isHydrated);

  return useMemo(() => {
    if (!snapshot || !filterState || catalogStatus !== 'ready' || !compendiumHydrated) {
      return {
        status: catalogStatus === 'failed' || catalogError ? 'failed' : 'loading',
        choices: [],
        items: [],
        enabledSourceIds: [],
        hiddenDuplicateCount: 0,
        unavailableCount: 0,
        searchItems: () => [],
        choiceForItemId: () => undefined,
        resolvePendingChoice: () => undefined
      };
    }

    const mechanicalItems = mergeRequiredBundledChoiceCarriers(compendiumItems);
    const requiredFallbackSourceIds = mechanicalItems
      .filter((item) => item.id.startsWith('bundled-fallback:'))
      .map((item) => item.sourceId);
    const mechanicalEnabledSourceIds = Array.from(new Set([
      ...localEnabledSourceIds,
      ...requiredFallbackSourceIds
    ]));
    const result = listCharacterChoices({
      snapshot,
      filterState,
      compendiumItems: mechanicalItems,
      enabledSourceIds: mechanicalEnabledSourceIds
    }, { includeUnavailable: true });
    const bridgeChoices = result.choices.filter((choice) =>
      choice.available || Boolean(choice.compendiumItemId) || choice.origin === 'compendium'
    );
    const originalById = new Map(mechanicalItems.map((item) => [item.id, item]));
    const items = bridgeChoices.map((choice) =>
      characterChoiceToMapperItem(
        choice,
        choice.compendiumItemId ? originalById.get(choice.compendiumItemId) : undefined
      )
    );
    const choiceById = new Map<string, CharacterChoiceItem>();
    for (const choice of bridgeChoices) {
      choiceById.set(choice.choiceId, choice);
      choiceById.set(choice.entityId, choice);
      if (choice.catalogEntityId) choiceById.set(choice.catalogEntityId, choice);
      if (choice.compendiumItemId) choiceById.set(choice.compendiumItemId, choice);
      choice.provenance.legacyItemIds.forEach((legacyId) => choiceById.set(legacyId, choice));
    }
    const enabledSourceIds = Array.from(new Set([
      ...mechanicalEnabledSourceIds,
      ...items.filter((item) => item.status === 'validated').map((item) => item.sourceId)
    ]));
    const enabledSet = new Set(enabledSourceIds);

    return {
      status: 'ready' as const,
      catalogSnapshotId: snapshot.snapshotId,
      catalogVersion: snapshot.catalogVersion,
      choices: bridgeChoices,
      items,
      enabledSourceIds,
      hiddenDuplicateCount: result.hiddenDuplicateCount,
      unavailableCount: result.unavailableCount,
      searchItems: (query: string, filters?: CompendiumItemSearchFilters) =>
        items.filter((item) => itemMatches(item, query, filters, enabledSet)),
      choiceForItemId: (itemId: string) => choiceById.get(itemId),
      resolvePendingChoice: (character: Character, pendingChoice: CharacterPendingChoice) => resolveCharacterPendingChoice({
        character,
        pendingChoice,
        choices: bridgeChoices,
        snapshot
      })
    };
  }, [catalogError, catalogStatus, compendiumHydrated, compendiumItems, filterState, localEnabledSourceIds, snapshot]);
};
