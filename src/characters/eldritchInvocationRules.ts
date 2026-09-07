import type { Character, CharacterEldritchInvocationChoice, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { findCompendiumItemByReference } from '../compendium/classProgression';
import { withBuiltinEldritchInvocations } from './eldritchInvocationCatalog';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asNumberArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : [];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const issue = (code: string, message: string): RuleValidationIssue => ({
  severity: 'error',
  code,
  message
});

const DEFAULT_INVOCATIONS_KNOWN_BY_LEVEL = [
  1, 3, 3, 3, 5, 5, 6, 6, 7, 7,
  7, 8, 8, 8, 9, 9, 9, 10, 10, 10
];

export interface CharacterClassSelectionEntry {
  item: StoredCompendiumItem;
  level: number;
}

export const isWarlockClassItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'class') return false;
  const payload = asRecord(item.normalizedJson);
  const engineKey = normalize(asString(payload.engineKey) ?? '');
  return normalize(item.name) === 'warlock'
    || normalize(item.importItemId).endsWith('class-warlock')
    || engineKey === 'class.warlock';
};

export const getSelectedWarlockLevel = (
  classEntries: CharacterClassSelectionEntry[]
): number => classEntries
  .filter(({ item }) => isWarlockClassItem(item))
  .reduce((sum, { level }) => sum + Math.max(0, Math.floor(level)), 0);

export const isEldritchInvocationItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'feature') return false;
  const payload = asRecord(item.normalizedJson);
  return normalize(asString(payload.sourceType) ?? '') === 'eldritchinvocation';
};

export const isEldritchInvocationRepeatable = (item: StoredCompendiumItem): boolean =>
  asRecord(item.normalizedJson).repeatable === true;

const findInvocationProgressionFeature = (
  warlockClassItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[]
): StoredCompendiumItem | undefined => {
  if (!warlockClassItem) return undefined;
  const payload = asRecord(warlockClassItem.normalizedJson);
  const references = [
    ...asStringArray(payload.featureIds),
    ...(Array.isArray(payload.progression)
      ? payload.progression.flatMap((entry) => asStringArray(asRecord(entry).featureIds))
      : [])
  ];
  return references
    .map((reference) => findCompendiumItemByReference(items, reference))
    .find((item) => Boolean(item && normalize(item.name) === 'eldritch invocations'));
};

export const getEldritchInvocationLimit = (
  warlockLevel: number,
  classEntries: CharacterClassSelectionEntry[],
  items: StoredCompendiumItem[]
): number => {
  if (warlockLevel <= 0) return 0;
  const warlockClassItem = classEntries.find(({ item }) => isWarlockClassItem(item))?.item;
  const progressionFeature = findInvocationProgressionFeature(warlockClassItem, items);
  const table = asNumberArray(asRecord(progressionFeature?.normalizedJson).invocationsKnownByLevel);
  const resolvedTable = table.length ? table : DEFAULT_INVOCATIONS_KNOWN_BY_LEVEL;
  const index = Math.max(0, Math.min(resolvedTable.length - 1, Math.floor(warlockLevel) - 1));
  return Math.max(0, Math.floor(resolvedTable[index] ?? 0));
};

export const getSelectableEldritchInvocations = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => {
  const enabled = new Set(enabledSourceIds);
  return withBuiltinEldritchInvocations(items)
    .filter(isEldritchInvocationItem)
    .filter((item) => item.status !== 'disabled' && enabled.has(item.sourceId))
    .sort((left, right) => {
      const leftLevel = getEldritchInvocationMinimumLevel(left);
      const rightLevel = getEldritchInvocationMinimumLevel(right);
      return leftLevel - rightLevel || left.name.localeCompare(right.name);
    });
};

export const getLevelAvailableEldritchInvocations = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  warlockLevel: number
): StoredCompendiumItem[] =>
  getSelectableEldritchInvocations(items, enabledSourceIds)
    .filter((item) => getEldritchInvocationMinimumLevel(item) <= warlockLevel);

export const getEligibleEldritchInvocations = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  warlockLevel: number,
  selectedCounts: Record<string, number> = {}
): StoredCompendiumItem[] => {
  const allInvocations = getSelectableEldritchInvocations(items, enabledSourceIds);
  return allInvocations.filter((item) =>
    getEldritchInvocationPrerequisiteIssues(
      item,
      warlockLevel,
      selectedCounts,
      allInvocations
    ).length === 0
  );
};

