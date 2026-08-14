import { z } from 'zod';

export const ruleSourceSchema = z.object({
  id: z.string().min(1),
  book: z.string().optional(),
  page: z.string().optional(),
  version: z.string().optional(),
  status: z.enum(['active', 'disabled', 'needsReview']),
  confidence: z.enum(['exact', 'ambiguous', 'manual', 'importedNeedsReview']),
  importId: z.string().optional(),
  notes: z.string().optional()
});

export const damageComponentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['dice', 'abilityModifier', 'proficiencyBonus', 'flat', 'customVariable']),
  operation: z.enum(['add', 'subtract']),
  dice: z.object({ count: z.number(), sides: z.number(), rerollLessThanOrEqual: z.number().optional() }).optional(),
  ability: z.enum(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']).optional(),
  value: z.number().optional(),
  variableKey: z.string().optional(),
  sourceType: z.enum(['weapon', 'abilityModifier', 'spell', 'classFeature', 'speciesFeature', 'feat', 'magicItem', 'condition', 'buff', 'debuff', 'manual']),
  application: z.enum(['onHit', 'guaranteed', 'onSaveFail', 'onSaveSuccessHalf', 'conditional']),
  criticalBehavior: z.enum(['doubleDice', 'notDoubled', 'extraOnCritOnly']).optional(),
  label: z.string().optional()
});

export const damageFormulaSchema = z.object({
  raw: z.string(),
  components: z.array(damageComponentSchema),
  unresolvedTokens: z.array(z.string()).optional()
});

export const compendiumItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature', 'condition', 'creatureStatBlock']),
  name: z.string().min(1),
  summary: z.string().optional(),
  source: ruleSourceSchema,
  payload: z.record(z.string(), z.unknown())
});

export const compendiumImportSchema = z.object({
  id: z.string().min(1),
  source: ruleSourceSchema,
  items: z.array(compendiumItemSchema)
});

export type CompendiumImportInput = z.infer<typeof compendiumImportSchema>;
export type CompendiumItemInput = z.infer<typeof compendiumItemSchema>;
