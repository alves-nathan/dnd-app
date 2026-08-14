import {
  ActionCost,
  AbilityScore,
  Armor,
  Background,
  Character,
  CharacterClass,
  CharacterCompendiumLink,
  CompendiumAppliedEntityType,
  DamageSourceType,
  Equipment,
  Feat,
  Feature,
  MagicItem,
  ResourcePool,
  RuleValidationIssue,
  Species,
  Spell,
  Subclass,
  Weapon
} from '../types';
import { createId } from '../utils/id';
import { StoredCompendiumItem } from './types';
import { buildDamageFormulaFromPayload, formulaTextFromPayload, parseGrantedActionsFromPayload, parseResourceCostsFromPayload, parseSpellScalingFromPayload } from './actionMapping';
import { parseEffectTemplatesFromPayload } from '../rules-engine/effects/derivedEffects';
import { focusMetadataFromLabel } from '../characters/spellComponentRules';
import { describeTacticalAreaTemplate, normalizeTacticalAreaTemplate } from '../rules-engine/targeting/areaTemplates';
import { getAbilityModifier, getProficiencyBonus, getTotalLevel } from '../rules-engine/characters/derivedStats';

export interface ApplyCompendiumItemResult {
  ok: boolean;
  character: Character;
  link?: CharacterCompendiumLink;
  issues: RuleValidationIssue[];
}

interface MappedEntityResult {
  entityType: CompendiumAppliedEntityType;
  entityId: string;
  entityName: string;
  character: Character;
  issues: RuleValidationIssue[];
}

const abilities: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const abilitySet = new Set<string>(abilities);
const actionCosts: ActionCost[] = ['action', 'bonusAction', 'reaction', 'movement', 'free', 'special'];
const actionCostSet = new Set<string>(actionCosts);
const damageSourceTypes: DamageSourceType[] = ['weapon', 'abilityModifier', 'spell', 'classFeature', 'speciesFeature', 'feat', 'magicItem', 'condition', 'buff', 'debuff', 'manual'];
const damageSourceTypeSet = new Set<string>(damageSourceTypes);

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const asStringArray = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);
const spellComponentsFromPayload = (value: unknown) => {
  if (typeof value === 'string') {
    const normalized = value.toUpperCase();
    return { verbal: /(^|[, /])V($|[, /])/.test(normalized), somatic: /(^|[, /])S($|[, /])/.test(normalized), material: /(^|[, /])M($|[, /])/.test(normalized), materialDescription: value.match(/M\s*\((.+)\)/i)?.[1] };
  }
  const record = asRecord(value);
  if (!Object.keys(record).length) return undefined;
  return { verbal: asBoolean(record.verbal) ?? asBoolean(record.v) ?? false, somatic: asBoolean(record.somatic) ?? asBoolean(record.s) ?? false, material: asBoolean(record.material) ?? asBoolean(record.m) ?? false, materialDescription: asString(record.materialDescription) ?? asString(record.materials) ?? asString(record.description) };
};
const asAbility = (value: unknown): AbilityScore | undefined => {
  const text = asString(value)?.toUpperCase();
  if (text && abilitySet.has(text)) return text as AbilityScore;
  const record = asRecord(value);
  const options = Array.isArray(record.options)
    ? record.options
        .map((entry) => asString(entry)?.toUpperCase())
        .filter((entry): entry is string => Boolean(entry && abilitySet.has(entry)))
    : [];
  return options.length === 1 ? options[0] as AbilityScore : undefined;
};

const resolveAbilityReference = (value: unknown, character: Character): AbilityScore | undefined => {
  const direct = asAbility(value);
  if (direct) return direct;
  const record = asRecord(value);
  const options = Array.isArray(record.options)
    ? record.options
        .map((entry) => asString(entry)?.toUpperCase())
        .filter((entry): entry is AbilityScore => Boolean(entry && abilitySet.has(entry)))
    : [];
  if (!options.length) return undefined;
  return options.reduce((best, candidate) =>
    character.abilities[candidate] > character.abilities[best] ? candidate : best
  );
};
const asActionCost = (value: unknown): ActionCost | undefined => {
  const text = asString(value);
  if (text && actionCostSet.has(text)) return text as ActionCost;
  const record = asRecord(value);
  const structured = asString(record.actionCost);
  return structured && actionCostSet.has(structured) ? (structured as ActionCost) : undefined;
};
const asDamageSourceType = (value: unknown): DamageSourceType | undefined => {
  const text = asString(value);
  return text && damageSourceTypeSet.has(text) ? (text as DamageSourceType) : undefined;
};

