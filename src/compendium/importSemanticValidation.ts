import type { RuleValidationIssue } from '../types';
import type {
  CompendiumEntityKind,
  CompendiumImportItem,
  CompendiumImportSource,
  ResourceDefinition,
  StructuredPrerequisite
} from './importDomain';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';

export interface ImportSemanticIssue extends RuleValidationIssue {
  itemId?: string;
  itemKind?: CompendiumEntityKind;
  path?: string;
  relatedId?: string;
}

export interface ImportSemanticValidationSummary {
  itemCount: number;
  uniqueItemIds: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  byCode: Record<string, number>;
}

export interface ImportSemanticValidationResult {
  valid: boolean;
  issues: ImportSemanticIssue[];
  errors: ImportSemanticIssue[];
  warnings: ImportSemanticIssue[];
  infos: ImportSemanticIssue[];
  summary: ImportSemanticValidationSummary;
}

export interface ImportSemanticExternalItem {
  id: string;
  kind: CompendiumEntityKind;
  /** Optional condition slug for existing condition entities. */
  conditionId?: string;
}

export interface ImportSemanticValidationOptions {
  /**
   * Existing catalog entities that may satisfy references in incremental packs.
   * This keeps semantic validation useful before persistence without forcing a
   * partial update pack to repeat every dependency it already has locally.
   */
  externalItems?: Iterable<ImportSemanticExternalItem>;
}

export interface SemanticImportPack {
  templateVersion: typeof IMPORT_TEMPLATE_VERSION_V2;
  id: string;
  source: CompendiumImportSource;
  metadata?: Record<string, unknown>;
  items: CompendiumImportItem[];
  [extension: string]: unknown;
}

type Item = CompendiumImportItem;
type Severity = RuleValidationIssue['severity'];

interface IssueContext {
  item?: Item;
  path?: string;
  relatedId?: string;
}

const makeIssue = (
  severity: Severity,
  code: string,
  message: string,
  context: IssueContext = {}
): ImportSemanticIssue => ({
  severity,
  code,
  message,
  ...(context.item ? { itemId: context.item.id, itemKind: context.item.kind, source: context.item.source } : {}),
  ...(context.path ? { path: context.path } : {}),
  ...(context.relatedId ? { relatedId: context.relatedId } : {})
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];

const duplicateValues = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
};

const allFeatureReferences = (item: Item): string[] => {
  // Progression references are validated with their level/owner context in
  // checkProgression(). This helper intentionally covers only direct lists so
  // one broken progression reference produces one actionable issue.
  if (item.kind === 'class' || item.kind === 'subclass') return item.payload.featureIds ?? [];
  if (item.kind === 'species') return item.payload.featureIds ?? [];
  if (item.kind === 'background') return item.payload.grantsFeatureIds ?? [];
  if (item.kind === 'feat') return item.payload.featureIds ?? [];
  return [];
};

const progressionFeatureLevels = (item: Item): Map<string, number[]> => {
  const result = new Map<string, number[]>();
  if (item.kind !== 'class' && item.kind !== 'subclass') return result;
  for (const entry of item.payload.progression ?? []) {
    for (const featureId of entry.featureIds) {
      const levels = result.get(featureId) ?? [];
      levels.push(entry.level);
      result.set(featureId, levels);
    }
  }
  return result;
};

const structuredPrerequisite = (value: unknown): StructuredPrerequisite | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const hasStructuredKey = ['classIds', 'subclassIds', 'featureIds', 'featIds', 'spellIds', 'abilities', 'level']
    .some((key) => record[key] !== undefined);
  return hasStructuredKey ? record as StructuredPrerequisite : undefined;
};

const resourceIdsFromItem = (item: Item): string[] => {
  if (item.kind === 'class') return (item.payload.resources ?? []).map((resource) => resource.id);
  if (item.kind === 'feature' && item.payload.resource?.id) return [item.payload.resource.id];
  return [];
};

const referenceKindsLabel = (kinds: readonly CompendiumEntityKind[]): string => kinds.join(' | ');

