import type { AbilityScore, Character, RuleValidationIssue, Spell } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { findCompendiumItemForCharacterLink } from '../compendium/characterLinkIdentity';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

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

export type SpellPreparationMode = 'prepared' | 'known' | 'spellbook' | 'pactKnown';

export interface ClassSpellcastingProfile {
  classItemId: string;
  classImportItemId: string;
  className: string;
  classLevel: number;
  ability?: string;
  progression?: string;
  preparationMode: SpellPreparationMode;
  replacementLimitOnLevelUp: number;
  cantripLimit: number;
  preparedSpellLimit: number;
  spellbookMinimumSpellCount: number;
  spellbookSpellsGainedPerLevel: number;
  maxSpellLevel: number;
  /** Spell-list owners used for eligibility. Usually the class itself; subclass casters can borrow another class list. */
  spellListClassNames: string[];
  /** Slot row for this exact class level, used when the class gains spellcasting from a subclass. */
  slotCounts: Record<string, number>;
  sourceSubclassItemId?: string;
  sourceFeatureItemId?: string;
}

const valueAtClassLevel = (value: unknown, classLevel: number): number => {
  if (!Array.isArray(value)) return 0;
  return Math.max(0, asNumber(value[Math.max(0, classLevel - 1)]) ?? 0);
};

const maxSlotFromRecord = (value: unknown): number => {
  const record = asRecord(value);
  return Object.entries(record).reduce((max, [level, count]) => {
    const slotLevel = Number(level);
    const amount = asNumber(count) ?? 0;
    return amount > 0 && Number.isFinite(slotLevel) ? Math.max(max, slotLevel) : max;
  }, 0);
};

const preparationModeForClass = (className: string, spellcasting: Record<string, unknown>): SpellPreparationMode => {
  const explicit = asString(spellcasting.preparationSource);
  if (explicit === 'spellbook') return 'spellbook';
  const name = normalize(className);
  if (name === 'warlock') return 'pactKnown';
  if (['bard', 'sorcerer'].includes(name)) return 'known';
  if (name === 'wizard') return 'spellbook';
  return 'prepared';
};

const replacementLimitForMode = (mode: SpellPreparationMode): number =>
  mode === 'known' || mode === 'pactKnown' ? 1 : 0;

export const getClassSpellcastingProfile = (
  classItem: StoredCompendiumItem,
  classLevel: number
): ClassSpellcastingProfile | undefined => {
  const payload = asRecord(classItem.normalizedJson);
  const spellcasting = asRecord(payload.spellcasting);
  if (!Object.keys(spellcasting).length) return undefined;

  const slotsByLevel = asRecord(spellcasting.slotsByLevel);
  const classSlots = slotsByLevel[String(classLevel)];
  const pactSlotLevel = valueAtClassLevel(spellcasting.pactSlotLevelByLevel, classLevel);
  const maxSpellLevel = Math.max(maxSlotFromRecord(classSlots), pactSlotLevel);

  const preparationMode = preparationModeForClass(classItem.name, spellcasting);
  return {
    classItemId: classItem.id,
    classImportItemId: classItem.importItemId,
    className: classItem.name,
    classLevel,
    ability: asString(spellcasting.ability),
    progression: asString(spellcasting.progression),
    preparationMode,
    replacementLimitOnLevelUp: replacementLimitForMode(preparationMode),
    cantripLimit: valueAtClassLevel(spellcasting.cantripsKnownByLevel, classLevel),
    preparedSpellLimit: valueAtClassLevel(spellcasting.preparedSpellsByLevel, classLevel),
    spellbookMinimumSpellCount: preparationMode === 'spellbook' ? 6 + Math.max(0, classLevel - 1) * 2 : 0,
    spellbookSpellsGainedPerLevel: preparationMode === 'spellbook' ? 2 : 0,
    maxSpellLevel,
    spellListClassNames: [classItem.name],
    slotCounts: Object.fromEntries(Object.entries(asRecord(classSlots)).flatMap(([level, count]) => {
      const amount = asNumber(count) ?? 0;
      return amount > 0 ? [[level, amount]] : [];
    }))
  };
};