const asSimpleDamageType = (value: unknown): string | undefined => {
  const direct = asString(value);
  if (direct) return direct.toLowerCase();
  const record = asRecord(value);
  const candidates = [
    ...(Array.isArray(record.types) ? record.types : []),
    ...(Array.isArray(record.options) ? record.options : [])
  ].map(asString).filter((entry): entry is string => Boolean(entry));
  return candidates.length === 1 ? candidates[0]!.toLowerCase() : undefined;
};

const asResourceRecharge = (value: unknown): ResourcePool['recharge'] | undefined => {
  const text = asString(value);
  return text === 'turn' || text === 'shortRest' || text === 'longRest' || text === 'day' || text === 'manual' ? text : undefined;
};

const scalingStepValue = (stepsValue: unknown, level: number): number | undefined => {
  if (!Array.isArray(stepsValue)) return undefined;
  const candidates = stepsValue
    .map((entry) => {
      const record = asRecord(entry);
      return { level: asNumber(record.level), value: asNumber(record.value) };
    })
    .filter((entry): entry is { level: number; value: number } => entry.level !== undefined && entry.value !== undefined && entry.level <= level)
    .sort((left, right) => right.level - left.level);
  return candidates[0]?.value;
};

const abilityFromResourceFormula = (record: Record<string, unknown>): AbilityScore | undefined => {
  const direct = asString(record.ability)?.toUpperCase();
  if (direct && abilitySet.has(direct)) return direct as AbilityScore;
  const formula = asString(record.formula);
  const match = formula ? /\b(STR|DEX|CON|INT|WIS|CHA)\b/i.exec(formula) : undefined;
  return match ? match[1].toUpperCase() as AbilityScore : undefined;
};

const resourceMinimumFromFormula = (record: Record<string, unknown>): number | undefined => {
  const direct = asNumber(record.minimum);
  if (direct !== undefined) return direct;
  const formula = asString(record.formula);
  if (!formula) return undefined;
  const match = /minimum\s*(?:of\s*)?(\d+)/i.exec(formula) ?? /max\(\s*(\d+)\s*,/i.exec(formula);
  return match ? Number(match[1]) : undefined;
};

const scaledResourceMaximum = (
  value: unknown,
  payload: Record<string, unknown>,
  character: Character
): number | undefined => {
  const direct = asNumber(value);
  if (direct !== undefined) return direct;
  const record = asRecord(value);
  if (!Object.keys(record).length) return undefined;
  const kind = asString(record.kind);

  if (kind === 'proficiencyBonus') return getProficiencyBonus(character);
  if (kind === 'characterLevel') return scalingStepValue(record.steps, getTotalLevel(character));
  if (kind === 'classLevel') {
    const classId = asString(payload.classId) ?? asString(payload.ownerClassId);
    const classLevel = classId ? character.classes.find((entry) => entry.id === classId)?.level : undefined;
    return classLevel !== undefined ? scalingStepValue(record.steps, classLevel) : undefined;
  }
  if (kind === 'abilityModifier') {
    const ability = abilityFromResourceFormula(record);
    if (!ability) return undefined;
    const valueFromAbility = getAbilityModifier(character.abilities, ability);
    return Math.max(resourceMinimumFromFormula(record) ?? 0, valueFromAbility);
  }
  if (kind === 'custom') {
    const formula = asString(record.formula);
    if (formula && /^(PB|proficiency bonus)$/i.test(formula.trim())) return getProficiencyBonus(character);
    const ability = abilityFromResourceFormula(record);
    if (ability && formula && /\bmod(?:ifier)?\b/i.test(formula)) {
      return Math.max(resourceMinimumFromFormula(record) ?? 0, getAbilityModifier(character.abilities, ability));
    }
  }

  return undefined;
};

const resourcePoolFromPayload = (payload: Record<string, unknown>, item: StoredCompendiumItem, character: Character): ResourcePool | undefined => {
  const record = asRecord(payload.resource ?? payload.resourcePool ?? payload.uses);
  if (!Object.keys(record).length) return undefined;
  const max = scaledResourceMaximum(record.max, payload, character)
    ?? asNumber(record.maximum)
    ?? asNumber(record.uses)
    ?? asNumber(record.maxUses);
  if (max === undefined) return undefined;
  return {
    id: asString(record.id) ?? createId('resource'),
    name: asString(record.name) ?? asString(record.label) ?? item.name,
    max: Math.max(0, max),
    current: Math.max(0, asNumber(record.current) ?? max),
    recharge: asResourceRecharge(record.recharge) ?? asResourceRecharge(record.refresh) ?? 'longRest',
    notes: asString(record.notes),
    source: item.rawJson.source
  };
};

const addResourceIfMissing = (character: Character, resource?: ResourcePool): Character => {
  if (!resource) return character;
  if (character.resources.some((candidate) => candidate.id === resource.id)) return character;
  return { ...character, resources: [...character.resources, resource] };
};

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string, item: StoredCompendiumItem): RuleValidationIssue => ({
  severity,
  code,
  message,
  source: item.rawJson.source
});

