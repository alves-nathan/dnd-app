import type { StoredCompendiumItem } from '../compendium/types';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const isSidekickClassItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'class') return false;
  const mechanics = asRecord(item.normalizedJson.mechanics);
  if (mechanics?.sidekickClass === true) return true;

  // Compatibility fallback for older persisted snapshots that may predate the
  // structured mechanics marker but still preserve the imported sidekick tag/id.
  return item.tags.some((tag) => tag.trim().toLowerCase() === 'sidekick') ||
    item.importItemId.includes('-class-sidekick-');
};

/**
 * Player-character base classes must carry a real class chassis.  A few legacy
 * books legitimately contain sidekick classes and imported rule/options can
 * also be mis-typed as `class`; requiring a Hit Die prevents those records
 * from leaking into the base-class selector while keeping PHB 2024 and the
 * Forge 2025 Artificer available.
 */
export const isPlayerCharacterClassItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'class' || isSidekickClassItem(item)) return false;
  const payload = asRecord(item.normalizedJson) ?? {};
  const hitDie = asNumber(payload.hitDie);
  if (!hitDie || hitDie < 4 || hitDie > 20) return false;

  // Subclasses/variants/options should never masquerade as a base class even
  // when an upstream import accidentally assigns kind=class.
  if (
    asString(payload.classId) ||
    asString(payload.classRef) ||
    asString(payload.baseClassId) ||
    asString(payload.subclassId) ||
    asString(payload.ownerClassId) ||
    asString(payload.ownerSubclassId)
  ) return false;

  return true;
};
