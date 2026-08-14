import type {
  AbilityScore,
  ActionCost,
  ActiveEffectTemplate,
  DamageFormula,
  DamageSourceType,
  DiceTerm,
  RuleSource
} from '../types';
export { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

/**
 * Canonical import-domain primitives.
 *
 * This module deliberately reuses runtime types where the app already has a
 * stable representation. It is the first shared-domain layer for
 * dnd-combat-import.v2; adapters for legacy v1 values live outside this file.
 */
export const COMPENDIUM_ENTITY_KINDS = [
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'weapon',
  'armor',
  'equipment',
  'magicItem',
  'spell',
  'feature',
  'condition',
  'creatureStatBlock'
] as const;

export type CompendiumEntityKind = (typeof COMPENDIUM_ENTITY_KINDS)[number];

export const ABILITY_SCORES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const satisfies readonly AbilityScore[];
export const ACTION_COSTS = ['action', 'bonusAction', 'reaction', 'movement', 'free', 'special'] as const satisfies readonly ActionCost[];

export const SKILLS = [
  'Acrobatics',
  'Animal Handling',
  'Arcana',
  'Athletics',
  'Deception',
  'History',
  'Insight',
  'Intimidation',
  'Investigation',
  'Medicine',
  'Nature',
  'Perception',
  'Performance',
  'Persuasion',
  'Religion',
  'Sleight of Hand',
  'Stealth',
  'Survival'
] as const;

export type SkillName = (typeof SKILLS)[number];

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder'
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/**
 * Canonical representation for damage types that are not a single fixed type.
 *
 * The current PHB dataset contains legitimate mechanics such as a choice of
 * elemental damage, damage inherited from a weapon, and multi-type effects.
 * Keeping those values as ad-hoc strings makes every downstream consumer parse
 * them again. V2 promotes those recurring shapes while retaining a `custom`
 * escape hatch for data that still needs editorial review.
 */
export type DamageTypeReference =
  | DamageType
  | { kind: 'choice'; options: DamageType[]; label?: string }
  | { kind: 'multiple'; types: DamageType[]; label?: string }
  | { kind: 'sameAs'; source: 'weapon' | 'attack' | 'trigger'; label?: string }
  | { kind: 'variable'; key?: string; options?: DamageType[]; label?: string }
  | { kind: 'custom'; value: string; label?: string };

/** Values that can resolve to one ability at runtime without pretending that
 * composite selectors such as STR_OR_DEX are AbilityScore values. */
export type AbilityReference =
  | AbilityScore
  | { kind: 'choice'; options: AbilityScore[]; label?: string }
  | { kind: 'spellcasting'; label?: string }
  | { kind: 'sameAsAttack'; label?: string }
  | { kind: 'variable'; key?: string; label?: string };

export const CURRENCY_UNITS = ['CP', 'SP', 'EP', 'GP', 'PP'] as const;
export type CurrencyUnit = (typeof CURRENCY_UNITS)[number];

export interface CurrencyValue {
  amount: number;
  unit: CurrencyUnit;
}

export interface ActionTimingDetail {
  /** Canonical runtime action cost after alias normalization. */
  actionCost: ActionCost;
  /** Original semantic subtype when ActionCost alone is not expressive enough. */
  subtype?:
    | 'passive'
    | 'magicAction'
    | 'attackAction'
    | 'helpAction'
    | 'utilize'
    | 'attackReplacement'
    | 'finishLongRest'
    | 'triggered'
    | 'other';
  trigger?: string;
  original?: string;
}

export type CastingTimeUnit = 'minute' | 'hour' | 'day';

export type CastingTimeDefinition =
  | {
      kind: 'action';
      actionCost: ActionCost;
      ritualAlternative?: boolean;
      trigger?: string;
      original?: string;
    }
  | {
      kind: 'duration';
      amount: number;
      unit: CastingTimeUnit;
      ritualAlternative?: boolean;
      original?: string;
    }
  | {
      kind: 'special';
      actionCost?: ActionCost;
      label: string;
      ritualAlternative?: boolean;
      original?: string;
    };

export interface TargetDefinition {
  count?: number;
  description?: string;
  [extension: string]: unknown;
}

export type RulesEra = '2024' | 'legacy';
export type ContentType = 'official' | 'third-party' | 'homebrew';

/** Existing RuleSource remains authoritative; V2 only adds optional metadata. */
export interface CompendiumImportSource extends RuleSource {
  publisher?: string;
  rulesEra?: RulesEra;
  contentType?: ContentType;
  /** Schema V2 is extensible; preserve unknown source metadata without losing the shared-domain type. */
  [extension: string]: unknown;
}

export interface CompendiumReference {
  id: string;
  kind?: CompendiumEntityKind;
}

export interface LevelProgressionEntry {
  level: number;
  featureIds: string[];
  [extension: string]: unknown;
}

export interface AbilityScoreIncreaseRule {
  chooseOnePlus2AndDifferentOnePlus1?: boolean;
  orIncreaseAllBy1?: boolean;
  maximumScoreAfterIncrease?: number;
}

export interface ProficiencyChoice {
  count: number;
  options?: string[];
  from?: 'skills' | 'tools' | 'languages' | 'weapons' | 'armor' | 'custom';
  [extension: string]: unknown;
}

export interface ResourceScaling {
  kind: 'characterLevel' | 'classLevel' | 'proficiencyBonus' | 'abilityModifier' | 'custom';
  steps?: Array<{ level?: number; value: number }>;
  formula?: string;
  /** Ability used by canonical ability-modifier scaling. */
  ability?: AbilityScore;
  /** Optional floor for formulas such as max(1, INT modifier). */
  minimum?: number;
  [extension: string]: unknown;
}

export interface ResourceDefinition {
  id: string;
  name?: string;
  max?: number | ResourceScaling;
  recharge?: 'turn' | 'shortRest' | 'longRest' | 'day' | 'manual';
  recoveryRules?: Array<{
    trigger: 'turn' | 'shortRest' | 'longRest' | 'day' | 'manual' | 'initiative' | 'custom';
    amount: number | 'all';
    condition?: string;
  }>;
  [extension: string]: unknown;
}

export interface ResourceConsumption {
  resourceId?: string;
  itemId?: string;
  targetResource?: string;
  /** Fixed costs are numeric; variable source costs such as `1+` or `1-5` remain explicit strings until a choice resolves them. */
  amount: number | string;
  [extension: string]: unknown;
}

export interface StringDamageScalingStep {
  level?: number;
  minCharacterLevel?: number;
  slotLevel?: number;
  damageFormula?: string;
  formula?: string;
  attacksCount?: number;
  [extension: string]: unknown;
}

export type ImportScalingDefinition =
  | {
      kind: 'characterLevel' | 'classLevel';
      steps: StringDamageScalingStep[];
      notes?: string;
      [extension: string]: unknown;
    }
  | {
      kind: 'slotLevel';
      baseLevel?: number;
      dicePerStep?: DiceTerm;
      steps?: StringDamageScalingStep[];
      notes?: string;
      [extension: string]: unknown;
    }
  | {
      kind: 'none' | 'custom';
      steps?: StringDamageScalingStep[];
      notes?: string;
      [extension: string]: unknown;
    };

export interface GrantedActionDefinition {
  type: string;
  name: string;
  actionCost?: ActionCost;
  actionTiming?: ActionTimingDetail;
  sourceType?: DamageSourceType | string;
  damageFormula?: string;
  healingFormula?: string;
  damageType?: DamageTypeReference;
  consumes?: ResourceConsumption[];
  [extension: string]: unknown;
}

export interface ClassSpellcastingDefinition {
  ability?: AbilityScore;
  progression?: string;
  preparationSource?: string;
  cantripsKnownByLevel?: number[];
  spellsKnownByLevel?: number[];
  preparedSpellsByLevel?: number[];
  slotsByLevel?: Record<string, Record<string, number>>;
  pactSlotsByLevel?: number[] | Record<string, number>;
  pactSlotLevelByLevel?: number[] | Record<string, number>;
  ritualCasting?: boolean | string;
  spellcastingFocus?: string | string[];
  [extension: string]: unknown;
}

export interface EquipmentOptionDefinition {
  id?: string;
  label?: string;
  items?: string[];
  itemIds?: string[];
  currency?: CurrencyValue[];
  [extension: string]: unknown;
}

export interface ClassPayload {
  level?: number;
  hitDie?: number;
  primaryAbilities?: AbilityScore[];
  savingThrowProficiencies?: AbilityScore[];
  skillChoiceCount?: number;
  skillProficienciesChoice?: string[] | ProficiencyChoice;
  weaponProficiencies?: string[];
  armorTraining?: string[];
  toolProficiencies?: string[];
  featureIds?: string[];
  progression?: LevelProgressionEntry[];
  spellcasting?: ClassSpellcastingDefinition | null;
  resources?: ResourceDefinition[];
  equipmentOptions?: Record<string, string[] | EquipmentOptionDefinition>;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface SubclassPayload {
  classId: string;
  featureIds?: string[];
  progression?: LevelProgressionEntry[];
  tags?: string[];
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface SpeciesPayload {
  creatureType?: string;
  speed?: number | Record<string, number>;
  size?: string | string[];
  heightRange?: string;
  featureIds?: string[];
  engineKey?: string;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface BackgroundPayload {
  abilityScoreOptions?: AbilityScore[];
  abilityScoreIncreaseRule?: AbilityScoreIncreaseRule;
  featIds?: string[];
  featChoice?: Record<string, unknown>;
  skillProficiencies?: SkillName[] | string[];
  skillProficiencyChoice?: ProficiencyChoice;
  toolProficiencies?: string[];
  toolProficiencyChoice?: ProficiencyChoice;
  languageProficiencies?: string[];
  languageProficiencyChoice?: ProficiencyChoice;
  equipmentOptions?: Record<string, string[] | EquipmentOptionDefinition>;
  grantsFeatureIds?: string[];
  engineKey?: string;
  customBackground?: boolean;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface FeatMechanics {
  proficiencyChoice?: ProficiencyChoice;
  skillProficiencyChoice?: number | ProficiencyChoice;
  toolProficiencyChoice?: ProficiencyChoice;
  languageProficiencyChoice?: ProficiencyChoice;
  expertiseChoice?: ProficiencyChoice;
  spellListChoice?: string[] | string;
  spellcastingAbilityChoice?: AbilityScore[];
  damageTypeChoice?: DamageType[] | Record<string, unknown>;
  prerequisites?: StructuredPrerequisite;
  [futureExtension: string]: unknown;
}

export interface FeatPayload {
  category?: string;
  prerequisite?: string | StructuredPrerequisite;
  abilityScoreIncrease?: AbilityScore[] | Array<Record<string, unknown>>;
  repeatable?: boolean;
  featureIds?: string[];
  mechanics?: FeatMechanics;
  grantsActions?: GrantedActionDefinition[];
  effectTemplates?: Array<Partial<ActiveEffectTemplate> & Record<string, unknown>>;
  tags?: string[];
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface StructuredPrerequisite {
  level?: number;
  classIds?: string[];
  subclassIds?: string[];
  featureIds?: string[];
  featIds?: string[];
  spellIds?: string[];
  abilities?: Partial<Record<AbilityScore, number>>;
  [extension: string]: unknown;
}

export interface FeatureMechanics {
  proficiencyChoice?: ProficiencyChoice;
  skillProficiencyChoice?: number | ProficiencyChoice;
  toolProficiencyChoice?: ProficiencyChoice;
  languageProficiencyChoice?: ProficiencyChoice;
  expertiseChoice?: ProficiencyChoice;
  spellListChoice?: string[] | string;
  spellcastingAbilityChoice?: AbilityScore[];
  damageTypeChoice?: DamageType[] | Record<string, unknown>;
  masteryPropertyChoice?: string[] | Record<string, unknown>;
  prerequisites?: StructuredPrerequisite;
  [futureExtension: string]: unknown;
}

export interface FeaturePayload {
  sourceType: string;
  classId?: string;
  subclassId?: string;
  speciesId?: string;
  levelGained?: number;
  actionCost?: ActionCost;
  actionTiming?: ActionTimingDetail;
  prerequisite?: string | StructuredPrerequisite;
  requiresConcentration?: boolean;
  damageFormula?: string;
  damageType?: DamageTypeReference;
  conditionalDamage?: Array<Record<string, unknown>>;
  resource?: ResourceDefinition;
  consumes?: ResourceConsumption[];
  grantsActions?: GrantedActionDefinition[];
  effectTemplates?: Array<Partial<ActiveEffectTemplate> & Record<string, unknown>>;
  oncePerTurnKey?: string;
  engineKey?: string;
  mechanics?: FeatureMechanics;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface WeaponPayload {
  weaponCategory?: 'simple' | 'martial' | 'unknown';
  weaponType: 'melee' | 'ranged' | 'thrown' | 'finesse' | 'manual';
  actionCost?: ActionCost;
  actionTiming?: ActionTimingDetail;
  attackAbility?: AbilityReference;
  damageAbility?: AbilityReference;
  damageFormula: string;
  damageDie?: string;
  damageType?: DamageTypeReference;
  properties?: string[];
  mastery?: string;
  range?: { normal: number; long?: number; unit: 'ft' };
  versatileDamageFormula?: string;
  magicBonus?: number;
  attacksCount?: number;
  cost?: CurrencyValue | string;
  weight?: number;
  quantity?: number;
  tags?: string[];
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface ArmorPayload {
  armorCategory?: 'light' | 'medium' | 'heavy' | 'shield' | string;
  baseAC: number;
  dexCap?: number | null;
  acBonus?: number;
  strengthRequirement?: number;
  stealthDisadvantage?: boolean;
  stacksWithArmor?: boolean;
  weight?: number;
  cost?: CurrencyValue | string;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface EquipmentPayload {
  quantity?: number;
  weight?: number;
  cost?: CurrencyValue | string;
  equipmentCategory?: string;
  tags?: string[];
  grantsActions?: GrantedActionDefinition[];
  effectTemplates?: Array<Partial<ActiveEffectTemplate> & Record<string, unknown>>;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface MagicItemPayload extends EquipmentPayload {
  rarity?: string;
  attunement?: boolean;
  magicBonus?: number;
}

export interface SpellPayload {
  level: number;
  school?: string;
  classes: string[];
  /** Class entity references resolved from `classes` when available in-pack. */
  classIds?: string[];
  castingTime: CastingTimeDefinition;
  range?: string;
  duration?: string;
  components?: string | { verbal?: boolean; somatic?: boolean; material?: boolean; materialDescription?: string };
  specificMaterial?: string | boolean;
  ritual?: boolean;
  concentration?: boolean;
  requiresAttackRoll?: boolean;
  saveAbility?: AbilityReference;
  damageFormula?: string;
  damageType?: DamageTypeReference;
  healingFormula?: string;
  targets?: number | TargetDefinition;
  area?: Record<string, unknown>;
  consumesSpellSlot?: boolean;
  minimumSlotLevel?: number;
  scaling?: ImportScalingDefinition | Record<string, unknown>;
  damageOnSaveSuccess?: string;
  grantsActions?: GrantedActionDefinition[];
  effectTemplates?: Array<Partial<ActiveEffectTemplate> & Record<string, unknown>>;
  mechanics?: Record<string, unknown>;
  engineKey?: string;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface ConditionPayload {
  conditionId: string;
  officialCondition?: boolean;
  tags?: string[];
  effects?: Array<Record<string, unknown>>;
  endConditions?: Array<Record<string, unknown>>;
  engineNotes?: string;
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface CreatureActionDefinition {
  name: string;
  actionCost?: ActionCost;
  actionTiming?: ActionTimingDetail;
  type?: string;
  attackBonus?: number | string;
  reach?: string;
  range?: string;
  damageFormula?: string;
  damageType?: DamageTypeReference;
  saveAbility?: AbilityReference;
  saveDC?: number | string;
  conditionIds?: string[];
  [extension: string]: unknown;
}

export type MovementSpeedValue = number | {
  value?: number;
  formula?: string;
  condition?: string;
  original?: string;
};

export interface CreatureStatBlockPayload {
  size: string | string[];
  creatureType: string;
  alignment?: string;
  armorClass: number | Record<string, unknown>;
  hitPoints: number | Record<string, unknown>;
  speed: Record<string, MovementSpeedValue>;
  challenge?: string | number;
  proficiencyBonus?: number | string;
  abilities?: Partial<Record<AbilityScore, number>>;
  abilityScores?: Partial<Record<AbilityScore, number>>;
  abilityModifiers?: Partial<Record<AbilityScore, number>>;
  savingThrows?: Record<string, number | string>;
  skills?: Record<string, number | string>;
  resistances?: string[];
  vulnerabilities?: string[];
  immunities?: string[] | { damage?: string[]; conditions?: string[] };
  senses?: string | Record<string, unknown>;
  languages?: string | string[];
  traits?: Array<Record<string, unknown>>;
  actions?: CreatureActionDefinition[];
  bonusActions?: CreatureActionDefinition[];
  reactions?: CreatureActionDefinition[];
  mechanics?: Record<string, unknown>;
  engineKey?: string;
  tags?: string[];
  extractionNotes?: string[];
  [extension: string]: unknown;
}

export interface CompendiumPayloadByKind {
  class: ClassPayload;
  subclass: SubclassPayload;
  species: SpeciesPayload;
  background: BackgroundPayload;
  feat: FeatPayload;
  weapon: WeaponPayload;
  armor: ArmorPayload;
  equipment: EquipmentPayload;
  magicItem: MagicItemPayload;
  spell: SpellPayload;
  feature: FeaturePayload;
  condition: ConditionPayload;
  creatureStatBlock: CreatureStatBlockPayload;
}

export type CompendiumEntityPayload = CompendiumPayloadByKind[CompendiumEntityKind];

export type CompendiumImportItem = {
  [Kind in CompendiumEntityKind]: {
    id: string;
    kind: Kind;
    name: string;
    summary?: string;
    /** Non-gameplay provenance carried across import/export boundaries. */
    metadata?: Record<string, unknown>;
    source: CompendiumImportSource;
    payload: CompendiumPayloadByKind[Kind];
  }
}[CompendiumEntityKind];

/** Runtime-oriented damage types can be promoted to DamageFormula later by the mapper. */
export type CanonicalRuntimeDamageFormula = DamageFormula;
