import type { Character, CharacterSpeciesChoice } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

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

/**
 * Cross-source class-list relationships that cannot be inferred from the spell
 * record itself. Xanathar predates Artificer, so its spell payloads correctly
 * omit Artificer even though later official Artificer lists add these spells.
 *
 * References are only activated when that exact spell exists in the current
 * compendium. This keeps optional/disabled books optional and avoids creating
 * unresolved bundled dependencies.
 */
const CROSS_SOURCE_CLASS_SPELL_REFERENCES: Readonly<Record<string, readonly string[]>> = {
  artificer: [
    'xgte-2017-spell-absorb-elements',
    'xgte-2017-spell-catapult',
    'xgte-2017-spell-catnap',
    'xgte-2017-spell-create-bonfire',
    'xgte-2017-spell-elemental-bane',
    'xgte-2017-spell-flame-arrows',
    'xgte-2017-spell-frostbite',
    'xgte-2017-spell-magic-stone',
    'xgte-2017-spell-pyrotechnics',
    'xgte-2017-spell-skill-empowerment',
    'xgte-2017-spell-skywrite',
    'xgte-2017-spell-snare',
    'xgte-2017-spell-thunderclap',
    'xgte-2017-spell-tiny-servant',
    'xgte-2017-spell-transmute-rock'
  ]
};

const rawImportId = (item: StoredCompendiumItem): string | undefined => asString(asRecord(item.rawJson).id);

const itemMatchesReference = (item: StoredCompendiumItem, reference: string): boolean =>
  item.id === reference || item.importItemId === reference || rawImportId(item) === reference;

const installedCrossSourceClassSpellReferences = (
  className: string,
  items: StoredCompendiumItem[]
): string[] => {
  const configured = CROSS_SOURCE_CLASS_SPELL_REFERENCES[normalize(className)] ?? [];
  if (!configured.length) return [];
  return configured.filter((reference) =>
    items.some((item) => item.type === 'spell' && item.status !== 'disabled' && itemMatchesReference(item, reference))
  );
};

const referencesFromSpellEntries = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return [asString(record.spellId), ...asStringArray(record.spellIds)].filter((candidate): candidate is string => Boolean(candidate));
      })
    : [];

const referencesFromLevelMap = (value: unknown): string[] =>
  Object.values(asRecord(value)).flatMap((entry) => {
    if (Array.isArray(entry)) return asStringArray(entry);
    const record = asRecord(entry);
    return [
      ...asStringArray(record.spellIds),
      ...asStringArray(record.spellRefs),
      ...referencesFromSpellEntries(record.spells)
    ];
  });

const referencesFromAdditionValue = (
  value: unknown,
  className?: string
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string') return [entry];
      const record = asRecord(entry);
      const classNames = [
        ...asStringArray(record.classNames),
        ...asStringArray(record.classes),
        ...asStringArray(record.classListNames)
      ];
      if (className && classNames.length && !classNames.some((candidate) => normalize(candidate) === normalize(className))) return [];
      return [
        ...asStringArray(record.spellItemIds),
        ...asStringArray(record.spellIds),
        ...asStringArray(record.spellRefs),
        ...referencesFromSpellEntries(record.spells)
      ];
    });
  }

  const record = asRecord(value);
  if (!Object.keys(record).length) return [];
  const direct = [
    ...asStringArray(record.spellItemIds),
    ...asStringArray(record.spellIds),
    ...asStringArray(record.spellRefs),
    ...referencesFromSpellEntries(record.spells)
  ];
  return direct.length ? direct : referencesFromLevelMap(record);
};

/**
 * Extracts only mechanics that explicitly expand a class spell list.
 * Innate/free/always-prepared spell grants are intentionally excluded because
 * they do not consume the class' normal spell-selection allowance.
 */
export const getExplicitSpellListAdditionReferences = (
  value: unknown,
  className?: string
): string[] => {
  const root = asRecord(value);
  const records = [root, asRecord(root.mechanics)];
  const references: string[] = [];

  for (const record of records) {
    for (const [key, entry] of Object.entries(record)) {
      const normalizedKey = normalize(key).replace(/[^a-z0-9]/g, '');
      if (
        normalizedKey.includes('spelllist') &&
        !['expandedspelllists', 'expandedclassspelllists'].includes(normalizedKey) &&
        (normalizedKey.includes('added') || normalizedKey.includes('addition') || normalizedKey.includes('expanded'))
      ) {
        references.push(...referencesFromAdditionValue(entry, className));
      }
      if (['additionalspellrefs', 'additionalspellids', 'addedspellrefs', 'addedspellids'].includes(normalizedKey)) {
        references.push(...asStringArray(entry));
      }
    }
  }

  return unique(references);
};

