import type {
  Character,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from './types';
import { applyCompendiumItemToCharacter } from './mapper';
import { prepareAutomaticFeatureForCharacter, reconcileAutomaticFeatureResourceUpdates } from './automaticFeatureApplication';
import {
  characterLinkMatchesCompendiumItem,
  findCompendiumItemByReference,
  findCompendiumItemForCharacterLink,
  sameLogicalCompendiumItem,
  uniqueLogicalCompendiumItems
} from './characterLinkIdentity';

export { findCompendiumItemByReference } from './characterLinkIdentity';

const asRecord = (
  value: unknown
): Record<string, unknown> =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (
  value: unknown
): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;

const asNumber = (
  value: unknown
): number | undefined =>
  typeof value === 'number' &&
  Number.isFinite(value)
    ? value
    : undefined;

const asStringArray = (
  value: unknown
): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' &&
          Boolean(entry.trim())
      )
    : [];

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const unique = (values: string[]): string[] =>
  Array.from(new Set(values));

const rawImportId = (
  item: StoredCompendiumItem
): string | undefined =>
  asString(asRecord(item.rawJson).id);

export const getCompendiumClassReference = (
  item: StoredCompendiumItem
): string | undefined => {
  const payload = asRecord(item.normalizedJson);

  return (
    asString(payload.classId) ??
    asString(payload.classRef) ??
    asString(payload.baseClassId)
  );
};

export const getSubclassUnlockLevel = (
  item: StoredCompendiumItem
): number => {
  const payload = asRecord(item.normalizedJson);

  const progressionLevels = (
    Array.isArray(payload.progression)
      ? payload.progression
      : []
  )
    .map((entry) =>
      asNumber(asRecord(entry).level)
    )
    .filter(
      (level): level is number =>
        level !== undefined && level > 0
    );

  if (progressionLevels.length) {
    return Math.min(...progressionLevels);
  }

  return (
    asNumber(payload.level) ??
    asNumber(payload.subclassLevel) ??
    3
  );
};

export const getProgressionFeatureReferences = (
  item: StoredCompendiumItem,
  attainedLevel: number
): string[] => {
  const payload = asRecord(item.normalizedJson);

  const progression = Array.isArray(
    payload.progression
  )
    ? payload.progression
    : [];

  if (progression.length) {
    return unique(
      progression.flatMap((entry) => {
        const record = asRecord(entry);
        const level = asNumber(record.level);

        if (
          level === undefined ||
          level > attainedLevel
        ) {
          return [];
        }

        return asStringArray(record.featureIds);
      })
    );
  }

  return asStringArray(payload.featureIds);
};

export const collectProgressionOwnedFeatureReferences = (
  items: StoredCompendiumItem[]
): Set<string> => {
  const references = new Set<string>();

  for (const owner of items) {
    if (
      owner.type !== 'class' &&
      owner.type !== 'subclass'
    ) {
      continue;
    }

    const payload = asRecord(owner.normalizedJson);

    for (const id of asStringArray(
      payload.featureIds
    )) {
      references.add(id);
    }

    if (Array.isArray(payload.progression)) {
      for (const entry of payload.progression) {
        for (const id of asStringArray(
          asRecord(entry).featureIds
        )) {
          references.add(id);
        }
      }
    }
  }

  return references;
};

export const isProgressionOwnedFeatureItem = (
  item: StoredCompendiumItem,
  allItems: StoredCompendiumItem[]
): boolean => {
  if (item.type !== 'feature') return false;

  const payload = asRecord(item.normalizedJson);

  if (normalizeName(asString(payload.sourceType) ?? '') === 'eldritchinvocation') {
    return false;
  }

  if (
    asString(payload.classId) ||
    asString(payload.subclassId) ||
    asString(payload.ownerClassId) ||
    asString(payload.ownerSubclassId)
  ) {
    return true;
  }

  const references =
    collectProgressionOwnedFeatureReferences(
      allItems
    );

  return [
    item.id,
    item.importItemId,
    rawImportId(item)
  ].some(
    (candidate) =>
      Boolean(candidate) &&
      references.has(candidate as string)
  );
};

