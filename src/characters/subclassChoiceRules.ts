import type { CharacterSubclassChoice, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  findCompendiumItemByReference,
  getProgressionFeatureReferences
} from '../compendium/classProgression';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const normalized = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const titleCase = (value: string): string => value
  .split(/[-_\s]+/)
  .filter(Boolean)
  .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(' ');

const genieLabels: Record<string, string> = {
  dao: 'Dao · Terra',
  djinni: 'Djinni · Ar',
  efreeti: 'Efreeti · Fogo',
  marid: 'Marid · Água'
};

export interface SubclassChoiceOption {
  id: string;
  label: string;
  summary?: string;
}

export interface SubclassChoiceRequirement {
  subclassItemId: string;
  featureItemId: string;
  choiceId: string;
  title: string;
  description: string;
  options: SubclassChoiceOption[];
  mutable: boolean;
  changeTiming?: string;
}

const featureItemsForSubclass = (
  subclassItem: StoredCompendiumItem,
  items: StoredCompendiumItem[],
  classLevel: number
): StoredCompendiumItem[] => getProgressionFeatureReferences(subclassItem, classLevel)
  .map((reference) => findCompendiumItemByReference(items, reference))
  .filter((item): item is StoredCompendiumItem => Boolean(item && item.type === 'feature'));