const spellListProviderReferences = (item: StoredCompendiumItem): string[] => {
  const payload = asRecord(item.normalizedJson);
  return unique([
    ...asStringArray(payload.spellRefs),
    ...asStringArray(payload.spellIds),
    ...referencesFromSpellEntries(payload.spells)
  ]);
};

const isClassSpellListProvider = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'feature' || item.status === 'disabled') return false;
  const payload = asRecord(item.normalizedJson);
  return normalize(asString(payload.sourceType) ?? '') === 'spelllist' &&
    normalize(asString(payload.listKind) ?? '') === 'classspelllist';
};

const providerMatchesClass = (
  provider: StoredCompendiumItem,
  classItem: StoredCompendiumItem
): boolean => {
  const payload = asRecord(provider.normalizedJson);
  const classReference = asString(payload.classId) ?? asString(payload.classRef) ?? asString(payload.ownerClassId);
  if (classReference && itemMatchesReference(classItem, classReference)) return true;
  return normalize(provider.name.replace(/\s+spell\s+list$/i, '')) === normalize(classItem.name);
};

const providerReferencesForClassName = (
  className: string,
  items: StoredCompendiumItem[]
): string[] => {
  const normalizedClassName = normalize(className);
  const classItems = items.filter((item) => item.type === 'class' && normalize(item.name) === normalizedClassName);
  return unique(items
    .filter(isClassSpellListProvider)
    .filter((provider) => {
      if (classItems.some((classItem) => providerMatchesClass(provider, classItem))) return true;
      return normalize(provider.name.replace(/\s+spell\s+list$/i, '')) === normalizedClassName;
    })
    .flatMap(spellListProviderReferences));
};

const activeOwnerFeatureItems = (
  owner: StoredCompendiumItem,
  items: StoredCompendiumItem[],
  attainedLevel: number
): StoredCompendiumItem[] => {
  const payload = asRecord(owner.normalizedJson);
  const progression = Array.isArray(payload.progression) ? payload.progression : [];
  const references = progression.length
    ? progression.flatMap((entry) => {
        const record = asRecord(entry);
        const level = asNumber(record.level);
        return level !== undefined && level <= attainedLevel ? asStringArray(record.featureIds) : [];
      })
    : asStringArray(payload.featureIds);

  return unique(references)
    .flatMap((reference) => items.filter((item) => item.type === 'feature' && itemMatchesReference(item, reference)))
    .filter((feature) => {
      const levelGained = asNumber(asRecord(feature.normalizedJson).levelGained);
      return levelGained === undefined || levelGained <= attainedLevel;
    });
};

/**
 * Resolves the authoritative spell-list carrier for a class. This is required
 * for classes such as Artificer whose spell entities are intentionally shared
 * with the PHB and therefore do not repeat "Artificer" in every spell payload.
 */
export const getClassSpellListReferences = (
  classItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  classLevel = 20
): string[] => {
  if (!classItem || classItem.type !== 'class') return [];

  const references = items
    .filter(isClassSpellListProvider)
    .filter((provider) => providerMatchesClass(provider, classItem))
    .flatMap(spellListProviderReferences);

  for (const feature of activeOwnerFeatureItems(classItem, items, classLevel)) {
    references.push(...getExplicitSpellListAdditionReferences(feature.normalizedJson, classItem.name));
    const payload = asRecord(feature.normalizedJson);
    for (const expandedList of asStringArray(payload.expandedSpellLists)) {
      references.push(...providerReferencesForClassName(expandedList, items));
    }
    const mechanics = asRecord(payload.mechanics);
    for (const expandedList of asStringArray(mechanics.expandedSpellLists)) {
      references.push(...providerReferencesForClassName(expandedList, items));
    }
  }

  references.push(...getExplicitSpellListAdditionReferences(classItem.normalizedJson, classItem.name));
  references.push(...installedCrossSourceClassSpellReferences(classItem.name, items));
  return unique(references);
};


/**
 * Extracts spell-list additions granted by an active feat. Dragonmark feats
 * use `spellsOfTheMark` plus an explicit rule that adds those spells to any
 * Spellcasting/Pact Magic list owned by the character. These are candidates,
 * not automatic/prepared grants, so they continue to count against the
 * receiving class' normal spell-selection limit.
 */
