import type { CharacterClassFeatureChoice, CharacterSpeciesChoice, CharacterSubclassChoice } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  findCompendiumItemByReference,
  getProgressionFeatureReferences
} from '../compendium/classProgression';
import { getClassOrSubclassSpellcastingProfile, spellItemLevel, type ClassSpellcastingProfile } from './spellcastingRules';
import {
  getClassSpellListReferences,
  getExplicitSpellListAdditionReferences,
  getSpeciesSpellListReferences
} from './spellListRules';
import { getSubclassSpellListReferences } from './subclassChoiceRules';
import { getSpeciesGrantedSpellReferences } from './speciesChoiceRules';
import {
  classifySpellAccessFeature,
  type SpellAccessFeatureSignal
} from './spellAccessFeatureClassifier';
import {
  getPhb2024AutomaticSubclassSpellGrants,
  getPhb2024ConditionalSubclassSpellGrants,
  getPhb2024SubclassSpellGrantBridgeEntries,
  type Phb2024SubclassSpellGrantBridgeEntry
} from './phb2024SubclassSpellGrantBridge';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const unique = (values: readonly string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const splitClassNames = (value: unknown): string[] => {
  const direct = asStringArray(value);
  if (direct.length) return unique(direct);
  const text = asString(value);
  if (!text) return [];
  return unique(text.split(/[|,;/]+/g).map((entry) => entry.trim()).filter(Boolean));
};

const itemMatchesReference = (item: StoredCompendiumItem, reference: string): boolean => {
  const rawId = asString(asRecord(item.rawJson).id);
  return item.id === reference || item.importItemId === reference || rawId === reference;
};

const normalizeSpellName = (value: string): string => normalize(value).replace(/[^a-z0-9]/g, '');

const spellReferenceName = (reference: string): string => {
  const suffix = reference.includes('-spell-') ? reference.split('-spell-', 2)[1] : reference;
  return normalizeSpellName(suffix.replace(/[-_]+/g, ' '));
};

const findSpellByReference = (
  items: StoredCompendiumItem[],
  reference: string
): StoredCompendiumItem | undefined =>
  items.find((item) => item.type === 'spell' && item.status !== 'disabled' && itemMatchesReference(item, reference)) ??
  items.find((item) => item.type === 'spell' && item.status !== 'disabled' && normalizeSpellName(item.name) === spellReferenceName(reference));

const canonicalSpellReference = (
  items: StoredCompendiumItem[],
  reference: string
): string => findSpellByReference(items, reference)?.importItemId ?? reference;

const findClassByName = (
  items: StoredCompendiumItem[],
  className: string
): StoredCompendiumItem | undefined =>
  items.find((item) => item.type === 'class' && item.status !== 'disabled' && normalize(item.name) === normalize(className));

const classNameForReference = (
  items: StoredCompendiumItem[],
  reference: string
): string | undefined => {
  const item = items.find((candidate) => candidate.type === 'class' && itemMatchesReference(candidate, reference));
  return item?.name;
};

const activeProgressionFeatures = (
  owner: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  attainedLevel: number
): StoredCompendiumItem[] => {
  if (!owner || (owner.type !== 'class' && owner.type !== 'subclass')) return [];
  return getProgressionFeatureReferences(owner, attainedLevel)
    .map((reference) => findCompendiumItemByReference(items, reference))
    .filter((item): item is StoredCompendiumItem => Boolean(item && item.type === 'feature' && item.status !== 'disabled'));
};

const sourceClassSpellReferences = (
  items: StoredCompendiumItem[],
  classNames: readonly string[]
): string[] => unique(classNames.flatMap((className) => {
  const classItem = findClassByName(items, className);
  // Level 1 intentionally avoids pulling later class features such as Magical Secrets.
  const carrierReferences = classItem ? getClassSpellListReferences(classItem, items, 1) : [];
  const payloadReferences = items
    .filter((item) => item.type === 'spell' && item.status !== 'disabled')
    .filter((item) => asStringArray(asRecord(item.normalizedJson).classes).some((candidate) => normalize(candidate) === normalize(className)))
    .map((item) => item.importItemId);
  return [...carrierReferences, ...payloadReferences];
}));

export type CharacterSpellAccessKind =
  | 'classList'
  | 'expandedList'
  | 'bonusChoice'
  | 'alwaysPrepared'
  | 'granted';

export type CharacterSpellAccessSourceKind =
  | 'class'
  | 'subclass'
  | 'species'
  | 'feature'
  | 'custom';

export interface CharacterSpellAccessSource {
  kind: CharacterSpellAccessSourceKind;
  itemId: string;
  importItemId?: string;
  name: string;
}

export interface CharacterSpellAccessEntry {
  kind: Exclude<CharacterSpellAccessKind, 'bonusChoice'>;
  spellReference: string;
  source: CharacterSpellAccessSource;
  classItemId: string;
  className: string;
  countsAgainstNormalLimit: boolean;
  automatic: boolean;
  spellcastingAbility?: string;
  ritualOnly?: boolean;
}

export interface CharacterSpellChoiceActivation {
  kind: 'automatic' | 'featureOption';
  featureItemId?: string;
  optionId?: string;
}

export interface CharacterSpellChoiceRequirement {
  id: string;
  kind: 'bonusChoice';
  source: CharacterSpellAccessSource;
  classItemId: string;
  className: string;
  count: number;
  sourceClassNames: string[];
  explicitSpellReferences: string[];
  spellLevel?: number;
  countsAgainstNormalLimit: boolean;
  countsAsClassName?: string;
  spellcastingAbility?: string;
  activation: CharacterSpellChoiceActivation;
}

export interface CharacterConditionalSpellAccessRequirement {
  id: string;
  source: CharacterSpellAccessSource;
  classItemId: string;
  className: string;
  mode: string;
}

export interface CharacterSpellAccessResolution {
  classItemId: string;
  className: string;
  classLevel: number;
  entries: CharacterSpellAccessEntry[];
  classListSpellReferences: string[];
  expandedListSpellReferences: string[];
  alwaysPreparedSpellReferences: string[];
  grantedSpellReferences: string[];
  normalSelectionSpellReferences: string[];
  bonusChoiceRequirements: CharacterSpellChoiceRequirement[];
  activeBonusChoiceRequirements: CharacterSpellChoiceRequirement[];
  conditionalRequirements: CharacterConditionalSpellAccessRequirement[];
  /** Descriptive spell-access signals discovered on active progression features. */
  featureSignals: SpellAccessFeatureSignal[];
  /** PHB 2024 catalog evidence for the selected subclass. */
  catalogBridgeEntries: readonly Phb2024SubclassSpellGrantBridgeEntry[];
  catalogBridgeSpellReferences: string[];
  /** Catalog refs activated as conservative automatic subclass spell grants by FIX39. */
  catalogBridgeAppliedAutomaticSpellReferences: string[];
  /** Catalog spell refs not represented by an explicit feature signal or FIX39 automatic policy yet. */
  catalogBridgeUnrepresentedSpellReferences: string[];
}

export interface CharacterSpellAccessInput {
  classItem: StoredCompendiumItem;
  classLevel: number;
  items: StoredCompendiumItem[];
  subclassItem?: StoredCompendiumItem;
  subclassChoices?: CharacterSubclassChoice[];
  classFeatureChoices?: readonly CharacterClassFeatureChoice[];
  speciesItem?: StoredCompendiumItem;
  speciesChoices?: readonly CharacterSpeciesChoice[];
  characterLevel?: number;
  /** Additional feature items already known to be active, for example future selectable class-feature options. */
  activeFeatureItems?: StoredCompendiumItem[];
  /** Custom-rule additions are already normalized by the custom-rule layer before reaching this resolver. */
  customSpellListReferences?: readonly string[];
}

const sourceFromItem = (
  item: StoredCompendiumItem,
  kind: CharacterSpellAccessSourceKind
): CharacterSpellAccessSource => ({
  kind,
  itemId: item.id,
  importItemId: item.importItemId,
  name: item.name
});

const makeEntry = (
  kind: CharacterSpellAccessEntry['kind'],
  spellReference: string,
  source: CharacterSpellAccessSource,
  classItem: StoredCompendiumItem,
  metadata: Pick<CharacterSpellAccessEntry, 'spellcastingAbility' | 'ritualOnly'> = {}
): CharacterSpellAccessEntry => ({
  kind,
  spellReference,
  source,
  classItemId: classItem.id,
  className: classItem.name,
  countsAgainstNormalLimit: kind === 'classList' || kind === 'expandedList',
  automatic: kind === 'alwaysPrepared' || kind === 'granted',
  ...metadata
});

const spellReferenceIsAvailableAtClassLevel = (
  reference: string,
  classItem: StoredCompendiumItem,
  classLevel: number,
  items: StoredCompendiumItem[],
  profile?: ClassSpellcastingProfile
): boolean => {
  const spell = findSpellByReference(items, reference);
  if (!spell) return true;
  const level = spellItemLevel(spell);
  if (level === 0) return true;
  return Boolean(profile && level <= profile.maxSpellLevel);
};

const activeSpellGrantsFromFeature = (
  feature: StoredCompendiumItem,
  classItem: StoredCompendiumItem,
  classLevel: number,
  items: StoredCompendiumItem[],
  profile?: ClassSpellcastingProfile
): Array<{ kind: 'alwaysPrepared' | 'granted'; reference: string; spellcastingAbility?: string; ritualOnly?: boolean }> => {
  const payload = asRecord(feature.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const grants: Array<{ kind: 'alwaysPrepared' | 'granted'; reference: string; spellcastingAbility?: string; ritualOnly?: boolean }> = [];

  for (const reference of asStringArray(payload.alwaysPreparedSpellRefs)) {
    if (spellReferenceIsAvailableAtClassLevel(reference, classItem, classLevel, items, profile)) {
      grants.push({ kind: 'alwaysPrepared', reference: canonicalSpellReference(items, reference) });
    }
  }

  const directAlwaysPrepared = asStringArray(payload.alwaysPreparedSpells);
  for (const reference of directAlwaysPrepared) {
    if (spellReferenceIsAvailableAtClassLevel(reference, classItem, classLevel, items, profile)) {
      grants.push({ kind: 'alwaysPrepared', reference: canonicalSpellReference(items, reference) });
    }
  }

  const spellGrants = Array.isArray(mechanics.spellGrants) ? mechanics.spellGrants : [];
  for (const grantValue of spellGrants) {
    const grant = asRecord(grantValue);
    const minimumClassLevel = asNumber(grant.classLevel) ?? asNumber(grant.level) ?? 1;
    if (minimumClassLevel > classLevel) continue;
    const kind = asBoolean(grant.alwaysPrepared) === true || asBoolean(grant.countsAgainstPrepared) === false
      ? 'alwaysPrepared' as const
      : 'granted' as const;
    for (const reference of unique([
      ...asStringArray(grant.spellIds),
      ...asStringArray(grant.spellRefs)
    ])) {
      grants.push({ kind, reference: canonicalSpellReference(items, reference) });
    }
  }

  if (asBoolean(mechanics.alwaysPrepared) === true) {
    const progression = Array.isArray(mechanics.spellProgression) ? mechanics.spellProgression : [];
    for (const progressionValue of progression) {
      const row = asRecord(progressionValue);
      const minimumClassLevel = asNumber(row.classLevel) ?? asNumber(row.artificerLevel) ?? asNumber(row.level) ?? 1;
      if (minimumClassLevel > classLevel) continue;
      for (const reference of unique([
        ...asStringArray(row.spellIds),
        ...asStringArray(row.spellRefs)
      ])) {
        grants.push({ kind: 'alwaysPrepared', reference: canonicalSpellReference(items, reference) });
      }
    }
  }

  const domainTable = asRecord(mechanics.domainSpellTable);
  if (Object.keys(domainTable).length && asBoolean(mechanics.countsAgainstPreparedSpells) === false) {
    for (const [minimumLevelText, references] of Object.entries(domainTable)) {
      const minimumClassLevel = Number(minimumLevelText);
      if (Number.isFinite(minimumClassLevel) && minimumClassLevel <= classLevel) {
        for (const reference of asStringArray(references)) grants.push({ kind: 'alwaysPrepared', reference: canonicalSpellReference(items, reference) });
      }
    }
  }

  const cantripId = asString(mechanics.cantripId);
  if (
    cantripId &&
    (asBoolean(mechanics.countsAgainstPrepared) === false || asBoolean(mechanics.countsAgainstSpellsKnown) === false)
  ) {
    grants.push({ kind: 'granted', reference: canonicalSpellReference(items, cantripId) });
  }

  const grantedCantrip = asString(mechanics.grantedCantrip);
  if (grantedCantrip) {
    grants.push({ kind: 'granted', reference: canonicalSpellReference(items, grantedCantrip) });
  }

  if (asBoolean(payload.ritualOnly) === true) {
    const spellcastingAbility = asString(payload.spellcastingAbility);
    for (const reference of asStringArray(payload.spellRefs)) {
      grants.push({
        kind: 'granted',
        reference: canonicalSpellReference(items, reference),
        spellcastingAbility,
        ritualOnly: true
      });
    }
  }

  // Some subclass features both grant and enhance a specific spell. In the
  // bundled catalog this shape is used by Arcane Trickster's Mage Hand
  // Legerdemain, whose referenced cantrip is part of the subclass grant rather
  // than one of the character's normal cantrip selections.
  if (asString(payload.enhancesSpell)) {
    for (const reference of asStringArray(payload.spellRefs)) {
      grants.push({ kind: 'granted', reference: canonicalSpellReference(items, reference) });
    }
  }

  return grants;
};

const expandedClassFeatureReferences = (
  feature: StoredCompendiumItem,
  classItem: StoredCompendiumItem,
  items: StoredCompendiumItem[]
): string[] => {
  const payload = asRecord(feature.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const expandedClassNames = unique([
    ...asStringArray(payload.expandedSpellLists),
    ...asStringArray(mechanics.expandedSpellLists)
  ]).filter((className) => normalize(className) !== normalize(classItem.name));

  return unique([
    ...sourceClassSpellReferences(items, expandedClassNames),
    ...getExplicitSpellListAdditionReferences(feature.normalizedJson, classItem.name)
  ]);
};

const featureChoiceRequirements = (
  feature: StoredCompendiumItem,
  classItem: StoredCompendiumItem,
  items: StoredCompendiumItem[],
  activation: CharacterSpellChoiceActivation = { kind: 'automatic' }
): CharacterSpellChoiceRequirement[] => {
  const payload = asRecord(feature.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const source = sourceFromItem(feature, 'feature');
  const requirements: CharacterSpellChoiceRequirement[] = [];

  const pushRequirement = ({
    suffix,
    count,
    sourceClassNames,
    explicitSpellReferences = [],
    spellLevel,
    countsAsClassName,
    spellcastingAbility,
    requirementActivation = activation
  }: {
    suffix: string;
    count: number;
    sourceClassNames: string[];
    explicitSpellReferences?: string[];
    spellLevel?: number;
    countsAsClassName?: string;
    spellcastingAbility?: string;
    requirementActivation?: CharacterSpellChoiceActivation;
  }) => {
    if (count <= 0 || (!sourceClassNames.length && !explicitSpellReferences.length)) return;
    requirements.push({
      id: `${feature.id}:${suffix}`,
      kind: 'bonusChoice',
      source,
      classItemId: classItem.id,
      className: classItem.name,
      count,
      sourceClassNames: unique(sourceClassNames),
      explicitSpellReferences: unique(explicitSpellReferences),
      spellLevel,
      countsAgainstNormalLimit: false,
      countsAsClassName,
      spellcastingAbility,
      activation: requirementActivation
    });
  };

  const additionalPreparedSpells = asNumber(payload.additionalPreparedSpells);
  const spellSource = splitClassNames(payload.spellSource);
  if (additionalPreparedSpells && spellSource.length) {
    pushRequirement({
      suffix: 'additional-prepared-spells',
      count: additionalPreparedSpells,
      sourceClassNames: spellSource,
      countsAsClassName: classItem.name
    });
  }

  const cantripChoice = asRecord(mechanics.cantripChoice);
  const cantripChoiceCount = asNumber(cantripChoice.count);
  if (cantripChoiceCount) {
    const sourceClassReference = asString(cantripChoice.sourceClassId) ?? asString(cantripChoice.sourceClassRef);
    const sourceClassName = sourceClassReference ? classNameForReference(items, sourceClassReference) : undefined;
    pushRequirement({
      suffix: 'cantrip-choice',
      count: cantripChoiceCount,
      sourceClassNames: sourceClassName ? [sourceClassName] : splitClassNames(cantripChoice.sourceClassName),
      spellLevel: asNumber(cantripChoice.spellLevel) ?? 0,
      countsAsClassName: asString(mechanics.chosenCantripCountsAs) ?? classItem.name,
      spellcastingAbility: asString(cantripChoice.spellcastingAbility)
    });
  }

  const mechanicsCantripChoiceCount = asNumber(mechanics.cantripChoiceCount);
  const mechanicsSpellList = splitClassNames(mechanics.spellList);
  if (mechanicsCantripChoiceCount && mechanicsSpellList.length) {
    pushRequirement({
      suffix: 'mechanics-cantrip-choice',
      count: mechanicsCantripChoiceCount,
      sourceClassNames: mechanicsSpellList,
      spellLevel: 0,
      countsAsClassName: asString(mechanics.countsAsClassSpellsFor) ?? classItem.name,
      spellcastingAbility: asString(mechanics.spellcastingAbility)
    });
  }

  const spellChoice = asRecord(mechanics.spellChoice);
  const spellChoiceCount = asNumber(spellChoice.count);
  const spellChoiceSources = splitClassNames(spellChoice.sourceLists);
  if (spellChoiceCount && spellChoiceSources.length) {
    pushRequirement({
      suffix: 'spell-choice',
      count: spellChoiceCount,
      sourceClassNames: spellChoiceSources,
      spellLevel: asNumber(spellChoice.level),
      countsAsClassName: asString(spellChoice.countsAsClassSpellsFor) ?? classItem.name,
      spellcastingAbility: asString(spellChoice.spellcastingAbility)
    });
  }

  const explicitSpellChoices = asStringArray(mechanics.spellChoices);
  const knownCantrips = asNumber(mechanics.knownCantrips);
  if (explicitSpellChoices.length && knownCantrips) {
    pushRequirement({
      suffix: 'explicit-cantrip-choice',
      count: knownCantrips,
      sourceClassNames: [],
      explicitSpellReferences: explicitSpellChoices,
      spellLevel: 0,
      countsAsClassName: classItem.name,
      spellcastingAbility: asString(mechanics.spellcastingAbility)
    });
  }

  const optionContainers: Array<{ key: 'alternateOption' | 'choice'; value: unknown }> = [
    { key: 'alternateOption', value: payload.alternateOption },
    { key: 'choice', value: payload.choice }
  ];

  for (const container of optionContainers) {
    const options = container.key === 'choice'
      ? (Array.isArray(container.value) ? container.value : [])
      : (Object.keys(asRecord(container.value)).length ? [container.value] : []);
    for (const optionValue of options) {
      const option = asRecord(optionValue);
      const optionId = asString(option.id);
      const extraCantrips = asNumber(option.extraCantrips);
      if (!optionId || !extraCantrips) continue;
      const optionSpellLists = splitClassNames(option.spellList);
      pushRequirement({
        suffix: `option:${optionId}`,
        count: extraCantrips,
        sourceClassNames: optionSpellLists.length ? optionSpellLists : [classItem.name],
        spellLevel: 0,
        countsAsClassName: asString(option.countsAsClassSpellsFor) ?? classItem.name,
        spellcastingAbility: asString(option.spellcastingAbility),
        requirementActivation: {
          kind: 'featureOption',
          featureItemId: feature.id,
          optionId
        }
      });
    }
  }

  return requirements;
};

const conditionalRequirementsFromFeature = (
  feature: StoredCompendiumItem,
  classItem: StoredCompendiumItem
): CharacterConditionalSpellAccessRequirement[] => {
  const payload = asRecord(feature.normalizedJson);
  const spellListMode = asString(payload.spellListMode) ?? asString(asRecord(payload.mechanics).spellListMode);
  if (!spellListMode) return [];
  return [{
    id: `${feature.id}:spell-list-mode:${spellListMode}`,
    source: sourceFromItem(feature, 'feature'),
    classItemId: classItem.id,
    className: classItem.name,
    mode: spellListMode
  }];
};

export const getSpellAccessRequirementsFromFeature = (
  feature: StoredCompendiumItem,
  classItem: StoredCompendiumItem,
  items: StoredCompendiumItem[],
  activation: CharacterSpellChoiceActivation = { kind: 'automatic' }
): {
  bonusChoiceRequirements: CharacterSpellChoiceRequirement[];
  conditionalRequirements: CharacterConditionalSpellAccessRequirement[];
} => ({
  bonusChoiceRequirements: featureChoiceRequirements(feature, classItem, items, activation),
  conditionalRequirements: conditionalRequirementsFromFeature(feature, classItem)
});

export const resolveCharacterSpellAccess = ({
  classItem,
  classLevel,
  items,
  subclassItem,
  subclassChoices,
  classFeatureChoices = [],
  speciesItem,
  speciesChoices = [],
  characterLevel = classLevel,
  activeFeatureItems = [],
  customSpellListReferences = []
}: CharacterSpellAccessInput): CharacterSpellAccessResolution => {
  const classSource = sourceFromItem(classItem, 'class');
  const classFeatures = activeProgressionFeatures(classItem, items, classLevel);
  const subclassFeatures = activeProgressionFeatures(subclassItem, items, classLevel);
  const allActiveFeatures = Array.from(new Map(
    [...classFeatures, ...subclassFeatures, ...activeFeatureItems].map((feature) => [feature.id, feature])
  ).values());

  const spellcastingProfile = getClassOrSubclassSpellcastingProfile(classItem, classLevel, subclassItem, items);
  const baseClassReferences = getClassSpellListReferences(classItem, items, classLevel);
  const subclassCastingReferences = !baseClassReferences.length && spellcastingProfile
    ? sourceClassSpellReferences(items, spellcastingProfile.spellListClassNames)
    : [];
  const classAllReferences = unique([...baseClassReferences, ...subclassCastingReferences]);
  const expandedFromClassFeatures = unique(classFeatures.flatMap((feature) =>
    expandedClassFeatureReferences(feature, classItem, items)
  ));
  const expandedFromSubclass = getSubclassSpellListReferences(subclassItem, subclassChoices, items, classLevel);
  const expandedFromSpecies = getSpeciesSpellListReferences(
    speciesItem,
    speciesChoices,
    items,
    characterLevel,
    classItem.name,
    Boolean(spellcastingProfile)
  );
  const grantedFromSpecies = getSpeciesGrantedSpellReferences(
    speciesItem,
    items,
    characterLevel,
    [...speciesChoices]
  );
  const expandedSet = new Set(unique([
    ...expandedFromClassFeatures,
    ...expandedFromSubclass,
    ...expandedFromSpecies,
    ...customSpellListReferences
  ]));

  const classListSpellReferences = unique(classAllReferences.filter((reference) => !expandedSet.has(reference)));
  const expandedListSpellReferences = unique(Array.from(expandedSet));

  const entries: CharacterSpellAccessEntry[] = [
    ...classListSpellReferences.map((reference) => makeEntry('classList', reference, classSource, classItem)),
    ...expandedFromClassFeatures.map((reference) => makeEntry('expandedList', reference, classSource, classItem)),
    ...expandedFromSubclass.map((reference) => makeEntry(
      'expandedList',
      reference,
      subclassItem ? sourceFromItem(subclassItem, 'subclass') : classSource,
      classItem
    )),
    ...expandedFromSpecies.map((reference) => makeEntry(
      'expandedList',
      reference,
      speciesItem ? sourceFromItem(speciesItem, 'species') : classSource,
      classItem
    )),
    ...grantedFromSpecies.map((reference) => makeEntry(
      'granted',
      reference,
      speciesItem ? sourceFromItem(speciesItem, 'species') : classSource,
      classItem
    )),
    ...customSpellListReferences.map((reference) => makeEntry(
      'expandedList',
      reference,
      { kind: 'custom', itemId: 'custom-spell-list', name: 'Custom rule' },
      classItem
    ))
  ];

  for (const feature of allActiveFeatures) {
    for (const grant of activeSpellGrantsFromFeature(feature, classItem, classLevel, items, spellcastingProfile)) {
      entries.push(makeEntry(
        grant.kind,
        grant.reference,
        sourceFromItem(feature, 'feature'),
        classItem,
        { spellcastingAbility: grant.spellcastingAbility, ritualOnly: grant.ritualOnly }
      ));
    }
  }

  const catalogAutomaticGrants = subclassItem
    ? getPhb2024AutomaticSubclassSpellGrants(subclassItem.importItemId, classLevel)
    : [];
  const catalogAutomaticSource = subclassItem
    ? sourceFromItem(subclassItem, 'subclass')
    : classSource;
  for (const grant of catalogAutomaticGrants) {
    const reference = canonicalSpellReference(items, grant.spellReference);
    if (!spellReferenceIsAvailableAtClassLevel(reference, classItem, classLevel, items, spellcastingProfile)) continue;
    entries.push(makeEntry(grant.kind, reference, catalogAutomaticSource, classItem));
  }

  const landChoice = subclassItem
    ? (subclassChoices ?? []).find((choice) =>
        choice.subclassItemId === subclassItem.id && choice.choiceId === 'land-spell-list'
      )
    : undefined;
  const conditionalLandGrants = subclassItem
    ? getPhb2024ConditionalSubclassSpellGrants(
        subclassItem.importItemId,
        'landChoice',
        landChoice?.optionId,
        classLevel
      )
    : [];
  for (const grant of conditionalLandGrants) {
    const reference = canonicalSpellReference(items, grant.spellReference);
    entries.push(makeEntry('alwaysPrepared', reference, catalogAutomaticSource, classItem));
  }

  const dedupedEntries = Array.from(new Map(
    entries.map((entry) => [`${entry.kind}|${entry.spellReference}|${entry.source.itemId}`, entry])
  ).values());
  const alwaysPreparedSpellReferences = unique(
    dedupedEntries.filter((entry) => entry.kind === 'alwaysPrepared').map((entry) => entry.spellReference)
  );
  const grantedSpellReferences = unique(
    dedupedEntries.filter((entry) => entry.kind === 'granted').map((entry) => entry.spellReference)
  );
  const automaticSet = new Set([...alwaysPreparedSpellReferences, ...grantedSpellReferences]);
  const normalSelectionSpellReferences = unique([
    ...classListSpellReferences,
    ...expandedListSpellReferences
  ]).filter((reference) =>
    !automaticSet.has(reference) &&
    spellReferenceIsAvailableAtClassLevel(reference, classItem, classLevel, items, spellcastingProfile)
  );

  const requirementResults = allActiveFeatures.map((feature) =>
    getSpellAccessRequirementsFromFeature(feature, classItem, items)
  );
  const bonusChoiceRequirements = requirementResults.flatMap((result) => result.bonusChoiceRequirements);
  const activeBonusChoiceRequirements = bonusChoiceRequirements.filter((requirement) => {
    if (requirement.activation.kind === 'automatic') return true;
    return classFeatureChoices.some((choice) =>
      choice.classItemId === classItem.id &&
      choice.featureItemId === requirement.activation.featureItemId &&
      choice.optionId === requirement.activation.optionId
    );
  });
  const featureSignals = allActiveFeatures.flatMap((feature) => classifySpellAccessFeature(feature));
  const catalogBridgeEntries = subclassItem
    ? getPhb2024SubclassSpellGrantBridgeEntries(subclassItem.importItemId)
    : [];
  const catalogBridgeSpellReferences = unique(catalogBridgeEntries.flatMap((entry) =>
    entry.groups.flatMap((group) => group.spellReferences)
  ));
  const representedSignalReferences = new Set(featureSignals.flatMap((signal) => signal.spellReferences)
    .map((reference) => canonicalSpellReference(items, reference)));
  const catalogBridgeAppliedAutomaticSpellReferences = unique(catalogAutomaticGrants
    .map((grant) => canonicalSpellReference(items, grant.spellReference)));
  const representedOrAppliedReferences = new Set([
    ...representedSignalReferences,
    ...catalogBridgeAppliedAutomaticSpellReferences
  ]);
  const catalogBridgeUnrepresentedSpellReferences = catalogBridgeSpellReferences
    .map((reference) => canonicalSpellReference(items, reference))
    .filter((reference) => !representedOrAppliedReferences.has(reference));

  return {
    classItemId: classItem.id,
    className: classItem.name,
    classLevel,
    entries: dedupedEntries,
    classListSpellReferences,
    expandedListSpellReferences,
    alwaysPreparedSpellReferences,
    grantedSpellReferences,
    normalSelectionSpellReferences,
    bonusChoiceRequirements,
    activeBonusChoiceRequirements,
    conditionalRequirements: requirementResults.flatMap((result) => result.conditionalRequirements),
    featureSignals,
    catalogBridgeEntries,
    catalogBridgeSpellReferences,
    catalogBridgeAppliedAutomaticSpellReferences,
    catalogBridgeUnrepresentedSpellReferences
  };
};