const THIRD_CASTER_PREPARED_BY_LEVEL = [
  0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13
] as const;

const THIRD_CASTER_CANTRIPS_BY_LEVEL = [
  0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3
] as const;

const THIRD_CASTER_SLOTS_BY_LEVEL: Record<number, Record<string, number>> = {
  3: { '1': 2 },
  4: { '1': 3 },
  5: { '1': 3 },
  6: { '1': 3 },
  7: { '1': 4, '2': 2 },
  8: { '1': 4, '2': 2 },
  9: { '1': 4, '2': 2 },
  10: { '1': 4, '2': 3 },
  11: { '1': 4, '2': 3 },
  12: { '1': 4, '2': 3 },
  13: { '1': 4, '2': 3, '3': 2 },
  14: { '1': 4, '2': 3, '3': 2 },
  15: { '1': 4, '2': 3, '3': 2 },
  16: { '1': 4, '2': 3, '3': 3 },
  17: { '1': 4, '2': 3, '3': 3 },
  18: { '1': 4, '2': 3, '3': 3 },
  19: { '1': 4, '2': 3, '3': 3, '4': 1 },
  20: { '1': 4, '2': 3, '3': 3, '4': 1 }
};

const subclassFeatureItems = (
  subclassItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  classLevel: number
): StoredCompendiumItem[] => {
  if (!subclassItem) return [];
  const payload = asRecord(subclassItem.normalizedJson);
  const progression = Array.isArray(payload.progression) ? payload.progression : [];
  const activeRefs = new Set<string>();
  for (const rowValue of progression) {
    const row = asRecord(rowValue);
    const level = asNumber(row.level) ?? 1;
    if (level > classLevel) continue;
    for (const reference of asStringArray(row.featureIds)) activeRefs.add(reference);
  }
  if (!activeRefs.size) {
    for (const reference of asStringArray(payload.featureIds)) activeRefs.add(reference);
  }
  return items.filter((item) => item.type === 'feature' && (activeRefs.has(item.id) || activeRefs.has(item.importItemId)));
};

const thirdCasterProfile = (
  classItem: StoredCompendiumItem,
  classLevel: number,
  subclassItem: StoredCompendiumItem,
  featureItem: StoredCompendiumItem,
  spellcasting: Record<string, unknown>
): ClassSpellcastingProfile | undefined => {
  if (classLevel < 3) return undefined;
  const rawProgression = asString(spellcasting.progression);
  if (rawProgression !== 'eldritchKnightThirdCaster' && rawProgression !== 'arcaneTricksterThirdCaster') return undefined;
  const slotCounts = { ...(THIRD_CASTER_SLOTS_BY_LEVEL[Math.max(3, Math.min(20, classLevel))] ?? {}) };
  return {
    classItemId: classItem.id,
    classImportItemId: classItem.importItemId,
    className: classItem.name,
    classLevel,
    ability: asString(spellcasting.ability) ?? 'INT',
    progression: 'thirdCaster',
    preparationMode: 'known',
    replacementLimitOnLevelUp: 1,
    cantripLimit: THIRD_CASTER_CANTRIPS_BY_LEVEL[Math.max(0, Math.min(20, classLevel)) - 1] ?? 0,
    preparedSpellLimit: THIRD_CASTER_PREPARED_BY_LEVEL[Math.max(0, Math.min(20, classLevel)) - 1] ?? 0,
    spellbookMinimumSpellCount: 0,
    spellbookSpellsGainedPerLevel: 0,
    maxSpellLevel: maxSlotFromRecord(slotCounts),
    spellListClassNames: ['Wizard'],
    slotCounts,
    sourceSubclassItemId: subclassItem.id,
    sourceFeatureItemId: featureItem.id
  };
};