const characterChoiceMetadata = (item: StoredCompendiumItem): Record<string, unknown> =>
  asRecord(item.normalizedJson.__characterChoice);

const makeLink = (
  character: Character,
  item: StoredCompendiumItem,
  mapped: MappedEntityResult,
  status: CharacterCompendiumLink['status'] = mapped.issues.some((entry) => entry.severity === 'warning') ? 'needsReview' : 'active'
): CharacterCompendiumLink => {
  const metadata = characterChoiceMetadata(item);
  const origin = asString(metadata.origin);
  const manualReviewRequired = asBoolean(metadata.manualReviewRequired) ?? false;
  return {
    id: createId('cmpLink'),
    characterId: character.id,
    itemId: item.id,
    importItemId: item.importItemId,
    packId: item.packId,
    sourceId: item.sourceId,
    itemType: item.type as CompendiumAppliedEntityType,
    appliedAs: mapped.entityType,
    appliedEntityId: mapped.entityId,
    appliedEntityName: mapped.entityName,
    status,
    addedAt: new Date().toISOString(),
    notes: mapped.issues.length ? mapped.issues.map((entry) => `${entry.code}: ${entry.message}`).join('\n') : manualReviewRequired ? 'Revisão editorial preservada pelo catálogo.' : undefined,
    origin: origin === 'catalog' || origin === 'compendium' ? origin : undefined,
    choiceId: asString(metadata.choiceId) ?? item.id,
    catalogEntityId: asString(metadata.catalogEntityId),
    catalogSnapshotId: asString(metadata.catalogSnapshotId),
    manualReviewRequired
  };
};

const hasExistingActiveLink = (character: Character, item: StoredCompendiumItem): boolean => {
  const metadata = characterChoiceMetadata(item);
  const catalogEntityId = asString(metadata.catalogEntityId);
  const choiceId = asString(metadata.choiceId) ?? item.id;
  return (character.compendiumLinks ?? []).some((link) =>
    link.status === 'active' && (
      link.itemId === item.id ||
      link.choiceId === choiceId ||
      Boolean(catalogEntityId && link.catalogEntityId === catalogEntityId)
    )
  );
};

export interface BuildWeaponFromCompendiumItemResult {
  weapon: Weapon;
  issues: RuleValidationIssue[];
}

