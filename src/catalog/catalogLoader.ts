import { CatalogError } from './errors';
import type {
  AliasEquivalence,
  CatalogLoadOptions,
  CatalogSnapshot,
  CatalogValidationIssue,
  CatalogValidationReport,
  DependencyEdge,
  RuntimeCatalogBundle
} from './types';
import { deepFreeze, readonlyMap, stableStringify } from './utils';

const supportedSchemaVersions = new Set(['dnd-combat-runtime-bundle.v1']);

const normalizeDigest = (value: string): string => value.trim().toLocaleLowerCase('en-US').split(/\s+/)[0] ?? '';

const buildValidationReport = (
  bundle: RuntimeCatalogBundle,
  checkedAt: string,
  checksumStatus: boolean | 'notRequested',
  strictEditorial: boolean
): CatalogValidationReport => {
  const issues: CatalogValidationIssue[] = [];
  const runtimeIds = bundle.runtimeIndex.entries.map((entry) => entry.entityId);
  const registryIds = bundle.entityRegistry.entries.map((entry) => entry.entityId);
  const runtimeIdSet = new Set(runtimeIds);
  const registryIdSet = new Set(registryIds);

  const versionCoherence = [
    bundle.catalogVersion,
    bundle.manifest.version,
    bundle.sourcePackage.version
  ].every((version) => version === bundle.catalogVersion);
  if (!versionCoherence) {
    issues.push({ severity: 'error', code: 'VERSION_MISMATCH', message: 'As versões do bundle, manifest e pacote-fonte divergem.' });
  }

  const counts = bundle.runtimeIndex.entryCount === runtimeIds.length
    && bundle.dependencyGraph.nodeCount === registryIds.length
    && bundle.dependencyGraph.edgeCount === bundle.dependencyGraph.edges.length;
  if (!counts) issues.push({ severity: 'error', code: 'COUNT_MISMATCH', message: 'Uma ou mais contagens declaradas divergem dos arrays materializados.' });

  const uniqueEntityIds = new Set(runtimeIds).size === runtimeIds.length
    && new Set(registryIds).size === registryIds.length;
  if (!uniqueEntityIds) issues.push({ severity: 'error', code: 'DUPLICATE_ENTITY_ID', message: 'Foram encontrados IDs duplicados no índice ou registro.' });

  let registryCoverage = true;
  for (const id of runtimeIds) {
    if (!registryIdSet.has(id)) {
      registryCoverage = false;
      issues.push({ severity: 'error', code: 'RUNTIME_ENTITY_MISSING_FROM_REGISTRY', message: `A entidade ${id} existe no índice, mas não no registro.`, entityId: id });
    }
  }
  for (const id of registryIds) {
    if (!runtimeIdSet.has(id)) {
      registryCoverage = false;
      issues.push({ severity: 'error', code: 'REGISTRY_ENTITY_MISSING_FROM_RUNTIME_INDEX', message: `A entidade ${id} existe no registro, mas não no índice.`, entityId: id });
    }
  }

  let categoryReferences = true;
  for (const category of bundle.contentCategories.entities) {
    if (category.memberCount !== category.memberEntityIds.length) {
      categoryReferences = false;
      issues.push({ severity: 'error', code: 'CATEGORY_COUNT_MISMATCH', message: `A categoria ${category.id} possui contagem divergente.`, entityId: category.id });
    }
    for (const memberId of category.memberEntityIds) {
      if (!registryIdSet.has(memberId)) {
        categoryReferences = false;
        issues.push({ severity: 'error', code: 'CATEGORY_MEMBER_MISSING', message: `A categoria ${category.id} referencia ${memberId}, que não existe.`, entityId: memberId });
      }
    }
  }

  let dependencyReferences = true;
  for (const edge of bundle.dependencyGraph.edges) {
    if (!registryIdSet.has(edge.fromId) || !registryIdSet.has(edge.toId)) {
      dependencyReferences = false;
      issues.push({ severity: 'error', code: 'DEPENDENCY_ENDPOINT_MISSING', message: `A dependência ${edge.id} possui endpoint inexistente.`, entityId: edge.id });
    }
  }

  let aliasReferences = true;
  for (const alias of bundle.aliases.entities) {
    if (!registryIdSet.has(alias.from) || !registryIdSet.has(alias.to)) {
      aliasReferences = false;
      issues.push({ severity: 'error', code: 'ALIAS_ENDPOINT_MISSING', message: `O alias ${alias.id} possui endpoint inexistente.`, entityId: alias.id });
    }
  }

  if (strictEditorial) {
    for (const entry of bundle.runtimeIndex.entries) {
      if (entry.manualReviewRequired) {
        issues.push({ severity: 'error', code: 'EDITORIAL_REVIEW_REQUIRED', message: `${entry.entityId} ainda exige revisão editorial.`, entityId: entry.entityId });
      }
    }
  }

  const checks = {
    bundleChecksum: checksumStatus,
    versionCoherence,
    counts,
    uniqueEntityIds,
    registryCoverage,
    categoryReferences,
    dependencyReferences,
    aliasReferences
  };
  const passed = Object.values(checks).every((value) => value === true || value === 'notRequested')
    && issues.every((issue) => issue.severity !== 'error');

  return {
    status: passed ? 'passed' : 'failed',
    catalogVersion: bundle.catalogVersion,
    checkedAt,
    checks,
    counts: {
      runtimeEntries: bundle.runtimeIndex.entries.length,
      registryEntries: bundle.entityRegistry.entries.length,
      dependencyEdges: bundle.dependencyGraph.edges.length,
      categories: bundle.contentCategories.entities.length,
      aliases: bundle.aliases.entities.length
    },
    issues
  };
};

