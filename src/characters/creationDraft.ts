import type {
  AbilityGenerationMethod,
  AbilityGenerationState,
  AbilityScore,
  AbilityScores,
  CharacterEldritchInvocationChoice,
  CharacterEquipmentSelection,
  CharacterBackgroundChoice,
  CharacterCustomBackgroundChoice,
  CharacterFeatChoice,
  CharacterHigherLevelStartingBenefits,
  CharacterSpeciesChoice,
  CharacterSubclassChoice
} from '../types';
import type { KeyValueStorageAdapter } from '../storage/keyValueStorage';
import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';
import { STANDARD_ARRAY } from './abilityGeneration';
import { sanitizeCustomBackgroundChoice } from './customBackgroundRules';

export const CHARACTER_CREATION_DRAFT_KEY = 'dnd-combat-math-character-creation-draft';
export const CHARACTER_CREATION_DRAFT_VERSION = 13;

export interface CharacterCreationDraft {
  version: typeof CHARACTER_CREATION_DRAFT_VERSION;
  updatedAt: string;
  step: number;
  name: string;
  targetLevel: string;
  classSearch: string;
  selectedClassLevels: Record<string, number>;
  startingClassItemId?: string;
  selectedSpeciesId?: string;
  speciesChoices: CharacterSpeciesChoice[];
  selectedSpeciesFeatId?: string;
  selectedBackgroundId?: string;
  backgroundChoices: CharacterBackgroundChoice[];
  customBackground?: CharacterCustomBackgroundChoice;
  selectedSubclassByClass: Record<string, string>;
  subclassChoices: CharacterSubclassChoice[];
  selectedOriginFeatId?: string;
  selectedFeatCounts: Record<string, number>;
  selectedInvocationCounts: Record<string, number>;
  eldritchInvocationChoices: CharacterEldritchInvocationChoice[];
  featChoiceDrafts: Record<string, CharacterFeatChoice>;
  equipmentSelections: CharacterEquipmentSelection[];
  higherLevelStartingBenefits?: CharacterHigherLevelStartingBenefits;
  bonusMode: 'twoOne' | 'threeOnes';
  bonusAbilities: AbilityScore[];
  abilityMethod: AbilityGenerationMethod;
  abilityGeneration: AbilityGenerationState;
  abilityValueAssignments: Partial<Record<AbilityScore, number>>;
  baseAbilities: AbilityScores;
  classSkillChoices: string[];
  classToolChoicesText: string;
  backgroundToolChoicesText?: string;
  expertiseSkills: string[];
  languagesText: string;
  classLanguagesText?: string;
  spellSearch: string;
  activeSpellClassItemId?: string;
  spellAssignments: Record<string, string>;
  spellbookAssignments: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const normalizeOptionalChoiceReference = (value: unknown): string | undefined => {
  const reference = asOptionalString(value);
  return reference ? normalizeCharacterChoiceReference(reference) : undefined;
};

const asNumberRecord = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .map(([key, number]) => [normalizeCharacterChoiceReference(key), Math.max(0, Math.floor(number))])
  );
};

const asStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, target]) => [normalizeCharacterChoiceReference(key), normalizeCharacterChoiceReference(target)])
  );
};

const asBackgroundChoices = (value: unknown): CharacterBackgroundChoice[] =>
  Array.isArray(value) ? value.flatMap((raw): CharacterBackgroundChoice[] => {
    if (!isRecord(raw)) return [];
    const backgroundItemId = normalizeOptionalChoiceReference(raw.backgroundItemId);
    const choiceType = asOptionalString(raw.choiceType);
    const optionId = asOptionalString(raw.optionId);
    return backgroundItemId && choiceType && optionId ? [{ backgroundItemId, choiceType, optionId }] : [];
  }) : [];

const asSubclassChoices = (value: unknown): CharacterSubclassChoice[] =>
  Array.isArray(value)
    ? value.flatMap((raw): CharacterSubclassChoice[] => {
        if (!isRecord(raw)) return [];
        const subclassItemId = normalizeOptionalChoiceReference(raw.subclassItemId);
        const choiceId = asOptionalString(raw.choiceId);
        const optionId = asOptionalString(raw.optionId);
        return subclassItemId && choiceId && optionId ? [{ subclassItemId, choiceId, optionId }] : [];
      })
    : [];