export const buildWeaponFromCompendiumItem = (
  character: Character,
  item: StoredCompendiumItem,
  entityId = createId('weapon')
): BuildWeaponFromCompendiumItemResult => {
  const payload = item.normalizedJson;
  const issues: RuleValidationIssue[] = [];
  const formula = formulaTextFromPayload(payload);

  if (!formula) {
    issues.push(issue('error', 'WEAPON_DAMAGE_FORMULA_REQUIRED', `Arma importada "${item.name}" não possui damageFormula, damage ou formula no payload.`, item));
  }

  const structuredAttackAbility = resolveAbilityReference(payload.attackAbility, character);
  const structuredDamageAbility = resolveAbilityReference(payload.damageAbility, character);
  const flexibleAbility = [payload.attackAbility, payload.damageAbility, payload.ability]
    .some((value) => {
      const text = asString(value)?.toUpperCase();
      if (text === 'STR_OR_DEX') return true;
      const options = asStringArray(asRecord(value).options)?.map((entry) => entry.toUpperCase()) ?? [];
      return options.includes('STR') && options.includes('DEX');
    }) || Boolean(formula?.includes('STR_OR_DEX'));
  const preferredFlexibleAbility: AbilityScore = character.abilities.DEX > character.abilities.STR ? 'DEX' : 'STR';
  const attackAbility = structuredAttackAbility ?? resolveAbilityReference(payload.ability, character) ?? (flexibleAbility ? preferredFlexibleAbility : undefined);
  const damageAbility = structuredDamageAbility ?? attackAbility;
  const resolvedFormula = formula?.replace(/STR_OR_DEX/g, preferredFlexibleAbility);
  const magicBonus = asNumber(payload.magicBonus) ?? asNumber(payload.bonus) ?? 0;
  const weaponType = asString(payload.weaponType);
  const range = asRecord(payload.range);
  const properties = asStringArray(payload.properties) ?? [];
  const validWeaponType = weaponType === 'melee' || weaponType === 'ranged' || weaponType === 'thrown' || weaponType === 'finesse' || weaponType === 'manual' ? weaponType : 'manual';

  return {
    weapon: {
      id: entityId,
      name: item.name,
      weaponType: validWeaponType,
      damage: buildDamageFormulaFromPayload({ ...payload, damageFormula: resolvedFormula ?? formula }, { defaultSourceType: 'weapon', fallbackRaw: resolvedFormula ?? formula ?? '0' }),
      attackAbility,
      damageAbility,
      magicBonus,
      actionCost: asActionCost(payload.actionCost),
      attacksCount: asNumber(payload.attacksCount),
      consumes: parseResourceCostsFromPayload(payload),
      mastery: asString(payload.mastery),
      properties,
      quantity: Math.max(1, asNumber(payload.quantity) ?? 1),
      equipped: false,
      handsRequired: properties.some((property) => property.toLowerCase() === 'two-handed') ? 2 : 1,
      range: asNumber(range.normal) ? { normal: asNumber(range.normal)!, long: asNumber(range.long), unit: 'ft' } : undefined,
      ammunitionType: asString(payload.ammunitionType),
      ammunitionPerAttack: asString(payload.ammunitionType) ? 1 : undefined,
      recoverableAmmunition: properties.some((property) => property.toLowerCase() === 'thrown'),
      damageType: asSimpleDamageType(payload.damageType),
      versatileDamage: asString(payload.versatileDamageFormula)
        ? buildDamageFormulaFromPayload({ ...payload, damageFormula: asString(payload.versatileDamageFormula) }, { defaultSourceType: 'weapon', fallbackRaw: asString(payload.versatileDamageFormula) ?? '0' })
        : undefined,
      source: item.rawJson.source
    },
    issues
  };
};

const mapWeapon = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const { weapon, issues } = buildWeaponFromCompendiumItem(character, item);
  return {
    entityType: 'weapon',
    entityId: weapon.id,
    entityName: weapon.name,
    character: {
      ...character,
      weapons: [...character.weapons, { ...weapon, equipped: character.buildChoices?.activeLoadout?.explicit === true ? character.weapons.length === 0 : true }],
      buildChoices: character.weapons.length === 0 ? {
        ...(character.buildChoices ?? { speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [] }),
        activeLoadout: { ...(character.buildChoices?.activeLoadout ?? { armorAccessoryIds: [] }), mainHandWeaponId: weapon.id }
      } : character.buildChoices
    },
    issues
  };
};