const spellReferenceDisplayName = (reference: string): string => {
  const slug = reference.includes('-spell-') ? reference.split('-spell-', 2)[1] : reference;
  const minorWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => index > 0 && minorWords.has(part)
      ? part
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

const spellNames = (references: string[], items: StoredCompendiumItem[]): string[] => references
  .map((reference) => findCompendiumItemByReference(items, reference)?.name ?? spellReferenceDisplayName(reference))
  .filter((name): name is string => Boolean(name));

const genieRequirement = (
  subclassItem: StoredCompendiumItem,
  features: StoredCompendiumItem[],
  items: StoredCompendiumItem[]
): SubclassChoiceRequirement | undefined => {
  const expanded = features.find((feature) => {
    const mechanics = asRecord(asRecord(feature.normalizedJson).mechanics);
    return asStringArray(mechanics.genieKinds).length > 1 && Object.keys(asRecord(mechanics.byKind)).length > 0;
  });
  if (!expanded) return undefined;

  const expandedMechanics = asRecord(asRecord(expanded.normalizedJson).mechanics);
  const kinds = asStringArray(expandedMechanics.genieKinds);
  const byKind = asRecord(expandedMechanics.byKind);
  const wrathMap = features.reduce<Record<string, unknown>>((result, feature) => {
    const candidate = asRecord(asRecord(asRecord(feature.normalizedJson).mechanics).geniesWrath).damageTypeByPatron;
    return Object.keys(asRecord(candidate)).length ? asRecord(candidate) : result;
  }, {});
  const resistanceMap = features.reduce<Record<string, unknown>>((result, feature) => {
    const candidate = asRecord(feature.normalizedJson).mechanics;
    const map = asRecord(asRecord(candidate).damageResistanceByPatron);
    return Object.keys(map).length ? map : result;
  }, {});

  return {
    subclassItemId: subclassItem.id,
    featureItemId: expanded.id,
    choiceId: 'genie-kind',
    title: 'Tipo de gênio patrono',
    description: 'Essa escolha define o elemento da subclasse, a Genie’s Wrath, a resistência de Elemental Gift e as magias adicionais do patrono.',
    mutable: false,
    options: kinds.map((kind) => {
      const levels = asRecord(byKind[kind]);
      const references = Object.values(levels).flatMap((value) => asStringArray(value));
      const names = spellNames(references, items);
      const damageType = asString(wrathMap[kind]);
      const resistance = asString(resistanceMap[kind]);
      const details = [
        damageType ? `Genie’s Wrath: ${damageType}` : undefined,
        resistance ? `Elemental Gift: resistência a ${resistance}` : undefined,
        names.length ? `Magias do patrono: ${names.join(', ')}` : undefined
      ].filter(Boolean);
      return {
        id: kind,
        label: genieLabels[kind] ?? titleCase(kind),
        summary: details.join(' · ')
      };
    })
  };
};

const armorerRequirement = (
  subclassItem: StoredCompendiumItem,
  features: StoredCompendiumItem[]
): SubclassChoiceRequirement | undefined => {
  const armorModel = features.find((feature) => {
    const mechanics = asRecord(asRecord(feature.normalizedJson).mechanics);
    return asStringArray(mechanics.modelChoice).length > 1 && Object.keys(asRecord(mechanics.models)).length > 0;
  });
  if (!armorModel) return undefined;
  const mechanics = asRecord(asRecord(armorModel.normalizedJson).mechanics);
  const choices = asStringArray(mechanics.modelChoice);
  const models = asRecord(mechanics.models);
  const changeTiming = asStringArray(mechanics.modelChangeTiming);

  return {
    subclassItemId: subclassItem.id,
    featureItemId: armorModel.id,
    choiceId: 'armor-model',
    title: 'Modelo de Arcane Armor',
    description: 'O modelo selecionado define a arma especial e os benefícios ativos da Armorer.',
    mutable: changeTiming.length > 0,
    changeTiming: changeTiming.length ? `Pode ser alterado ao terminar: ${changeTiming.map(titleCase).join(' ou ')}.` : undefined,
    options: choices.map((choice) => {
      const model = asRecord(models[choice]);
      const weapon = asRecord(model.specialWeapon);
      const weaponName = asString(weapon.name);
      const damageFormula = asString(weapon.damageFormula);
      const damageType = asString(weapon.damageType);
      const details = [
        weaponName ? `Arma: ${weaponName}` : undefined,
        damageFormula && damageType ? `${damageFormula} ${damageType}` : undefined
      ].filter(Boolean);
      return { id: choice, label: titleCase(choice), summary: details.join(' · ') || undefined };
    })
  };
};

const refreshTimingLabel = (value: string): string => {
  if (value === 'shortOrLongRest') return 'Short Rest ou Long Rest';
  if (value === 'shortRest') return 'Short Rest';
  if (value === 'longRest') return 'Long Rest';
  return titleCase(value.replace(/([a-z])([A-Z])/g, '$1 $2'));
};

const refreshableFeatureRequirements = (
  subclassItem: StoredCompendiumItem,
  features: StoredCompendiumItem[],
  classLevel: number
): SubclassChoiceRequirement[] => features.flatMap((feature) => {
  const payload = asRecord(feature.normalizedJson);
  const levelGained = typeof payload.levelGained === 'number' ? payload.levelGained : 0;
  const choices = asStringArray(payload.choices);
  const choiceRefresh = asString(payload.choiceRefresh);
  if (!choiceRefresh || choices.length < 2 || levelGained > classLevel) return [];
  return [{
    subclassItemId: subclassItem.id,
    featureItemId: feature.id,
    choiceId: `feature-choice:${feature.id}`,
    title: feature.name,
    description: `Escolha qual opção de ${feature.name} está ativa para esta subclasse.`,
    mutable: true,
    changeTiming: `Pode ser alterado ao concluir um ${refreshTimingLabel(choiceRefresh)}.`,
    options: choices.map((choice) => ({ id: choice, label: titleCase(choice) }))
  }];
});

export const getSubclassChoiceRequirements = (
  subclassItem: StoredCompendiumItem | undefined,
  items: StoredCompendiumItem[],
  classLevel: number
): SubclassChoiceRequirement[] => {
  if (!subclassItem || subclassItem.type !== 'subclass') return [];
  // Internal subclass configuration can affect features gained later (for example
  // Genie patron resistance at level 6), so inspect the full subclass progression
  // while still requiring the choice as soon as the subclass itself is available.
  const features = featureItemsForSubclass(subclassItem, items, 20);
  const activeFeatures = featureItemsForSubclass(subclassItem, items, classLevel);
  const requirements = [
    genieRequirement(subclassItem, features, items),
    armorerRequirement(subclassItem, features),
    ...refreshableFeatureRequirements(subclassItem, activeFeatures, classLevel)
  ].filter((requirement): requirement is SubclassChoiceRequirement => Boolean(requirement));
  return requirements;
};

export const subclassChoiceForRequirement = (
  choices: CharacterSubclassChoice[] | undefined,
  requirement: SubclassChoiceRequirement
): CharacterSubclassChoice | undefined => (choices ?? []).find((choice) =>
  choice.subclassItemId === requirement.subclassItemId && choice.choiceId === requirement.choiceId
);

export const setSubclassChoiceOption = (
  choices: CharacterSubclassChoice[] | undefined,
  requirement: SubclassChoiceRequirement,
  optionId: string
): CharacterSubclassChoice[] => {
  const next = (choices ?? []).filter((choice) => !(
    choice.subclassItemId === requirement.subclassItemId && choice.choiceId === requirement.choiceId
  ));
  return [
    ...next,
    {
      subclassItemId: requirement.subclassItemId,
      choiceId: requirement.choiceId,
      optionId
    }
  ];
};

export const pruneSubclassChoices = (
  choices: CharacterSubclassChoice[] | undefined,
  requirements: SubclassChoiceRequirement[]
): CharacterSubclassChoice[] => (choices ?? []).filter((choice) => {
  const requirement = requirements.find((candidate) =>
    candidate.subclassItemId === choice.subclassItemId && candidate.choiceId === choice.choiceId
  );
  return Boolean(requirement?.options.some((option) => option.id === choice.optionId));
});

export const validateSubclassChoices = (
  requirements: SubclassChoiceRequirement[],
  choices: CharacterSubclassChoice[] | undefined
): RuleValidationIssue[] => requirements.flatMap((requirement) => {
  const choice = subclassChoiceForRequirement(choices, requirement);
  if (!choice) {
    return [{
      severity: 'error' as const,
      code: 'SUBCLASS_INTERNAL_CHOICE_REQUIRED',
      message: `${requirement.title}: escolha uma opção para concluir a configuração da subclasse.`
    }];
  }
  if (!requirement.options.some((option) => option.id === choice.optionId)) {
    return [{
      severity: 'error' as const,
      code: 'SUBCLASS_INTERNAL_CHOICE_INVALID',
      message: `${requirement.title}: a opção salva não existe mais nas regras ativas.`
    }];
  }
  return [];
});

export const describeSubclassChoice = (
  requirement: SubclassChoiceRequirement,
  choices: CharacterSubclassChoice[] | undefined
): string | undefined => {
  const choice = subclassChoiceForRequirement(choices, requirement);
  const option = requirement.options.find((candidate) => candidate.id === choice?.optionId);
  return option ? `${requirement.title}: ${option.label}` : undefined;
};


const spellReferencesFromLevelMap = (value: unknown): string[] =>
  Object.values(asRecord(value)).flatMap((entry) => asStringArray(entry));

/**
 * Spell-list additions granted by the active subclass configuration.
 * The imported books keep these mechanics structured, so the spell selector
 * can consume them without hard-coding individual spell names.
 */
export const getSubclassSpellListReferences = (
  subclassItem: StoredCompendiumItem | undefined,
  choices: CharacterSubclassChoice[] | undefined,
  items: StoredCompendiumItem[],
  classLevel: number
): string[] => {
  if (!subclassItem || subclassItem.type !== 'subclass') return [];
  const references: string[] = [];
  const features = featureItemsForSubclass(subclassItem, items, Math.max(classLevel, 20));

  for (const feature of features) {
    const mechanics = asRecord(asRecord(feature.normalizedJson).mechanics);
    references.push(...spellReferencesFromLevelMap(mechanics.addedToWarlockSpellListBySpellLevel));
    references.push(...spellReferencesFromLevelMap(mechanics.commonBySpellLevel));

    const byKind = asRecord(mechanics.byKind);
    if (Object.keys(byKind).length) {
      const requirement = genieRequirement(subclassItem, features, items);
      const choice = requirement ? subclassChoiceForRequirement(choices, requirement) : undefined;
      if (choice?.optionId) references.push(...spellReferencesFromLevelMap(byKind[choice.optionId]));
    }
  }

  return Array.from(new Set(references));
};

export const getCharacterSubclassSpellListReferences = (
  character: import('../types').Character,
  items: StoredCompendiumItem[],
  classEntityId: string
): string[] => {
  const subclassEntity = character.subclasses.find((entry) => entry.classId === classEntityId);
  if (!subclassEntity) return [];
  const link = (character.compendiumLinks ?? []).find((entry) =>
    entry.appliedAs === 'subclass' && entry.appliedEntityId === subclassEntity.id && entry.status === 'active'
  );
  const subclassItem = items.find((item) => item.id === link?.itemId && item.type === 'subclass');
  const classLevel = character.classes.find((entry) => entry.id === classEntityId)?.level ?? character.level;
  return getSubclassSpellListReferences(
    subclassItem,
    character.buildChoices?.subclassChoices,
    items,
    classLevel
  );
};

export const getGeniePatronKind = (
  choices: CharacterSubclassChoice[] | undefined,
  subclassItemId = 'tcoe-2020-subclass-the-genie'
): string | undefined => choices?.find((choice) =>
  choice.subclassItemId === subclassItemId && choice.choiceId === 'genie-kind'
)?.optionId;

export interface CharacterSubclassChoiceSummary {
  subclassItemId: string;
  subclassName: string;
  title: string;
  value?: string;
  detail?: string;
  pending: boolean;
}

export const getCharacterSubclassChoiceSummaries = (
  character: import('../types').Character,
  items: StoredCompendiumItem[]
): CharacterSubclassChoiceSummary[] => (character.compendiumLinks ?? [])
  .filter((link) => link.appliedAs === 'subclass' && link.status === 'active')
  .flatMap((link) => {
    const subclassItem = items.find((item) => item.id === link.itemId && item.type === 'subclass');
    const subclassEntity = character.subclasses.find((entry) => entry.id === link.appliedEntityId);
    const classLevel = subclassEntity
      ? character.classes.find((entry) => entry.id === subclassEntity.classId)?.level ?? character.level
      : character.level;
    return getSubclassChoiceRequirements(subclassItem, items, classLevel).map((requirement) => {
      const choice = subclassChoiceForRequirement(character.buildChoices?.subclassChoices, requirement);
      const option = requirement.options.find((candidate) => candidate.id === choice?.optionId);
      return {
        subclassItemId: requirement.subclassItemId,
        subclassName: subclassItem?.name ?? link.appliedEntityName,
        title: requirement.title,
        value: option?.label,
        detail: option?.summary,
        pending: !option
      };
    });
  });