export const isChoiceProgressionFeature = (
  item: StoredCompendiumItem
): boolean => {
  const payload = asRecord(item.normalizedJson);
  const normalizedName = normalizeName(item.name);

  return (
    payload.featChoice === true ||
    payload.requiresChoice === true ||
    payload.choiceRequired === true ||
    payload.choose === true ||
    typeof payload.choiceType === 'string' ||
    Array.isArray(payload.choices) ||
    Array.isArray(payload.options) ||
    typeof payload.featCategory === 'string' ||
    normalizedName === 'ability score improvement' ||
    normalizedName === 'fighting style' ||
    normalizedName === 'epic boon'
  );
};

export interface ApplyAutomaticClassProgressionResult {
  character: Character;
  appliedItems: StoredCompendiumItem[];
  choiceItems: StoredCompendiumItem[];
  issues: RuleValidationIssue[];
}

const warning = (
  code: string,
  message: string
): RuleValidationIssue => ({
  severity: 'warning',
  code,
  message
});

const activeLinksByType = (
  character: Character,
  type: 'class' | 'subclass'
) =>
  (character.compendiumLinks ?? []).filter(
    (link) =>
      link.appliedAs === type &&
      link.status === 'active'
  );

export interface InferredSubclassProgressionBinding {
  subclassEntityId: string;
  classEntityId: string;
  subclassItem: StoredCompendiumItem;
  classLevel: number;
}

/**
 * Older character snapshots can retain subclass state in more than one
 * partially migrated shape. Recover only when the stored identity and the
 * owning base class make the selection unambiguous.
 */