/**
 * Reconcile a resumed invocation selection with the current Warlock level.
 * Level reductions or a class switch must not leave invisible invocations in
 * the draft that keep the progression step blocked. Still-available choices
 * are retained in insertion order up to the current invocation limit.
 */
export const pruneEldritchInvocationCounts = (
  selectedCounts: Record<string, number>,
  candidates: StoredCompendiumItem[],
  limit: number
): Record<string, number> => {
  const available = new Map(candidates.map((item) => [item.id, item]));
  let remaining = Math.max(0, Math.floor(limit));
  const next: Record<string, number> = {};

  for (const [itemId, rawCount] of Object.entries(selectedCounts)) {
    if (remaining <= 0) break;
    const item = available.get(itemId);
    if (!item) continue;
    const count = Math.max(0, Math.floor(rawCount));
    if (!count) continue;
    const allowed = isEldritchInvocationRepeatable(item) ? count : Math.min(1, count);
    const kept = Math.min(allowed, remaining);
    if (kept > 0) {
      next[itemId] = kept;
      remaining -= kept;
    }
  }

  const currentEntries = Object.entries(selectedCounts).filter(([, value]) => Math.max(0, Math.floor(value)) > 0);
  const nextEntries = Object.entries(next);
  const unchanged = currentEntries.length === nextEntries.length
    && currentEntries.every(([itemId, value]) => next[itemId] === Math.max(0, Math.floor(value)));
  return unchanged ? selectedCounts : next;
};


export const getEffectiveEldritchInvocationCounts = (
  character: Pick<Character, 'buildChoices' | 'featChoices'>
): Record<string, number> => {
  const counts = Object.fromEntries(
    Object.entries(character.buildChoices?.eldritchInvocationCounts ?? {})
      .map(([itemId, count]) => [itemId, Math.max(0, Math.floor(count))])
      .filter(([, count]) => Number(count) > 0)
  ) as Record<string, number>;
  for (const featChoice of character.featChoices ?? []) {
    const itemId = featChoice.eldritchInvocationItemId;
    if (!itemId) continue;
    counts[itemId] = (counts[itemId] ?? 0) + 1;
  }
  return counts;
};

export const getEffectiveEldritchInvocationChoices = (
  character: Pick<Character, 'buildChoices' | 'featChoices'>
): CharacterEldritchInvocationChoice[] => {
  const result = [...(character.buildChoices?.eldritchInvocationChoices ?? [])];
  const offsets = { ...getEffectiveEldritchInvocationCounts({ buildChoices: character.buildChoices, featChoices: [] }) };
  for (const featChoice of character.featChoices ?? []) {
    const itemId = featChoice.eldritchInvocationItemId;
    if (!itemId) continue;
    const instanceIndex = offsets[itemId] ?? 0;
    offsets[itemId] = instanceIndex + 1;
    if (featChoice.eldritchInvocationChoice) {
      result.push({
        ...featChoice.eldritchInvocationChoice,
        invocationItemId: itemId,
        instanceIndex
      });
    }
  }
  return result;
};

export const findEldritchInvocationById = (
  items: StoredCompendiumItem[],
  itemId: string
): StoredCompendiumItem | undefined =>
  withBuiltinEldritchInvocations(items).find((item) => item.id === itemId);

export const getEldritchInvocationMinimumLevel = (item: StoredCompendiumItem): number => {
  const payload = asRecord(item.normalizedJson);
  const explicitLevel = asNumber(payload.levelGained) ?? 1;
  const prerequisite = asString(payload.prerequisite) ?? '';
  const match = prerequisite.match(/level\s*(\d+)\s*\+?/i);
  const parsed = match?.[1] ? Number(match[1]) : undefined;
  return Math.max(1, Math.floor(Math.max(explicitLevel, parsed ?? 1)));
};

const selectedCount = (counts: Record<string, number>, itemId: string): number =>
  Math.max(0, Math.floor(counts[itemId] ?? 0));

