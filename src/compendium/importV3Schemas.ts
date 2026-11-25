import { z } from 'zod';
import {
  importV2SourceSchema,
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
  creatureStatBlockImportItemV2Schema,
} from './importV2Schemas';
import { IMPORT_TEMPLATE_VERSION_V3 } from './importVersions';

export { IMPORT_TEMPLATE_VERSION_V3 } from './importVersions';
export const IMPORT_V3_CONTRACT_REVISION = 'canonical-v3.1' as const;
const nonEmpty = z.string().min(1).refine(s => s.trim() === s && s.length > 0, 'Expected trimmed nonempty string');
const metadata = z.record(z.string(), z.unknown()).refine(m => !Object.prototype.hasOwnProperty.call(m,'v3'), 'metadata.v3 is reserved for runtime projection');
const isoDate = z.string().refine(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0,10) === s, 'Expected a valid ISO calendar date');
const year = z.number().int().min(1).max(9999);
const month = z.number().int().min(1).max(12);
export const publicationV3Schema = z.discriminatedUnion('precision', [
  z.object({ precision:z.literal('day'), date:isoDate, year, evidence:nonEmpty }).strict(),
  z.object({ precision:z.literal('month'), date:z.null(), year, month, evidence:nonEmpty }).strict(),
  z.object({ precision:z.literal('year'), date:z.null(), year, evidence:nonEmpty }).strict(),
  z.object({ precision:z.literal('unknown'), date:z.null(), year:z.null(), evidence:nonEmpty }).strict()
]).superRefine((p,ctx) => {
  if (p.precision === 'day' && Number(p.date.slice(0,4)) !== p.year)
    ctx.addIssue({code:'custom',path:['year'],message:'Publication year must match date'});
});
export const identityV3Schema = z.object({
  canonicalKey:nonEmpty, precedenceScope:nonEmpty
}).strict();
export const precedenceV3Schema = z.object({
  relation:z.enum(['original','supersedes','reprint','coexists','unresolved']),
  supersedes:z.array(nonEmpty), reprints:z.array(nonEmpty), coexistsWith:z.array(nonEmpty),
  basis:nonEmpty, notes:z.string().optional()
}).strict();
const hash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const provenanceV3Schema = z.discriminatedUnion('origin',[
  z.object({
    origin:z.enum(['5etools','homebrew']), repository:nonEmpty, commit:hash, blob:hash,
    path:nonEmpty.refine(p => !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s => s && s !== '.' && s !== '..')),
    entityKey:nonEmpty, index:z.number().int().nonnegative(),
    sourceCode:nonEmpty, resolverVersion:nonEmpty, lineage:z.array(nonEmpty)
  }).strict(),
  z.object({origin:z.literal('manual'), reference:nonEmpty}).strict(),
  z.object({origin:z.literal('legacy'), reference:nonEmpty, format:z.enum(['v1','v2','historical-v3'])}).strict()
]);
export const importV3SourceSchema = importV2SourceSchema.extend({
  rulesEra:z.enum(['2014','2024','unknown']),
  contentType:z.enum(['official','third-party','homebrew']),
  precedenceScope:nonEmpty,
  publication:publicationV3Schema
});
const v3Fields = {
  source:importV3SourceSchema,
  identity:identityV3Schema,
  precedence:precedenceV3Schema,
  provenance:provenanceV3Schema,
  metadata:metadata.optional()
};
const classV3 = classImportItemV2Schema.extend(v3Fields);
const subclassV3 = subclassImportItemV2Schema.extend(v3Fields);
const speciesV3 = speciesImportItemV2Schema.extend(v3Fields);
const backgroundV3 = backgroundImportItemV2Schema.extend(v3Fields);
const featV3 = featImportItemV2Schema.extend(v3Fields);
const weaponV3 = weaponImportItemV2Schema.extend(v3Fields);
const armorV3 = armorImportItemV2Schema.extend(v3Fields);
const equipmentV3 = equipmentImportItemV2Schema.extend(v3Fields);
const magicItemV3 = magicItemImportItemV2Schema.extend(v3Fields);
const spellV3 = spellImportItemV2Schema.extend(v3Fields);
const featureV3 = featureImportItemV2Schema.extend(v3Fields);
const conditionV3 = conditionImportItemV2Schema.extend(v3Fields);
const creatureStatBlockV3 = creatureStatBlockImportItemV2Schema.extend(v3Fields);
export const compendiumImportItemV3Schema = z.discriminatedUnion('kind', [
  classV3,
  subclassV3,
  speciesV3,
  backgroundV3,
  featV3,
  weaponV3,
  armorV3,
  equipmentV3,
  magicItemV3,
  spellV3,
  featureV3,
  conditionV3,
  creatureStatBlockV3,
]);
export const compendiumImportV3Schema = z.object({
  templateVersion:z.literal(IMPORT_TEMPLATE_VERSION_V3),
  contractRevision:z.literal(IMPORT_V3_CONTRACT_REVISION),
  id:nonEmpty,
  source:importV3SourceSchema,
  metadata:metadata.optional(),
  items:z.array(compendiumImportItemV3Schema)
}).strict();
export type CompendiumImportV3Input = z.infer<typeof compendiumImportV3Schema>;
export type CompendiumImportItemV3Input = z.infer<typeof compendiumImportItemV3Schema>;