export const getInferredSubclassProgressionBindings = (
  character: Character,
  items: StoredCompendiumItem[]
): InferredSubclassProgressionBinding[] => {
  const classLinks = activeLinksByType(character, 'class');
  const activeSubclassLinks = activeLinksByType(character, 'subclass');
  const allSubclassLinks = (character.compendiumLinks ?? []).filter(
    (link) => link.appliedAs === 'subclass'
  );

  const classBindings = classLinks.flatMap((link) => {
    const classEntity = character.classes.find(
      (entry) => entry.id === link.appliedEntityId
    );
    const classItem = findCompendiumItemForCharacterLink(items, link);

    return classEntity && classItem
      ? [{ classEntity, classItem }]
      : [];
  });

  const findOwningClassBinding = (
    subclassItem: StoredCompendiumItem
  ) => {
    const classReference =
      getCompendiumClassReference(subclassItem);
    const ownerClassItem = classReference
      ? findCompendiumItemByReference(items, classReference)
      : undefined;

    if (ownerClassItem) {
      const exact = classBindings.find(({ classItem }) =>
        sameLogicalCompendiumItem(
          classItem,
          ownerClassItem
        )
      );
      if (exact) return exact;
    }

    return !classReference && classBindings.length === 1
      ? classBindings[0]
      : undefined;
  };

  const inferredFromEntities = character.subclasses.flatMap((subclassEntity) => {
    const classEntity =
      character.classes.find(
        (entry) => entry.id === subclassEntity.classId
      ) ??
      (character.classes.length === 1
        ? character.classes[0]
        : undefined);
    if (!classEntity) return [];

    const classBinding = classBindings.find(
      ({ classEntity: candidate }) =>
        candidate.id === classEntity.id
    );
    const classItem = classBinding?.classItem;

    const activeLink = activeSubclassLinks.find(
      (link) => link.appliedEntityId === subclassEntity.id
    );
    if (activeLink) {
      const linkedSubclassItem = findCompendiumItemForCharacterLink(
        items,
        activeLink
      );
      const linkedOwner = linkedSubclassItem
        ? findOwningClassBinding(linkedSubclassItem)
        : undefined;

      // An active link is authoritative only when it still resolves to the
      // same subclass identity and owning class. Old persisted item IDs can
      // become stale across import/catalog migrations.
      if (
        linkedSubclassItem &&
        linkedSubclassItem.type === 'subclass' &&
        linkedSubclassItem.status !== 'disabled' &&
        normalizeName(linkedSubclassItem.name) ===
          normalizeName(subclassEntity.name) &&
        linkedOwner?.classEntity.id === classEntity.id
      ) {
        return [];
      }
    }

    const candidates = uniqueLogicalCompendiumItems(
      items.filter((item) => {
        if (
          item.type !== 'subclass' ||
          item.status === 'disabled'
        ) return false;
        if (
          normalizeName(item.name) !==
          normalizeName(subclassEntity.name)
        ) return false;

        const classReference =
          getCompendiumClassReference(item);
        if (!classReference || !classItem) {
          return character.classes.length === 1;
        }
        const owner =
          findCompendiumItemByReference(
            items,
            classReference
          );
        return Boolean(
          owner &&
          sameLogicalCompendiumItem(
            owner,
            classItem
          )
        );
      })
    );

    if (candidates.length !== 1) return [];
    const subclassItem = candidates[0]!;
    if (
      classEntity.level <
      getSubclassUnlockLevel(subclassItem)
    ) return [];

    return [{
      subclassEntityId: subclassEntity.id,
      classEntityId: classEntity.id,
      subclassItem,
      classLevel: classEntity.level
    }];
  });

  const entityBoundClassIds = new Set(
    character.subclasses.map(
      (entry) => entry.classId
    )
  );

  const orphanLinkCandidates = allSubclassLinks.flatMap((link) => {
    if (
      link.status !== 'active' &&
      link.status !== 'removed'
    ) return [];
    if (character.subclasses.some(
      (entry) => entry.id === link.appliedEntityId
    )) return [];

    let subclassItem = findCompendiumItemForCharacterLink(items, link);

    // Some older links persisted only an obsolete carrier ID. If the human
    // identity survived, recover by exact subclass name plus owning class.
    if (
      (!subclassItem || subclassItem.type !== 'subclass') &&
      link.appliedEntityName
    ) {
      const namedCandidates = uniqueLogicalCompendiumItems(
        items.filter((item) =>
          item.type === 'subclass' &&
          item.status !== 'disabled' &&
          normalizeName(item.name) ===
            normalizeName(link.appliedEntityName) &&
          Boolean(findOwningClassBinding(item))
        )
      );
      if (namedCandidates.length === 1) {
        subclassItem = namedCandidates[0];
      }
    }

    if (
      !subclassItem ||
      subclassItem.type !== 'subclass' ||
      subclassItem.status === 'disabled'
    ) return [];

    const classBinding =
      findOwningClassBinding(subclassItem);
    if (!classBinding) return [];
    if (entityBoundClassIds.has(
      classBinding.classEntity.id
    )) return [];
    if (
      classBinding.classEntity.level <
      getSubclassUnlockLevel(subclassItem)
    ) return [];

    return [{
      status: link.status,
      binding: {
        subclassEntityId: link.appliedEntityId,
        classEntityId: classBinding.classEntity.id,
        subclassItem,
        classLevel: classBinding.classEntity.level
      } satisfies InferredSubclassProgressionBinding
    }];
  });

  const inferredFromOrphanLinks: InferredSubclassProgressionBinding[] = [];
  for (const classBinding of classBindings) {
    const forClass = orphanLinkCandidates.filter(
      ({ binding }) =>
        binding.classEntityId ===
        classBinding.classEntity.id
    );
    const active = forClass.filter(
      ({ status }) => status === 'active'
    );
    const preferred = active.length ? active : forClass;
    const candidates = uniqueLogicalCompendiumItems(
      preferred.map(
        ({ binding }) => binding.subclassItem
      )
    );

    // Do not guess if history contains genuinely different subclass
    // selections for the same class.
    if (candidates.length !== 1) continue;
    const subclassItem = candidates[0]!;
    const match = preferred.find(
      ({ binding }) =>
        sameLogicalCompendiumItem(
          binding.subclassItem,
          subclassItem
        )
    );
    if (match) {
      inferredFromOrphanLinks.push(match.binding);
    }
  }

  const entityRecoveredClassIds = new Set(
    inferredFromEntities.map(
      (binding) => binding.classEntityId
    )
  );

  return [
    ...inferredFromEntities,
    ...inferredFromOrphanLinks.filter(
      (binding) =>
        !entityRecoveredClassIds.has(
          binding.classEntityId
        )
    )
  ];
};