/** Resolves normal class spellcasting first, then spellcasting granted by an active subclass feature. */
export const getClassOrSubclassSpellcastingProfile = (
  classItem: StoredCompendiumItem,
  classLevel: number,
  subclassItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[]
): ClassSpellcastingProfile | undefined => {
  const base = getClassSpellcastingProfile(classItem, classLevel);
  if (base) return base;
  for (const featureItem of subclassFeatureItems(subclassItem, items, classLevel)) {
    const spellcasting = asRecord(asRecord(featureItem.normalizedJson).spellcasting);
    if (!Object.keys(spellcasting).length) continue;
    const profile = subclassItem ? thirdCasterProfile(classItem, classLevel, subclassItem, featureItem, spellcasting) : undefined;
    if (profile) return profile;
  }
  return undefined;
};

export const getActiveSubclassItemForClass = (
  character: Character,
  classEntityId: string,
  items: StoredCompendiumItem[]
): StoredCompendiumItem | undefined => {
  const subclassEntity = character.subclasses.find((entry) => entry.classId === classEntityId);
  if (!subclassEntity) return undefined;
  const link = (character.compendiumLinks ?? []).find((entry) =>
    entry.appliedAs === 'subclass' && entry.appliedEntityId === subclassEntity.id && entry.status === 'active'
  );
  const item = link
    ? findCompendiumItemForCharacterLink(items, link)
    : undefined;
  return item?.type === 'subclass' ? item : undefined;
};

export const spellItemLevel = (spellItem: StoredCompendiumItem): number =>
  Math.max(0, asNumber(asRecord(spellItem.normalizedJson).level) ?? 0);

export const spellItemClasses = (spellItem: StoredCompendiumItem): string[] =>
  asStringArray(asRecord(spellItem.normalizedJson).classes);

const spellReferenceMatches = (spellItem: StoredCompendiumItem, reference: string): boolean =>
  spellItem.id === reference ||
  spellItem.importItemId === reference ||
  asString(asRecord(spellItem.rawJson).id) === reference;

export const isSpellItemEligibleForProfile = (
  spellItem: StoredCompendiumItem,
  profile: ClassSpellcastingProfile,
  additionalSpellReferences: readonly string[] = []
): boolean => {
  if (spellItem.type !== 'spell') return false;
  const spellLevel = spellItemLevel(spellItem);
  const classNames = spellItemClasses(spellItem).map(normalize);
  const eligibleListNames = profile.spellListClassNames.length ? profile.spellListClassNames : [profile.className];
  const onClassList = eligibleListNames.some((className) => classNames.includes(normalize(className)));
  const onAdditionalList = additionalSpellReferences.some((reference) => spellReferenceMatches(spellItem, reference));
  if (!onClassList && !onAdditionalList) return false;
  return spellLevel === 0 ? profile.cantripLimit > 0 : spellLevel <= profile.maxSpellLevel;
};

export const getSpellcastingProfiles = (
  classEntries: Array<{ item: StoredCompendiumItem; level: number; subclassItem?: StoredCompendiumItem }>,
  items: StoredCompendiumItem[] = []
): ClassSpellcastingProfile[] =>
  classEntries
    .map(({ item, level, subclassItem }) => getClassOrSubclassSpellcastingProfile(item, level, subclassItem, items))
    .filter((profile): profile is ClassSpellcastingProfile => Boolean(profile));

export interface SpellAssignmentValidationInput {
  assignments: Record<string, string>;
  spellbookAssignments?: Record<string, string>;
  spellItems: StoredCompendiumItem[];
  profiles: ClassSpellcastingProfile[];
  additionalSpellReferencesByClassItemId?: Record<string, string[]>;
  requireExact?: boolean;
}

export interface SpellAssignmentValidationResult {
  ok: boolean;
  issues: RuleValidationIssue[];
  countsByClassItemId: Record<string, { cantrips: number; prepared: number; spellbook: number }>;
}