export const analyzeCompendiumImportV2Semantics = (
  pack: SemanticImportPack,
  options: ImportSemanticValidationOptions = {},
  // Only the V3 review boundary supplies IDs after validating raw evidence.
  // The ordinary V2 import and runtime validation paths remain strict.
  reviewOnlyAlternativeSpellIds: ReadonlySet<string> = new Set()
): ImportSemanticValidationResult => {
  const issues: ImportSemanticIssue[] = [];
  const byId = new Map<string, Item>();
  const externalById = new Map<string, ImportSemanticExternalItem>();
  const conditionByConditionId = new Map<string, Item>();
  const externalConditionIds = new Set<string>();
  const globalResourceIds = new Set<string>();
  const classIdByNormalizedName = new Map<string, string>();

  for (const external of options.externalItems ?? []) {
    externalById.set(external.id, external);
    if (external.kind === 'condition' && external.conditionId) externalConditionIds.add(external.conditionId);
  }

  for (const item of pack.items) {
    if (byId.has(item.id)) {
      issues.push(makeIssue('error', 'IMPORT_V2_DUPLICATE_ID', `Duplicate item id: ${item.id}.`, {
        item,
        path: 'id',
        relatedId: item.id
      }));
      continue;
    }
    byId.set(item.id, item);
    if (item.kind === 'class') classIdByNormalizedName.set(item.name.trim().toLowerCase(), item.id);
    for (const resourceId of resourceIdsFromItem(item)) globalResourceIds.add(resourceId);
  }

  for (const item of pack.items) {
    if (item.kind !== 'condition') continue;
    const previous = conditionByConditionId.get(item.payload.conditionId);
    if (previous) {
      issues.push(makeIssue(
        'error',
        'IMPORT_V2_DUPLICATE_CONDITION_ID',
        `Condition id ${item.payload.conditionId} is declared by both ${previous.id} and ${item.id}.`,
        { item, path: 'payload.conditionId', relatedId: previous.id }
      ));
    } else {
      conditionByConditionId.set(item.payload.conditionId, item);
    }
  }


  const checkReference = (
    item: Item,
    id: string,
    expectedKinds: readonly CompendiumEntityKind[],
    path: string,
    codes: { missing: string; wrongKind: string },
    missingSeverity: Severity = 'warning'
  ): Item | undefined => {
    const target = byId.get(id);
    const actualKind = target?.kind ?? externalById.get(id)?.kind;
    if (!actualKind) {
      issues.push(makeIssue(
        missingSeverity,
        codes.missing,
        `${item.kind} ${item.id} references missing ${referenceKindsLabel(expectedKinds)} ${id}.`,
        { item, path, relatedId: id }
      ));
      return undefined;
    }
    if (!expectedKinds.includes(actualKind)) {
      issues.push(makeIssue(
        'error',
        codes.wrongKind,
        `${item.kind} ${item.id} references ${id}, but that item is ${actualKind}; expected ${referenceKindsLabel(expectedKinds)}.`,
        { item, path, relatedId: id }
      ));
      return undefined;
    }
    return target;
  };

  const checkConditionId = (item: Item, conditionId: string, path: string, severity: Severity = 'warning'): void => {
    if (conditionByConditionId.has(conditionId) || externalConditionIds.has(conditionId)) return;
    issues.push(makeIssue(severity, 'IMPORT_V2_CONDITION_REFERENCE_MISSING', `${item.kind} ${item.id} references unknown conditionId ${conditionId}.`, {
      item,
      path,
      relatedId: conditionId
    }));
  };

  const checkActionReferences = (item: Item, actions: readonly unknown[] | undefined, path: string): void => {
    if (!actions) return;
    actions.forEach((actionValue, actionIndex) => {
      const action = asRecord(actionValue);
      if (!action) return;
      const actionPath = `${path}[${actionIndex}]`;
      if (typeof action.spellId === 'string') {
        checkReference(item, action.spellId, ['spell'], `${actionPath}.spellId`, {
          missing: 'IMPORT_V2_ACTION_SPELL_MISSING',
          wrongKind: 'IMPORT_V2_ACTION_SPELL_WRONG_KIND'
        });
      }
      for (const conditionKey of ['conditionIds', 'onSuccessConditionIds', 'onFailConditionIds', 'onHitConditionIds'] as const) {
        for (const [conditionIndex, conditionId] of asStringArray(action[conditionKey]).entries()) {
          checkConditionId(item, conditionId, `${actionPath}.${conditionKey}[${conditionIndex}]`);
        }
      }
      const consumes = Array.isArray(action.consumes) ? action.consumes : [];
      consumes.forEach((consumptionValue, consumptionIndex) => {
        const consumption = asRecord(consumptionValue);
        if (!consumption) return;
        if (typeof consumption.itemId === 'string') {
          checkReference(item, consumption.itemId, ['equipment', 'weapon', 'armor', 'magicItem'], `${actionPath}.consumes[${consumptionIndex}].itemId`, {
            missing: 'IMPORT_V2_CONSUMED_ITEM_MISSING',
            wrongKind: 'IMPORT_V2_CONSUMED_ITEM_WRONG_KIND'
          });
        }
        if (typeof consumption.resourceId === 'string' && !globalResourceIds.has(consumption.resourceId)) {
          issues.push(makeIssue('info', 'IMPORT_V2_RESOURCE_REFERENCE_EXTERNAL_OR_RUNTIME', `${item.id} action consumes resource ${consumption.resourceId}, which is not declared as an import resource in this pack. It may be runtime-defined.`, {
            item,
            path: `${actionPath}.consumes[${consumptionIndex}].resourceId`,
            relatedId: consumption.resourceId
          }));
        }
      });
    });
  };

  const checkEquipmentOptions = (item: Item, value: unknown, path: string): void => {
    const options = asRecord(value);
    if (!options) return;
    for (const [optionKey, optionValue] of Object.entries(options)) {
      const option = asRecord(optionValue);
      if (!option) continue;
      for (const [index, itemId] of asStringArray(option.itemIds).entries()) {
        checkReference(item, itemId, ['equipment', 'weapon', 'armor', 'magicItem'], `${path}.${optionKey}.itemIds[${index}]`, {
          missing: 'IMPORT_V2_EQUIPMENT_OPTION_ITEM_MISSING',
          wrongKind: 'IMPORT_V2_EQUIPMENT_OPTION_ITEM_WRONG_KIND'
        });
      }
    }
  };

  const checkPrerequisite = (item: Item, value: unknown, path: string): void => {
    const prerequisite = structuredPrerequisite(value);
    if (!prerequisite) return;
    const refs: Array<[keyof StructuredPrerequisite, readonly CompendiumEntityKind[]]> = [
      ['classIds', ['class']],
      ['subclassIds', ['subclass']],
      ['featureIds', ['feature']],
      ['featIds', ['feat']],
      ['spellIds', ['spell']]
    ];
    for (const [key, kinds] of refs) {
      for (const id of asStringArray(prerequisite[key])) {
        checkReference(item, id, kinds, `${path}.${key}`, {
          missing: 'IMPORT_V2_PREREQUISITE_REFERENCE_MISSING',
          wrongKind: 'IMPORT_V2_PREREQUISITE_REFERENCE_WRONG_KIND'
        });
      }
    }
  };

  const checkResources = (item: Item, resources: readonly ResourceDefinition[], path: string): void => {
    const ids = resources.map((resource) => resource.id);
    for (const duplicate of duplicateValues(ids)) {
      issues.push(makeIssue('error', 'IMPORT_V2_DUPLICATE_RESOURCE_ID', `Resource id ${duplicate} is declared more than once on ${item.id}.`, {
        item,
        path,
        relatedId: duplicate
      }));
    }
    resources.forEach((resource, index) => {
      const resourcePath = `${path}[${index}]`;
      const max = resource.max;
      if (typeof max === 'object' && max !== null && Array.isArray(max.steps)) {
        const levels = max.steps.map((entry) => entry.level).filter((level): level is number => typeof level === 'number');
        if (new Set(levels).size !== levels.length) {
          issues.push(makeIssue('error', 'IMPORT_V2_RESOURCE_SCALING_DUPLICATE_LEVEL', `Resource ${resource.id} has duplicate scaling levels.`, {
            item,
            path: `${resourcePath}.max.steps`
          }));
        }
        if (levels.some((level) => level < 1 || level > 20)) {
          issues.push(makeIssue('error', 'IMPORT_V2_RESOURCE_SCALING_LEVEL_OUT_OF_RANGE', `Resource ${resource.id} contains a scaling level outside 1-20.`, {
            item,
            path: `${resourcePath}.max.steps`
          }));
        }
      }
    });
  };

  const checkProgression = (item: Item): void => {
    if (item.kind !== 'class' && item.kind !== 'subclass') return;
    const progression = item.payload.progression ?? [];
    const levels = progression.map((entry) => entry.level);
    // Multiple progression entries at the same level are valid in the current
    // domain (several subclasses model each feature as a separate row). The
    // invariant is ordering and duplicate feature grants within a row, not one
    // row per level.
    const sorted = [...levels].sort((a, b) => a - b);
    if (levels.some((level, index) => level !== sorted[index])) {
      issues.push(makeIssue('warning', 'IMPORT_V2_PROGRESSION_UNSORTED', `${item.kind} ${item.id} progression is not sorted by level.`, {
        item,
        path: 'payload.progression'
      }));
    }

    const directFeatureIds = new Set(item.payload.featureIds ?? []);
    progression.forEach((entry, progressionIndex) => {
      const entryPath = `payload.progression[${progressionIndex}]`;
      for (const duplicate of duplicateValues(entry.featureIds)) {
        issues.push(makeIssue('error', 'IMPORT_V2_PROGRESSION_DUPLICATE_FEATURE', `${item.kind} ${item.id} repeats feature ${duplicate} at level ${entry.level}.`, {
          item,
          path: `${entryPath}.featureIds`,
          relatedId: duplicate
        }));
      }
      for (const featureId of entry.featureIds) {
        if (!directFeatureIds.has(featureId)) {
          issues.push(makeIssue('warning', 'IMPORT_V2_PROGRESSION_FEATURE_NOT_DECLARED', `${item.kind} ${item.id} progression references ${featureId}, but it is absent from payload.featureIds.`, {
            item,
            path: `${entryPath}.featureIds`,
            relatedId: featureId
          }));
        }
        const feature = checkReference(item, featureId, ['feature'], `${entryPath}.featureIds`, {
          missing: 'IMPORT_V2_FEATURE_REFERENCE_MISSING',
          wrongKind: 'IMPORT_V2_FEATURE_REFERENCE_WRONG_KIND'
        });
        if (!feature || feature.kind !== 'feature') continue;

        if (typeof feature.payload.levelGained === 'number' && entry.level < feature.payload.levelGained) {
          issues.push(makeIssue('error', 'IMPORT_V2_FEATURE_GRANTED_BEFORE_LEVEL_GAINED', `Feature ${feature.id} says levelGained ${feature.payload.levelGained}, but ${item.id} grants it earlier at level ${entry.level}.`, {
            item,
            path: `${entryPath}.featureIds`,
            relatedId: feature.id
          }));
        }
        // The same feature entity can legitimately reappear at later levels to
        // model upgrades (ASI, Expertise, Action Surge, subclass selectors,
        // etc.). levelGained therefore means first availability, not the only
        // level at which the feature may occur.
        if (item.kind === 'class' && feature.payload.classId && feature.payload.classId !== item.id) {
          issues.push(makeIssue('error', 'IMPORT_V2_CLASS_PROGRESSION_FEATURE_OWNER_MISMATCH', `Class ${item.id} grants feature ${feature.id}, but the feature belongs to class ${feature.payload.classId}.`, {
            item,
            path: `${entryPath}.featureIds`,
            relatedId: feature.id
          }));
        }
        if (item.kind === 'subclass' && feature.payload.subclassId && feature.payload.subclassId !== item.id) {
          issues.push(makeIssue('error', 'IMPORT_V2_SUBCLASS_PROGRESSION_FEATURE_OWNER_MISMATCH', `Subclass ${item.id} grants feature ${feature.id}, but the feature belongs to subclass ${feature.payload.subclassId}.`, {
            item,
            path: `${entryPath}.featureIds`,
            relatedId: feature.id
          }));
        }
      }
    });
  };

  const checkClassSpellcasting = (item: Item): void => {
    if (item.kind !== 'class' || !item.payload.spellcasting) return;
    const spellcasting = item.payload.spellcasting;
    const arrays: Array<[string, number[] | undefined]> = [
      ['cantripsKnownByLevel', spellcasting.cantripsKnownByLevel],
      ['spellsKnownByLevel', spellcasting.spellsKnownByLevel],
      ['preparedSpellsByLevel', spellcasting.preparedSpellsByLevel]
    ];
    for (const [field, values] of arrays) {
      if (!values) continue;
      if (values.length > 20) {
        issues.push(makeIssue('error', 'IMPORT_V2_SPELLCASTING_LEVEL_TABLE_TOO_LONG', `${item.id} ${field} contains ${values.length} entries; maximum is 20.`, {
          item,
          path: `payload.spellcasting.${field}`
        }));
      } else if (values.length > 0 && values.length < 20) {
        issues.push(makeIssue('info', 'IMPORT_V2_SPELLCASTING_PARTIAL_LEVEL_TABLE', `${item.id} ${field} contains ${values.length}/20 level entries. Partial tables are allowed but should be intentional.`, {
          item,
          path: `payload.spellcasting.${field}`
        }));
      }
    }

    const slotsByLevel = spellcasting.slotsByLevel;
    if (slotsByLevel) {
      for (const [characterLevel, slots] of Object.entries(slotsByLevel)) {
        const level = Number(characterLevel);
        if (!Number.isInteger(level) || level < 1 || level > 20) {
          issues.push(makeIssue('error', 'IMPORT_V2_SPELLCASTING_CHARACTER_LEVEL_INVALID', `${item.id} slotsByLevel contains invalid character level key ${characterLevel}.`, {
            item,
            path: `payload.spellcasting.slotsByLevel.${characterLevel}`
          }));
        }
        for (const [slotLevel, count] of Object.entries(slots)) {
          const parsedSlotLevel = Number(slotLevel);
          if (!Number.isInteger(parsedSlotLevel) || parsedSlotLevel < 1 || parsedSlotLevel > 9) {
            issues.push(makeIssue('error', 'IMPORT_V2_SPELLCASTING_SLOT_LEVEL_INVALID', `${item.id} slotsByLevel contains invalid spell slot level ${slotLevel}.`, {
              item,
              path: `payload.spellcasting.slotsByLevel.${characterLevel}.${slotLevel}`
            }));
          }
          if (count < 0) {
            issues.push(makeIssue('error', 'IMPORT_V2_SPELLCASTING_SLOT_COUNT_INVALID', `${item.id} has negative spell slot count at class level ${characterLevel}, slot ${slotLevel}.`, {
              item,
              path: `payload.spellcasting.slotsByLevel.${characterLevel}.${slotLevel}`
            }));
          }
        }
      }
    }

    const pactSlots = spellcasting.pactSlotsByLevel;
    const pactLevels = spellcasting.pactSlotLevelByLevel;
    if ((pactSlots && !pactLevels) || (!pactSlots && pactLevels)) {
      issues.push(makeIssue('error', 'IMPORT_V2_PACT_MAGIC_TABLE_INCOMPLETE', `${item.id} must define pactSlotsByLevel and pactSlotLevelByLevel together.`, {
        item,
        path: 'payload.spellcasting'
      }));
    }
    if (Array.isArray(pactSlots) && Array.isArray(pactLevels) && pactSlots.length !== pactLevels.length) {
      issues.push(makeIssue('error', 'IMPORT_V2_PACT_MAGIC_TABLE_LENGTH_MISMATCH', `${item.id} pact slot count and slot-level tables have different lengths.`, {
        item,
        path: 'payload.spellcasting'
      }));
    }
  };

  for (const item of pack.items) {
    checkProgression(item);

    const directFeatureIds = allFeatureReferences(item);
    for (const duplicate of duplicateValues(directFeatureIds)) {
      issues.push(makeIssue('warning', 'IMPORT_V2_DUPLICATE_FEATURE_REFERENCE', `${item.kind} ${item.id} repeats feature reference ${duplicate}.`, {
        item,
        path: 'payload.featureIds',
        relatedId: duplicate
      }));
    }
    for (const featureId of directFeatureIds) {
      const feature = checkReference(item, featureId, ['feature'], 'payload.featureIds', {
        missing: 'IMPORT_V2_FEATURE_REFERENCE_MISSING',
        wrongKind: 'IMPORT_V2_FEATURE_REFERENCE_WRONG_KIND'
      });
      if (!feature || feature.kind !== 'feature') continue;
      if (item.kind === 'class' && feature.payload.classId && feature.payload.classId !== item.id) {
        issues.push(makeIssue('error', 'IMPORT_V2_CLASS_FEATURE_OWNER_MISMATCH', `Class ${item.id} references feature ${feature.id}, but the feature belongs to class ${feature.payload.classId}.`, {
          item, path: 'payload.featureIds', relatedId: feature.id
        }));
      }
      if (item.kind === 'subclass' && feature.payload.subclassId && feature.payload.subclassId !== item.id) {
        issues.push(makeIssue('error', 'IMPORT_V2_SUBCLASS_FEATURE_OWNER_MISMATCH', `Subclass ${item.id} references feature ${feature.id}, but the feature belongs to subclass ${feature.payload.subclassId}.`, {
          item, path: 'payload.featureIds', relatedId: feature.id
        }));
      }
      if (item.kind === 'species' && feature.payload.speciesId && feature.payload.speciesId !== item.id) {
        issues.push(makeIssue('error', 'IMPORT_V2_SPECIES_FEATURE_OWNER_MISMATCH', `Species ${item.id} references feature ${feature.id}, but the feature belongs to species ${feature.payload.speciesId}.`, {
          item, path: 'payload.featureIds', relatedId: feature.id
        }));
      }
    }

    if (item.kind === 'class') {
      checkResources(item, item.payload.resources ?? [], 'payload.resources');
      checkClassSpellcasting(item);
      checkEquipmentOptions(item, item.payload.equipmentOptions, 'payload.equipmentOptions');
    }

    if (item.kind === 'subclass') {
      checkReference(item, item.payload.classId, ['class'], 'payload.classId', {
        missing: 'IMPORT_V2_SUBCLASS_CLASS_MISSING',
        wrongKind: 'IMPORT_V2_SUBCLASS_CLASS_WRONG_KIND'
      }, 'error');
    }

    if (item.kind === 'background') {
      for (const featId of item.payload.featIds ?? []) {
        checkReference(item, featId, ['feat'], 'payload.featIds', {
          missing: 'IMPORT_V2_BACKGROUND_FEAT_MISSING',
          wrongKind: 'IMPORT_V2_BACKGROUND_FEAT_WRONG_KIND'
        });
      }
      const featChoice = asRecord(item.payload.featChoice);
      const recommendedFeatId = typeof featChoice?.recommendedFeatId === 'string' ? featChoice.recommendedFeatId : undefined;
      if (recommendedFeatId) {
        checkReference(item, recommendedFeatId, ['feat'], 'payload.featChoice.recommendedFeatId', {
          missing: 'IMPORT_V2_BACKGROUND_RECOMMENDED_FEAT_MISSING',
          wrongKind: 'IMPORT_V2_BACKGROUND_RECOMMENDED_FEAT_WRONG_KIND'
        });
      }
      checkEquipmentOptions(item, item.payload.equipmentOptions, 'payload.equipmentOptions');
      if (item.payload.abilityScoreOptions && new Set(item.payload.abilityScoreOptions).size !== item.payload.abilityScoreOptions.length) {
        issues.push(makeIssue('error', 'IMPORT_V2_BACKGROUND_DUPLICATE_ABILITY_OPTION', `${item.id} repeats an ability in abilityScoreOptions.`, {
          item,
          path: 'payload.abilityScoreOptions'
        }));
      }
    }

    if (item.kind === 'feat') {
      checkPrerequisite(item, item.payload.prerequisite, 'payload.prerequisite');
      checkPrerequisite(item, item.payload.mechanics?.prerequisites, 'payload.mechanics.prerequisites');
      checkActionReferences(item, item.payload.grantsActions, 'payload.grantsActions');
    }

    if (item.kind === 'feature') {
      if (item.payload.classId) {
        checkReference(item, item.payload.classId, ['class'], 'payload.classId', {
          missing: 'IMPORT_V2_FEATURE_CLASS_MISSING',
          wrongKind: 'IMPORT_V2_FEATURE_CLASS_WRONG_KIND'
        }, 'error');
      }
      if (item.payload.subclassId) {
        const subclass = checkReference(item, item.payload.subclassId, ['subclass'], 'payload.subclassId', {
          missing: 'IMPORT_V2_FEATURE_SUBCLASS_MISSING',
          wrongKind: 'IMPORT_V2_FEATURE_SUBCLASS_WRONG_KIND'
        }, 'error');
        if (subclass?.kind === 'subclass' && item.payload.classId && subclass.payload.classId !== item.payload.classId) {
          issues.push(makeIssue('error', 'IMPORT_V2_FEATURE_SUBCLASS_CLASS_MISMATCH', `Feature ${item.id} classId ${item.payload.classId} does not match subclass ${subclass.id} owner ${subclass.payload.classId}.`, {
            item,
            path: 'payload.classId',
            relatedId: subclass.id
          }));
        }
      }
      if (item.payload.speciesId) {
        checkReference(item, item.payload.speciesId, ['species'], 'payload.speciesId', {
          missing: 'IMPORT_V2_FEATURE_SPECIES_MISSING',
          wrongKind: 'IMPORT_V2_FEATURE_SPECIES_WRONG_KIND'
        }, 'error');
      }

      if (item.payload.sourceType === 'classFeature' && !item.payload.classId) {
        issues.push(makeIssue('warning', 'IMPORT_V2_CLASS_FEATURE_OWNER_MISSING', `${item.id} is a classFeature without classId.`, { item, path: 'payload.classId' }));
      }
      if (item.payload.sourceType === 'subclassFeature' && !item.payload.subclassId) {
        issues.push(makeIssue('warning', 'IMPORT_V2_SUBCLASS_FEATURE_OWNER_MISSING', `${item.id} is a subclassFeature without subclassId.`, { item, path: 'payload.subclassId' }));
      }
      if (item.payload.sourceType === 'speciesTrait' && !item.payload.speciesId) {
        issues.push(makeIssue('warning', 'IMPORT_V2_SPECIES_FEATURE_OWNER_MISSING', `${item.id} is a speciesTrait without speciesId.`, { item, path: 'payload.speciesId' }));
      }

      checkPrerequisite(item, item.payload.prerequisite, 'payload.prerequisite');
      checkPrerequisite(item, item.payload.mechanics?.prerequisites, 'payload.mechanics.prerequisites');
      checkResources(item, item.payload.resource ? [item.payload.resource] : [], 'payload.resource');
      checkActionReferences(item, item.payload.grantsActions, 'payload.grantsActions');
      const featureRecord = item.payload as unknown as Record<string, unknown>;
      for (const [conditionIndex, conditionId] of asStringArray(featureRecord.conditionIds).entries()) {
        checkConditionId(item, conditionId, `payload.conditionIds[${conditionIndex}]`);
      }
      for (const spellRefKey of ['spellRefs', 'alwaysPreparedSpellRefs'] as const) {
        const spellRefs = Array.isArray(featureRecord[spellRefKey]) ? featureRecord[spellRefKey] as unknown[] : [];
        spellRefs.forEach((spellRefValue, spellRefIndex) => {
          const spellRef = asRecord(spellRefValue);
          const spellId = typeof spellRef?.spellId === 'string' ? spellRef.spellId : typeof spellRefValue === 'string' ? spellRefValue : undefined;
          if (spellId) {
            checkReference(item, spellId, ['spell'], `payload.${spellRefKey}[${spellRefIndex}]`, {
              missing: 'IMPORT_V2_FEATURE_SPELL_REFERENCE_MISSING',
              wrongKind: 'IMPORT_V2_FEATURE_SPELL_REFERENCE_WRONG_KIND'
            });
          }
        });
      }

      for (const [index, consumption] of (item.payload.consumes ?? []).entries()) {
        if (consumption.itemId) {
          checkReference(item, consumption.itemId, ['equipment', 'weapon', 'armor', 'magicItem'], `payload.consumes[${index}].itemId`, {
            missing: 'IMPORT_V2_CONSUMED_ITEM_MISSING',
            wrongKind: 'IMPORT_V2_CONSUMED_ITEM_WRONG_KIND'
          });
        }
        if (consumption.resourceId && !globalResourceIds.has(consumption.resourceId)) {
          issues.push(makeIssue('info', 'IMPORT_V2_RESOURCE_REFERENCE_EXTERNAL_OR_RUNTIME', `${item.id} consumes resource ${consumption.resourceId}, which is not declared as an import resource in this pack. It may be runtime-defined.`, {
            item,
            path: `payload.consumes[${index}].resourceId`,
            relatedId: consumption.resourceId
          }));
        }
      }
    }

    if (item.kind === 'spell') {
      if (item.payload.classes.length === 0) {
        if (reviewOnlyAlternativeSpellIds.has(item.id) && item.source.status === 'needsReview') {
          issues.push(makeIssue('warning', 'V3_ALTERNATIVE_SPELL_ACCESS_REVIEW_REQUIRED', `Spell ${item.id} has only alternative access evidence; direct class grants are not established.`, { item, path: 'payload.classes' }));
        } else {
          issues.push(makeIssue('error', 'IMPORT_V2_SPELL_CLASSES_EMPTY', `Spell ${item.id} must declare at least one class.`, { item, path: 'payload.classes' }));
        }
      }
      for (const duplicate of duplicateValues(item.payload.classes.map((name) => name.trim().toLowerCase()))) {
        issues.push(makeIssue('warning', 'IMPORT_V2_SPELL_DUPLICATE_CLASS_NAME', `Spell ${item.id} repeats class name ${duplicate}.`, { item, path: 'payload.classes' }));
      }
      const declaredClassIds = new Set(item.payload.classIds ?? []);
      item.payload.classes.forEach((className, classNameIndex) => {
        const resolvedId = classIdByNormalizedName.get(className.trim().toLowerCase());
        if (resolvedId && !declaredClassIds.has(resolvedId)) {
          issues.push(makeIssue('warning', 'IMPORT_V2_SPELL_CLASS_ID_NOT_RESOLVED', `Spell ${item.id} names class ${className}, but classIds does not include ${resolvedId}.`, {
            item,
            path: `payload.classes[${classNameIndex}]`,
            relatedId: resolvedId
          }));
        }
      });
      for (const [index, classId] of (item.payload.classIds ?? []).entries()) {
        checkReference(item, classId, ['class'], `payload.classIds[${index}]`, {
          missing: 'IMPORT_V2_SPELL_CLASS_MISSING',
          wrongKind: 'IMPORT_V2_SPELL_CLASS_WRONG_KIND'
        });
      }
      for (const duplicate of duplicateValues(item.payload.classIds ?? [])) {
        issues.push(makeIssue('warning', 'IMPORT_V2_SPELL_DUPLICATE_CLASS_ID', `Spell ${item.id} repeats classId ${duplicate}.`, { item, path: 'payload.classIds', relatedId: duplicate }));
      }
      if (item.payload.level === 0 && item.payload.consumesSpellSlot === true) {
        issues.push(makeIssue('error', 'IMPORT_V2_CANTRIP_CONSUMES_SLOT', `Cantrip ${item.id} cannot consume a spell slot by default.`, { item, path: 'payload.consumesSpellSlot' }));
      }
      if (item.payload.minimumSlotLevel !== undefined && item.payload.minimumSlotLevel < item.payload.level) {
        issues.push(makeIssue('error', 'IMPORT_V2_SPELL_MINIMUM_SLOT_LEVEL_INVALID', `Spell ${item.id} minimumSlotLevel ${item.payload.minimumSlotLevel} is below spell level ${item.payload.level}.`, {
          item,
          path: 'payload.minimumSlotLevel'
        }));
      }
      const scaling = asRecord(item.payload.scaling);
      if (scaling?.kind === 'slotLevel') {
        // When omitted, baseLevel is unambiguous and defaults to the spell's
        // minimum usable slot level. Only contradictory explicit values are an
        // error; omission is not semantic debt.
        const baseLevel = typeof scaling.baseLevel === 'number' ? scaling.baseLevel : undefined;
        if (baseLevel !== undefined && baseLevel < Math.max(1, item.payload.level)) {
          issues.push(makeIssue('error', 'IMPORT_V2_SLOT_SCALING_BASE_LEVEL_INVALID', `Spell ${item.id} slot scaling baseLevel ${baseLevel} is below its usable slot level.`, { item, path: 'payload.scaling.baseLevel' }));
        }
      }
      if (item.payload.damageOnSaveSuccess && !item.payload.saveAbility) {
        issues.push(makeIssue('warning', 'IMPORT_V2_SAVE_DAMAGE_WITHOUT_SAVE', `Spell ${item.id} defines damageOnSaveSuccess without saveAbility.`, { item, path: 'payload.damageOnSaveSuccess' }));
      }
      checkActionReferences(item, item.payload.grantsActions, 'payload.grantsActions');
    }

    if (item.kind === 'weapon') {
      if (!item.payload.weaponCategory) {
        issues.push(makeIssue('error', 'IMPORT_V2_WEAPON_CATEGORY_MISSING', `Weapon ${item.id} must declare weaponCategory so simple/martial eligibility is deterministic.`, { item, path: 'payload.weaponCategory' }));
      } else if (item.payload.weaponCategory === 'unknown') {
        issues.push(makeIssue('warning', 'IMPORT_V2_WEAPON_CATEGORY_UNRESOLVED', `Weapon ${item.id} has unresolved weaponCategory and requires review before simple/martial eligibility can be applied.`, { item, path: 'payload.weaponCategory' }));
      }
      const versatile = item.payload.properties?.some((property) => property.toLowerCase() === 'versatile') ?? false;
      if (versatile && !item.payload.versatileDamageFormula) {
        issues.push(makeIssue('warning', 'IMPORT_V2_WEAPON_VERSATILE_DAMAGE_MISSING', `Weapon ${item.id} has versatile property but no versatileDamageFormula.`, { item, path: 'payload.versatileDamageFormula' }));
      }
      if (item.payload.weaponType === 'ranged' && !item.payload.range) {
        issues.push(makeIssue('warning', 'IMPORT_V2_RANGED_WEAPON_RANGE_MISSING', `Ranged weapon ${item.id} does not declare range.`, { item, path: 'payload.range' }));
      }
      if (!item.payload.cost) {
        issues.push(makeIssue('warning', 'IMPORT_V2_EQUIPMENT_COST_MISSING', `Weapon ${item.id} does not declare structured cost.`, { item, path: 'payload.cost' }));
      }
    }

    if (item.kind === 'armor') {
      if (!item.payload.armorCategory) {
        issues.push(makeIssue('warning', 'IMPORT_V2_ARMOR_CATEGORY_MISSING', `Armor ${item.id} does not declare armorCategory.`, { item, path: 'payload.armorCategory' }));
      }
      const isShieldLike = String(item.payload.armorCategory ?? '').toLowerCase() === 'shield' || (item.payload.acBonus ?? 0) > 0;
      if (item.payload.baseAC < 0 || (item.payload.baseAC === 0 && !isShieldLike)) {
        issues.push(makeIssue('error', 'IMPORT_V2_ARMOR_BASE_AC_INVALID', `Armor ${item.id} must have positive baseAC unless it is modeled as an AC-bonus shield.`, { item, path: 'payload.baseAC' }));
      }
      if (typeof item.payload.dexCap === 'number' && item.payload.dexCap < 0) {
        issues.push(makeIssue('error', 'IMPORT_V2_ARMOR_DEX_CAP_INVALID', `Armor ${item.id} has negative dexCap.`, { item, path: 'payload.dexCap' }));
      }
      if (!item.payload.cost) {
        issues.push(makeIssue('warning', 'IMPORT_V2_EQUIPMENT_COST_MISSING', `Armor ${item.id} does not declare structured cost.`, { item, path: 'payload.cost' }));
      }
    }

    if (item.kind === 'equipment' || item.kind === 'magicItem') {
      if (!item.payload.cost) {
        issues.push(makeIssue('warning', 'IMPORT_V2_EQUIPMENT_COST_MISSING', `${item.kind} ${item.id} does not declare structured cost.`, { item, path: 'payload.cost' }));
      }
      checkActionReferences(item, item.payload.grantsActions, 'payload.grantsActions');
    }

    if (item.kind === 'creatureStatBlock') {
      for (const section of ['actions', 'bonusActions', 'reactions'] as const) {
        for (const [actionIndex, action] of (item.payload[section] ?? []).entries()) {
          for (const [conditionIndex, conditionId] of (action.conditionIds ?? []).entries()) {
            if (!conditionByConditionId.has(conditionId) && !externalConditionIds.has(conditionId)) {
              issues.push(makeIssue('warning', 'IMPORT_V2_CREATURE_CONDITION_MISSING', `${item.id} ${section} action ${action.name} references unknown conditionId ${conditionId}.`, {
                item,
                path: `payload.${section}[${actionIndex}].conditionIds[${conditionIndex}]`,
                relatedId: conditionId
              }));
            }
          }
        }
      }
    }

    const featureLevels = progressionFeatureLevels(item);
    if ((item.kind === 'class' || item.kind === 'subclass') && featureLevels.size) {
      for (const [featureId, levels] of featureLevels) {
        if (new Set(levels).size !== levels.length) {
          issues.push(makeIssue('warning', 'IMPORT_V2_FEATURE_GRANTED_MULTIPLE_TIMES_SAME_LEVEL', `${item.id} grants ${featureId} more than once at the same level.`, {
            item,
            path: 'payload.progression',
            relatedId: featureId
          }));
        }
      }
    }
  }

  // Condition references also exist in feature/spell effect extensions. They are
  // intentionally not hard-failed yet because the current runtime uses both
  // formal condition entities and lightweight effect-state identifiers. Creature
  // action conditionIds are validated strictly enough above because that field is
  // already modeled as a canonical condition reference.

  const errors = issues.filter((entry) => entry.severity === 'error');
  const warnings = issues.filter((entry) => entry.severity === 'warning');
  const infos = issues.filter((entry) => entry.severity === 'info');
  const byCode: Record<string, number> = {};
  for (const semanticIssue of issues) byCode[semanticIssue.code] = (byCode[semanticIssue.code] ?? 0) + 1;

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    infos,
    summary: {
      itemCount: pack.items.length,
      uniqueItemIds: byId.size,
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length,
      byCode
    }
  };
};

/** Backward-compatible array API used by parseImportPack and Phase 01 tests. */
export const validateCompendiumImportV2Semantics = (
  pack: SemanticImportPack,
  options: ImportSemanticValidationOptions = {}
): ImportSemanticIssue[] => analyzeCompendiumImportV2Semantics(pack, options).issues;