export const applyAutomaticClassProgression = (
  character: Character,
  items: StoredCompendiumItem[]
): ApplyAutomaticClassProgressionResult => {
  let next = character;

  const requestedReferences: string[] = [];
  const issues: RuleValidationIssue[] = [];

  const classLinks = activeLinksByType(
    next,
    'class'
  );

  for (const link of classLinks) {
    const classItem = findCompendiumItemForCharacterLink(items, link);

    const characterClass = next.classes.find(
      (entry) =>
        entry.id === link.appliedEntityId
    );

    if (!classItem || !characterClass) {
      issues.push(
        warning(
          'CLASS_PROGRESSION_OWNER_MISSING',
          `Não foi possível resolver a classe vinculada ${link.appliedEntityName}.`
        )
      );
      continue;
    }

    requestedReferences.push(
      ...getProgressionFeatureReferences(
        classItem,
        characterClass.level
      )
    );
  }

  const subclassLinks = activeLinksByType(
    next,
    'subclass'
  );

  for (const link of subclassLinks) {
    const subclassItem = findCompendiumItemForCharacterLink(items, link);

    if (!subclassItem) {
      issues.push(
        warning(
          'SUBCLASS_PROGRESSION_OWNER_MISSING',
          `Não foi possível resolver a subclasse vinculada ${link.appliedEntityName}.`
        )
      );
      continue;
    }

    const classReference =
      getCompendiumClassReference(subclassItem);

    const referencedClassItem = classReference
      ? findCompendiumItemByReference(items, classReference)
      : undefined;
    const matchingClassLink = classLinks.find((classLink) => {
      const linkedClassItem = findCompendiumItemForCharacterLink(items, classLink);
      if (referencedClassItem && linkedClassItem) {
        return sameLogicalCompendiumItem(
          linkedClassItem,
          referencedClassItem
        );
      }
      return (
        classLink.itemId === classReference ||
        classLink.importItemId === classReference
      );
    });

    const matchingClass =
      matchingClassLink
        ? next.classes.find(
            (entry) =>
              entry.id ===
              matchingClassLink.appliedEntityId
          )
        : next.classes.length === 1
          ? next.classes[0]
          : undefined;

    if (!matchingClass) {
      issues.push(
        warning(
          'SUBCLASS_BASE_CLASS_MISSING',
          `A classe-base da subclasse ${subclassItem.name} não foi encontrada na ficha.`
        )
      );
      continue;
    }

    requestedReferences.push(
      ...getProgressionFeatureReferences(
        subclassItem,
        matchingClass.level
      )
    );
  }

  for (const binding of getInferredSubclassProgressionBindings(next, items)) {
    const links = next.compendiumLinks ?? [];
    const historicalLinkIndex =
      links.findIndex(
        (link) =>
          link.appliedAs === 'subclass' &&
          link.appliedEntityId ===
            binding.subclassEntityId
      );

    const recoveredLink = {
      id: `recovered-subclass-link:${binding.subclassEntityId}:${binding.subclassItem.id}`,
      characterId: next.id,
      itemId: binding.subclassItem.id,
      importItemId: binding.subclassItem.importItemId,
      packId: binding.subclassItem.packId,
      sourceId: binding.subclassItem.sourceId,
      itemType: 'subclass' as const,
      appliedAs: 'subclass' as const,
      appliedEntityId: binding.subclassEntityId,
      appliedEntityName: binding.subclassItem.name,
      status: 'active' as const,
      addedAt: new Date().toISOString(),
      origin: 'compendium' as const,
      choiceId: binding.subclassItem.id,
      manualReviewRequired:
        binding.subclassItem.status !== 'validated',
      notes: 'recovered-subclass-link'
    };

    const compendiumLinks =
      historicalLinkIndex >= 0
        ? links.map((link, index) =>
            index === historicalLinkIndex
              ? {
                  ...link,
                  itemId: binding.subclassItem.id,
                  importItemId:
                    binding.subclassItem.importItemId,
                  packId: binding.subclassItem.packId,
                  sourceId: binding.subclassItem.sourceId,
                  itemType: 'subclass' as const,
                  appliedAs: 'subclass' as const,
                  appliedEntityId:
                    binding.subclassEntityId,
                  appliedEntityName:
                    binding.subclassItem.name,
                  status: 'active' as const,
                  origin: 'compendium' as const,
                  choiceId: binding.subclassItem.id,
                  manualReviewRequired:
                    binding.subclassItem.status !==
                    'validated',
                  notes: [
                    link.notes,
                    'recovered-subclass-link'
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }
              : link
          )
        : [...links, recoveredLink];

    const hasSubclassEntity =
      next.subclasses.some(
        (entry) =>
          entry.id === binding.subclassEntityId
      );

    next = {
      ...next,
      subclasses: hasSubclassEntity
        ? next.subclasses
        : [
            ...next.subclasses,
            {
              id: binding.subclassEntityId,
              classId: binding.classEntityId,
              name: binding.subclassItem.name,
              source: binding.subclassItem.rawJson.source
            }
          ],
      compendiumLinks
    };

    requestedReferences.push(
      ...getProgressionFeatureReferences(
        binding.subclassItem,
        binding.classLevel
      )
    );
  }

  const appliedItems: StoredCompendiumItem[] = [];
  const choiceItemsByName = new Map<
    string,
    StoredCompendiumItem
  >();

  for (const reference of unique(
    requestedReferences
  )) {
    const featureItem =
      findCompendiumItemByReference(
        items,
        reference
      );

    if (!featureItem) {
      issues.push(
        warning(
          'PROGRESSION_FEATURE_NOT_FOUND',
          `Feature de progressão não encontrada: ${reference}.`
        )
      );
      continue;
    }

    if (featureItem.type !== 'feature') {
      issues.push(
        warning(
          'PROGRESSION_REFERENCE_NOT_FEATURE',
          `A referência ${reference} aponta para ${featureItem.type}, não para feature.`
        )
      );
      continue;
    }

    const alreadyLinked = (
      next.compendiumLinks ?? []
    ).some((link) =>
      link.status === 'active' &&
      characterLinkMatchesCompendiumItem(items, link, featureItem)
    );

    if (alreadyLinked) {
      next = reconcileAutomaticFeatureResourceUpdates(next, featureItem);
      continue;
    }

    if (isChoiceProgressionFeature(featureItem)) {
      const key = normalizeName(featureItem.name);

      if (!choiceItemsByName.has(key)) {
        choiceItemsByName.set(
          key,
          featureItem
        );
      }

      continue;
    }

    if (featureItem.status === 'disabled') {
      issues.push(
        warning(
          'PROGRESSION_FEATURE_DISABLED',
          `A feature automática "${featureItem.name}" está desabilitada no Compêndio.`
        )
      );
      continue;
    }

    const result =
      applyCompendiumItemToCharacter(
        next,
        prepareAutomaticFeatureForCharacter(featureItem)
      );

    if (result.ok) {
      next = reconcileAutomaticFeatureResourceUpdates(result.character, featureItem);
      appliedItems.push(featureItem);
    } else {
      issues.push(...result.issues);
    }
  }

  return {
    character: next,
    appliedItems,
    choiceItems: Array.from(
      choiceItemsByName.values()
    ),
    issues
  };
};
