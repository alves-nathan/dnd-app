export type AbilityScore = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export type ActionCost = 'action' | 'bonusAction' | 'reaction' | 'movement' | 'free' | 'special';
export type RollMode = 'normal' | 'advantage' | 'disadvantage';
export type CoverLevel = 'none' | 'half' | 'threeQuarters' | 'total';
export type CreatureSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';
export type TacticalTargetEffectKind = 'sap' | 'slow' | 'prone' | 'vex';
export type TacticalEffectExpiry = 'afterTargetAttack' | 'afterNextAttackAgainstTarget' | 'startOfSourceTurn' | 'endOfSourceTurn' | 'manual';
export type TacticalTurnPhase = 'idle' | 'active';
export type TacticalParticipantKind = 'character' | 'target';
export type TacticalReactionKind = 'opportunityAttack' | 'ready';
export type BattlefieldRecoveryMode = 'automatic' | 'manual' | 'none';
export type WeaponGrip = 'oneHanded' | 'twoHanded';
export type WeaponInteractionKind = 'draw' | 'stow' | 'drop' | 'pickup' | 'swap';
export type WeaponInteractionTiming = 'before' | 'after';
export type SpellcastingFocusKind = 'arcane' | 'druidic' | 'holySymbol' | 'musicalInstrument' | 'componentPouch' | 'weapon' | 'other';
export type DamageSourceType =
  | 'weapon'
  | 'abilityModifier'
  | 'spell'
  | 'classFeature'
  | 'speciesFeature'
  | 'feat'
  | 'magicItem'
  | 'condition'
  | 'buff'
  | 'debuff'
  | 'manual';

export type DamageApplication = 'onHit' | 'guaranteed' | 'onSaveFail' | 'onSaveSuccessHalf' | 'conditional';
export type SourceStatus = 'active' | 'disabled' | 'needsReview';
export type SourceConfidence = 'exact' | 'ambiguous' | 'manual' | 'importedNeedsReview';
export type ResourceRecharge = 'turn' | 'shortRest' | 'longRest' | 'day' | 'manual';
export type RestType = 'turnStart' | 'shortRest' | 'longRest' | 'manual';
export type SpellSlotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SpellSlotRecharge = 'longRest' | 'shortRest' | 'manual';
export type SpellSlotPoolKind = 'spellcasting' | 'pactMagic' | 'manual';
export type ActiveEffectKind = 'buff' | 'debuff' | 'condition' | 'spell' | 'feature' | 'item' | 'manual';
export type ActiveEffectDurationUnit = 'turn' | 'round' | 'minute' | 'hour' | 'manual';
export type ActiveEffectStatus = 'active' | 'expired' | 'removed';

export interface ActionSourceRef {
  kind: 'manual' | 'characterEntry' | 'compendiumLink' | 'featureGrant';
  entityType?: CompendiumAppliedEntityType;
  entityId?: string;
  itemId?: string;
  linkId?: string;
  parentFeatureId?: string;
}

export type CompendiumAppliedEntityType =
  | 'class'
  | 'subclass'
  | 'species'
  | 'background'
  | 'feat'
  | 'weapon'
  | 'armor'
  | 'equipment'
  | 'magicItem'
  | 'spell'
  | 'feature';

export type CharacterContentReference =
  | { origin: 'catalog'; entityId: string; catalogSnapshotId: string; choiceId: string }
  | { origin: 'compendium'; itemId: string; sourceId: string; packId: string; choiceId: string };

export interface CharacterCompendiumLink {
  id: string;
  characterId: string;
  itemId: string;
  importItemId: string;
  packId: string;
  sourceId: string;
  itemType: CompendiumAppliedEntityType;
  appliedAs: CompendiumAppliedEntityType;
  appliedEntityId: string;
  appliedEntityName: string;
  status: 'active' | 'removed' | 'needsReview';
  addedAt: string;
  notes?: string;
  origin?: 'catalog' | 'compendium';
  choiceId?: string;
  catalogEntityId?: string;
  catalogSnapshotId?: string;
  manualReviewRequired?: boolean;
}

export interface RuleSource {
  id: string;
  book?: string;
  page?: string;
  version?: string;
  status: SourceStatus;
  confidence: SourceConfidence;
  importId?: string;
  notes?: string;
}

export interface RuleValidationIssue {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  source?: RuleSource;
}

export interface RuleValidationResult {
  ok: boolean;
  issues: RuleValidationIssue[];
}

export interface AbilityScores {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
}

export type AbilityGenerationMethod = 'standardArray' | 'pointBuy' | 'diceRoll' | 'manual';

export interface AbilityGenerationState {
  method: AbilityGenerationMethod;
  generatedValues: number[];
  pointBuyBudget?: number;
  pointBuySpent?: number;
  diceRolls?: Array<{ rolls: number[]; discarded: number; total: number }>;
}

export interface CharacterProficiencies {
  skills: string[];
  expertiseSkills: string[];
  tools: string[];
  weapons: string[];
  armor: string[];
  languages: string[];
  savingThrows: AbilityScore[];
}

export interface SpellComponents {
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  materialDescription?: string;
}

export interface CharacterClass {
  id: string;
  name: string;
  level: number;
  hitDie?: number;
  source?: RuleSource;
}

export interface Subclass {
  id: string;
  classId: string;
  name: string;
  source?: RuleSource;
}

export interface Species {
  id: string;
  name: string;
  size?: CreatureSize;
  source?: RuleSource;
  features?: Feature[];
}

export interface Background {
  id: string;
  name: string;
  source?: RuleSource;
  features?: Feature[];
}

export interface Feat {
  id: string;
  name: string;
  source?: RuleSource;
  summary?: string;
  custom?: boolean;
  features?: Feature[];
  grantedByInvocationItemId?: string;
}

export interface CharacterWeaponMastery {
  id: string;
  sourceKind: 'class' | 'feat' | 'manual';
  sourceEntityId?: string;
  sourceItemId?: string;
  weaponItemId?: string;
  weaponName: string;
  mastery: string;
  changeOnLongRest?: boolean;
  notes?: string;
}

