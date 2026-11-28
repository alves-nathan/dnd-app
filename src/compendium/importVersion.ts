import { IMPORT_TEMPLATE_VERSION_V2, IMPORT_TEMPLATE_VERSION_V3, LEGACY_IMPORT_TEMPLATE_VERSION_V1 } from './importVersions';

export type SupportedCompendiumImportVersion = typeof LEGACY_IMPORT_TEMPLATE_VERSION_V1 | typeof IMPORT_TEMPLATE_VERSION_V2;
export type DetectedCompendiumImportVersion = SupportedCompendiumImportVersion | 'legacy-unversioned' | 'unknown';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Recognize V3 separately from supported persistence versions. The contract
 * marker also protects malformed/mislabeled canonical V3 envelopes. */
export const isV3StagingEnvelope = (value: unknown): boolean => {
  const record = asRecord(value);
  return !!record && (record.templateVersion === IMPORT_TEMPLATE_VERSION_V3 ||
    (typeof record.contractRevision === 'string' && record.contractRevision.startsWith('canonical-v3.')));
};

export const isV3StagingJson = (text: string): boolean => {
  try { return isV3StagingEnvelope(JSON.parse(text)); }
  catch { return false; }
};

export const detectCompendiumImportVersion = (value: unknown): DetectedCompendiumImportVersion => {
  const record = asRecord(value);
  if (!record || isV3StagingEnvelope(record)) return 'unknown';
  if (record.templateVersion === IMPORT_TEMPLATE_VERSION_V2) return IMPORT_TEMPLATE_VERSION_V2;
  if (record.templateVersion === LEGACY_IMPORT_TEMPLATE_VERSION_V1) return LEGACY_IMPORT_TEMPLATE_VERSION_V1;
  if (typeof record.templateVersion === 'string') return 'unknown';
  if (typeof record.id === 'string' && Array.isArray(record.items) && asRecord(record.source)) return 'legacy-unversioned';
  return 'unknown';
};