export const validateSpellAssignments = ({
  assignments,
  spellbookAssignments = {},
  spellItems,
  profiles,
  additionalSpellReferencesByClassItemId = {},
  requireExact = true
}: SpellAssignmentValidationInput): SpellAssignmentValidationResult => {
  const issues: RuleValidationIssue[] = [];
  const profileMap = new Map(profiles.map((profile) => [profile.classItemId, profile]));
  const itemMap = new Map(spellItems.map((item) => [item.id, item]));
  const countsByClassItemId: Record<string, { cantrips: number; prepared: number; spellbook: number }> = {};

  for (const profile of profiles) countsByClassItemId[profile.classItemId] = { cantrips: 0, prepared: 0, spellbook: 0 };

  for (const [spellItemId, classItemId] of Object.entries(assignments)) {
    const profile = profileMap.get(classItemId);
    const spellItem = itemMap.get(spellItemId);
    if (!profile || !spellItem) {
      issues.push({ severity: 'error', code: 'SPELL_ASSIGNMENT_REFERENCE_INVALID', message: 'Uma escolha de magia aponta para classe ou magia ausente.' });
      continue;
    }
    if (!isSpellItemEligibleForProfile(spellItem, profile, additionalSpellReferencesByClassItemId[classItemId] ?? [])) {
      issues.push({
        severity: 'error',
        code: 'SPELL_NOT_ON_CLASS_LIST_OR_LEVEL',
        message: `${spellItem.name} não pertence à lista de ${profile.className} ou exige um nível de magia ainda indisponível.`
      });
      continue;
    }
    const counts = countsByClassItemId[classItemId] ?? { cantrips: 0, prepared: 0, spellbook: 0 };
    if (spellItemLevel(spellItem) === 0) counts.cantrips += 1;
    else counts.prepared += 1;
    countsByClassItemId[classItemId] = counts;
  }

  for (const [spellItemId, classItemId] of Object.entries(spellbookAssignments)) {
    const profile = profileMap.get(classItemId);
    const spellItem = itemMap.get(spellItemId);
    if (!profile || !spellItem || profile.preparationMode !== 'spellbook') {
      issues.push({ severity: 'error', code: 'SPELLBOOK_ASSIGNMENT_REFERENCE_INVALID', message: 'Uma entrada do spellbook aponta para classe ou magia inválida.' });
      continue;
    }
    if (!isSpellItemEligibleForProfile(spellItem, profile, additionalSpellReferencesByClassItemId[classItemId] ?? []) || spellItemLevel(spellItem) === 0) {
      issues.push({ severity: 'error', code: 'SPELLBOOK_SPELL_NOT_ELIGIBLE', message: `${spellItem.name} não pode ser aprendida no spellbook de ${profile.className} neste nível.` });
      continue;
    }
    const counts = countsByClassItemId[classItemId] ?? { cantrips: 0, prepared: 0, spellbook: 0 };
    counts.spellbook += 1;
    countsByClassItemId[classItemId] = counts;
  }

  for (const profile of profiles) {
    const counts = countsByClassItemId[profile.classItemId] ?? { cantrips: 0, prepared: 0, spellbook: 0 };
    const cantripInvalid = requireExact
      ? counts.cantrips !== profile.cantripLimit
      : counts.cantrips > profile.cantripLimit;
    const preparedInvalid = requireExact
      ? counts.prepared !== profile.preparedSpellLimit
      : counts.prepared > profile.preparedSpellLimit;

    if (cantripInvalid) {
      issues.push({
        severity: 'error',
        code: 'CANTRIP_SELECTION_COUNT',
        message: `${profile.className} ${profile.classLevel} exige ${profile.cantripLimit} cantrip(s); selecionado(s): ${counts.cantrips}.`
      });
    }
    if (preparedInvalid) {
      issues.push({
        severity: 'error',
        code: 'PREPARED_SPELL_SELECTION_COUNT',
        message: `${profile.className} ${profile.classLevel} exige ${profile.preparedSpellLimit} magia(s) preparada(s/conhecida(s)); selecionada(s): ${counts.prepared}.`
      });
    }
    if (profile.preparationMode === 'spellbook') {
      const spellbookInvalid = requireExact
        ? counts.spellbook !== profile.spellbookMinimumSpellCount
        : false;
      if (spellbookInvalid) {
        issues.push({
          severity: 'error',
          code: 'SPELLBOOK_SELECTION_COUNT',
          message: `${profile.className} ${profile.classLevel} exige ${profile.spellbookMinimumSpellCount} magia(s) no spellbook na criação; selecionada(s): ${counts.spellbook}.`
        });
      }
      for (const [spellItemId, classItemId] of Object.entries(assignments)) {
        if (classItemId !== profile.classItemId) continue;
        const spellItem = itemMap.get(spellItemId);
        if (spellItem && spellItemLevel(spellItem) > 0 && spellbookAssignments[spellItemId] !== profile.classItemId) {
          issues.push({ severity: 'error', code: 'PREPARED_SPELL_NOT_IN_SPELLBOOK', message: `${spellItem.name} precisa estar no spellbook antes de ser preparada.` });
        }
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    countsByClassItemId
  };
};

export const annotateLatestSpellWithClass = (
  before: Character,
  after: Character,
  classEntityId: string,
  className: string,
  spellcastingAbility?: string
): Character => {
  const beforeIds = new Set(before.spells.map((spell) => spell.id));
  const addedSpell = after.spells.find((spell) => !beforeIds.has(spell.id));
  if (!addedSpell) return after;
  return {
    ...after,
    spells: after.spells.map((spell) =>
      spell.id === addedSpell.id
        ? {
            ...spell,
            spellcastingClassId: classEntityId,
            spellcastingClassName: className,
            spellcastingAbility: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes((spellcastingAbility ?? '').toUpperCase())
              ? spellcastingAbility!.toUpperCase() as AbilityScore
              : spell.spellcastingAbility,
            prepared: true
          }
        : spell
    )
  };
};

export const spellCountsAgainstNormalClassLimit = (spell: Spell): boolean =>
  !spell.grantedByFeatEntityId &&
  !spell.grantedByFeatureEntityId &&
  !spell.grantedByInvocationItemId &&
  !spell.bonusSpellChoiceId &&
  !spell.spellbookSpecialChoiceId &&
  !spell.mysticArcanumChoiceId &&
  !(spell.automaticSpellAccessSources?.length) &&
  !(spell.externalSpellGrantSources?.length);

export const countCharacterSpellsForClass = (
  spells: Spell[],
  classEntityId: string
): { cantrips: number; prepared: number } =>
  spells.reduce(
    (counts, spell) => {
      if (spell.spellcastingClassId !== classEntityId || !spellCountsAgainstNormalClassLimit(spell)) return counts;
      if (spell.level === 0) counts.cantrips += 1;
      else counts.prepared += 1;
      return counts;
    },
    { cantrips: 0, prepared: 0 }
  );


export interface SpellLevelUpChangePlan {
  classItemId: string;
  className: string;
  preparationMode: SpellPreparationMode;
  cantripsToAdd: number;
  leveledSpellsToAdd: number;
  replacementsAllowed: number;
  spellbookSpellsToLearn: number;
  canFreelyReprepare: boolean;
}

export const getSpellLevelUpChangePlan = (
  before: ClassSpellcastingProfile | undefined,
  after: ClassSpellcastingProfile | undefined
): SpellLevelUpChangePlan | undefined => {
  if (!after) return undefined;
  return {
    classItemId: after.classItemId,
    className: after.className,
    preparationMode: after.preparationMode,
    cantripsToAdd: Math.max(0, after.cantripLimit - (before?.cantripLimit ?? 0)),
    leveledSpellsToAdd: Math.max(0, after.preparedSpellLimit - (before?.preparedSpellLimit ?? 0)),
    replacementsAllowed: before ? after.replacementLimitOnLevelUp : 0,
    spellbookSpellsToLearn: after.preparationMode === 'spellbook'
      ? Math.max(0, after.spellbookMinimumSpellCount - (before?.spellbookMinimumSpellCount ?? 0))
      : 0,
    canFreelyReprepare: after.preparationMode === 'prepared' || after.preparationMode === 'spellbook'
  };
};

export const isSpellExchangeAllowedOnLevelUp = (
  profile: ClassSpellcastingProfile,
  removedCount: number,
  addedCount: number,
  gainedCount: number
): boolean => {
  if (profile.preparationMode === 'prepared' || profile.preparationMode === 'spellbook') return true;
  const replacementCount = Math.max(0, removedCount);
  return replacementCount <= profile.replacementLimitOnLevelUp && addedCount <= gainedCount + replacementCount;
};
