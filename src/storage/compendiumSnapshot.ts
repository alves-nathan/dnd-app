import type { RuleSource } from '../types';
import type { StoredCompendiumItem, StoredCompendiumPack } from '../compendium/types';

export interface CompendiumPersistenceState {
  sources: RuleSource[];
  packs: StoredCompendiumPack[];
  items: StoredCompendiumItem[];
  enabledSourceIds: string[];
}

export const COMPENDIUM_PERSISTENCE_VERSION = 3;
export const COMPENDIUM_STORAGE_KEY = 'dnd-combat-math-compendium';

export const emptyCompendiumPersistenceState = (): CompendiumPersistenceState => ({
  sources: [],
  packs: [],
  items: [],
  enabledSourceIds: []
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

export const sanitizeCompendiumPersistenceState = (value: unknown): CompendiumPersistenceState => {
  if (!isRecord(value)) return emptyCompendiumPersistenceState();
  return {
    sources: asArray<RuleSource>(value.sources),
    packs: asArray<StoredCompendiumPack>(value.packs),
    items: asArray<StoredCompendiumItem>(value.items),
    enabledSourceIds: asStringArray(value.enabledSourceIds)
  };
};

export const createCompendiumPersistenceState = (state: CompendiumPersistenceState): CompendiumPersistenceState => ({
  sources: state.sources,
  packs: state.packs,
  items: state.items,
  enabledSourceIds: state.enabledSourceIds
});
