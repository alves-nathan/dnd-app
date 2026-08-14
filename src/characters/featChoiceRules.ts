import type {
  AbilityScore,
  AbilityScores,
  Character,
  CharacterFeatChoice,
  CharacterWeaponMastery,
  ResourcePool,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { ABILITY_ORDER, abilityScoresFromValues } from './abilityGeneration';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createId } from '../utils/id';
import {
  ALL_LANGUAGE_OPTIONS,
  ALL_TOOL_OPTIONS,
  getToolOptionsForDescriptor
} from './choiceOptions';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const abilitySet = new Set<string>(ABILITY_ORDER);
const asAbilities = (value: unknown): AbilityScore[] =>
  asStringArray(value)
    .map((entry) => entry.toUpperCase())
    .filter((entry): entry is AbilityScore => abilitySet.has(entry));

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

export type FeatChoiceKind =
  | 'abilityScoreIncrease'
  | 'abilityScoreImprovement'
  | 'skillProficiency'
  | 'skillUpgrade'
  | 'expertise'
  | 'toolProficiency'
  | 'languageProficiency'
  | 'magicInitiate'
  | 'spellChoice'
  | 'damageType'
  | 'weaponMastery';

export interface FeatChoiceSchema {
  kinds: FeatChoiceKind[];
  abilityOptions: AbilityScore[];
  abilityIncreaseAmount: number;
  abilityMaximum: number;
  asiMode?: 'plusTwoOrTwoPlusOne';
  skillChoiceCount: number;
  skillUpgradeOptions: string[];
  expertiseChoiceCount: number;
  toolChoiceCount: number;
  toolOptions: string[];
  mixedSkillToolChoiceCount: number;
  languageChoiceCount: number;
  languageOptions: string[];
  spellListOptions: string[];
  allowCombinedSpellLists: boolean;
  spellcastingAbilityOptions: AbilityScore[];
  fixedSpellcastingAbility?: AbilityScore;
  cantripChoiceCount: number;
  level1SpellChoiceCount: number;
  genericSpellChoiceCount: number;
  genericSpellMaximumLevel?: number;
  genericSpellSourceLists: string[];
  genericSpellReferences: string[];
  spellChoiceSchools: string[];
  alwaysPreparedSpellReferences: string[];
  damageTypeOptions: string[];
  weaponMasteryChoiceCount: number;
  weaponMasteryRequirement?: string;
  weaponMasteryChangeOnLongRest: boolean;
  unsupportedChoiceTypes: string[];
}