export interface CharacterFeatChoice {
  id: string;
  featEntityId: string;
  featItemId: string;
  instanceIndex: number;
  abilityScoreIncreases?: Partial<Record<AbilityScore, number>>;
  skills?: string[];
  expertiseSkills?: string[];
  skillUpgrade?: string;
  tools?: string[];
  languages?: string[];
  spellItemIds?: string[];
  spellList?: string;
  spellcastingAbility?: AbilityScore;
  damageType?: string;
  weaponItemIds?: string[];
  weaponMasterySelections?: CharacterWeaponMastery[];
  fightingStyleItemId?: string;
  creatureType?: string;
  notes?: string;
}

export type PactChainFamiliarVariant = 'standard' | 'special';
export type LifedrinkerDamageType = 'necrotic' | 'psychic' | 'radiant';
export type ChainMasterMovementMode = 'fly' | 'swim';
export type ChainMasterDamageType = 'necrotic' | 'radiant';
export type CharacterSenseKind = 'darkvision' | 'truesight' | 'borrowed' | 'special';
export type GazeCastingOrigin = 'self' | 'gazeTarget';
export type OneWithShadowsLightLevel = 'bright' | 'dim' | 'darkness';

export interface CharacterSense {
  id: string;
  name: string;
  kind: CharacterSenseKind;
  rangeFeet?: number;
  magicalDarkness?: boolean;
  sourceInvocationItemId?: string;
  sourceCompanionId?: string;
  notes?: string;
}

export interface CharacterGazeOfTwoMindsState {
  invocationItemId: string;
  targetName: string;
  targetCompanionId?: string;
  targetSenses?: string;
  distanceFeet: number;
  samePlane: boolean;
  active: boolean;
  remainingTurnWindows: number;
  spellOrigin: GazeCastingOrigin;
  startedAt: string;
  maintainedAt?: string;
  notes?: string;
}

export interface CharacterGiftOfProtectorsState {
  invocationItemId: string;
  names: string[];
  maxNames: number;
  resourceId: string;
  lastTriggeredName?: string;
  lastTriggeredAt?: string;
}

export interface CharacterOneWithShadowsState {
  invocationItemId: string;
  lightLevel: OneWithShadowsLightLevel;
  activeEffectId?: string;
  activatedAt?: string;
}

export interface CharacterProtectionTransaction {
  id: string;
  characterId: string;
  name: string;
  action: 'inscribed' | 'erased' | 'triggered' | 'recovered';
  createdAt: string;
  notes?: string;
}

export interface CharacterEldritchInvocationChoice {
  id: string;
  invocationItemId: string;
  instanceIndex: number;
  cantripItemIds?: string[];
  ritualSpellItemIds?: string[];
  targetCantripItemId?: string;
  originFeatItemId?: string;
  familiarCreatureItemId?: string;
  familiarVariant?: PactChainFamiliarVariant;
  lifedrinkerDamageType?: LifedrinkerDamageType;
  chainMasterMovementMode?: ChainMasterMovementMode;
  chainMasterDamageType?: ChainMasterDamageType;
  notes?: string;
}


export interface CharacterCompanionTrait {
  id: string;
  name: string;
  summary?: string;
}

export interface CharacterCompanionResource {
  id: string;
  name: string;
  max: number;
  current: number;
  recharge: 'longRest' | 'manual';
  sourceActionId?: string;
}

export interface CharacterCompanionTransaction {
  id: string;
  companionId: string;
  action: 'damage' | 'healing' | 'resourceSpent' | 'resourceRecovered' | 'conditionAdded' | 'conditionRemoved';
  label: string;
  amount?: number;
  before?: number;
  after?: number;
  createdAt: string;
}

export interface CharacterCompanionAction {
  id: string;
  name: string;
  actionCost: ActionCost;
  type: 'attack' | 'utility';
  attackBonus?: number;
  reach?: string;
  range?: string;
  damageFormula?: string;
  damageType?: string;
  saveAbility?: AbilityScore;
  saveDC?: number;
  uses?: string;
  resourceId?: string;
  conditionIds?: string[];
  summary?: string;
}

