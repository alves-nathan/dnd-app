/** Version identifiers live in a dependency-free module so detection,
 * normalization and migration do not need to import UI/template/Zod code. */
export const LEGACY_IMPORT_TEMPLATE_VERSION_V1 = 'dnd-combat-import.v1' as const;
export const IMPORT_TEMPLATE_VERSION_V2 = 'dnd-combat-import.v2' as const;

/**
 * @deprecated Ambiguous historical name retained only for source compatibility.
 * New code should use LEGACY_IMPORT_TEMPLATE_VERSION_V1 when referring to V1,
 * or IMPORT_TEMPLATE_VERSION_V2 for the canonical format.
 */
export const STANDARD_IMPORT_TEMPLATE_VERSION = LEGACY_IMPORT_TEMPLATE_VERSION_V1;

/** Staging contract only until the V3 persistence cutover. */
export const IMPORT_TEMPLATE_VERSION_V3 = 'dnd-combat-import.v3' as const;
