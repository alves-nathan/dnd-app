import type {
  Character,
  CharacterClassMetamagicChoice
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import {
  findCompendiumItemByReference
} from '../compendium/classProgression';
import {
  findCompendiumItemForCharacterLink,
  sameLogicalCompendiumItem
} from '../compendium/characterLinkIdentity';
import {
  getFeatChoiceSchema
} from './featChoiceRules';
import {
  METAMAGIC_OPTIONS_2024,
  getMetamagicFeatOptions,
  type FeatOptionDefinition
} from './featOptionCatalog';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

export type CharacterMetamagicSourceKind = 'sorcerer' | 'feat';

export interface CharacterMetamagicSource {
  id: string;
  kind: CharacterMetamagicSourceKind;
  label: string;
  description: string;
  optionLimit: number;
  selectedOptionIds: string[];
  availableOptions: FeatOptionDefinition[];
  resourceId: string;
  classEntityId?: string;
  featureEntityId?: string;
  classItemId?: string;
  featureItemId?: string;
  featEntityId?: string;
  featItemId?: string;
}

const metamagicKnownCount = (featureItem: StoredCompendiumItem, classLevel: number): number => {
  const byLevel = asRecord(asRecord(featureItem.normalizedJson).metamagicOptionsKnownByLevel);
  return Object.entries(byLevel).reduce((current, [levelText, count]) => {
    const level = Number(levelText);
    const amount = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    return Number.isFinite(level) && level <= classLevel ? Math.max(current, amount) : current;
  }, 0);
};

const classMetamagicChoiceForSource = (
  character: Character,
  classEntityId: string,
  featureEntityId: string
): CharacterClassMetamagicChoice | undefined => (character.buildChoices?.classMetamagicChoices ?? []).find((choice) =>
  choice.classEntityId === classEntityId && choice.featureEntityId === featureEntityId
);

const sorcererMetamagicSources = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterMetamagicSource[] => character.features.flatMap((feature): CharacterMetamagicSource[] => {
  const featureLink = (character.compendiumLinks ?? []).find((link) =>
    link.status === 'active' && link.appliedAs === 'feature' && link.appliedEntityId === feature.id
  );
  const featureItem = featureLink ? findCompendiumItemForCharacterLink(items, featureLink) : undefined;
  if (!featureItem || asString(asRecord(featureItem.normalizedJson).engineKey) !== 'sorcerer.metamagic') return [];

  const classReference = asString(asRecord(featureItem.normalizedJson).classId);
  const classItem = classReference ? findCompendiumItemByReference(items, classReference) : undefined;
  const classLink = (character.compendiumLinks ?? []).find((link) => {
    if (link.status !== 'active' || link.appliedAs !== 'class') return false;
    const linked = findCompendiumItemForCharacterLink(items, link);
    return Boolean(classItem && linked && sameLogicalCompendiumItem(linked, classItem));
  });
  const classEntity = classLink ? character.classes.find((entry) => entry.id === classLink.appliedEntityId) : undefined;
  if (!classEntity || !classItem) return [];

  const optionLimit = metamagicKnownCount(featureItem, classEntity.level);
  if (optionLimit <= 0) return [];
  const selected = classMetamagicChoiceForSource(character, classEntity.id, feature.id)?.optionIds ?? [];
  const resourceId = asString(asRecord(featureItem.normalizedJson).resourceId)
    ?? character.resources.find((resource) => normalize(resource.name) === 'sorcery points')?.id
    ?? 'sorcerer-sorcery-points';

  return [{
    id: `sorcerer:${feature.id}`,
    kind: 'sorcerer',
    label: 'Sorcerer Metamagic',
    description: `${classItem.name} nível ${classEntity.level}: conhece ${optionLimit} opção(ões) de Metamagic.`,
    optionLimit,
    selectedOptionIds: selected.filter((id) => METAMAGIC_OPTIONS_2024.some((option) => option.id === id)).slice(0, optionLimit),
    availableOptions: METAMAGIC_OPTIONS_2024,
    resourceId,
    classEntityId: classEntity.id,
    featureEntityId: feature.id,
    classItemId: classItem.id,
    featureItemId: featureItem.id
  }];
});

const featMetamagicSources = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterMetamagicSource[] => {
  const enabledSourceIds = Array.from(new Set(items.filter((item) => item.status !== 'disabled').map((item) => item.sourceId)));
  const resolved = character.feats.flatMap((feat): CharacterMetamagicSource[] => {
    const link = (character.compendiumLinks ?? []).find((entry) =>
      entry.status === 'active' && entry.appliedAs === 'feat' && entry.appliedEntityId === feat.id
    );
    const featItem = link ? findCompendiumItemForCharacterLink(items, link) : undefined;
    if (!featItem) return [];
    const schema = getFeatChoiceSchema(featItem);
    if (schema.metamagicChoiceCount <= 0) return [];
    const choice = (character.featChoices ?? []).find((entry) => entry.featEntityId === feat.id);
    return [{
      id: `feat:${feat.id}`,
      kind: 'feat',
      label: feat.name,
      description: `Feat: escolha ${schema.metamagicChoiceCount} opção(ões) de Metamagic; usa o pool de Sorcery Points concedido pelo feat.`,
      optionLimit: schema.metamagicChoiceCount,
      selectedOptionIds: (choice?.metamagicOptionIds ?? []).slice(0, schema.metamagicChoiceCount),
      availableOptions: getMetamagicFeatOptions(enabledSourceIds),
      resourceId: `feat_metamagic_${feat.id}`,
      featEntityId: feat.id,
      featItemId: featItem.id
    }];
  });
  const resolvedFeatIds = new Set(resolved.map((source) => source.featEntityId).filter(Boolean));
  const legacy = (character.featChoices ?? []).flatMap((choice): CharacterMetamagicSource[] => {
    if (resolvedFeatIds.has(choice.featEntityId) || !(choice.metamagicOptionIds ?? []).length) return [];
    return [{
      id: `feat:${choice.featEntityId}`,
      kind: 'feat',
      label: 'Metamagic Adept',
      description: 'Escolhas persistidas de Metamagic Adept recuperadas de uma ficha legacy.',
      optionLimit: 2,
      selectedOptionIds: (choice.metamagicOptionIds ?? []).slice(0, 2),
      availableOptions: getMetamagicFeatOptions(enabledSourceIds),
      resourceId: `feat_metamagic_${choice.featEntityId}`,
      featEntityId: choice.featEntityId,
      featItemId: choice.featItemId
    }];
  });
  return [...resolved, ...legacy];
};

export const getCharacterMetamagicSources = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterMetamagicSource[] => [
  ...sorcererMetamagicSources(character, items),
  ...featMetamagicSources(character, items)
];

export const setClassMetamagicOptions = (
  choices: readonly CharacterClassMetamagicChoice[] | undefined,
  source: Pick<CharacterMetamagicSource, 'kind' | 'classEntityId' | 'featureEntityId' | 'classItemId' | 'featureItemId' | 'optionLimit' | 'availableOptions'>,
  optionIds: readonly string[]
): CharacterClassMetamagicChoice[] => {
  if (source.kind !== 'sorcerer' || !source.classEntityId || !source.featureEntityId || !source.classItemId || !source.featureItemId) {
    return [...(choices ?? [])];
  }
  const allowed = new Set(source.availableOptions.map((option) => option.id));
  const selected = Array.from(new Set(optionIds.filter((id) => allowed.has(id)))).slice(0, source.optionLimit);
  const remaining = (choices ?? []).filter((choice) => !(
    choice.classEntityId === source.classEntityId && choice.featureEntityId === source.featureEntityId
  ));
  if (!selected.length) return remaining;
  return [...remaining, {
    classEntityId: source.classEntityId,
    featureEntityId: source.featureEntityId,
    classItemId: source.classItemId,
    featureItemId: source.featureItemId,
    optionIds: selected
  }];
};


export const reconcileClassMetamagicChoices = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterClassMetamagicChoice[] => getCharacterMetamagicSources(character, items)
  .filter((source) => source.kind === 'sorcerer')
  .flatMap((source) => setClassMetamagicOptions([], source, source.selectedOptionIds));

export const metamagicSourceIsComplete = (source: CharacterMetamagicSource): boolean =>
  source.selectedOptionIds.length === source.optionLimit;
