import { CatalogError } from './errors';
import type {
  CatalogFilterState,
  CatalogSnapshot,
  EntityAvailability,
  FilterImpactReport,
  RuntimeCatalogEntry
} from './types';

const defaultBookStates = (snapshot: CatalogSnapshot): Record<string, boolean> => Object.fromEntries(
  snapshot.manifest.sourceBooks.map((bookId) => [bookId, true])
);

export class ContentPolicyService {
  constructor(private readonly snapshot: CatalogSnapshot) {}

  createDefaultState(profileId = 'full-official'): CatalogFilterState {
    const profile = this.snapshot.filterPolicy.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new CatalogError('CATALOG_PROFILE_NOT_FOUND', `Perfil de conteúdo não encontrado: ${profileId}.`);
    return {
      bookStates: { ...defaultBookStates(this.snapshot), ...profile.bookStates },
      categoryStates: {},
      entityStates: {}
    };
  }

  evaluate(entryOrId: RuntimeCatalogEntry | string, state: CatalogFilterState): EntityAvailability {
    const entry = typeof entryOrId === 'string' ? this.snapshot.entryById.get(entryOrId) : entryOrId;
    if (!entry) throw new CatalogError('CATALOG_ENTITY_NOT_FOUND', `Entidade não encontrada: ${String(entryOrId)}.`);

    const sourceBookEnabled = entry.sourceBookId === null || (state.bookStates[entry.sourceBookId] ?? true);
    if (!sourceBookEnabled) return this.result(entry, false, 'sourceBookDisabled');

    const categories = entry.categoryIds
      .map((categoryId) => this.snapshot.categoryById.get(categoryId))
      .filter((category) => category !== undefined);
    const protectedByCategory = categories.some((category) => category.canDisable === false);
    if (protectedByCategory) return this.result(entry, true, 'protectedEntity');

    const explicitState = state.entityStates[entry.entityId] ?? 'inherit';
    if (explicitState === 'disabled') return this.result(entry, false, 'explicitEntityDisabled');
    if (explicitState === 'enabled') return this.result(entry, true, 'explicitEntityEnabled');

    const explicitCategoryState = entry.categoryIds
      .map((categoryId) => state.categoryStates[categoryId])
      .find((value) => value !== undefined);
    if (explicitCategoryState === false) return this.result(entry, false, 'categoryDisabled');
    if (explicitCategoryState === true) return this.result(entry, true, 'categoryEnabled');

    const categoryDefault = categories.map((category) => category.defaultEnabled).find((value) => value !== undefined);
    const defaultEnabled = entry.defaultEnabled ?? categoryDefault ?? true;
    return this.result(entry, defaultEnabled, defaultEnabled ? 'entityDefaultEnabled' : 'entityDefaultDisabled');
  }

  isEnabled(entityId: string, state: CatalogFilterState): boolean {
    return this.evaluate(entityId, state).enabled;
  }

  previewImpact(before: CatalogFilterState, after: CatalogFilterState): FilterImpactReport {
    const disabledEntityIds: string[] = [];
    const enabledEntityIds: string[] = [];
    let beforeEnabled = 0;
    let afterEnabled = 0;

    for (const entry of this.snapshot.entries) {
      const wasEnabled = this.evaluate(entry, before).enabled;
      const isEnabled = this.evaluate(entry, after).enabled;
      if (wasEnabled) beforeEnabled += 1;
      if (isEnabled) afterEnabled += 1;
      if (wasEnabled && !isEnabled) disabledEntityIds.push(entry.entityId);
      if (!wasEnabled && isEnabled) enabledEntityIds.push(entry.entityId);
    }

    const hardDependencyBreaks: FilterImpactReport['hardDependencyBreaks'] = [];
    for (const fromId of this.snapshot.entryById.keys()) {
      if (!this.isEnabled(fromId, after)) continue;
      for (const edge of this.snapshot.dependenciesFrom.get(fromId) ?? []) {
        const requiresEnabled = edge.resolutionPolicy === 'requireEnabled'
          || edge.strength === 'hard'
          || edge.strength === 'ownership';
        if (requiresEnabled && !this.isEnabled(edge.toId, after)) {
          hardDependencyBreaks.push({
            fromId: edge.fromId,
            toId: edge.toId,
            relation: edge.relation,
            resolutionPolicy: edge.resolutionPolicy
          });
        }
      }
    }

    return { beforeEnabled, afterEnabled, disabledEntityIds, enabledEntityIds, hardDependencyBreaks };
  }

  private result(entry: RuntimeCatalogEntry, enabled: boolean, reason: EntityAvailability['reason']): EntityAvailability {
    return {
      entityId: entry.entityId,
      enabled,
      reason,
      sourceBookId: entry.sourceBookId,
      categoryIds: entry.categoryIds.slice()
    };
  }
}