const normalizeFeatChoiceDraftKey = (key: string): string => {
  const match = key.match(/^((?:origin|species)::)?(.+)::(\d+)$/);
  if (!match) return normalizeCharacterChoiceReference(key);
  return `${match[1] ?? ''}${normalizeCharacterChoiceReference(match[2] ?? '')}::${match[3]}`;
};

const asFeatChoiceDrafts = (value: unknown): Record<string, CharacterFeatChoice> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]): Array<[string, CharacterFeatChoice]> => {
      if (!isRecord(raw)) return [];
      const featItemId = normalizeOptionalChoiceReference(raw.featItemId);
      if (!featItemId) return [];
      const choice = raw as unknown as CharacterFeatChoice;
      return [[normalizeFeatChoiceDraftKey(key), {
        ...choice,
        featItemId,
        spellItemIds: asStringArray(raw.spellItemIds).map(normalizeCharacterChoiceReference),
        weaponItemIds: asStringArray(raw.weaponItemIds).map(normalizeCharacterChoiceReference),
        fightingStyleItemId: normalizeOptionalChoiceReference(raw.fightingStyleItemId),
        weaponMasterySelections: Array.isArray(raw.weaponMasterySelections)
          ? (raw.weaponMasterySelections as NonNullable<CharacterFeatChoice['weaponMasterySelections']>).map((selection) => ({
              ...selection,
              sourceItemId: selection.sourceItemId
                ? normalizeCharacterChoiceReference(selection.sourceItemId)
                : undefined,
              weaponItemId: selection.weaponItemId
                ? normalizeCharacterChoiceReference(selection.weaponItemId)
                : undefined
            }))
          : []
      }]];
    })
  );
};

const asEldritchInvocationChoices = (value: unknown): CharacterEldritchInvocationChoice[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): CharacterEldritchInvocationChoice[] => {
    if (!isRecord(raw)) return [];
    const invocationItemId = normalizeOptionalChoiceReference(raw.invocationItemId);
    if (!invocationItemId) return [];
    return [{
      id: asOptionalString(raw.id) ?? `invocation-choice-${invocationItemId}-${Number(raw.instanceIndex) || 0}`,
      invocationItemId,
      instanceIndex: typeof raw.instanceIndex === 'number' ? Math.max(0, Math.floor(raw.instanceIndex)) : 0,
      cantripItemIds: asStringArray(raw.cantripItemIds).map(normalizeCharacterChoiceReference),
      ritualSpellItemIds: asStringArray(raw.ritualSpellItemIds).map(normalizeCharacterChoiceReference),
      targetCantripItemId: normalizeOptionalChoiceReference(raw.targetCantripItemId),
      originFeatItemId: normalizeOptionalChoiceReference(raw.originFeatItemId),
      familiarCreatureItemId: normalizeOptionalChoiceReference(raw.familiarCreatureItemId),
      familiarVariant: raw.familiarVariant === 'standard' || raw.familiarVariant === 'special' ? raw.familiarVariant : undefined,
      lifedrinkerDamageType: raw.lifedrinkerDamageType === 'necrotic' || raw.lifedrinkerDamageType === 'psychic' || raw.lifedrinkerDamageType === 'radiant' ? raw.lifedrinkerDamageType : undefined,
      chainMasterMovementMode: raw.chainMasterMovementMode === 'fly' || raw.chainMasterMovementMode === 'swim' ? raw.chainMasterMovementMode : undefined,
      notes: asOptionalString(raw.notes)
    }];
  });
};


const asSpeciesChoices = (value: unknown): CharacterSpeciesChoice[] => {
  if (!Array.isArray(value)) return [];
  const result: CharacterSpeciesChoice[] = [];
  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) continue;
    const choiceKind = rawEntry.choiceKind;
    if (
      choiceKind !== 'ancestry' &&
      choiceKind !== 'lineage' &&
      choiceKind !== 'legacy' &&
      choiceKind !== 'revelation' &&
      choiceKind !== 'option' &&
      choiceKind !== 'size' &&
      choiceKind !== 'variableTrait' &&
      choiceKind !== 'language'
    ) continue;
    const speciesItemId = normalizeOptionalChoiceReference(rawEntry.speciesItemId);
    const featureItemId = normalizeOptionalChoiceReference(rawEntry.featureItemId);
    const optionId = asOptionalString(rawEntry.optionId);
    if (!speciesItemId || !featureItemId || !optionId) continue;
    const ability = asOptionalString(rawEntry.spellcastingAbility)?.toUpperCase();
    const entry: CharacterSpeciesChoice = {
      speciesItemId,
      featureItemId,
      choiceKind,
      optionId,
      skill: asOptionalString(rawEntry.skill),
      language: asOptionalString(rawEntry.language)
    };
    if (ability && ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(ability)) {
      entry.spellcastingAbility = ability as AbilityScore;
    }
    result.push(entry);
  }
  return result;
};