const mapSpell = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const payload = item.normalizedJson;
  const issues: RuleValidationIssue[] = [];
  const entityId = createId('spell');
  const formula = formulaTextFromPayload(payload);
  const targeting = asRecord(payload.targeting);
  const rawTargets = payload.targets ?? targeting.targets;
  const targetRecord = asRecord(rawTargets);
  const targets = asNumber(rawTargets) ?? asNumber(targetRecord.count) ?? asNumber(targetRecord.max) ?? 1;
  const targetDescription = asString(targetRecord.description) ?? asString(targeting.description);
  const area = normalizeTacticalAreaTemplate(payload.area ?? targeting.area ?? targeting.areaOfEffect, targetDescription);

  if (!formula) {
    issues.push(issue('warning', 'SPELL_WITHOUT_DAMAGE_FORMULA', `Magia importada "${item.name}" não possui fórmula de dano. Ela será adicionada, mas não entrará nos cálculos ofensivos até ser editada.`, item));
  }

  const spell: Spell = {
    id: entityId,
    name: item.name,
    level: asNumber(payload.level) ?? 0,
    school: asString(payload.school),
    castingTime: asActionCost(payload.castingTime) ?? asActionCost(payload.actionCost) ?? 'action',
    range: asString(payload.range),
    components: spellComponentsFromPayload(payload.components),
    duration: asString(payload.duration),
    description: asString(payload.description) ?? item.summary,
    upcastingDescription: asString(payload.upcastingDescription) ?? asString(payload.higherLevels),
    requiresAttackRoll: asBoolean(payload.requiresAttackRoll) ?? asBoolean(payload.attackRoll) ?? Boolean(formula),
    saveAbility: asAbility(payload.saveAbility),
    damage: formula ? buildDamageFormulaFromPayload(payload, { defaultSourceType: 'spell', fallbackRaw: formula }) : undefined,
    damageType: asSimpleDamageType(payload.damageType),
    targeting: { targets: Math.max(1, targets), area: describeTacticalAreaTemplate(area), areaTemplate: area, description: targetDescription },
    damageOnSaveSuccess: asString(payload.damageOnSaveSuccess),
    concentration: asBoolean(payload.concentration) ?? asBoolean(payload.requiresConcentration),
    consumes: parseResourceCostsFromPayload(payload),
    scaling: parseSpellScalingFromPayload(payload),
    effectTemplates: parseEffectTemplatesFromPayload(payload, {
      idPrefix: `spell_effect_${entityId}`,
      name: item.name,
      kind: 'spell',
      sourceType: 'spell',
      source: item.rawJson.source,
      sourceRef: { kind: 'compendiumLink', entityType: 'spell', itemId: item.id }
    }),
    source: item.rawJson.source
  };

  return {
    entityType: 'spell',
    entityId,
    entityName: spell.name,
    character: { ...character, spells: [...character.spells, spell] },
    issues
  };
};

const mapFeature = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const payload = item.normalizedJson;
  const entityId = createId('feature');
  const resource = resourcePoolFromPayload(payload, item, character);
  const feature: Feature = {
    id: entityId,
    name: item.name,
    sourceType: asDamageSourceType(payload.sourceType) ?? 'classFeature',
    source: item.rawJson.source,
    summary: item.summary ?? asString(payload.summary) ?? asString(payload.description),
    actionCost: asActionCost(payload.actionCost),
    resource,
    requiresConcentration: asBoolean(payload.requiresConcentration),
    oncePerTurnKey: asString(payload.oncePerTurnKey),
    attackActionAttackCount: asNumber(payload.attackActionAttackCount) ?? asNumber(payload.attacksCountOverride),
    effectTemplates: parseEffectTemplatesFromPayload(payload, {
      idPrefix: `feature_effect_${entityId}`,
      name: item.name,
      kind: 'feature',
      sourceType: asDamageSourceType(payload.sourceType) ?? 'classFeature',
      source: item.rawJson.source,
      sourceRef: { kind: 'compendiumLink', entityType: 'feature', itemId: item.id }
    }),
    requiresReview: item.status !== 'validated',
    grantsActions: parseGrantedActionsFromPayload(item, entityId)
  };

  const withResource = addResourceIfMissing(character, resource);

  return {
    entityType: 'feature',
    entityId,
    entityName: feature.name,
    character: { ...withResource, features: [...withResource.features, feature] },
    issues: []
  };
};

