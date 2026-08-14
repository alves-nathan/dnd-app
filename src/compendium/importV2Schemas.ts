import { z } from 'zod';
import {
  ABILITY_SCORES,
  ACTION_COSTS,
  COMPENDIUM_ENTITY_KINDS,
  CURRENCY_UNITS,
  DAMAGE_TYPES,
  SKILLS
} from './importDomain';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

export { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

const abilitySchema = z.enum(ABILITY_SCORES);
const actionCostSchema = z.enum(ACTION_COSTS);
const skillSchema = z.enum(SKILLS);
const damageTypeSchema = z.enum(DAMAGE_TYPES);
const currencyUnitSchema = z.enum(CURRENCY_UNITS);
const nonEmptyString = z.string().min(1);
const unknownRecord = z.record(z.string(), z.unknown());

export const importV2SourceSchema = z.object({
  id: nonEmptyString,
  book: z.string().optional(),
  page: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(['active', 'disabled', 'needsReview']),
  confidence: z.enum(['exact', 'ambiguous', 'manual', 'importedNeedsReview']),
  importId: z.string().optional(),
  notes: z.string().optional(),
  publisher: z.string().optional(),
  rulesEra: z.enum(['2024', 'legacy']).optional(),
  contentType: z.enum(['official', 'third-party', 'homebrew']).optional()
}).passthrough();

export const currencyValueSchema = z.object({
  amount: z.number().nonnegative(),
  unit: currencyUnitSchema
});

const costSchema = currencyValueSchema;

const actionTimingSchema = z.object({
  actionCost: actionCostSchema,
  subtype: z.enum([
    'passive',
    'magicAction',
    'attackAction',
    'helpAction',
    'utilize',
    'attackReplacement',
    'finishLongRest',
    'triggered',
    'other'
  ]).optional(),
  trigger: z.string().optional(),
  original: z.string().optional()
}).passthrough();

const abilityReferenceSchema = z.union([
  abilitySchema,
  z.object({ kind: z.literal('choice'), options: z.array(abilitySchema).min(1), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('spellcasting'), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('sameAsAttack'), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('variable'), key: z.string().optional(), label: z.string().optional() }).passthrough()
]);

const damageTypeReferenceSchema = z.union([
  damageTypeSchema,
  z.object({ kind: z.literal('choice'), options: z.array(damageTypeSchema).min(1), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('multiple'), types: z.array(damageTypeSchema).min(1), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('sameAs'), source: z.enum(['weapon', 'attack', 'trigger']), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('variable'), key: z.string().optional(), options: z.array(damageTypeSchema).optional(), label: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal('custom'), value: nonEmptyString, label: z.string().optional() }).passthrough()
]);

const castingTimeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    actionCost: actionCostSchema,
    ritualAlternative: z.boolean().optional(),
    trigger: z.string().optional(),
    original: z.string().optional()
  }).passthrough(),
  z.object({
    kind: z.literal('duration'),
    amount: z.number().positive(),
    unit: z.enum(['minute', 'hour', 'day']),
    ritualAlternative: z.boolean().optional(),
    original: z.string().optional()
  }).passthrough(),
  z.object({
    kind: z.literal('special'),
    actionCost: actionCostSchema.optional(),
    label: nonEmptyString,
    ritualAlternative: z.boolean().optional(),
    original: z.string().optional()
  }).passthrough()
]);

const targetDefinitionSchema = z.object({
  count: z.number().nonnegative().optional(),
  description: z.string().optional()
}).passthrough();

export const levelProgressionEntrySchema = z.object({
  level: z.number().int().min(1).max(20),
  featureIds: z.array(nonEmptyString)
}).passthrough();

export const proficiencyChoiceSchema = z.object({
  count: z.number().int().nonnegative(),
  options: z.array(z.string()).optional(),
  from: z.enum(['skills', 'tools', 'languages', 'weapons', 'armor', 'custom']).optional()
}).passthrough();