export const getFeatChoiceSchema = (item: StoredCompendiumItem): FeatChoiceSchema => {
  const payload = asRecord(item.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const kinds: FeatChoiceKind[] = [];
  const abilityIncreases = Array.isArray(payload.abilityScoreIncrease)
    ? payload.abilityScoreIncrease.map(asRecord)
    : [];
  const firstAbilityIncrease = abilityIncreases[0] ?? {};
  let abilityOptions = asAbilities(firstAbilityIncrease.abilities);
  let abilityIncreaseAmount = asNumber(firstAbilityIncrease.amount) ?? 0;
  let abilityMaximum = asNumber(firstAbilityIncrease.max) ?? 20;
  let asiMode: FeatChoiceSchema['asiMode'];

  const normalizedName = normalize(item.name);
  if (normalizedName === 'ability score improvement' || Array.isArray(mechanics.abilityScoreOptions)) {
    kinds.push('abilityScoreImprovement');
    abilityOptions = [...ABILITY_ORDER];
    abilityIncreaseAmount = 2;
    abilityMaximum = 20;
    asiMode = 'plusTwoOrTwoPlusOne';
  } else if (abilityOptions.length && abilityIncreaseAmount > 0) {
    kinds.push('abilityScoreIncrease');
  }

  let skillChoiceCount = 0;
  let expertiseChoiceCount = 0;
  let toolChoiceCount = 0;
  let toolOptions: string[] = [];
  let mixedSkillToolChoiceCount = 0;
  let languageChoiceCount = 0;
  let languageOptions: string[] = [];

  const proficiencyChoice = asRecord(mechanics.proficiencyChoice);
  if (Object.keys(proficiencyChoice).length) {
    const count = Math.max(0, asNumber(proficiencyChoice.count) ?? 0);
    const options = asStringArray(proficiencyChoice.options).map(normalize);
    if (options.includes('skills') && options.includes('tools')) mixedSkillToolChoiceCount += count;
    else {
      if (options.includes('skills')) skillChoiceCount += count;
      if (options.includes('tools')) toolChoiceCount += count;
    }
  }

  const toolChoice = asRecord(mechanics.toolProficiencyChoice);
  if (Object.keys(toolChoice).length) {
    toolChoiceCount += Math.max(0, asNumber(toolChoice.count) ?? 0);
    toolOptions = getToolOptionsForDescriptor(toolChoice.options);
  }
  if (typeof mechanics.skillProficiencyChoice === 'number') skillChoiceCount += Math.max(0, Math.floor(mechanics.skillProficiencyChoice));
  if (mechanics.expertiseChoice) expertiseChoiceCount += 1;

  const skillUpgradeOptions = asStringArray(mechanics.skillUpgradeChoice);
  if (skillChoiceCount || mixedSkillToolChoiceCount) kinds.push('skillProficiency');
  if (skillUpgradeOptions.length) kinds.push('skillUpgrade');
  if (expertiseChoiceCount) kinds.push('expertise');
  if (toolChoiceCount || mixedSkillToolChoiceCount) kinds.push('toolProficiency');
  if (mixedSkillToolChoiceCount > 0 && !toolOptions.length) toolOptions = [...ALL_TOOL_OPTIONS];

  const languageChoiceRaw = mechanics.languageProficiencyChoice ?? mechanics.languageChoice ?? mechanics.languageChoices;
  if (typeof languageChoiceRaw === 'number') {
    languageChoiceCount = Math.max(0, Math.floor(languageChoiceRaw));
    languageOptions = [...ALL_LANGUAGE_OPTIONS];
  } else {
    const languageChoice = asRecord(languageChoiceRaw);
    if (Object.keys(languageChoice).length) {
      languageChoiceCount = Math.max(0, asNumber(languageChoice.count) ?? 0);
      const explicitOptions = asStringArray(languageChoice.options);
      languageOptions = explicitOptions.length ? explicitOptions : [...ALL_LANGUAGE_OPTIONS];
    }
  }
  if (languageChoiceCount > 0) kinds.push('languageProficiency');

  const structuredSpellChoices = Array.isArray(mechanics.spellChoices) ? mechanics.spellChoices.map(asRecord) : [];
  const spellListOptions = unique([
    ...asStringArray(mechanics.spellListChoice),
    ...structuredSpellChoices.flatMap((entry) => {
      const sourceList = asString(entry.sourceList);
      return sourceList ? [sourceList] : [];
    })
  ]);
  const allowCombinedSpellLists =
    asBoolean(mechanics.allowCombinedSpellLists) ??
    (normalizedName === 'magic initiate' && spellListOptions.length > 1);
  const structuredSpellChoice = asRecord(mechanics.spellChoice);
  const fixedSpellcastingAbilityRaw = asString(mechanics.spellcastingAbility)?.toUpperCase();
  const fixedSpellcastingAbility = fixedSpellcastingAbilityRaw && abilitySet.has(fixedSpellcastingAbilityRaw)
    ? fixedSpellcastingAbilityRaw as AbilityScore
    : undefined;
  const spellcastingAbilityOptions = unique([
    ...asAbilities(mechanics.spellcastingAbilityChoice),
    ...asAbilities(structuredSpellChoice.spellcastingAbilityChoice)
  ]);
  const pluralCantripCount = structuredSpellChoices
    .filter((entry) => asNumber(entry.spellLevel) === 0)
    .reduce((sum, entry) => sum + Math.max(0, Math.floor(asNumber(entry.count) ?? 0)), 0);
  const pluralLevel1Count = structuredSpellChoices
    .filter((entry) => asNumber(entry.spellLevel) === 1)
    .reduce((sum, entry) => sum + Math.max(0, Math.floor(asNumber(entry.count) ?? 0)), 0);
  const cantripChoiceCount = Math.max(0, asNumber(mechanics.cantripChoices) ?? 0) + pluralCantripCount;
  const level1SpellChoiceCount = Math.max(0, asNumber(mechanics.level1SpellChoices) ?? asNumber(asRecord(mechanics.level1SpellChoice).count) ?? 0) + pluralLevel1Count;
  const genericSpellChoiceCount = Math.max(0, Math.floor(asNumber(structuredSpellChoice.count) ?? 0));
  const genericEligible = Array.isArray(structuredSpellChoice.eligible) ? structuredSpellChoice.eligible.map(asRecord) : [];
  const genericSpellMaximumLevel = genericEligible.reduce<number | undefined>((maximum, entry) => {
    const value = asNumber(entry.maximumSpellLevel);
    return value === undefined ? maximum : maximum === undefined ? value : Math.max(maximum, value);
  }, undefined);
  const genericSpellSourceLists = unique(genericEligible.flatMap((entry) => {
    const direct = asString(entry.sourceList);
    return direct ? [direct] : asStringArray(entry.sourceLists);
  }));
  const genericSpellReferences = unique(genericEligible.flatMap((entry) => asStringArray(entry.spellIds)));
  const spellChoiceSchools = asStringArray(asRecord(mechanics.level1SpellChoice).schools);
  const alwaysPreparedSpellReferences = unique([
    ...asStringArray(mechanics.alwaysPrepared),
    ...(structuredSpellChoice.alwaysPrepared === true ? [] : asStringArray(structuredSpellChoice.alwaysPrepared))
  ]);
  if (spellListOptions.length || cantripChoiceCount || level1SpellChoiceCount) kinds.push('magicInitiate');
  if (genericSpellChoiceCount || spellChoiceSchools.length || alwaysPreparedSpellReferences.length) kinds.push('spellChoice');

  const damageTypeOptions = asStringArray(
    asRecord(mechanics.damageTypeChoice).options ?? mechanics.damageTypeChoice ?? asRecord(mechanics.energyResistanceChoice).damageTypes
  );
  if (damageTypeOptions.length) kinds.push('damageType');

  const masteryChoice = asRecord(mechanics.masteryPropertyChoice);
  const weaponMasteryChoiceCount = Math.max(0, asNumber(masteryChoice.count) ?? 0);
  const weaponMasteryRequirement = asString(masteryChoice.weaponRequirement);
  const weaponMasteryChangeOnLongRest = asBoolean(masteryChoice.changeOnLongRest) ?? false;
  if (weaponMasteryChoiceCount > 0) kinds.push('weaponMastery');

  const unsupportedChoiceTypes = [
    Object.keys(asRecord(mechanics.invocationChoice)).length ? 'Eldritch Invocation' : undefined,
    Object.keys(asRecord(mechanics.fightingStyleChoice)).length ? 'Fighting Style' : undefined,
    Object.keys(asRecord(mechanics.metamagicChoice)).length ? 'Metamagic' : undefined,
    Object.keys(asRecord(mechanics.maneuverChoice)).length ? 'Battle Master Maneuver' : undefined
  ].filter((entry): entry is string => Boolean(entry));

  return {
    kinds: unique(kinds),
    abilityOptions,
    abilityIncreaseAmount,
    abilityMaximum,
    asiMode,
    skillChoiceCount,
    skillUpgradeOptions,
    expertiseChoiceCount,
    toolChoiceCount,
    toolOptions: toolOptions.length ? toolOptions : [...ALL_TOOL_OPTIONS],
    mixedSkillToolChoiceCount,
    languageChoiceCount,
    languageOptions,
    spellListOptions,
    allowCombinedSpellLists,
    spellcastingAbilityOptions,
    fixedSpellcastingAbility,
    cantripChoiceCount,
    level1SpellChoiceCount,
    genericSpellChoiceCount,
    genericSpellMaximumLevel,
    genericSpellSourceLists,
    genericSpellReferences,
    spellChoiceSchools,
    alwaysPreparedSpellReferences,
    damageTypeOptions,
    weaponMasteryChoiceCount,
    weaponMasteryRequirement,
    weaponMasteryChangeOnLongRest,
    unsupportedChoiceTypes
  };
};

export const featChoiceKey = (featItemId: string, instanceIndex: number): string => `${featItemId}::${instanceIndex}`;

export const emptyFeatChoice = (
  featItemId: string,
  featEntityId = '',
  instanceIndex = 0
): CharacterFeatChoice => ({
  id: createId('featChoice'),
  featEntityId,
  featItemId,
  instanceIndex,
  skills: [],
  expertiseSkills: [],
  tools: [],
  languages: [],
  spellItemIds: [],
  weaponItemIds: [],
  weaponMasterySelections: [],
  abilityScoreIncreases: {}
});

const issue = (code: string, message: string): RuleValidationIssue => ({ severity: 'error', code, message });

const findByReference = (items: StoredCompendiumItem[], reference: string): StoredCompendiumItem | undefined =>
  items.find((item) => item.id === reference || item.importItemId === reference || asString(asRecord(item.rawJson).id) === reference);

export const isSpellItemEligibleForGenericFeatChoice = (
  spellItem: StoredCompendiumItem,
  schema: FeatChoiceSchema
): boolean => {
  if (spellItem.type !== 'spell' || schema.genericSpellChoiceCount <= 0) return false;
  const rawId = asString(asRecord(spellItem.rawJson).id);
  const explicit = schema.genericSpellReferences.some((reference) =>
    reference === spellItem.id || reference === spellItem.importItemId || reference === rawId
  );
  const sourceLists = schema.genericSpellSourceLists.map(normalize);
  const classes = asStringArray(asRecord(spellItem.normalizedJson).classes).map(normalize);
  const level = Math.max(0, asNumber(asRecord(spellItem.normalizedJson).level) ?? 0);
  const onSourceList = sourceLists.length > 0 && classes.some((className) => sourceLists.includes(className));
  const levelAllowed = schema.genericSpellMaximumLevel === undefined || level <= schema.genericSpellMaximumLevel;
  return explicit || (onSourceList && levelAllowed);
};

export const isWeaponItemEligibleForMasteryWithProficiencies = (
  weaponProficiencies: string[],
  weaponItem: StoredCompendiumItem
): boolean => {
  if (weaponItem.type !== 'weapon') return false;
  const payload = asRecord(weaponItem.normalizedJson);
  const category = normalize(asString(payload.weaponCategory) ?? '');
  const properties = asStringArray(payload.properties).map(normalize);
  const proficiencies = weaponProficiencies.map(normalize);
  const explicit = proficiencies.includes(normalize(weaponItem.name));
  const categoryMatch = Boolean(category && proficiencies.includes(category));
  const martialSpecial = category === 'martial' && proficiencies.includes('martial finesse or light')
    && (properties.includes('finesse') || properties.includes('light'));
  return explicit || categoryMatch || martialSpecial;
};

export const isWeaponItemEligibleForMastery = (
  character: Character | undefined,
  weaponItem: StoredCompendiumItem
): boolean =>
  !character || isWeaponItemEligibleForMasteryWithProficiencies(character.proficiencies.weapons, weaponItem);

export const validateFeatChoiceUniqueness = (
  item: StoredCompendiumItem,
  choice: CharacterFeatChoice | undefined,
  previousChoices: CharacterFeatChoice[]
): RuleValidationIssue[] => {
  if (!choice) return [];
  const mechanics = asRecord(asRecord(item.normalizedJson).mechanics);
  const issues: RuleValidationIssue[] = [];
  if (
    mechanics.repeatableRequiresDifferentSpellList === true &&
    choice.spellList &&
    normalize(choice.spellList) !== 'all'
  ) {
    if (previousChoices.some((entry) => entry.spellList && normalize(entry.spellList) === normalize(choice.spellList!))) {
      issues.push(issue('FEAT_REPEATABLE_SPELL_LIST_DUPLICATE', `${item.name} exige uma lista de magias diferente em cada escolha.`));
    }
  }
  if (mechanics.repeatableRequiresDifferentDamageType === true && choice.damageType) {
    if (previousChoices.some((entry) => entry.damageType && normalize(entry.damageType) === normalize(choice.damageType!))) {
      issues.push(issue('FEAT_REPEATABLE_DAMAGE_TYPE_DUPLICATE', `${item.name} exige um tipo de dano diferente em cada escolha.`));
    }
  }
  return issues;
};

export const validateFeatChoice = (
  item: StoredCompendiumItem,
  choice: CharacterFeatChoice | undefined,
  abilities: AbilityScores,
  allItems: StoredCompendiumItem[] = [],
  character?: Character
): RuleValidationIssue[] => {
  const schema = getFeatChoiceSchema(item);
  if (schema.unsupportedChoiceTypes.length) {
    return [issue(
      'FEAT_CHOICE_EDITOR_UNAVAILABLE',
      `${item.name} exige uma escolha de ${schema.unsupportedChoiceTypes.join(' / ')} que ainda não possui editor estruturado. O feat foi bloqueado para evitar aplicar uma versão mecanicamente incompleta.`
    )];
  }
  if (!schema.kinds.length) return [];
  if (!choice) return [issue('FEAT_CHOICE_REQUIRED', `${item.name} possui escolhas internas pendentes.`)];
  const issues: RuleValidationIssue[] = [];
  const increases = choice.abilityScoreIncreases ?? {};
  const increaseEntries = Object.entries(increases).filter(([, value]) => (value ?? 0) > 0) as Array<[AbilityScore, number]>;

  if (schema.asiMode === 'plusTwoOrTwoPlusOne') {
    const values = increaseEntries.map(([, value]) => value).sort((a, b) => b - a);
    const valid = (values.length === 1 && values[0] === 2) || (values.length === 2 && values[0] === 1 && values[1] === 1);
    if (!valid) issues.push(issue('ASI_DISTRIBUTION_INVALID', 'Ability Score Improvement exige +2 em uma habilidade ou +1 em duas habilidades diferentes.'));
  } else if (schema.abilityIncreaseAmount > 0) {
    const selected = increaseEntries.filter(([ability]) => schema.abilityOptions.includes(ability));
    const total = selected.reduce((sum, [, value]) => sum + value, 0);
    if (selected.length !== 1 || total !== schema.abilityIncreaseAmount) {
      issues.push(issue('FEAT_ABILITY_CHOICE_INVALID', `${item.name} exige escolher uma habilidade válida para receber +${schema.abilityIncreaseAmount}.`));
    }
  }

  for (const [ability, amount] of increaseEntries) {
    if (abilities[ability] + amount > schema.abilityMaximum) issues.push(issue('FEAT_ABILITY_MAX_EXCEEDED', `${ability} ultrapassaria o máximo ${schema.abilityMaximum} concedido por ${item.name}.`));
  }

  if (schema.skillChoiceCount > 0 && (choice.skills ?? []).length !== schema.skillChoiceCount) issues.push(issue('FEAT_SKILL_CHOICE_COUNT', `${item.name} exige ${schema.skillChoiceCount} escolha(s) de perícia.`));
  if (schema.skillUpgradeOptions.length && (!choice.skillUpgrade || !schema.skillUpgradeOptions.map(normalize).includes(normalize(choice.skillUpgrade)))) {
    issues.push(issue('FEAT_SKILL_UPGRADE_REQUIRED', `${item.name} exige escolher uma perícia válida para obter proficiência ou Expertise.`));
  }
  if (schema.expertiseChoiceCount > 0 && (choice.expertiseSkills ?? []).length !== schema.expertiseChoiceCount) issues.push(issue('FEAT_EXPERTISE_CHOICE_COUNT', `${item.name} exige ${schema.expertiseChoiceCount} escolha(s) de Expertise.`));
  if (schema.toolChoiceCount > 0 && (choice.tools ?? []).length !== schema.toolChoiceCount) issues.push(issue('FEAT_TOOL_CHOICE_COUNT', `${item.name} exige ${schema.toolChoiceCount} escolha(s) de ferramenta.`));
  if (schema.mixedSkillToolChoiceCount > 0 && unique([...(choice.skills ?? []), ...(choice.tools ?? [])]).length !== schema.mixedSkillToolChoiceCount) issues.push(issue('FEAT_MIXED_PROFICIENCY_CHOICE_COUNT', `${item.name} exige ${schema.mixedSkillToolChoiceCount} escolha(s) no total entre perícias e ferramentas.`));
  if (schema.languageChoiceCount > 0 && unique(choice.languages ?? []).length !== schema.languageChoiceCount) issues.push(issue('FEAT_LANGUAGE_CHOICE_COUNT', `${item.name} exige ${schema.languageChoiceCount} escolha(s) de idioma.`));

  const normalizedSpellList = normalize(choice.spellList ?? '');
  const individualSpellLists = schema.spellListOptions.map(normalize);
  const combinedSpellListsSelected = schema.allowCombinedSpellLists && (!normalizedSpellList || normalizedSpellList === 'all');
  const implicitSingleSpellList = schema.spellListOptions.length === 1 && !normalizedSpellList;
  if (
    schema.spellListOptions.length &&
    !combinedSpellListsSelected &&
    !implicitSingleSpellList &&
    !individualSpellLists.includes(normalizedSpellList)
  ) {
    issues.push(issue('FEAT_SPELL_LIST_REQUIRED', `${item.name} exige escolher uma lista de magias válida.`));
  }
  if (schema.spellcastingAbilityOptions.length && (!choice.spellcastingAbility || !schema.spellcastingAbilityOptions.includes(choice.spellcastingAbility))) issues.push(issue('FEAT_SPELLCASTING_ABILITY_REQUIRED', `${item.name} exige escolher a habilidade de conjuração.`));

  const selectedSpellIds = unique(choice.spellItemIds ?? []);
  const expectedSpellCount = schema.cantripChoiceCount + schema.level1SpellChoiceCount;
  if (selectedSpellIds.length !== expectedSpellCount && expectedSpellCount > 0) {
    issues.push(issue('FEAT_SPELL_CHOICE_COUNT', `${item.name} exige ${schema.cantripChoiceCount} cantrip(s) e ${schema.level1SpellChoiceCount} magia(s) de nível 1.`));
  } else if (expectedSpellCount > 0 && allItems.length) {
    const selectedSpells = selectedSpellIds.map((id) => findByReference(allItems, id)).filter((spell): spell is StoredCompendiumItem => Boolean(spell));
    const cantrips = selectedSpells.filter((spell) => (asNumber(asRecord(spell.normalizedJson).level) ?? 0) === 0).length;
    const levelOne = selectedSpells.filter((spell) => (asNumber(asRecord(spell.normalizedJson).level) ?? 0) === 1).length;
    if (cantrips !== schema.cantripChoiceCount || levelOne !== schema.level1SpellChoiceCount) issues.push(issue('FEAT_SPELL_LEVEL_DISTRIBUTION', `${item.name} exige exatamente ${schema.cantripChoiceCount} cantrip(s) e ${schema.level1SpellChoiceCount} magia(s) de nível 1.`));

    const allowedLists = combinedSpellListsSelected
      ? individualSpellLists
      : normalizedSpellList
        ? [normalizedSpellList]
        : individualSpellLists;
    const invalidSpell = selectedSpells.find((spell) => {
      const classes = asStringArray(asRecord(spell.normalizedJson).classes).map(normalize);
      return allowedLists.length > 0 && !classes.some((className) => allowedLists.includes(className));
    });
    if (invalidSpell) {
      issues.push(issue(
        'FEAT_SPELL_LIST_MISMATCH',
        `${invalidSpell.name} não pertence às listas permitidas por ${item.name}.`
      ));
    }
  }

  if (schema.genericSpellChoiceCount > 0) {
    if (selectedSpellIds.length !== schema.genericSpellChoiceCount) {
      issues.push(issue('FEAT_GENERIC_SPELL_CHOICE_COUNT', `${item.name} exige ${schema.genericSpellChoiceCount} escolha(s) de magia.`));
    } else if (allItems.length) {
      for (const spellId of selectedSpellIds) {
        const spell = findByReference(allItems, spellId);
        if (!spell || spell.type !== 'spell') {
          issues.push(issue('FEAT_GENERIC_SPELL_REFERENCE_INVALID', `Uma magia escolhida para ${item.name} não existe no compêndio.`));
          continue;
        }
        if (!isSpellItemEligibleForGenericFeatChoice(spell, schema)) {
          issues.push(issue('FEAT_GENERIC_SPELL_NOT_ELIGIBLE', `${spell.name} não atende aos critérios de magia de ${item.name}.`));
        }
      }
    }
  }

  if (schema.damageTypeOptions.length && (!choice.damageType || !schema.damageTypeOptions.map(normalize).includes(normalize(choice.damageType)))) issues.push(issue('FEAT_DAMAGE_TYPE_REQUIRED', `${item.name} exige escolher um tipo de dano.`));

  if (schema.weaponMasteryChoiceCount > 0) {
    const selections = choice.weaponMasterySelections ?? [];
    if (selections.length !== schema.weaponMasteryChoiceCount) {
      issues.push(issue('FEAT_WEAPON_MASTERY_CHOICE_COUNT', `${item.name} exige ${schema.weaponMasteryChoiceCount} escolha(s) de arma para maestria.`));
    }
    if (new Set(selections.map((selection) => selection.weaponItemId)).size !== selections.length) {
      issues.push(issue('FEAT_WEAPON_MASTERY_DUPLICATE_WEAPON', `${item.name} exige armas diferentes em cada escolha de maestria.`));
    }
    for (const selection of selections) {
      const weaponItem = allItems.find((candidate) => candidate.id === selection.weaponItemId);
      if (!weaponItem || weaponItem.type !== 'weapon') {
        issues.push(issue('FEAT_WEAPON_MASTERY_WEAPON_INVALID', `A arma escolhida para ${item.name} não existe no compêndio.`));
        continue;
      }
      const mastery = asString(asRecord(weaponItem.normalizedJson).mastery);
      if (!mastery || normalize(mastery) !== normalize(selection.mastery)) issues.push(issue('FEAT_WEAPON_MASTERY_PROPERTY_INVALID', `${weaponItem.name} não possui a propriedade de maestria informada.`));
      if (!isWeaponItemEligibleForMastery(character, weaponItem)) issues.push(issue('FEAT_WEAPON_MASTERY_PROFICIENCY_REQUIRED', `${item.name} exige proficiência com ${weaponItem.name}.`));
    }
  }

  return issues;
};

export const recalculateCharacterAbilities = (character: Character): Character => {
  const generated = character.abilityGeneration?.generatedValues;
  const base = generated?.length === 6 ? abilityScoresFromValues(generated) : character.abilities;
  const origin = character.abilityScoreBonuses ?? {};
  const featIncreases = (character.featChoices ?? []).reduce<Partial<Record<AbilityScore, number>>>((result, choice) => {
    for (const ability of ABILITY_ORDER) result[ability] = (result[ability] ?? 0) + (choice.abilityScoreIncreases?.[ability] ?? 0);
    return result;
  }, {});
  const abilities = ABILITY_ORDER.reduce<AbilityScores>((result, ability) => {
    result[ability] = Math.min(30, base[ability] + (origin[ability] ?? 0) + (featIncreases[ability] ?? 0));
    return result;
  }, { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 });
  return { ...character, abilities };
};

const freeCastResource = (
  character: Character,
  featItem: StoredCompendiumItem,
  choice: CharacterFeatChoice
): { character: Character; resource?: ResourcePool } => {
  const mechanics = asRecord(asRecord(featItem.normalizedJson).mechanics);
  const directFreeCast = asRecord(mechanics.freeCast);
  const spellChoiceFreeCast = asRecord(asRecord(mechanics.spellChoice).freeCast);
  const pluralSpellChoiceWithFreeCast = (Array.isArray(mechanics.spellChoices) ? mechanics.spellChoices.map(asRecord) : [])
    .find((entry) => Object.keys(asRecord(entry.freeCast)).length > 0);
  const pluralFreeCast = asRecord(pluralSpellChoiceWithFreeCast?.freeCast);
  const freeCast = Object.keys(directFreeCast).length
    ? directFreeCast
    : Object.keys(spellChoiceFreeCast).length
      ? spellChoiceFreeCast
      : pluralFreeCast;
  const uses = Math.max(0, asNumber(freeCast.uses) ?? 0);
  if (!uses) return { character };
  const resourceId = `feat_free_cast_${choice.featEntityId}`;
  const existing = character.resources.find((resource) => resource.id === resourceId);
  const resource: ResourcePool = {
    id: resourceId,
    name: `${featItem.name}: conjuração gratuita`,
    max: uses,
    current: existing ? Math.min(uses, existing.current) : uses,
    recharge: ['shortRest', 'shortOrLongRest'].includes(asString(freeCast.recharge) ?? '') ? 'shortRest' : 'longRest',
    source: featItem.rawJson.source,
    notes: `Uso gratuito concedido por ${featItem.name}.`
  };
  return {
    character: {
      ...character,
      resources: [...character.resources.filter((entry) => entry.id !== resourceId), resource]
    },
    resource
  };
};

export const applyFeatChoiceEffects = (
  character: Character,
  featItem: StoredCompendiumItem,
  choice: CharacterFeatChoice,
  allItems: StoredCompendiumItem[]
): Character => {
  const schema = getFeatChoiceSchema(featItem);
  const skillUpgrade = choice.skillUpgrade;
  const gainsExpertise = Boolean(skillUpgrade && character.proficiencies.skills.map(normalize).includes(normalize(skillUpgrade)));
  const mechanics = asRecord(asRecord(featItem.normalizedJson).mechanics);
  const directTool = asString(mechanics.toolProficiency);
  const savingThrowGrant = asString(mechanics.savingThrowProficiencyGranted);
  const selectedAbility = (Object.keys(choice.abilityScoreIncreases ?? {})[0]?.toUpperCase() ?? '') as AbilityScore;

  let next: Character = {
    ...character,
    featChoices: [
      ...(character.featChoices ?? []).filter((entry) => entry.id !== choice.id && !(entry.featEntityId === choice.featEntityId && entry.featEntityId)),
      choice
    ],
    proficiencies: {
      ...character.proficiencies,
      skills: unique([...character.proficiencies.skills, ...(choice.skills ?? []), ...(skillUpgrade && !gainsExpertise ? [skillUpgrade] : [])]),
      expertiseSkills: unique([...character.proficiencies.expertiseSkills, ...(choice.expertiseSkills ?? []), ...(skillUpgrade && gainsExpertise ? [skillUpgrade] : [])]),
      tools: unique([...character.proficiencies.tools, ...(choice.tools ?? []), ...(directTool ? [directTool] : [])]),
      languages: unique([...character.proficiencies.languages, ...(choice.languages ?? [])]),
      savingThrows: unique([
        ...character.proficiencies.savingThrows,
        ...(savingThrowGrant && abilitySet.has(selectedAbility) ? [selectedAbility] : [])
      ])
    },
    weaponMasteries: [
      ...(character.weaponMasteries ?? []).filter((entry) => entry.sourceEntityId !== choice.featEntityId),
      ...((choice.weaponMasterySelections ?? []).map((entry): CharacterWeaponMastery => ({
        ...entry,
        id: entry.id || createId('weaponMastery'),
        sourceKind: 'feat',
        sourceEntityId: choice.featEntityId,
        sourceItemId: featItem.id,
        changeOnLongRest: schema.weaponMasteryChangeOnLongRest
      })))
    ]
  };

  const armorTrainingGranted = asStringArray(mechanics.armorTrainingGranted);
  const weaponProficiencyGranted = asStringArray(mechanics.weaponProficiencyGranted);
  if (armorTrainingGranted.length || weaponProficiencyGranted.length) {
    next = {
      ...next,
      proficiencies: {
        ...next.proficiencies,
        armor: unique([...next.proficiencies.armor, ...armorTrainingGranted]),
        weapons: unique([...next.proficiencies.weapons, ...weaponProficiencyGranted])
      }
    };
  }

  const freeCast = freeCastResource(next, featItem, choice);
  next = freeCast.character;

  const spellReferences = unique([...(choice.spellItemIds ?? []), ...schema.alwaysPreparedSpellReferences]);
  for (const reference of spellReferences) {
    const spellItem = findByReference(allItems, reference);
    if (!spellItem || spellItem.type !== 'spell') continue;
    const existingLink = (next.compendiumLinks ?? []).find((link) => link.itemId === spellItem.id && link.status === 'active');
    if (existingLink) continue;
    const beforeIds = new Set(next.spells.map((spell) => spell.id));
    const result = applyCompendiumItemToCharacter(next, spellItem);
    if (!result.ok) continue;
    next = {
      ...result.character,
      spells: result.character.spells.map((spell) => {
        if (beforeIds.has(spell.id)) return spell;
        const directFreeCastRules = asRecord(mechanics.freeCast);
        const singularSpellChoice = asRecord(mechanics.spellChoice);
        const singularFreeCastRules = asRecord(singularSpellChoice.freeCast);
        const pluralSpellChoice = (Array.isArray(mechanics.spellChoices) ? mechanics.spellChoices.map(asRecord) : [])
          .find((entry) => Object.keys(asRecord(entry.freeCast)).length > 0);
        const freeCastRules = Object.keys(directFreeCastRules).length
          ? directFreeCastRules
          : Object.keys(singularFreeCastRules).length
            ? { ...singularFreeCastRules, spellLevel: singularSpellChoice.spellLevel }
            : pluralSpellChoice
              ? { ...asRecord(pluralSpellChoice.freeCast), spellLevel: pluralSpellChoice.spellLevel }
              : {};
        const configuredSpellLevel = asNumber(freeCastRules.spellLevel);
        const isFreeCastSpell = Boolean(freeCast.resource) && (configuredSpellLevel === undefined || spell.level === configuredSpellLevel);
        return {
          ...spell,
          spellcastingClassName: featItem.name,
          spellcastingAbility: choice.spellcastingAbility ?? schema.fixedSpellcastingAbility ?? spell.spellcastingAbility,
          grantedByFeatEntityId: choice.featEntityId,
          prepared: true,
          consumes: isFreeCastSpell
            ? unique([...(spell.consumes ?? []), { resourceId: freeCast.resource!.id, amount: 1, label: freeCast.resource!.name }])
            : spell.consumes
        };
      })
    };
  }

  return recalculateCharacterAbilities(next);
};

export interface FeatChoiceInstanceInput {
  item: StoredCompendiumItem;
  choice?: CharacterFeatChoice;
}

export const validateFeatChoiceSequence = (
  instances: FeatChoiceInstanceInput[],
  baseAbilities: AbilityScores,
  allItems: StoredCompendiumItem[] = [],
  character?: Character
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  let projected = { ...baseAbilities };
  const previousByItem = new Map<string, CharacterFeatChoice[]>();
  for (const { item, choice } of instances) {
    issues.push(...validateFeatChoice(item, choice, projected, allItems, character));
    issues.push(...validateFeatChoiceUniqueness(item, choice, previousByItem.get(item.id) ?? []));
    if (choice) previousByItem.set(item.id, [...(previousByItem.get(item.id) ?? []), choice]);
    for (const ability of ABILITY_ORDER) projected[ability] = Math.min(30, projected[ability] + (choice?.abilityScoreIncreases?.[ability] ?? 0));
  }
  return issues;
};