const mapClass = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const payload = item.normalizedJson;
  const entityId = createId('class');
  const level = Math.max(1, asNumber(payload.level) ?? 1);
  const cls: CharacterClass = { id: entityId, name: item.name, level, hitDie: asNumber(payload.hitDie), source: item.rawJson.source };
  const classes = [...character.classes, cls];
  const totalLevel = classes.reduce((sum, entry) => sum + entry.level, 0);
  return { entityType: 'class', entityId, entityName: cls.name, character: { ...character, classes, level: totalLevel }, issues: [] };
};

const mapSubclass = (
  character: Character,
  item: StoredCompendiumItem
): MappedEntityResult => {
  const payload = item.normalizedJson;
  const entityId = createId('subclass');

  const importedClassReference =
    asString(payload.classId) ??
    asString(payload.classRef) ??
    asString(payload.baseClassId);

  const matchingClassLink =
    (character.compendiumLinks ?? []).find(
      (link) =>
        link.appliedAs === 'class' &&
        link.status === 'active' &&
        (
          link.itemId === importedClassReference ||
          link.importItemId === importedClassReference
        )
    );

  const resolvedClassId =
    matchingClassLink?.appliedEntityId ??
    (
      character.classes.length === 1
        ? character.classes[0]?.id
        : undefined
    ) ??
    importedClassReference ??
    asString(payload.className) ??
    'manual-class';

  const subclass: Subclass = {
    id: entityId,
    classId: resolvedClassId,
    name: item.name,
    source: item.rawJson.source
  };

  return {
    entityType: 'subclass',
    entityId,
    entityName: subclass.name,
    character: {
      ...character,
      subclasses: [
        ...character.subclasses,
        subclass
      ]
    },
    issues: []
  };
};

const mapSpecies = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const entityId = createId('species');
  const species: Species = { id: entityId, name: item.name, source: item.rawJson.source, features: [] };
  // 2024 character creation moves origin ability increases to the background.
  // Legacy species payloads can retain abilityScoreIncrease/abilityScoreIncreaseRule for provenance,
  // but those fields are intentionally never mapped into character abilities or abilityScoreBonuses.
  return { entityType: 'species', entityId, entityName: species.name, character: { ...character, species }, issues: [] };
};

const mapBackground = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const entityId = createId('background');
  const background: Background = { id: entityId, name: item.name, source: item.rawJson.source, features: [] };
  return { entityType: 'background', entityId, entityName: background.name, character: { ...character, background }, issues: [] };
};

const mapFeat = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const entityId = createId('feat');
  const feat: Feat = { id: entityId, name: item.name, source: item.rawJson.source, features: [] };
  return { entityType: 'feat', entityId, entityName: feat.name, character: { ...character, feats: [...character.feats, feat] }, issues: [] };
};

const mapArmor = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const payload = item.normalizedJson;
  const issues: RuleValidationIssue[] = [];
  const entityId = createId('armor');
  const baseAC = asNumber(payload.baseAC) ?? asNumber(payload.ac);
  const acBonus = asNumber(payload.acBonus) ?? asNumber(payload.bonusAC);
  const stacksWithArmor = asBoolean(payload.stacksWithArmor) ?? Boolean(acBonus);
  const armorCategory = asString(payload.armorCategory) ?? asString(payload.category);
  if (baseAC === undefined && !stacksWithArmor) {
    issues.push(issue('warning', 'ARMOR_BASE_AC_MISSING', `Armadura importada "${item.name}" não possui baseAC/ac. Usando 10 até revisão.`, item));
  }
  const armor: Armor = {
    id: entityId,
    name: item.name,
    baseAC: baseAC ?? 0,
    dexCap: asNumber(payload.dexCap),
    armorCategory,
    acBonus,
    stacksWithArmor,
    equipped: true,
    source: item.rawJson.source
  };
  return {
    entityType: 'armor',
    entityId,
    entityName: armor.name,
    character: stacksWithArmor
      ? {
          ...character,
          armorAccessories: [...(character.armorAccessories ?? []), { ...armor, equipped: false }]
        }
      : {
          ...character,
          armors: [...(character.armors ?? (character.armor ? [character.armor] : [])), { ...armor, baseAC: baseAC ?? 10, equipped: !character.armor }],
          armor: character.armor ?? { ...armor, baseAC: baseAC ?? 10, equipped: true },
          buildChoices: !character.armor ? {
            ...(character.buildChoices ?? { speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [] }),
            activeLoadout: { ...(character.buildChoices?.activeLoadout ?? { armorAccessoryIds: [] }), armorId: armor.id }
          } : character.buildChoices
        },
    issues
  };
};

