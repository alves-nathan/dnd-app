import type { Character, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  applyAutomaticClassProgression,
  findCompendiumItemByReference,
  getCompendiumClassReference,
  getProgressionFeatureReferences,
  getInferredSubclassProgressionBindings,
  getSubclassUnlockLevel,
  isChoiceProgressionFeature,
  isProgressionOwnedFeatureItem
} from '../compendium/classProgression';
import {
  findCompendiumItemForCharacterLink,
  sameLogicalCompendiumItem
} from '../compendium/characterLinkIdentity';

export interface ProgressionReconciliationResult {
  character: Character;
  removedSubclassCount: number;
  removedFeatureCount: number;
  removedResourceCount: number;
  appliedFeatureCount: number;
  issues: RuleValidationIssue[];
}

const activeLinks = (character: Character, appliedAs: string) =>
  (character.compendiumLinks ?? []).filter(
    (link) => link.appliedAs === appliedAs && link.status === 'active'
  );

export const reconcileCharacterProgression = (
  character: Character,
  items: StoredCompendiumItem[]
): ProgressionReconciliationResult => {
  let next = character;
  const issues: RuleValidationIssue[] = [];
  const classLinks = activeLinks(next, 'class');
  const classBindings = classLinks
    .map((link) => ({
      link,
      item: findCompendiumItemForCharacterLink(items, link),
      entity: next.classes.find((entry) => entry.id === link.appliedEntityId)
    }))
    .filter((entry) => Boolean(entry.item && entry.entity));

  const allowedFeatureItemIds = new Set<string>();
  for (const binding of classBindings) {
    for (const reference of getProgressionFeatureReferences(binding.item!, binding.entity!.level)) {
      const feature = findCompendiumItemByReference(items, reference);
      if (feature && feature.type === 'feature' && !isChoiceProgressionFeature(feature)) {
        allowedFeatureItemIds.add(feature.id);
      }
    }
  }

  const invalidSubclassEntityIds = new Set<string>();
  const validSubclassLinks = activeLinks(next, 'subclass').filter((link) => {
    const subclassItem = findCompendiumItemForCharacterLink(items, link);
    const subclassEntity = next.subclasses.find((entry) => entry.id === link.appliedEntityId);
    if (!subclassItem || !subclassEntity) {
      invalidSubclassEntityIds.add(link.appliedEntityId);
      return false;
    }
    const classReference = getCompendiumClassReference(subclassItem);
    const referencedClassItem = classReference
      ? findCompendiumItemByReference(items, classReference)
      : undefined;
    const classBinding = classBindings.find(({ item: classItem }) =>
      Boolean(
        classItem &&
        referencedClassItem &&
        sameLogicalCompendiumItem(classItem, referencedClassItem)
      )
    );
    if (!classBinding?.entity || classBinding.entity.level < getSubclassUnlockLevel(subclassItem)) {
      invalidSubclassEntityIds.add(subclassEntity.id);
      return false;
    }
    for (const reference of getProgressionFeatureReferences(subclassItem, classBinding.entity.level)) {
      const feature = findCompendiumItemByReference(items, reference);
      if (feature && feature.type === 'feature' && !isChoiceProgressionFeature(feature)) {
        allowedFeatureItemIds.add(feature.id);
      }
    }
    return true;
  });

  for (const binding of getInferredSubclassProgressionBindings(next, items)) {
    for (const reference of getProgressionFeatureReferences(binding.subclassItem, binding.classLevel)) {
      const feature = findCompendiumItemByReference(items, reference);
      if (feature && feature.type === 'feature' && !isChoiceProgressionFeature(feature)) {
        allowedFeatureItemIds.add(feature.id);
      }
    }
  }

  if (invalidSubclassEntityIds.size) {
    next = {
      ...next,
      subclasses: next.subclasses.filter((entry) => !invalidSubclassEntityIds.has(entry.id)),
      compendiumLinks: (next.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'subclass' && invalidSubclassEntityIds.has(link.appliedEntityId) && link.status === 'active'
          ? { ...link, status: 'removed' as const }
          : link
      )
    };
  }

  const featureLinksToRemove = activeLinks(next, 'feature').filter((link) => {
    const item = findCompendiumItemForCharacterLink(items, link);
    return Boolean(item && isProgressionOwnedFeatureItem(item, items) && !allowedFeatureItemIds.has(item.id));
  });
  const removedFeatureEntityIds = new Set(featureLinksToRemove.map((link) => link.appliedEntityId));
  const removedResourceIds = new Set(
    next.features
      .filter((feature) => removedFeatureEntityIds.has(feature.id))
      .map((feature) => feature.resource?.id)
      .filter((id): id is string => Boolean(id))
  );

  if (removedFeatureEntityIds.size) {
    next = {
      ...next,
      features: next.features.filter((feature) => !removedFeatureEntityIds.has(feature.id)),
      resources: next.resources.filter((resource) => !removedResourceIds.has(resource.id)),
      compendiumLinks: (next.compendiumLinks ?? []).map((link) =>
        link.appliedAs === 'feature' && removedFeatureEntityIds.has(link.appliedEntityId) && link.status === 'active'
          ? { ...link, status: 'removed' as const }
          : link
      )
    };
  }

  const automatic = applyAutomaticClassProgression(next, items);
  next = automatic.character;
  issues.push(...automatic.issues);

  if (invalidSubclassEntityIds.size) {
    issues.push({
      severity: 'warning',
      code: 'SUBCLASS_REMOVED_BY_LEVEL_RECONCILIATION',
      message: `${invalidSubclassEntityIds.size} subclasse(s) foi/foram removida(s) porque a classe-base não atende mais ao nível exigido.`
    });
  }
  if (removedFeatureEntityIds.size) {
    issues.push({
      severity: 'warning',
      code: 'FEATURES_REMOVED_BY_LEVEL_RECONCILIATION',
      message: `${removedFeatureEntityIds.size} feature(s) de progressão foi/foram removida(s) após a alteração de níveis.`
    });
  }

  // Prevent an unused local variable from hiding a future logic regression.
  void validSubclassLinks;

  return {
    character: next,
    removedSubclassCount: invalidSubclassEntityIds.size,
    removedFeatureCount: removedFeatureEntityIds.size,
    removedResourceCount: removedResourceIds.size,
    appliedFeatureCount: automatic.appliedItems.length,
    issues
  };
};