export interface CharacterCompanion {
  id: string;
  name: string;
  customName?: boolean;
  sourceCreatureItemId: string;
  grantedByInvocationItemId: string;
  variant: PactChainFamiliarVariant;
  size?: string;
  creatureType?: string;
  armorClass: number;
  hitPoints: { current: number; max: number };
  speed: Record<string, number>;
  senses?: string;
  languages?: string;
  traits: CharacterCompanionTrait[];
  actions: CharacterCompanionAction[];
  resources: CharacterCompanionResource[];
  activeEffects: ActiveEffect[];
  transactions: CharacterCompanionTransaction[];
  initiative: 'own';
  command: 'forgoOneAttack' | 'bonusAction';
  canAttack: boolean;
  investment?: {
    active: boolean;
    movementMode?: ChainMasterMovementMode;
    movementSpeed?: number;
    usesWarlockSpellSaveDC?: boolean;
    reactionResistance?: boolean;
    damageType?: ChainMasterDamageType;
    warlockSpellSaveDC?: number;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterHitPointState {
  current: number;
  max: number;
  temporary: number;
}

export interface CharacterHitDiePool {
  id: string;
  classEntityId: string;
  className: string;
  dieSides: number;
  max: number;
  current: number;
}

export interface CharacterHitDieTransaction {
  id: string;
  characterId: string;
  poolId: string;
  classEntityId: string;
  dieSides: number;
  amount: number;
  before: number;
  after: number;
  reason: string;
  restType?: RestType;
  createdAt: string;
}

export interface CharacterHealingTransaction {
  id: string;
  characterId: string;
  source: 'lifedrinker' | 'manual';
  sourceItemId?: string;
  hitDiePoolId?: string;
  dieRoll?: number;
  constitutionModifier?: number;
  amount: number;
  hitPointsBefore?: number;
  hitPointsAfter?: number;
  createdAt: string;
  notes?: string;
}

export type PactWeaponDamageType = 'normal' | 'necrotic' | 'psychic' | 'radiant';

export interface CharacterPactWeaponChoice {
  mode: 'bound' | 'conjured';
  weaponEntityId: string;
  sourceWeaponItemId?: string;
  damageType: PactWeaponDamageType;
  invokedAt: string;
}

export interface CharacterEquipmentSelectionItem {
  label: string;
  quantity: number;
  goldPieces: number;
  compendiumItemId?: string;
  compendiumItemType?: 'weapon' | 'armor' | 'equipment';
}

export interface CharacterEquipmentSelection {
  id: string;
  sourceKind: 'class' | 'background';
  sourceItemId: string;
  optionId: string;
  labels: string[];
  goldPieces?: number;
  currency?: Partial<CharacterCurrency>;
  items?: CharacterEquipmentSelectionItem[];
}

export interface CharacterHigherLevelStartingBenefits {
  startingLevel: number;
  rolledD10: number;
  baseGold: number;
  goldMultiplier: number;
  bonusGold: number;
  magicItemAllowance: Partial<Record<'common' | 'uncommon' | 'rare' | 'veryRare', number>>;
  generatedAt: string;
}

export interface CharacterSpeciesChoice {
  speciesItemId: string;
  featureItemId: string;
  choiceKind: 'ancestry' | 'lineage' | 'legacy' | 'revelation' | 'option' | 'size' | 'variableTrait' | 'language';
  optionId: string;
  spellcastingAbility?: AbilityScore;
  skill?: string;
  language?: string;
}

export interface CharacterBackgroundChoice {
  backgroundItemId: string;
  choiceType: string;
  optionId: string;
}

export interface CharacterSubclassChoice {
  subclassItemId: string;
  choiceId: string;
  optionId: string;
}

export interface CharacterEquipmentLoadout {
  explicit?: boolean;
  mainHandWeaponId?: string;
  offHandWeaponId?: string;
  heldFocusEquipmentId?: string;
  armorId?: string;
  armorAccessoryIds: string[];
}

export interface CharacterCustomBackgroundChoice {
  name: string;
  abilityScoreOptions: AbilityScore[];
  skillProficiencies: string[];
  toolProficiency?: string;
}

export interface CharacterBuildChoices {
  startingClassItemId?: string;
  speciesChoices: CharacterSpeciesChoice[];
  speciesFeatItemId?: string;
  backgroundChoices?: CharacterBackgroundChoice[];
  subclassChoices?: CharacterSubclassChoice[];
  classSkillChoices: string[];
  classToolChoices: string[];
  backgroundToolChoices?: string[];
  customBackground?: CharacterCustomBackgroundChoice;
  expertiseSkills: string[];
  languages: string[];
  classLanguageChoices?: string[];
  spellAssignments: Record<string, string>;
  spellbookAssignments?: Record<string, string>;
  equipmentSelections: CharacterEquipmentSelection[];
  activeLoadout?: CharacterEquipmentLoadout;
  eldritchInvocationCounts?: Record<string, number>;
  eldritchInvocationChoices?: CharacterEldritchInvocationChoice[];
  pactWeapon?: CharacterPactWeaponChoice;
  gazeOfTwoMinds?: CharacterGazeOfTwoMindsState;
  giftOfProtectors?: CharacterGiftOfProtectorsState;
  oneWithShadows?: CharacterOneWithShadowsState;
  higherLevelStartingBenefits?: CharacterHigherLevelStartingBenefits;
  manualProficiencies?: CharacterProficiencies;
}

export type CharacterPendingChoiceKind =
  | 'subclass'
  | 'subclassOptions'
  | 'feat'
  | 'featOptions'
  | 'proficiency'
  | 'spellSelection'
  | 'spellReplacement'
  | 'equipment'
  | 'speciesOption'
  | 'eldritchInvocation'
  | 'eldritchInvocationOptions'
  | 'pactWeapon'
  | 'warlockSpecial';

export interface CharacterPendingChoice {
  id: string;
  kind: CharacterPendingChoiceKind;
  title: string;
  description: string;
  sourceItemId?: string;
  sourceEntityId?: string;
  requiredCount?: number;
  currentCount?: number;
  status: 'pending' | 'resolved';
  createdAt: string;
}

export interface CharacterCurrency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export interface CustomDamageMultiplierRule {
  id: string;
  damageType: string;
  multiplier: number;
  label?: string;
  notes?: string;
}

export interface CustomTriggeredDamageRule {
  id: string;
  triggerDamageType: string;
  triggerRoll: DiceTerm;
  triggerValues: number[];
  radiusFeet?: number;
  saveAbility?: AbilityScore;
  saveSuccessDamage?: 'half' | 'none';
  damageMode: 'sameAsTriggeringDamage' | 'formula';
  damageFormula?: DamageFormula;
  label?: string;
  notes?: string;
}

export interface CustomSpellReplacementRule {
  id: string;
  count: number;
  recharge: 'shortRest' | 'longRest' | 'manual';
  resourceId: string;
  classNames?: string[];
  label?: string;
  notes?: string;
}

export interface CustomSpellListAdditionRule {
  id: string;
  spellItemIds: string[];
  classNames?: string[];
  label?: string;
  notes?: string;
}

export type CustomModifierTarget =
  | 'proficiency'
  | 'abilityCheck'
  | 'skillCheck'
  | 'toolCheck'
  | 'savingThrow'
  | 'attackRoll'
  | 'spellAttackRoll'
  | 'spellSaveDC'
  | 'spellDamage'
  | 'damageDealt'
  | 'damageTaken'
  | 'armorClass'
  | 'initiative'
  | 'speed'
  | 'maxHitPoints';

export type CustomModifierOperation =
  | 'add'
  | 'multiply'
  | 'advantage'
  | 'disadvantage'
  | 'grantProficiency'
  | 'removeProficiency';

export type CustomProficiencyKind = 'skill' | 'tool' | 'savingThrow' | 'weapon' | 'armor' | 'language';

export interface CustomModifierSelector {
  skills?: string[];
  tools?: string[];
  abilities?: AbilityScore[];
  spellItemIds?: string[];
  spellNames?: string[];
  damageTypes?: string[];
  spellSchools?: string[];
  actionTypes?: Array<'attack' | 'spell'>;
  proficiencyKind?: CustomProficiencyKind;
  proficiencyValues?: string[];
}

export interface CustomModifierValue {
  flat?: number;
  multiplier?: number;
  proficiencyBonusMultiplier?: number;
  abilityModifierMultiplier?: number;
  ability?: AbilityScore;
}

export interface CustomCharacterModifierRule {
  id: string;
  target: CustomModifierTarget;
  operation: CustomModifierOperation;
  selector?: CustomModifierSelector;
  value?: CustomModifierValue;
  label?: string;
  notes?: string;
}

export interface CustomFeatureRules {
  damageMultipliers?: CustomDamageMultiplierRule[];
  triggeredDamage?: CustomTriggeredDamageRule[];
  spellReplacement?: CustomSpellReplacementRule[];
  grantedSpellItemIds?: string[];
  spellListAdditions?: CustomSpellListAdditionRule[];
  modifiers?: CustomCharacterModifierRule[];
}

export interface Feature {
  id: string;
  name: string;
  sourceType: DamageSourceType;
  custom?: boolean;
  source?: RuleSource;
  summary?: string;
  actionCost?: ActionCost;
  grantsActions?: Array<AttackAction | SpellAction>;
  resource?: ResourcePool;
  requiresConcentration?: boolean;
  oncePerTurnKey?: string;
  attackActionAttackCount?: number;
  effectTemplates?: ActiveEffectTemplate[];
  customRules?: CustomFeatureRules;
  requiresReview?: boolean;
}

export interface ResourcePool {
  id: string;
  name: string;
  max: number;
  current: number;
  recharge: ResourceRecharge;
  source?: RuleSource;
  sourceInvocationItemId?: string;
  notes?: string;
}

export interface ResourceTransaction {
  id: string;
  characterId: string;
  resourceId: string;
  resourceName: string;
  amount: number;
  before: number;
  after: number;
  reason: string;
  restType?: RestType;
  createdAt: string;
}

export interface ActiveEffectDuration {
  unit: ActiveEffectDurationUnit;
  remaining?: number;
  expiresOn?: 'turnStart' | 'turnEnd' | 'manual';
}

export interface ActiveEffectTemplate {
  id: string;
  name: string;
  kind: ActiveEffectKind;
  sourceType: DamageSourceType;
  source?: RuleSource;
  concentration?: boolean;
  conditionIds?: string[];
  duration: ActiveEffectDuration;
  endsOnShortRest?: boolean;
  endsOnLongRest?: boolean;
  notes?: string;
  sourceRef?: ActionSourceRef;
  requiresReview?: boolean;
}

export interface ActiveEffect {
  id: string;
  name: string;
  kind: ActiveEffectKind;
  sourceType: DamageSourceType;
  source?: RuleSource;
  status: ActiveEffectStatus;
  concentration?: boolean;
  conditionIds?: string[];
  duration: ActiveEffectDuration;
  endsOnShortRest?: boolean;
  endsOnLongRest?: boolean;
  notes?: string;
  templateId?: string;
  sourceRef?: ActionSourceRef;
  createdAt: string;
}

export interface ActiveEffectTransaction {
  id: string;
  characterId: string;
  effectId: string;
  effectName: string;
  action: 'started' | 'ended' | 'expired' | 'advanced' | 'edited';
  reason: string;
  restType?: RestType;
  createdAt: string;
}

export interface SpellSlotPool {
  id?: string;
  level: SpellSlotLevel;
  max: number;
  current: number;
  recharge: SpellSlotRecharge;
  poolKind?: SpellSlotPoolKind;
  sourceClassId?: string;
  sourceClassName?: string;
  source?: RuleSource;
  notes?: string;
}

export interface SpellSlotCost {
  slotLevel: SpellSlotLevel;
  poolKind?: SpellSlotPoolKind;
  sourceClassId?: string;
  amount: number;
  minimumSlotLevel?: SpellSlotLevel;
  spellId?: string;
  spellName?: string;
  label?: string;
}

export interface ConditionalSpellSlotCost extends SpellSlotCost {
  conditionId: string;
}

export interface SpellSlotTransaction {
  id: string;
  poolId?: string;
  poolKind?: SpellSlotPoolKind;
  sourceClassId?: string;
  characterId: string;
  slotLevel: SpellSlotLevel;
  amount: number;
  before: number;
  after: number;
  reason: string;
  restType?: RestType;
  createdAt: string;
}

export interface SpellSlotAvailabilityResult {
  ok: boolean;
  remaining: Partial<Record<SpellSlotLevel, number>>;
  issues: RuleValidationIssue[];
  costs: SpellSlotCost[];
}

export interface ResourceAvailabilityResult {
  ok: boolean;
  remaining: Record<string, number>;
  issues: RuleValidationIssue[];
  costs: ResourceCost[];
}

export interface RestApplicationResult {
  character: Character;
  transactions: ResourceTransaction[];
  issues: RuleValidationIssue[];
}

export interface ResourceCost {
  resourceId: string;
  amount: number;
  label?: string;
  oncePerTurnKey?: string;
}

export interface DiceTerm {
  count: number;
  sides: number;
  rerollLessThanOrEqual?: number;
}

export interface DamageCondition {
  id: string;
  label: string;
  defaultEnabled?: boolean;
  requiresResourceId?: string;
  oncePerTurnKey?: string;
  requiresConcentration?: boolean;
}

export interface DamageComponent {
  id: string;
  kind: 'dice' | 'abilityModifier' | 'proficiencyBonus' | 'flat' | 'customVariable';
  operation: 'add' | 'subtract';
  dice?: DiceTerm;
  ability?: AbilityScore;
  value?: number;
  variableKey?: string;
  sourceType: DamageSourceType;
  application: DamageApplication;
  condition?: DamageCondition;
  criticalBehavior?: 'doubleDice' | 'notDoubled' | 'extraOnCritOnly';
  label?: string;
}

export interface DamageFormula {
  raw: string;
  components: DamageComponent[];
  unresolvedTokens?: string[];
}

export interface WeaponRange {
  normal: number;
  long?: number;
  unit: 'ft';
}

export interface Weapon {
  id: string;
  name: string;
  weaponType: 'melee' | 'ranged' | 'thrown' | 'finesse' | 'manual';
  damage: DamageFormula;
  damageType?: string;
  quantity?: number;
  equipped?: boolean;
  handsRequired?: 1 | 2;
  range?: WeaponRange;
  ammunitionType?: string;
  ammunitionPerAttack?: number;
  recoverableAmmunition?: boolean;
  attackAbility?: AbilityScore;
  damageAbility?: AbilityScore;
  magicBonus?: number;
  actionCost?: ActionCost;
  attacksCount?: number;
  consumes?: ResourceCost[];
  mastery?: string;
  properties?: string[];
  source?: RuleSource;
  startingEquipmentSelectionId?: string;
  pactWeapon?: boolean;
  pactWeaponMode?: 'bound' | 'conjured';
  pactWeaponSourceItemId?: string;
  pactWeaponDamageType?: PactWeaponDamageType;
  versatileDamage?: DamageFormula;
  spellcastingFocus?: boolean;
  spellcastingFocusKind?: SpellcastingFocusKind;
}

export interface Armor {
  id: string;
  name: string;
  baseAC: number;
  dexCap?: number;
  armorCategory?: string;
  acBonus?: number;
  stacksWithArmor?: boolean;
  equipped?: boolean;
  owned?: boolean;
  source?: RuleSource;
  startingEquipmentSelectionId?: string;
}

export interface Equipment {
  id: string;
  name: string;
  quantity: number;
  tags?: string[];
  ammunitionType?: string;
  source?: RuleSource;
  startingEquipmentSelectionId?: string;
  spellcastingFocus?: boolean;
  spellcastingFocusKind?: SpellcastingFocusKind;
  focusRequiresHand?: boolean;
  materialComponent?: boolean;
}

export interface MagicItem extends Equipment {
  attunement?: boolean;
  features?: Feature[];
  effectTemplates?: ActiveEffectTemplate[];
}

export interface SpellScalingRule {
  kind: 'none' | 'slotLevel' | 'characterLevel' | 'custom';
  baseLevel?: number;
  dicePerStep?: DiceTerm;
  steps?: Array<{ minCharacterLevel?: number; slotLevel?: number; formula: DamageFormula; attacksCount?: number }>;
  requiresReview?: boolean;
}


export type SpellbookAcquisition = 'starting' | 'levelUp' | 'copied' | 'manual' | 'feat';

export interface CharacterSpellbookEntry {
  id: string;
  classEntityId: string;
  classItemId?: string;
  spellItemId: string;
  spellName: string;
  spellLevel: number;
  acquisition: SpellbookAcquisition;
  learnedAtCharacterLevel: number;
  learnedAtClassLevel?: number;
  prepared: boolean;
  createdAt: string;
  notes?: string;
}

export type SpellChangeTransactionKind =
  | 'learned'
  | 'copied'
  | 'prepared'
  | 'unprepared'
  | 'replaced'
  | 'removed';

export interface SpellChangeTransaction {
  id: string;
  characterId: string;
  classEntityId?: string;
  className?: string;
  kind: SpellChangeTransactionKind;
  spellItemId?: string;
  spellName: string;
  replacedSpellItemId?: string;
  replacedSpellName?: string;
  source: 'creation' | 'levelUp' | 'manual' | 'feat' | 'feature' | 'reconciliation';
  characterLevel: number;
  classLevel?: number;
  createdAt: string;
  notes?: string;
}

export interface Spell {
  id: string;
  name: string;
  level: number;
  school?: string;
  castingTime: ActionCost;
  range?: string;
  components?: SpellComponents;
  duration?: string;
  description?: string;
  upcastingDescription?: string;
  requiresAttackRoll?: boolean;
  saveAbility?: AbilityScore;
  damage?: DamageFormula;
  damageType?: string;
  scaling?: SpellScalingRule;
  targeting?: {
    targets: number;
    area?: string;
    areaTemplate?: TacticalAreaTemplate;
    description?: string;
  };
  damageOnSaveSuccess?: string;
  concentration?: boolean;
  consumes?: ResourceCost[];
  effectTemplates?: ActiveEffectTemplate[];
  source?: RuleSource;
  spellcastingClassId?: string;
  spellcastingClassName?: string;
  spellcastingAbility?: AbilityScore;
  grantedByFeatEntityId?: string;
  grantedByFeatureEntityId?: string;
  grantedByInvocationItemId?: string;
  ritualOnly?: boolean;
  prepared?: boolean;
  freeCast?: boolean;
  invocationSelfOnly?: boolean;
  invocationUsage?: 'atWill' | 'oncePerLongRest';
}

export interface AttackAction {
  id: string;
  type: 'attack';
  name: string;
  actionCost: ActionCost;
  sourceType: DamageSourceType;
  source?: RuleSource;
  weaponId?: string;
  attackAbility?: AbilityScore;
  attackBonusOverride?: number;
  attackBonusExtra?: number;
  damage: DamageFormula;
  damageTypes?: string[];
  attacksCount: number;
  consumes?: ResourceCost[];
  conditionalSpellSlotCosts?: ConditionalSpellSlotCost[];
  tags?: string[];
  origin?: ActionSourceRef;
  requiresReview?: boolean;
  ruleNotes?: string[];
  replacesOwnAttackCount?: number;
  companionId?: string;
  range?: WeaponRange;
  ammunitionType?: string;
  ammunitionPerAttack?: number;
  thrownWeapon?: boolean;
  mastery?: WeaponMasteryApplication;
  handsRequired?: 1 | 2;
  weaponGrip?: WeaponGrip;
  loading?: boolean;
  light?: boolean;
}

export interface WeaponMasteryApplication {
  property: 'cleave' | 'graze' | 'nick' | 'push' | 'sap' | 'slow' | 'topple' | 'vex';
  label: string;
  description: string;
  oncePerTurnKey?: string;
  saveAbility?: AbilityScore;
  saveDC?: number;
  forcedMovementFt?: number;
  maxTargetSize?: CreatureSize;
}

export interface SpellAction {
  id: string;
  type: 'spell';
  name: string;
  actionCost: ActionCost;
  sourceType: DamageSourceType;
  source?: RuleSource;
  spellId?: string;
  spellLevel?: number;
  spellSchool?: string;
  spellcastingAbility?: AbilityScore;
  attackBonusOverride?: number;
  saveDCOverride?: number;
  damage?: DamageFormula;
  damageTypes?: string[];
  targets?: number;
  attacksCount?: number;
  area?: TacticalAreaTemplate;
  targetDescription?: string;
  saveAbility?: AbilityScore;
  saveSuccessDamage?: 'half' | 'none';
  conditionIds?: string[];
  range?: string;
  forcedMovementFt?: number;
  forcedMovementMaxTargetSize?: string;
  consumes?: ResourceCost[];
  consumesSpellSlot?: boolean;
  minimumSlotLevel?: SpellSlotLevel;
  castAtSlotLevel?: SpellSlotLevel;
  concentration?: boolean;
  tags?: string[];
  origin?: ActionSourceRef;
  requiresReview?: boolean;
  ruleNotes?: string[];
  gazeCastingOriginAvailable?: boolean;
  gazeTargetName?: string;
  gazeTargetDistanceFeet?: number;
  components?: SpellComponents;
  materialDescription?: string;
  spellcastingClassName?: string;
}

export type CharacterAction = AttackAction | SpellAction;

export interface TacticalMovement {
  kind: 'approach' | 'retreat' | 'reposition';
  distanceFeet: number;
  targetId?: string;
}

export interface TurnAction {
  id: string;
  name: string;
  actionCost: ActionCost;
  action: CharacterAction;
  actionRef?: ActionSourceRef;
  repeat?: number;
  enabledConditionIds?: string[];
  selectedSpellSlotLevel?: SpellSlotLevel;
  spellOrigin?: GazeCastingOrigin;
  weaponOperation?: {
    kind: WeaponInteractionKind;
    timing?: WeaponInteractionTiming;
    weaponId?: string;
    offHandWeaponId?: string;
    hand?: 'main' | 'off';
  };
  attackCountOverride?: number;
  targetId?: string;
  movement?: TacticalMovement;
}

export interface TurnRotation {
  id: string;
  characterId: string;
  name: string;
  actions: TurnAction[];
  favorite?: boolean;
  notes?: string;
}

export interface CombatState {
  targetAC?: number;
  rollMode: RollMode;
  targetCount: number;
  resistanceMultiplier: 0 | 0.5 | 1 | 2;
  criticalGuaranteed?: boolean;
  critRange?: number;
  activeConditionIds?: string[];
  consumedResourceIds?: string[];
  concentratingOn?: string;
  availableResourceOverrides?: Record<string, number>;
  availableSpellSlotOverrides?: Partial<Record<SpellSlotLevel, number>>;
  targetDistanceFeet?: number;
  targetSize?: CreatureSize;
  cover?: CoverLevel;
  lineOfSight?: boolean;
  adjacentSecondaryTarget?: boolean;
}

export interface DamageRange {
  min: number;
  max: number;
  average: number;
}

export interface HitChanceResult {
  hitChance: number;
  critChance: number;
  normalHitChance: number;
}

export interface DamageAnalysisResult {
  id: string;
  name: string;
  actionCost: ActionCost;
  sourceType: DamageSourceType;
  formula: string;
  attacksCount: number;
  perHit: DamageRange;
  critical: DamageRange;
  perTarget: DamageRange;
  total: DamageRange;
  guaranteed: DamageRange;
  hitDependent: DamageRange;
  conditioned: DamageRange;
  saveDependent: DamageRange;
  weightedAverage?: number;
  hitChance?: HitChanceResult;
  targetCount: number;
  resourcesConsumed: ResourceCost[];
  spellSlotsConsumed: SpellSlotCost[];
  ammunitionConsumed?: Array<{ type: string; amount: number; label: string }>;
  masteryEffects?: string[];
  warnings: RuleValidationIssue[];
  breakdown: Array<{
    label: string;
    min: number;
    max: number;
    average: number;
    sourceType: DamageSourceType;
    application: DamageApplication;
    conditionLabel?: string;
  }>;
}

export interface ActionBuildResult {
  actions: CharacterAction[];
  issues: RuleValidationIssue[];
}

export interface TurnAnalysisResult {
  rotationId: string;
  rotationName: string;
  actions: DamageAnalysisResult[];
  attackCount: number;
  total: DamageRange;
  weightedAverage?: number;
  resourcesConsumed: ResourceCost[];
  spellSlotsConsumed: SpellSlotCost[];
  resourceAvailability: ResourceAvailabilityResult;
  spellSlotAvailability: SpellSlotAvailabilityResult;
  ammunitionAvailability?: { ok: boolean; issues: RuleValidationIssue[]; costs: Array<{ type: string; amount: number; label: string }> };
  tacticalEffects?: TacticalEffectEvent[];
  movement?: TacticalMovementSummary;
  validation: RuleValidationResult;
}



export interface TacticalTargetEffect {
  id: string;
  kind: TacticalTargetEffectKind;
  label: string;
  sourceCharacterId: string;
  sourceActionId?: string;
  sourceRotationId?: string;
  expiry: TacticalEffectExpiry;
  speedPenaltyFeet?: number;
  remainingUses?: number;
  appliedRound: number;
  appliedAt: string;
  notes?: string;
}

export type TacticalAreaShape = 'line' | 'cone' | 'cube' | 'sphere' | 'cylinder' | 'emanation' | 'square' | 'custom';

export type TacticalSpatialMode = 'linear' | 'map2d';
export type TacticalDiagonalRule = 'euclidean' | 'fiveFeet' | 'alternating5_10';

export interface TacticalMapPoint {
  xFeet: number;
  yFeet: number;
}

export interface TacticalTerrainRegion {
  id: string;
  label: string;
  shape: 'rectangle' | 'circle';
  xFeet: number;
  yFeet: number;
  widthFeet?: number;
  heightFeet?: number;
  radiusFeet?: number;
  movementMultiplier: number;
  notes?: string;
}

export interface TacticalAreaTemplate {
  shape: TacticalAreaShape;
  sizeFeet?: number;
  radiusFeet?: number;
  lengthFeet?: number;
  widthFeet?: number;
  heightFeet?: number;
  origin?: 'actor' | 'point' | 'target';
  description?: string;
}

export type TacticalTargetActionSection = 'action' | 'bonusAction' | 'reaction';
export type TacticalTargetActionType = 'attack' | 'saveEffect' | 'utility';

export interface TacticalTargetStatBlockAction {
  id: string;
  name: string;
  section: TacticalTargetActionSection;
  actionCost: ActionCost;
  type: TacticalTargetActionType;
  attackType?: 'melee' | 'ranged' | string;
  attackBonus?: number;
  attackBonusFormula?: string;
  reach?: string;
  range?: string;
  damageFormula?: string;
  damageType?: string;
  saveAbility?: AbilityScore;
  saveDC?: number;
  saveDCFormula?: string;
  saveSuccessDamage?: 'half' | 'none';
  conditionIds?: string[];
  trigger?: string;
  summary?: string;
  resourceId?: string;
}

export interface TacticalTargetStatBlockResource {
  id: string;
  name: string;
  max: number;
  current: number;
  recharge: 'rechargeRoll' | 'longRest' | 'manual';
  rechargeMin?: number;
  rechargeMax?: number;
  sourceActionId?: string;
}

export interface TacticalTarget {
  id: string;
  name: string;
  armorClass?: number;
  hitPoints?: { current: number; max: number; temporary?: number };
  initiative?: number;
  size: CreatureSize;
  positionFeet: number;
  mapPosition?: TacticalMapPoint;
  speedFeet: number;
  cover: CoverLevel;
  lineOfSight: boolean;
  conditions: string[];
  effects: TacticalTargetEffect[];
  sourceCreatureItemId?: string;
  sourceCreatureImportItemId?: string;
  statBlockActions?: TacticalTargetStatBlockAction[];
  statBlockResources?: TacticalTargetStatBlockResource[];
  notes?: string;
}

export interface BattlefieldItem {
  id: string;
  kind: 'ammunition' | 'thrownWeapon';
  label: string;
  quantity: number;
  ammunitionType?: string;
  weaponId?: string;
  recoverable: boolean;
  recoveryMode: BattlefieldRecoveryMode;
  recoveryPercent: number;
  createdRound: number;
}

export interface TacticalCombatLogEntry {
  id: string;
  round: number;
  kind: 'movement' | 'mastery' | 'condition' | 'forcedMovement' | 'resource' | 'recovery' | 'turn' | 'attack' | 'savingThrow' | 'reaction' | 'damage' | 'concentration';
  message: string;
  targetId?: string;
  actionId?: string;
  createdAt: string;
}

export interface TacticalActionResolution {
  actionId: string;
  targetId?: string;
  confirmedHits: number;
  toppleSave?: 'success' | 'failure' | 'pending';
  targetResults?: TacticalTargetResolution[];
}

export interface TacticalTargetResolution {
  targetId: string;
  confirmedHits?: number;
  saveResult?: 'success' | 'failure' | 'pending';
  /** Full rolled/declared damage before the save-success rule is applied. */
  damage?: number;
  conditionIds?: string[];
}

export interface TacticalMovementSummary {
  speedFeet: number;
  movementSpentFeet: number;
  movementRemainingFeet: number;
  difficultTerrain: boolean;
  finalPositionFeet: number;
  finalMapPosition?: TacticalMapPoint;
}

export interface TacticalEffectEvent {
  id: string;
  actionId: string;
  targetId: string;
  kind: 'sap' | 'slow' | 'prone' | 'vex' | 'push' | 'repellingBlast' | 'cleave';
  label: string;
  description: string;
  applied: boolean;
}

export interface TacticalParticipant {
  id: string;
  kind: TacticalParticipantKind;
  name: string;
  targetId?: string;
  initiative: number;
  hasActed: boolean;
  reactionAvailable: boolean;
  movementSpentFeet: number;
  startedRound?: number;
  endedRound?: number;
}

export interface TacticalReadyAction {
  id: string;
  participantId: string;
  actionId: string;
  actionName: string;
  trigger: string;
  targetId?: string;
  selectedSlotLevel?: SpellSlotLevel;
  resourcesCommitted?: boolean;
  heldEffectId?: string;
  createdRound: number;
}

export interface TacticalPendingReaction {
  id: string;
  kind: TacticalReactionKind;
  reactorParticipantId: string;
  provokingTargetId?: string;
  targetId?: string;
  readyActionId?: string;
  trigger: string;
  createdRound: number;
}

export interface CombatScenario {
  id: string;
  characterId: string;
  name: string;
  combatState: CombatState;
  favorite?: boolean;
  notes?: string;
  targets?: TacticalTarget[];
  actorPositionFeet?: number;
  actorMapPosition?: TacticalMapPoint;
  actorSpeedFeet?: number;
  spatialMode?: TacticalSpatialMode;
  diagonalRule?: TacticalDiagonalRule;
  terrainRegions?: TacticalTerrainRegion[];
  difficultTerrain?: boolean;
  round?: number;
  battlefieldItems?: BattlefieldItem[];
  tacticalLog?: TacticalCombatLogEntry[];
  participants?: TacticalParticipant[];
  activeParticipantId?: string;
  turnPhase?: TacticalTurnPhase;
  readyActions?: TacticalReadyAction[];
  pendingReaction?: TacticalPendingReaction;
  createdAt: string;
  updatedAt: string;
}

export interface RotationResourceSummary {
  resourceId: string;
  label: string;
  amount: number;
  oncePerTurnKeys: string[];
}

export interface RotationComparisonRow {
  rotationId: string;
  rotationName: string;
  actionCount: number;
  attackCount: number;
  total: DamageRange;
  weightedAverage?: number;
  guaranteed: DamageRange;
  hitDependent: DamageRange;
  conditioned: DamageRange;
  saveDependent: DamageRange;
  resourcesConsumed: RotationResourceSummary[];
  warningCount: number;
  errorCount: number;
  validation: RuleValidationResult;
}

export interface RotationComparisonResult {
  scenario: CombatScenario;
  rows: RotationComparisonRow[];
  bestByAverageRotationId?: string;
  bestByWeightedAverageRotationId?: string;
  bestByGuaranteedRotationId?: string;
}


export type BuildSnapshotKind =
  | 'manual'
  | 'levelUp'
  | 'feat'
  | 'item'
  | 'spell'
  | 'ruleRevision'
  | 'scenario'
  | 'rotation'
  | 'import'
  | 'other';

export interface BuildHistoryRowSnapshot {
  rotationId: string;
  rotationName: string;
  actionCount: number;
  attackCount: number;
  total: DamageRange;
  weightedAverage?: number;
  guaranteed: DamageRange;
  hitDependent: DamageRange;
  conditioned: DamageRange;
  saveDependent: DamageRange;
  resourcesConsumed: RotationResourceSummary[];
  warningCount: number;
  errorCount: number;
}

export interface BuildHistoryCharacterSummary {
  name: string;
  level: number;
  classes: Array<{ id: string; name: string; level: number }>;
  weaponCount: number;
  spellCount: number;
  featureCount: number;
  featCount: number;
  compendiumLinkCount: number;
}

export interface BuildHistorySnapshot {
  id: string;
  characterId: string;
  name: string;
  kind: BuildSnapshotKind;
  createdAt: string;
  notes?: string;
  character: BuildHistoryCharacterSummary;
  scenario: {
    id: string;
    name: string;
    targetAC?: number;
    targetCount: number;
    rollMode: RollMode;
    resistanceMultiplier: 0 | 0.5 | 1 | 2;
    criticalGuaranteed?: boolean;
    critRange?: number;
  };
  rows: BuildHistoryRowSnapshot[];
  winners: {
    bestByAverageRotationId?: string;
    bestByWeightedAverageRotationId?: string;
    bestByGuaranteedRotationId?: string;
  };
  issueCount: { warnings: number; errors: number };
}

export interface BuildHistoryMetricDelta {
  before?: number;
  after?: number;
  delta?: number;
  percentDelta?: number;
}

export interface BuildHistoryRotationDelta {
  rotationId?: string;
  rotationName: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  average: BuildHistoryMetricDelta;
  weightedAverage: BuildHistoryMetricDelta;
  guaranteedAverage: BuildHistoryMetricDelta;
  hitDependentAverage: BuildHistoryMetricDelta;
  conditionedAverage: BuildHistoryMetricDelta;
  warningDelta: number;
  errorDelta: number;
  resourceChanges: Array<{ resourceId: string; label: string; before: number; after: number; delta: number }>;
}

export interface BuildHistoryDiff {
  beforeId: string;
  afterId: string;
  beforeName: string;
  afterName: string;
  levelDelta: number;
  classSummaryBefore: string;
  classSummaryAfter: string;
  addedRotations: string[];
  removedRotations: string[];
  changedWinners: string[];
  warningDelta: number;
  errorDelta: number;
  rotationDeltas: BuildHistoryRotationDelta[];
}

export interface DerivedEffectOption {
  id: string;
  label: string;
  sourceLabel: string;
  template: ActiveEffectTemplate;
  alreadyActive: boolean;
  warnings: RuleValidationIssue[];
}

export type CharacterProgressionTransactionKind =
  | 'levelUp'
  | 'pendingResolution'
  | 'combined'
  | 'compatibilityRemediation'
  | 'rollback';

export interface CharacterProgressionOperation {
  id: string;
  kind: 'levelUp' | 'choice' | 'snapshotMigration' | 'reconciliation' | 'manual';
  label: string;
  createdAt: string;
  pendingChoiceId?: string;
  choiceIds?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CharacterProgressionClassChange {
  classId: string;
  name: string;
  beforeLevel: number;
  afterLevel: number;
}

export interface CharacterProgressionChangeSummary {
  levelBefore: number;
  levelAfter: number;
  catalogSnapshotBefore?: string;
  catalogSnapshotAfter?: string;
  classChanges: CharacterProgressionClassChange[];
  added: Record<string, number>;
  removed: Record<string, number>;
  pendingBefore: number;
  pendingAfter: number;
  changedPaths: string[];
}

export type CharacterProgressionSnapshot = Omit<Character, 'progressionTransactions'>;

export interface CharacterProgressionAuditEntry {
  id: string;
  transactionId: string;
  kind: CharacterProgressionTransactionKind;
  status: 'committed' | 'rolledBack';
  createdAt: string;
  committedAt: string;
  rolledBackTransactionId?: string;
  catalogSnapshotBefore?: string;
  catalogSnapshotAfter?: string;
  operations: CharacterProgressionOperation[];
  summary: CharacterProgressionChangeSummary;
  before: CharacterProgressionSnapshot;
  after: CharacterProgressionSnapshot;
}

export interface Character {
  id: string;
  catalogSnapshotId?: string;
  name: string;
  level: number;
  classes: CharacterClass[];
  subclasses: Subclass[];
  species?: Species;
  background?: Background;
  originFeatId?: string;
  abilityScoreBonuses?: Partial<Record<AbilityScore, number>>;
  abilityGeneration?: AbilityGenerationState;
  featChoices?: CharacterFeatChoice[];
  buildChoices?: CharacterBuildChoices;
  pendingChoices?: CharacterPendingChoice[];
  currency?: CharacterCurrency;
  proficiencies: CharacterProficiencies;
  abilities: AbilityScores;
  proficiencyBonusOverride?: number;
  armor?: Armor;
  armors?: Armor[];
  armorAccessories?: Armor[];
  companions?: CharacterCompanion[];
  senses?: CharacterSense[];
  hitPoints?: CharacterHitPointState;
  hitDice?: CharacterHitDiePool[];
  weapons: Weapon[];
  equipment: Equipment[];
  magicItems: MagicItem[];
  feats: Feat[];
  spells: Spell[];
  spellbookEntries?: CharacterSpellbookEntry[];
  weaponMasteries?: CharacterWeaponMastery[];
  features: Feature[];
  resources: ResourcePool[];
  spellSlots: SpellSlotPool[];
  activeEffects: ActiveEffect[];
  rotations: TurnRotation[];
  compendiumLinks?: CharacterCompendiumLink[];
  resourceTransactions?: ResourceTransaction[];
  spellSlotTransactions?: SpellSlotTransaction[];
  spellChangeTransactions?: SpellChangeTransaction[];
  activeEffectTransactions?: ActiveEffectTransaction[];
  hitDieTransactions?: CharacterHitDieTransaction[];
  healingTransactions?: CharacterHealingTransaction[];
  protectionTransactions?: CharacterProtectionTransaction[];
  progressionTransactions?: CharacterProgressionAuditEntry[];
  notes?: string;
}