const mapEquipment = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const payload = item.normalizedJson;
  const entityId = createId('equipment');
  const focus = focusMetadataFromLabel([item.name, ...item.tags, ...(asStringArray(payload.tags) ?? [])].join(' '));
  const equipment: Equipment = {
    id: entityId,
    name: item.name,
    quantity: asNumber(payload.quantity) ?? 1,
    tags: [...item.tags, ...(asStringArray(payload.tags) ?? [])],
    ammunitionType: asString(payload.ammunitionType),
    spellcastingFocus: asBoolean(payload.spellcastingFocus) ?? focus.spellcastingFocus,
    spellcastingFocusKind: asString(payload.spellcastingFocusKind) as Equipment['spellcastingFocusKind'] ?? focus.spellcastingFocusKind,
    focusRequiresHand: asBoolean(payload.focusRequiresHand) ?? focus.focusRequiresHand,
    materialComponent: asBoolean(payload.materialComponent) ?? focus.materialComponent,
    source: item.rawJson.source
  };
  return { entityType: 'equipment', entityId, entityName: equipment.name, character: { ...character, equipment: [...character.equipment, equipment] }, issues: [] };
};

const mapMagicItem = (character: Character, item: StoredCompendiumItem): MappedEntityResult => {
  const payload = item.normalizedJson;
  const entityId = createId('magicItem');
  const magicItem: MagicItem = {
    id: entityId,
    name: item.name,
    quantity: asNumber(payload.quantity) ?? 1,
    attunement: asBoolean(payload.attunement),
    source: item.rawJson.source,
    features: [],
    effectTemplates: parseEffectTemplatesFromPayload(payload, {
      idPrefix: `item_effect_${entityId}`,
      name: item.name,
      kind: 'item',
      sourceType: 'magicItem',
      source: item.rawJson.source,
      sourceRef: { kind: 'compendiumLink', entityType: 'magicItem', itemId: item.id }
    })
  };
  return { entityType: 'magicItem', entityId, entityName: magicItem.name, character: { ...character, magicItems: [...character.magicItems, magicItem] }, issues: [] };
};

export const canApplyCompendiumItemToCharacter = (item: StoredCompendiumItem): boolean =>
  ['class', 'subclass', 'species', 'background', 'feat', 'weapon', 'armor', 'equipment', 'magicItem', 'spell', 'feature'].includes(item.type);

