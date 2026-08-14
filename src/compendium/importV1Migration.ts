import type { RuleSource } from '../types';
import type { CompendiumEntityKind } from './importDomain';
import { LEGACY_IMPORT_TEMPLATE_VERSION_V1 } from './importVersions';
import {
  normalizeCompendiumImportPack,
  type CanonicalImportPackShape,
  type ImportNormalizationIssue,
  type NormalizationResult
} from './importNormalization';

export interface LegacyCompendiumImportItemInput {
  id: string;
  kind: CompendiumEntityKind;
  name: string;
  summary?: string;
  source: RuleSource;
  payload: Record<string, unknown>;
}

export interface LegacyCompendiumImportInput {
  id: string;
  source: RuleSource;
  items: LegacyCompendiumImportItemInput[];
}

export interface MigrateImportV1ToV2Options {
  /** The original envelope is optional because the V1 Zod schema historically
   * stripped metadata/template fields that it did not know about. */
  originalEnvelope?: Record<string, unknown>;
  detectedLegacyVersion?: typeof LEGACY_IMPORT_TEMPLATE_VERSION_V1 | 'legacy-unversioned';
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const appendMigrationMetadata = (
  pack: CanonicalImportPackShape,
  input: LegacyCompendiumImportInput,
  options: MigrateImportV1ToV2Options
): CanonicalImportPackShape => {
  const original = options.originalEnvelope ?? {};
  const existingMetadata = asRecord(original.metadata) ?? {};
  const legacyExtensions: Record<string, unknown> = {};

  for (const key of ['extractionInstructions', 'consolidationMeta'] as const) {
    if (original[key] !== undefined) legacyExtensions[key] = original[key];
  }

  return {
    ...pack,
    metadata: {
      ...existingMetadata,
      migratedFrom: options.detectedLegacyVersion ?? LEGACY_IMPORT_TEMPLATE_VERSION_V1,
      legacyPackId: input.id,
      ...(Object.keys(legacyExtensions).length ? { legacyExtensions } : {})
    }
  };
};

/**
 * Explicit V1 compatibility boundary.
 *
 * V1 is parsed with its historical schema first, then this adapter promotes
 * recurring legacy shapes (currency strings, action aliases, resource
 * progression, etc.) into the canonical V2 representation. Nothing after this
 * function needs to know that the source was V1.
 */
export const migrateImportV1ToV2 = (
  input: LegacyCompendiumImportInput,
  options: MigrateImportV1ToV2Options = {}
): NormalizationResult<CanonicalImportPackShape | undefined> => {
  const original = options.originalEnvelope ?? {};
  const rawForNormalization: Record<string, unknown> = {
    ...original,
    id: input.id,
    source: input.source,
    items: input.items,
    metadata: asRecord(original.metadata)
  };

  const normalized = normalizeCompendiumImportPack(rawForNormalization);
  if (!normalized.value) return normalized;

  const migrated = appendMigrationMetadata(normalized.value, input, options);
  const migrationIssue: ImportNormalizationIssue = {
    severity: 'info',
    code: 'IMPORT_V1_MIGRATED_TO_V2',
    message: `Migrated ${input.items.length} item(s) from ${options.detectedLegacyVersion ?? LEGACY_IMPORT_TEMPLATE_VERSION_V1} to the canonical V2 model.`,
    path: 'templateVersion',
    originalValue: options.detectedLegacyVersion ?? LEGACY_IMPORT_TEMPLATE_VERSION_V1,
    normalizedValue: migrated.templateVersion
  };

  return { value: migrated, issues: [migrationIssue, ...normalized.issues] };
};