export const resourceDefinitionSchema = z.object({
  id: nonEmptyString,
  name: z.string().optional(),
  max: z.union([
    z.number().nonnegative(),
    z.object({
      kind: z.enum(['characterLevel', 'classLevel', 'proficiencyBonus', 'abilityModifier', 'custom']),
      steps: z.array(z.object({ level: z.number().int().optional(), value: z.number() }).passthrough()).optional(),
      formula: z.string().optional(),
      ability: abilitySchema.optional(),
      minimum: z.number().nonnegative().optional()
    }).passthrough()
  ]).optional(),
  recharge: z.enum(['turn', 'shortRest', 'longRest', 'day', 'manual']).optional(),
  recoveryRules: z.array(z.object({
    trigger: z.enum(['turn', 'shortRest', 'longRest', 'day', 'manual', 'initiative', 'custom']),
    amount: z.union([z.number().nonnegative(), z.literal('all')]),
    condition: z.string().optional()
  }).passthrough()).optional()
}).passthrough();

const resourceConsumptionSchema = z.object({
  resourceId: z.string().optional(),
  itemId: z.string().optional(),
  targetResource: z.string().optional(),
  amount: z.union([z.number().positive(), nonEmptyString])
}).passthrough();

const grantedActionSchema = z.object({
  type: nonEmptyString,
  name: nonEmptyString,
  actionCost: actionCostSchema.optional(),
  actionTiming: actionTimingSchema.optional(),
  sourceType: z.string().optional(),
  damageFormula: z.string().optional(),
  healingFormula: z.string().optional(),
  damageType: damageTypeReferenceSchema.optional(),
  consumes: z.array(resourceConsumptionSchema).optional()
}).passthrough();

const effectTemplateSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString
}).passthrough();

const structuredPrerequisiteSchema = z.object({
  level: z.number().int().nonnegative().optional(),
  classIds: z.array(nonEmptyString).optional(),
  subclassIds: z.array(nonEmptyString).optional(),
  featureIds: z.array(nonEmptyString).optional(),
  featIds: z.array(nonEmptyString).optional(),
  spellIds: z.array(nonEmptyString).optional(),
  abilities: z.record(z.string(), z.number()).optional()
}).passthrough();

const equipmentOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  items: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  currency: z.array(currencyValueSchema).optional()
}).passthrough();

const equipmentOptionsSchema = z.record(z.string(), z.union([z.array(z.string()), equipmentOptionSchema]));

const classSpellcastingSchema = z.object({
  ability: abilitySchema.optional(),
  progression: z.string().optional(),
  preparationSource: z.string().optional(),
  cantripsKnownByLevel: z.array(z.number().int().nonnegative()).optional(),
  spellsKnownByLevel: z.array(z.number().int().nonnegative()).optional(),
  preparedSpellsByLevel: z.array(z.number().int().nonnegative()).optional(),
  slotsByLevel: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())).optional(),
  pactSlotsByLevel: z.union([z.array(z.number().int().nonnegative()), z.record(z.string(), z.number().int().nonnegative())]).optional(),
  pactSlotLevelByLevel: z.union([z.array(z.number().int().nonnegative()), z.record(z.string(), z.number().int().nonnegative())]).optional(),
  ritualCasting: z.union([z.boolean(), z.string()]).optional(),
  spellcastingFocus: z.union([z.string(), z.array(z.string())]).optional()
}).passthrough();

