import type { CompendiumImportItem } from './importDomain';

/**
 * Fields added by persistence/review/import sessions that must not make two
 * semantically equivalent compendium entities look different.
 */
const TRANSIENT_CONTENT_KEYS = new Set([
  'contentHash',
  'checksum',
  'importedAt',
  'createdAt',
  'updatedAt',
  'reviewedAt',
  'reviewedBy',
  'reviewDecision',
  'reviewNotes',
  'requiresReview',
  'importId'
]);

const semanticValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (value === null || typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (TRANSIENT_CONTENT_KEYS.has(key)) continue;
    const entry = input[key];
    if (entry === undefined) continue;
    output[key] = semanticValue(entry);
  }
  return output;
};

export const canonicalizeImportContentForHash = (value: unknown): unknown => semanticValue(value);

export const stableImportStringify = (value: unknown): string => {
  const normalized = semanticValue(value);
  const stringify = (entry: unknown): string => {
    if (entry === null || typeof entry !== 'object') return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(stringify).join(',')}]`;
    const record = entry as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`)
      .join(',')}}`;
  };
  return stringify(normalized);
};

/**
 * Small deterministic, runtime-portable content fingerprint.
 *
 * This intentionally avoids Node's crypto module so the exact function can run
 * in React Native/Hermes as well as Node/Jest. Two independent 32-bit lanes are
 * combined to reduce accidental collisions compared with the legacy checksum.
 */
export const createImportContentHash = (value: unknown): string => {
  const text = stableImportStringify(value);
  let laneA = 0x811c9dc5;
  let laneB = 0x9e3779b9;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    laneA ^= code;
    laneA = Math.imul(laneA, 0x01000193);

    laneB ^= code + index;
    laneB = Math.imul(laneB, 0x85ebca6b);
    laneB ^= laneB >>> 13;
  }

  const a = (laneA >>> 0).toString(16).padStart(8, '0');
  const b = (laneB >>> 0).toString(16).padStart(8, '0');
  return `cmpv2_${a}${b}`;
};

/** Hashes the canonical entity identity + source + payload, never pack metadata. */
export const createCompendiumImportItemContentHash = (item: CompendiumImportItem): string => createImportContentHash({
  id: item.id,
  kind: item.kind,
  name: item.name,
  summary: item.summary,
  source: item.source,
  payload: item.payload
});