const asEquipmentSelections = (value: unknown): CharacterEquipmentSelection[] =>
  Array.isArray(value) ? (value as CharacterEquipmentSelection[]).map((selection) => ({
    ...selection,
    sourceItemId: normalizeCharacterChoiceReference(selection.sourceItemId),
    items: selection.items?.map((item) => ({
      ...item,
      compendiumItemId: item.compendiumItemId
        ? normalizeCharacterChoiceReference(item.compendiumItemId)
        : undefined
    }))
  })) : [];

const asHigherLevelStartingBenefits = (value: unknown): CharacterHigherLevelStartingBenefits | undefined => {
  if (!isRecord(value)) return undefined;
  const startingLevel = typeof value.startingLevel === 'number' ? Math.max(1, Math.min(20, Math.floor(value.startingLevel))) : undefined;
  const rolledD10 = typeof value.rolledD10 === 'number' ? Math.max(1, Math.min(10, Math.floor(value.rolledD10))) : undefined;
  const baseGold = typeof value.baseGold === 'number' ? Math.max(0, Math.floor(value.baseGold)) : undefined;
  const goldMultiplier = typeof value.goldMultiplier === 'number' ? Math.max(0, Math.floor(value.goldMultiplier)) : undefined;
  const bonusGold = typeof value.bonusGold === 'number' ? Math.max(0, Math.floor(value.bonusGold)) : undefined;
  if (startingLevel === undefined || rolledD10 === undefined || baseGold === undefined || goldMultiplier === undefined || bonusGold === undefined) return undefined;
  const allowance = isRecord(value.magicItemAllowance) ? value.magicItemAllowance : {};
  const count = (rarity: string): number | undefined => {
    const raw = allowance[rarity];
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : undefined;
  };
  return {
    startingLevel,
    rolledD10,
    baseGold,
    goldMultiplier,
    bonusGold,
    magicItemAllowance: {
      common: count('common'),
      uncommon: count('uncommon'),
      rare: count('rare'),
      veryRare: count('veryRare')
    },
    generatedAt: asString(value.generatedAt, new Date(0).toISOString())
  };
};

const defaultAbilities: AbilityScores = {
  STR: 15,
  DEX: 14,
  CON: 13,
  INT: 12,
  WIS: 10,
  CHA: 8
};

const asAbilityValueAssignments = (value: unknown): Partial<Record<AbilityScore, number>> => {
  if (!isRecord(value)) return {};
  const result: Partial<Record<AbilityScore, number>> = {};
  const used = new Set<number>();
  for (const ability of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as AbilityScore[]) {
    const raw = value[ability];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < 6 && !used.has(raw)) {
      result[ability] = raw;
      used.add(raw);
    }
  }
  return result;
};

const asAbilities = (value: unknown): AbilityScores => {
  const record = isRecord(value) ? value : {};
  const score = (ability: AbilityScore): number => {
    const raw = record[ability];
    return typeof raw === 'number' && Number.isFinite(raw)
      ? Math.max(1, Math.min(30, raw))
      : defaultAbilities[ability];
  };
  return { STR: score('STR'), DEX: score('DEX'), CON: score('CON'), INT: score('INT'), WIS: score('WIS'), CHA: score('CHA') };
};

