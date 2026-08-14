import { CatalogError } from './errors';
import { ContentPolicyService } from './contentPolicyService';
import type {
  AliasEquivalence,
  CatalogFilterState,
  CatalogSearchRequest,
  CatalogSnapshot,
  DependencyEdge,
  RuntimeCatalogEntry
} from './types';
import { normalizeSearchText } from './utils';

export class CatalogQueryService {
  private readonly policy: ContentPolicyService;

  constructor(private readonly snapshot: CatalogSnapshot) {
    this.policy = new ContentPolicyService(snapshot);
  }

  getById(entityId: string): RuntimeCatalogEntry {
    const entry = this.snapshot.entryById.get(entityId);
    if (!entry) throw new CatalogError('CATALOG_ENTITY_NOT_FOUND', `Entidade não encontrada: ${entityId}.`);
    return entry;
  }

  tryGetById(entityId: string): RuntimeCatalogEntry | undefined {
    return this.snapshot.entryById.get(entityId);
  }

  resolveAlias(entityId: string, maxDepth = 16): { entityId: string; chain: AliasEquivalence[] } {
    const chain: AliasEquivalence[] = [];
    const visited = new Set<string>();
    let current = entityId;
    while (chain.length < maxDepth) {
      if (visited.has(current)) break;
      visited.add(current);
      const alias = this.snapshot.aliases.get(current);
      if (!alias || alias.status !== 'active') break;
      chain.push(alias);
      current = alias.to;
    }
    return { entityId: current, chain };
  }

  search(request: CatalogSearchRequest = {}, filterState?: CatalogFilterState): RuntimeCatalogEntry[] {
    const text = normalizeSearchText(request.text ?? '');
    const tokens = text.split(' ').filter(Boolean);
    const kindSet = request.kinds?.length ? new Set(request.kinds) : undefined;
    const bookSet = request.sourceBookIds?.length ? new Set(request.sourceBookIds) : undefined;
    const categorySet = request.categoryIds?.length ? new Set(request.categoryIds) : undefined;
    const limit = Math.max(1, request.limit ?? 100);

    const scored: Array<{ entry: RuntimeCatalogEntry; score: number }> = [];
    for (const entry of this.snapshot.entries) {
      if (kindSet && !kindSet.has(entry.kind)) continue;
      if (bookSet && (!entry.sourceBookId || !bookSet.has(entry.sourceBookId))) continue;
      if (categorySet && !entry.categoryIds.some((categoryId) => categorySet.has(categoryId))) continue;
      if (request.includeManualReview === false && entry.manualReviewRequired) continue;
      if (request.enabledOnly && filterState && !this.policy.isEnabled(entry.entityId, filterState)) continue;

      const haystack = normalizeSearchText(entry.searchKey || `${entry.displayName} ${entry.entityId} ${entry.kind}`);
      if (tokens.length && !tokens.every((token) => haystack.includes(token))) continue;
      const exactName = text.length > 0 && normalizeSearchText(entry.displayName) === text;
      const startsName = text.length > 0 && normalizeSearchText(entry.displayName).startsWith(text);
      const score = exactName ? 1000 : startsName ? 500 : tokens.reduce((sum, token) => sum + (haystack.indexOf(token) === 0 ? 50 : 10), 0);
      scored.push({ entry, score });
    }

    return scored
      .sort((left, right) => right.score - left.score || left.entry.displayName.localeCompare(right.entry.displayName))
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  dependenciesOf(entityId: string): readonly DependencyEdge[] {
    return this.snapshot.dependenciesFrom.get(entityId) ?? [];
  }

  dependentsOf(entityId: string): readonly DependencyEdge[] {
    return this.snapshot.dependenciesTo.get(entityId) ?? [];
  }
}
