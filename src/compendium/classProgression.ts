import type {
  Character,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from './types';
import { applyCompendiumItemToCharacter } from './mapper';

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

export const findCompendiumItemByReference = (
  items: StoredCompendiumItem[],
  reference: string
): StoredCompendiumItem | undefined =>
  items.find(
    (item) =>
      item.id === reference ||
      item.importItemId === reference ||
      rawImportId(item) === reference
  );

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
    const classItem = items.find(
      (item) => item.id === link.itemId
    );

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
    const subclassItem = items.find(
      (item) => item.id === link.itemId
    );

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

    const matchingClassLink = classLinks.find(
      (classLink) =>
        classLink.itemId === classReference ||
        classLink.importItemId === classReference
    );

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
    ).some(
      (link) =>
        link.itemId === featureItem.id &&
        link.status === 'active'
    );

    if (alreadyLinked) continue;

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

    if (featureItem.status !== 'validated') {
      issues.push(
        warning(
          'PROGRESSION_FEATURE_NOT_VALIDATED',
          `A feature "${featureItem.name}" ainda está como ${featureItem.status}.`
        )
      );
      continue;
    }

    const result =
      applyCompendiumItemToCharacter(
        next,
        featureItem
      );

    if (result.ok) {
      next = result.character;
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