export const getEldritchInvocationPrerequisiteIssues = (
  item: StoredCompendiumItem,
  warlockLevel: number,
  selectedCounts: Record<string, number>,
  allInvocations: StoredCompendiumItem[]
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  const minimumLevel = getEldritchInvocationMinimumLevel(item);
  if (warlockLevel < minimumLevel) {
    issues.push(issue(
      'ELDRITCH_INVOCATION_LEVEL_PREREQUISITE',
      `${item.name} exige Warlock nível ${minimumLevel} ou superior.`
    ));
  }

  const payload = asRecord(item.normalizedJson);
  const requiredFeatureReference = asString(asRecord(payload.mechanics).requiresFeatureId);
  if (requiredFeatureReference) {
    const requiredFeature = findCompendiumItemByReference(allInvocations, requiredFeatureReference);
    if (!requiredFeature) {
      issues.push(issue(
        'ELDRITCH_INVOCATION_REQUIRED_FEATURE_UNAVAILABLE',
        `${item.name} exige uma opção que não está disponível nas fontes ativas: ${requiredFeatureReference}.`
      ));
    } else if (selectedCount(selectedCounts, requiredFeature.id) === 0) {
      issues.push(issue(
        'ELDRITCH_INVOCATION_DEPENDENCY_PREREQUISITE',
        `${item.name} exige ${requiredFeature.name}.`
      ));
    }
  }

  const prerequisite = normalize(asString(payload.prerequisite) ?? '');
  if (prerequisite) {
    for (const candidate of allInvocations) {
      if (candidate.id === item.id) continue;
      const candidateName = normalize(candidate.name);
      if (candidateName
          && prerequisite.includes(candidateName)
          && selectedCount(selectedCounts, candidate.id) === 0
          && (!requiredFeatureReference || candidate.importItemId !== requiredFeatureReference)) {
        issues.push(issue(
          'ELDRITCH_INVOCATION_DEPENDENCY_PREREQUISITE',
          `${item.name} exige a invocation ${candidate.name}.`
        ));
      }
    }
  }

  return issues;
};

export const validateEldritchInvocationSelection = (
  classEntries: CharacterClassSelectionEntry[],
  items: StoredCompendiumItem[],
  enabledSourceIds: string[],
  selectedCounts: Record<string, number>
): RuleValidationIssue[] => {
  const warlockLevel = getSelectedWarlockLevel(classEntries);
  const required = getEldritchInvocationLimit(warlockLevel, classEntries, items);
  const allInvocations = getSelectableEldritchInvocations(items, enabledSourceIds);
  const totalSelected = Object.values(selectedCounts).reduce(
    (sum, count) => sum + Math.max(0, Math.floor(count)),
    0
  );
  const issues: RuleValidationIssue[] = [];

  if (warlockLevel <= 0) {
    if (totalSelected > 0) {
      issues.push(issue(
        'ELDRITCH_INVOCATION_WITHOUT_WARLOCK',
        'Remova as Eldritch Invocations, pois o personagem não possui níveis de Warlock.'
      ));
    }
    return issues;
  }

  if (totalSelected !== required) {
    issues.push(issue(
      'ELDRITCH_INVOCATION_COUNT',
      `Escolha exatamente ${required} Eldritch Invocation(s) para Warlock nível ${warlockLevel}. Selecionadas: ${totalSelected}.`
    ));
  }

  for (const [itemId, rawCount] of Object.entries(selectedCounts)) {
    const count = Math.max(0, Math.floor(rawCount));
    if (!count) continue;
    const item = findEldritchInvocationById(items, itemId);
    if (!item || !isEldritchInvocationItem(item)) {
      issues.push(issue(
        'ELDRITCH_INVOCATION_NOT_FOUND',
        `Uma Eldritch Invocation selecionada não está mais disponível no compêndio: ${itemId}.`
      ));
      continue;
    }
    if (item.status === 'disabled' || !enabledSourceIds.includes(item.sourceId)) {
      issues.push(issue(
        'ELDRITCH_INVOCATION_SOURCE_UNAVAILABLE',
        `${item.name} pertence a uma fonte inativa ou está desabilitada.`
      ));
    }
    if (count > 1 && !isEldritchInvocationRepeatable(item)) {
      issues.push(issue(
        'ELDRITCH_INVOCATION_NOT_REPEATABLE',
        `${item.name} não pode ser escolhida mais de uma vez.`
      ));
    }
    issues.push(...getEldritchInvocationPrerequisiteIssues(
      item,
      warlockLevel,
      selectedCounts,
      allInvocations
    ));
  }

  return issues;
};