export const sanitizeCharacterCreationDraft = (value: unknown): CharacterCreationDraft | undefined => {
  if (!isRecord(value)) return undefined;
  const method = value.abilityMethod;
  const abilityMethod: AbilityGenerationMethod =
    method === 'pointBuy' || method === 'diceRoll' || method === 'manual' ? method : 'standardArray';
  const generation = isRecord(value.abilityGeneration) ? value.abilityGeneration : {};
  const diceRolls = Array.isArray(generation.diceRolls) ? generation.diceRolls as AbilityGenerationState['diceRolls'] : undefined;
  const storedGeneratedValues = Array.isArray(generation.generatedValues)
    ? generation.generatedValues.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : [];
  const generatedValues = abilityMethod === 'standardArray'
    ? [...STANDARD_ARRAY]
    : abilityMethod === 'diceRoll' && diceRolls?.length === 6
      ? diceRolls.map((roll) => roll.total)
      : storedGeneratedValues;

  return {
    version: CHARACTER_CREATION_DRAFT_VERSION,
    updatedAt: asString(value.updatedAt, new Date(0).toISOString()),
    step: Math.max(0, Math.min(7, typeof value.step === 'number' ? Math.floor(value.step) : 0)),
    name: asString(value.name),
    targetLevel: asString(value.targetLevel, '1'),
    classSearch: asString(value.classSearch),
    selectedClassLevels: asNumberRecord(value.selectedClassLevels),
    startingClassItemId: normalizeOptionalChoiceReference(value.startingClassItemId),
    selectedSpeciesId: normalizeOptionalChoiceReference(value.selectedSpeciesId),
    speciesChoices: asSpeciesChoices(value.speciesChoices),
    selectedSpeciesFeatId: normalizeOptionalChoiceReference(value.selectedSpeciesFeatId),
    selectedBackgroundId: normalizeOptionalChoiceReference(value.selectedBackgroundId),
    backgroundChoices: asBackgroundChoices(value.backgroundChoices),
    customBackground: sanitizeCustomBackgroundChoice(value.customBackground),
    selectedSubclassByClass: asStringRecord(value.selectedSubclassByClass),
    subclassChoices: asSubclassChoices(value.subclassChoices),
    selectedOriginFeatId: normalizeOptionalChoiceReference(value.selectedOriginFeatId),
    selectedFeatCounts: asNumberRecord(value.selectedFeatCounts),
    selectedInvocationCounts: asNumberRecord(value.selectedInvocationCounts),
    eldritchInvocationChoices: asEldritchInvocationChoices(value.eldritchInvocationChoices),
    featChoiceDrafts: asFeatChoiceDrafts(value.featChoiceDrafts),
    equipmentSelections: asEquipmentSelections(value.equipmentSelections),
    higherLevelStartingBenefits: asHigherLevelStartingBenefits(value.higherLevelStartingBenefits),
    bonusMode: value.bonusMode === 'threeOnes' ? 'threeOnes' : 'twoOne',
    bonusAbilities: asStringArray(value.bonusAbilities).filter((entry): entry is AbilityScore => ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(entry)),
    abilityMethod,
    abilityGeneration: {
      method: abilityMethod,
      generatedValues,
      pointBuyBudget: typeof generation.pointBuyBudget === 'number' ? generation.pointBuyBudget : undefined,
      pointBuySpent: typeof generation.pointBuySpent === 'number' ? generation.pointBuySpent : undefined,
      diceRolls
    },
    abilityValueAssignments: asAbilityValueAssignments(value.abilityValueAssignments),
    baseAbilities: asAbilities(value.baseAbilities),
    classSkillChoices: asStringArray(value.classSkillChoices),
    classToolChoicesText: asString(value.classToolChoicesText),
    backgroundToolChoicesText: asString(value.backgroundToolChoicesText),
    expertiseSkills: asStringArray(value.expertiseSkills),
    languagesText: asString(value.languagesText),
    classLanguagesText: asString(value.classLanguagesText),
    spellSearch: asString(value.spellSearch),
    activeSpellClassItemId: normalizeOptionalChoiceReference(value.activeSpellClassItemId),
    spellAssignments: asStringRecord(value.spellAssignments),
    spellbookAssignments: asStringRecord(value.spellbookAssignments)
  };
};

export class CharacterCreationDraftRepository {
  constructor(
    private readonly storage: KeyValueStorageAdapter,
    private readonly key = CHARACTER_CREATION_DRAFT_KEY
  ) {}

  async load(): Promise<CharacterCreationDraft | undefined> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return undefined;
    try {
      return sanitizeCharacterCreationDraft(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  async save(draft: CharacterCreationDraft): Promise<void> {
    await this.storage.setItem(this.key, JSON.stringify(sanitizeCharacterCreationDraft(draft) ?? draft));
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.key);
  }
}

