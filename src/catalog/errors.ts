export type CatalogErrorCode =
  | 'CATALOG_PARSE_FAILED'
  | 'CATALOG_CHECKSUM_REQUIRED'
  | 'CATALOG_CHECKSUM_MISMATCH'
  | 'CATALOG_SCHEMA_UNSUPPORTED'
  | 'CATALOG_VALIDATION_FAILED'
  | 'CATALOG_ENTITY_NOT_FOUND'
  | 'CATALOG_PROFILE_NOT_FOUND';

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: CatalogErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
    this.details = details;
  }
}