const classPayloadSchema = z.object({
  level: z.number().int().min(1).max(20).optional(),
  hitDie: z.number().int().positive().optional(),
  primaryAbilities: z.array(abilitySchema).optional(),
  savingThrowProficiencies: z.array(abilitySchema).optional(),
  skillChoiceCount: z.number().int().nonnegative().optional(),
  skillProficienciesChoice: z.union([z.array(z.string()), proficiencyChoiceSchema]).optional(),
  weaponProficiencies: z.array(z.string()).optional(),
  armorTraining: z.array(z.string()).optional(),
  toolProficiencies: z.array(z.string()).optional(),
  featureIds: z.array(nonEmptyString).optional(),
  progression: z.array(levelProgressionEntrySchema).optional(),
  spellcasting: classSpellcastingSchema.nullable().optional(),
  resources: z.array(resourceDefinitionSchema).optional(),
  equipmentOptions: equipmentOptionsSchema.optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const subclassPayloadSchema = z.object({
  classId: nonEmptyString,
  featureIds: z.array(nonEmptyString).optional(),
  progression: z.array(levelProgressionEntrySchema).optional(),
  tags: z.array(z.string()).optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const speciesPayloadSchema = z.object({
  creatureType: z.string().optional(),
  speed: z.union([z.number(), z.record(z.string(), z.number())]).optional(),
  size: z.union([z.string(), z.array(z.string())]).optional(),
  heightRange: z.string().optional(),
  featureIds: z.array(nonEmptyString).optional(),
  engineKey: z.string().optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const abilityIncreaseRuleSchema = z.object({
  chooseOnePlus2AndDifferentOnePlus1: z.boolean().optional(),
  orIncreaseAllBy1: z.boolean().optional(),
  maximumScoreAfterIncrease: z.number().int().optional()
}).passthrough();

const backgroundPayloadSchema = z.object({
  abilityScoreOptions: z.array(abilitySchema).optional(),
  abilityScoreIncreaseRule: abilityIncreaseRuleSchema.optional(),
  featIds: z.array(nonEmptyString).optional(),
  featChoice: unknownRecord.optional(),
  skillProficiencies: z.array(z.union([skillSchema, z.string()])).optional(),
  skillProficiencyChoice: proficiencyChoiceSchema.optional(),
  toolProficiencies: z.array(z.string()).optional(),
  toolProficiencyChoice: proficiencyChoiceSchema.optional(),
  languageProficiencies: z.array(z.string()).optional(),
  languageProficiencyChoice: proficiencyChoiceSchema.optional(),
  equipmentOptions: equipmentOptionsSchema.optional(),
  grantsFeatureIds: z.array(nonEmptyString).optional(),
  engineKey: z.string().optional(),
  customBackground: z.boolean().optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const featPayloadSchema = z.object({
  category: z.string().optional(),
  prerequisite: z.union([z.string(), structuredPrerequisiteSchema]).optional(),
  abilityScoreIncrease: z.union([z.array(abilitySchema), z.array(unknownRecord)]).optional(),
  repeatable: z.boolean().optional(),
  featureIds: z.array(nonEmptyString).optional(),
  mechanics: unknownRecord.optional(),
  grantsActions: z.array(grantedActionSchema).optional(),
  effectTemplates: z.array(effectTemplateSchema).optional(),
  tags: z.array(z.string()).optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const featurePayloadSchema = z.object({
  sourceType: nonEmptyString,
  classId: z.string().optional(),
  subclassId: z.string().optional(),
  speciesId: z.string().optional(),
  levelGained: z.number().int().nonnegative().optional(),
  actionCost: actionCostSchema.optional(),
  actionTiming: actionTimingSchema.optional(),
  prerequisite: z.union([z.string(), structuredPrerequisiteSchema]).optional(),
  requiresConcentration: z.boolean().optional(),
  damageFormula: z.string().optional(),
  damageType: damageTypeReferenceSchema.optional(),
  conditionalDamage: z.array(unknownRecord).optional(),
  resource: resourceDefinitionSchema.optional(),
  consumes: z.array(resourceConsumptionSchema).optional(),
  grantsActions: z.array(grantedActionSchema).optional(),
  effectTemplates: z.array(effectTemplateSchema).optional(),
  oncePerTurnKey: z.string().optional(),
  engineKey: z.string().optional(),
  mechanics: unknownRecord.optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const weaponPayloadSchema = z.object({
  weaponCategory: z.enum(['simple', 'martial', 'unknown']).optional(),
  weaponType: z.enum(['melee', 'ranged', 'thrown', 'finesse', 'manual']),
  actionCost: actionCostSchema.optional(),
  actionTiming: actionTimingSchema.optional(),
  attackAbility: abilityReferenceSchema.optional(),
  damageAbility: abilityReferenceSchema.optional(),
  damageFormula: nonEmptyString,
  damageDie: z.string().optional(),
  damageType: damageTypeReferenceSchema.optional(),
  properties: z.array(z.string()).optional(),
  mastery: z.string().optional(),
  range: z.object({ normal: z.number().nonnegative(), long: z.number().nonnegative().optional(), unit: z.literal('ft') }).optional(),
  versatileDamageFormula: z.string().optional(),
  magicBonus: z.number().optional(),
  attacksCount: z.number().int().positive().optional(),
  cost: costSchema.optional(),
  weight: z.number().nonnegative().optional(),
  quantity: z.number().positive().optional(),
  tags: z.array(z.string()).optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const armorPayloadSchema = z.object({
  armorCategory: z.string().optional(),
  baseAC: z.number(),
  dexCap: z.number().nullable().optional(),
  acBonus: z.number().optional(),
  strengthRequirement: z.number().optional(),
  stealthDisadvantage: z.boolean().optional(),
  stacksWithArmor: z.boolean().optional(),
  weight: z.number().nonnegative().optional(),
  cost: costSchema.optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const equipmentPayloadSchema = z.object({
  quantity: z.number().positive().optional(),
  weight: z.number().nonnegative().optional(),
  cost: costSchema.optional(),
  equipmentCategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  grantsActions: z.array(grantedActionSchema).optional(),
  effectTemplates: z.array(effectTemplateSchema).optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const magicItemPayloadSchema = equipmentPayloadSchema.extend({
  rarity: z.string().optional(),
  attunement: z.boolean().optional(),
  magicBonus: z.number().optional()
}).passthrough();

const scalingSchema = z.object({
  kind: z.enum(['none', 'slotLevel', 'characterLevel', 'classLevel', 'custom']),
  baseLevel: z.number().int().optional(),
  dicePerStep: z.object({ count: z.number().int().positive(), sides: z.number().int().positive(), rerollLessThanOrEqual: z.number().optional() }).optional(),
  steps: z.array(unknownRecord).optional(),
  notes: z.string().optional()
}).passthrough();

const spellComponentsSchema = z.object({
  verbal: z.boolean().optional(),
  somatic: z.boolean().optional(),
  material: z.boolean().optional(),
  materialDescription: z.string().optional()
}).passthrough();

const spellPayloadSchema = z.object({
  level: z.number().int().min(0).max(9),
  school: z.string().optional(),
  classes: z.array(nonEmptyString),
  classIds: z.array(nonEmptyString).optional(),
  castingTime: castingTimeSchema,
  range: z.string().optional(),
  duration: z.string().optional(),
  components: z.union([z.string(), spellComponentsSchema]).optional(),
  specificMaterial: z.union([z.string(), z.boolean()]).optional(),
  ritual: z.boolean().optional(),
  concentration: z.boolean().optional(),
  requiresAttackRoll: z.boolean().optional(),
  saveAbility: abilityReferenceSchema.optional(),
  damageFormula: z.string().optional(),
  damageType: damageTypeReferenceSchema.optional(),
  healingFormula: z.string().optional(),
  targets: z.union([z.number().nonnegative(), targetDefinitionSchema]).optional(),
  area: unknownRecord.optional(),
  consumesSpellSlot: z.boolean().optional(),
  minimumSlotLevel: z.number().int().min(0).max(9).optional(),
  scaling: scalingSchema.optional(),
  damageOnSaveSuccess: z.string().optional(),
  grantsActions: z.array(grantedActionSchema).optional(),
  effectTemplates: z.array(effectTemplateSchema).optional(),
  mechanics: unknownRecord.optional(),
  engineKey: z.string().optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const conditionPayloadSchema = z.object({
  conditionId: nonEmptyString,
  officialCondition: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  effects: z.array(unknownRecord).optional(),
  endConditions: z.array(unknownRecord).optional(),
  engineNotes: z.string().optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const creatureActionSchema = z.object({
  name: nonEmptyString,
  actionCost: actionCostSchema.optional(),
  actionTiming: actionTimingSchema.optional(),
  type: z.string().optional(),
  attackBonus: z.union([z.number(), z.string()]).optional(),
  reach: z.string().optional(),
  range: z.string().optional(),
  damageFormula: z.string().optional(),
  damageType: damageTypeReferenceSchema.optional(),
  saveAbility: abilityReferenceSchema.optional(),
  saveDC: z.union([z.number(), z.string()]).optional(),
  conditionIds: z.array(z.string()).optional()
}).passthrough();

const movementSpeedValueSchema = z.union([
  z.number().nonnegative(),
  z.object({
    value: z.number().nonnegative().optional(),
    formula: z.string().optional(),
    condition: z.string().optional(),
    original: z.string().optional()
  }).passthrough()
]);

const creatureStatBlockPayloadSchema = z.object({
  size: z.union([z.string(), z.array(z.string())]),
  creatureType: nonEmptyString,
  alignment: z.string().optional(),
  armorClass: z.union([z.number(), unknownRecord]),
  hitPoints: z.union([z.number(), unknownRecord]),
  speed: z.record(z.string(), movementSpeedValueSchema),
  challenge: z.union([z.string(), z.number()]).optional(),
  proficiencyBonus: z.union([z.number(), z.string()]).optional(),
  abilities: z.record(z.string(), z.number()).optional(),
  abilityScores: z.record(z.string(), z.number()).optional(),
  abilityModifiers: z.record(z.string(), z.number()).optional(),
  savingThrows: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  skills: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  resistances: z.array(z.string()).optional(),
  vulnerabilities: z.array(z.string()).optional(),
  immunities: z.union([z.array(z.string()), unknownRecord]).optional(),
  senses: z.union([z.string(), unknownRecord]).optional(),
  languages: z.union([z.string(), z.array(z.string())]).optional(),
  traits: z.array(unknownRecord).optional(),
  actions: z.array(creatureActionSchema).optional(),
  bonusActions: z.array(creatureActionSchema).optional(),
  reactions: z.array(creatureActionSchema).optional(),
  mechanics: unknownRecord.optional(),
  engineKey: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extractionNotes: z.array(z.string()).optional()
}).passthrough();

const baseItem = {
  id: nonEmptyString,
  name: nonEmptyString,
  summary: z.string().optional(),
  /** Provenance/editorial metadata is explicitly outside gameplay payloads. */
  metadata: unknownRecord.optional(),
  source: importV2SourceSchema
};

export const classImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('class'), payload: classPayloadSchema });
export const subclassImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('subclass'), payload: subclassPayloadSchema });
export const speciesImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('species'), payload: speciesPayloadSchema });
export const backgroundImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('background'), payload: backgroundPayloadSchema });
export const featImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('feat'), payload: featPayloadSchema });
export const weaponImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('weapon'), payload: weaponPayloadSchema });
export const armorImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('armor'), payload: armorPayloadSchema });
export const equipmentImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('equipment'), payload: equipmentPayloadSchema });
export const magicItemImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('magicItem'), payload: magicItemPayloadSchema });
export const spellImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('spell'), payload: spellPayloadSchema });
export const featureImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('feature'), payload: featurePayloadSchema });
export const conditionImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('condition'), payload: conditionPayloadSchema });
export const creatureStatBlockImportItemV2Schema = z.object({ ...baseItem, kind: z.literal('creatureStatBlock'), payload: creatureStatBlockPayloadSchema });

export const compendiumImportItemV2Schema = z.discriminatedUnion('kind', [
  classImportItemV2Schema,
  subclassImportItemV2Schema,
  speciesImportItemV2Schema,
  backgroundImportItemV2Schema,
  featImportItemV2Schema,
  weaponImportItemV2Schema,
  armorImportItemV2Schema,
  equipmentImportItemV2Schema,
  magicItemImportItemV2Schema,
  spellImportItemV2Schema,
  featureImportItemV2Schema,
  conditionImportItemV2Schema,
  creatureStatBlockImportItemV2Schema
]);

export const compendiumImportV2Schema = z.object({
  templateVersion: z.literal(IMPORT_TEMPLATE_VERSION_V2),
  id: nonEmptyString,
  source: importV2SourceSchema,
  metadata: unknownRecord.optional(),
  items: z.array(compendiumImportItemV2Schema)
}).passthrough();

export const compendiumEntityKindSchema = z.enum(COMPENDIUM_ENTITY_KINDS);

export type CompendiumImportV2Input = z.infer<typeof compendiumImportV2Schema>;
export type CompendiumImportItemV2Input = z.infer<typeof compendiumImportItemV2Schema>;