const parseBundle = (rawText: string): RuntimeCatalogBundle => {
  try {
    return JSON.parse(rawText) as RuntimeCatalogBundle;
  } catch (error) {
    throw new CatalogError('CATALOG_PARSE_FAILED', 'O bundle de catálogo não contém JSON válido.', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
};

const indexEdges = (edges: readonly DependencyEdge[], direction: 'from' | 'to'): ReadonlyMap<string, readonly DependencyEdge[]> => {
  const result = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    const key = direction === 'from' ? edge.fromId : edge.toId;
    const current = result.get(key) ?? [];
    current.push(edge);
    result.set(key, current);
  }
  return readonlyMap(Array.from(result.entries(), ([key, value]) => [key, Object.freeze(value.slice())] as const));
};

export class CatalogLoader {
  async initializeFromText(rawText: string, options: CatalogLoadOptions = {}): Promise<CatalogSnapshot> {
    const now = options.now ?? (() => new Date());
    let checksumStatus: boolean | 'notRequested' = 'notRequested';
    let bundleSha256: string | undefined;

    if (options.expectedSha256) {
      if (!options.digestAdapter) {
        throw new CatalogError('CATALOG_CHECKSUM_REQUIRED', 'Foi informado um checksum esperado, mas nenhum DigestAdapter foi fornecido.');
      }
      bundleSha256 = normalizeDigest(await options.digestAdapter.sha256(rawText));
      const expected = normalizeDigest(options.expectedSha256);
      checksumStatus = bundleSha256 === expected;
      if (!checksumStatus) {
        throw new CatalogError('CATALOG_CHECKSUM_MISMATCH', 'O checksum SHA-256 do bundle não corresponde ao valor esperado.', {
          expected,
          actual: bundleSha256
        });
      }
    }

    const bundle = parseBundle(rawText);
    return this.initializeFromBundle(bundle, {
      ...(options.strictEditorial === undefined ? {} : { strictEditorial: options.strictEditorial }),
      now,
      ...(bundleSha256 === undefined ? {} : { bundleSha256 }),
      checksumStatus
    });
  }

  initializeFromBundle(
    bundle: RuntimeCatalogBundle,
    options: CatalogLoadOptions & { bundleSha256?: string; checksumStatus?: boolean | 'notRequested' } = {}
  ): CatalogSnapshot {
    const now = options.now ?? (() => new Date());
    if (!supportedSchemaVersions.has(bundle.schemaVersion)) {
      throw new CatalogError('CATALOG_SCHEMA_UNSUPPORTED', `Schema de bundle não suportado: ${bundle.schemaVersion}.`);
    }

    const checkedAt = now().toISOString();
    const validation = buildValidationReport(
      bundle,
      checkedAt,
      options.checksumStatus ?? 'notRequested',
      options.strictEditorial ?? false
    );
    if (validation.status !== 'passed') {
      throw new CatalogError('CATALOG_VALIDATION_FAILED', 'O bundle falhou na validação estrutural.', {
        issueCount: validation.issues.length,
        issues: validation.issues.slice(0, 50)
      });
    }

    const registry = readonlyMap(bundle.entityRegistry.entries.map((entry) => [entry.entityId, deepFreeze({ ...entry })] as const));
    const entryById = readonlyMap(bundle.runtimeIndex.entries.map((entry) => [entry.entityId, deepFreeze({ ...entry })] as const));
    const categoryById = readonlyMap(bundle.contentCategories.entities.map((category) => [category.id, deepFreeze({ ...category })] as const));
    const aliases = readonlyMap(bundle.aliases.entities.map((alias: AliasEquivalence) => [alias.from, deepFreeze({ ...alias })] as const));
    const snapshotSeed = stableStringify({
      catalogVersion: bundle.catalogVersion,
      bundleSha256: options.bundleSha256 ?? null,
      runtimeEntries: bundle.runtimeIndex.entryCount,
      dependencyEdges: bundle.dependencyGraph.edgeCount
    });
    const snapshotId = `catalog-${bundle.catalogVersion}-${simpleStableHash(snapshotSeed)}`;

    const snapshot: CatalogSnapshot = {
      snapshotId,
      catalogVersion: bundle.catalogVersion,
      loadedAt: checkedAt,
      ...(options.bundleSha256 === undefined ? {} : { bundleSha256: options.bundleSha256 }),
      manifest: deepFreeze({ ...bundle.manifest }),
      entries: Object.freeze(bundle.runtimeIndex.entries.map((entry) => entryById.get(entry.entityId)!)),
      registry,
      entryById,
      categories: Object.freeze(bundle.contentCategories.entities.map((category) => categoryById.get(category.id)!)),
      categoryById,
      dependenciesFrom: indexEdges(bundle.dependencyGraph.edges, 'from'),
      dependenciesTo: indexEdges(bundle.dependencyGraph.edges, 'to'),
      aliases,
      filterPolicy: deepFreeze({ ...bundle.contentFilterPolicy }),
      readinessProfile: deepFreeze({ ...bundle.readinessProfile }),
      validation: deepFreeze(validation)
    };
    return Object.freeze(snapshot);
  }
}

const simpleStableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