export const applyCompendiumItemToCharacter = (character: Character, item: StoredCompendiumItem): ApplyCompendiumItemResult => {
  if (item.status !== 'validated') {
    return {
      ok: false,
      character,
      issues: [issue('error', 'COMPENDIUM_ITEM_NOT_VALIDATED', `Item "${item.name}" está como ${item.status}. Valide-o antes de aplicar à ficha.`, item)]
    };
  }

  if (!canApplyCompendiumItemToCharacter(item)) {
    return {
      ok: false,
      character,
      issues: [issue('error', 'COMPENDIUM_ITEM_TYPE_UNSUPPORTED', `Tipo "${item.type}" ainda não pode ser aplicado à ficha.`, item)]
    };
  }

  const repeatableChoice = asRecord(item.normalizedJson).repeatable === true && (
    item.type === 'feat' ||
    (item.type === 'feature' && asString(asRecord(item.normalizedJson).sourceType)?.toLowerCase() === 'eldritchinvocation')
  );
  if (hasExistingActiveLink(character, item) && !repeatableChoice) {
    return {
      ok: false,
      character,
      issues: [issue('warning', 'COMPENDIUM_ITEM_ALREADY_LINKED', `Item "${item.name}" já está vinculado a esta ficha.`, item)]
    };
  }

  let mapped: MappedEntityResult;
  switch (item.type) {
    case 'class':
      mapped = mapClass(character, item);
      break;
    case 'subclass':
      mapped = mapSubclass(character, item);
      break;
    case 'species':
      mapped = mapSpecies(character, item);
      break;
    case 'background':
      mapped = mapBackground(character, item);
      break;
    case 'feat':
      mapped = mapFeat(character, item);
      break;
    case 'weapon':
      mapped = mapWeapon(character, item);
      break;
    case 'armor':
      mapped = mapArmor(character, item);
      break;
    case 'equipment':
      mapped = mapEquipment(character, item);
      break;
    case 'magicItem':
      mapped = mapMagicItem(character, item);
      break;
    case 'spell':
      mapped = mapSpell(character, item);
      break;
    case 'feature':
      mapped = mapFeature(character, item);
      break;
    default:
      return {
        ok: false,
        character,
        issues: [issue('error', 'COMPENDIUM_ITEM_TYPE_UNSUPPORTED', `Tipo "${item.type}" ainda não pode ser aplicado à ficha.`, item)]
      };
  }
  const hasErrors = mapped.issues.some((entry) => entry.severity === 'error');
  if (hasErrors) {
    return { ok: false, character, issues: mapped.issues };
  }

  const link = makeLink(character, item, mapped);
  const singletonTypes: CompendiumAppliedEntityType[] = ['species', 'background', 'armor'];
  const stackedArmor = item.type === 'armor' && (
    asBoolean(asRecord(item.normalizedJson).stacksWithArmor) === true ||
    asNumber(asRecord(item.normalizedJson).acBonus) !== undefined
  );
  const armorAccessoryEntityIds = new Set((mapped.character.armorAccessories ?? []).map((entry) => entry.id));
  const existingLinks = (mapped.character.compendiumLinks ?? []).map((existingLink) =>
    singletonTypes.includes(mapped.entityType) &&
    !(mapped.entityType === 'armor' && stackedArmor) &&
    !(mapped.entityType === 'armor' && armorAccessoryEntityIds.has(existingLink.appliedEntityId)) &&
    existingLink.appliedAs === mapped.entityType &&
    existingLink.status === 'active'
      ? { ...existingLink, status: 'removed' as const }
      : existingLink
  );
  const catalogSnapshotId = asString(characterChoiceMetadata(item).catalogSnapshotId);
  const characterWithLink: Character = {
    ...mapped.character,
    catalogSnapshotId: catalogSnapshotId ?? mapped.character.catalogSnapshotId,
    compendiumLinks: [...existingLinks, link]
  };
  const editorialIssues = asBoolean(characterChoiceMetadata(item).manualReviewRequired) === true
    ? [issue('warning', 'CATALOG_EDITORIAL_REVIEW_REQUIRED', `Item oficial "${item.name}" mantém sinalização de revisão editorial.`, item)]
    : [];
  return { ok: true, character: characterWithLink, link, issues: [...mapped.issues, ...editorialIssues] };
};

export const describeCompendiumPayloadHints = (item: StoredCompendiumItem): string => {
  if (item.type === 'weapon') return 'weapon: damageFormula, attackAbility, damageAbility, magicBonus, weaponType, mastery, properties';
  if (item.type === 'spell') return 'spell: damageFormula, level, castingTime/actionCost, requiresAttackRoll, saveAbility, targets, concentration';
  if (item.type === 'feature') return 'feature: summary, sourceType, actionCost, requiresConcentration, oncePerTurnKey';
  if (item.type === 'armor') return 'armor: baseAC/ac, dexCap';
  if (item.type === 'creatureStatBlock') {
    return 'creatureStatBlock: size, creatureType, armorClass, hitPoints, speed, challenge, actions, traits e engineKey';
  }
  if (item.type === 'class') return 'class: level, hitDie';
  return `${item.type}: name, summary, source e payload livre preservado em rawJson/normalizedJson`;
};