export const getFeatSpellListAdditionReferences = (
  featItem: StoredCompendiumItem | undefined
): string[] => {
  if (!featItem || featItem.type !== 'feat' || featItem.status === 'disabled') return [];
  const payload = asRecord(featItem.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const rule = asRecord(mechanics.spellsOfTheMarkRule);
  const effect = normalize(asString(rule.effect) ?? '');
  if (!effect.includes('add') || !effect.includes('spell') || !effect.includes('list')) return [];
  const rows = Array.isArray(mechanics.spellsOfTheMark) ? mechanics.spellsOfTheMark.map(asRecord) : [];
  return unique(rows.flatMap((row) => asStringArray(row.spellIds)));
};

export const getCharacterFeatSpellListReferences = (
  character: Character,
  items: StoredCompendiumItem[]
): string[] => unique(
  (character.compendiumLinks ?? [])
    .filter((link) => link.appliedAs === 'feat' && link.status === 'active')
    .flatMap((link) => getFeatSpellListAdditionReferences(items.find((item) => item.id === link.itemId)))
);

const speciesFeatureItems = (
  speciesItem: StoredCompendiumItem,
  choices: readonly CharacterSpeciesChoice[],
  items: StoredCompendiumItem[],
  characterLevel: number
): StoredCompendiumItem[] => {
  const payload = asRecord(speciesItem.normalizedJson);
  const directReferences = asStringArray(payload.featureIds);
  const selectedOptionReferences = choices
    .filter((choice) => choice.speciesItemId === speciesItem.id)
    .flatMap((choice) => [choice.featureItemId, choice.optionId]);

  return unique([...directReferences, ...selectedOptionReferences])
    .flatMap((reference) => items.filter((item) => item.type === 'feature' && itemMatchesReference(item, reference)))
    .filter((feature) => {
      const levelGained = asNumber(asRecord(feature.normalizedJson).levelGained);
      return levelGained === undefined || levelGained <= characterLevel;
    });
};

const structuredSpeciesSpellListExpansionReferences = (
  feature: StoredCompendiumItem,
  className: string | undefined,
  hasSpellcastingOrPactMagic: boolean
): string[] => {
  if (!className || !hasSpellcastingOrPactMagic) return [];
  const payload = asRecord(feature.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const condition = normalize(asString(mechanics.spellListExpansionCondition) ?? '');
  if (condition !== 'hasspellcastingorpactmagic') return [];
  const table = asRecord(mechanics.spellTable);
  return unique(Object.values(table).flatMap((row) => {
    if (Array.isArray(row)) {
      return row.flatMap((entry) => {
        if (typeof entry === 'string') return [entry];
        const record = asRecord(entry);
        return [asString(record.spellId), asString(record.spellRef), ...asStringArray(record.spellIds)]
          .filter((reference): reference is string => Boolean(reference));
      });
    }
    const record = asRecord(row);
    return [asString(record.spellId), asString(record.spellRef), ...asStringArray(record.spellIds)]
      .filter((reference): reference is string => Boolean(reference));
  }));
};

const selectedOptionSpellListReferences = (
  feature: StoredCompendiumItem,
  choice: CharacterSpeciesChoice | undefined,
  className?: string
): string[] => {
  if (!choice) return [];
  const payload = asRecord(feature.normalizedJson);
  const optionContainers = ['ancestryOptions', 'lineageOptions', 'legacyOptions', 'options'];
  return unique(optionContainers.flatMap((container) => {
    const option = asRecord(asRecord(payload[container])[choice.optionId]);
    return getExplicitSpellListAdditionReferences(option, className);
  }));
};

/** Returns only species mechanics that explicitly add spells to a class list. */
export const getSpeciesSpellListReferences = (
  speciesItem: StoredCompendiumItem | undefined,
  choices: readonly CharacterSpeciesChoice[],
  items: StoredCompendiumItem[],
  characterLevel: number,
  className?: string,
  hasSpellcastingOrPactMagic = Boolean(className)
): string[] => {
  if (!speciesItem || speciesItem.type !== 'species') return [];
  const references = getExplicitSpellListAdditionReferences(speciesItem.normalizedJson, className);
  for (const feature of speciesFeatureItems(speciesItem, choices, items, characterLevel)) {
    references.push(...getExplicitSpellListAdditionReferences(feature.normalizedJson, className));
    references.push(...structuredSpeciesSpellListExpansionReferences(feature, className, hasSpellcastingOrPactMagic));
    const choice = choices.find((entry) => entry.speciesItemId === speciesItem.id && itemMatchesReference(feature, entry.featureItemId));
    references.push(...selectedOptionSpellListReferences(feature, choice, className));
  }
  return unique(references);
};

export const getCharacterSpeciesSpellListReferences = (
  character: Character,
  items: StoredCompendiumItem[],
  className?: string
): string[] => {
  const link = (character.compendiumLinks ?? []).find((entry) => entry.appliedAs === 'species' && entry.status === 'active');
  const speciesItem = link
    ? items.find((item) => item.type === 'species' && (item.id === link.itemId || item.importItemId === link.importItemId))
    : undefined;
  return getSpeciesSpellListReferences(
    speciesItem,
    character.buildChoices?.speciesChoices ?? [],
    items,
    character.level,
    className,
    Boolean(className)
  );
};
