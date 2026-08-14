import type { StoredCompendiumItem } from '../compendium/types';
import { itemReferenceMatches } from './creationData';
import { getSpeciesFeatureItems } from './speciesChoiceRules';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];

const compact = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > maxLength * 0.65 ? lastSpace : maxLength).trim()}…`;
};

export const getSelectionShortDescription = (
  item: StoredCompendiumItem,
  maxLength = 240
): string => {
  const payload = asRecord(item.normalizedJson);
  return compact(
    asString(item.summary) ??
      asString(payload.summary) ??
      asString(payload.description) ??
      'Descrição resumida indisponível.',
    maxLength
  );
};

const abilityLabels: Record<string, string> = {
  STR: 'Força',
  DEX: 'Destreza',
  CON: 'Constituição',
  INT: 'Inteligência',
  WIS: 'Sabedoria',
  CHA: 'Carisma'
};

const armorLabels: Record<string, string> = {
  light: 'armadura leve',
  medium: 'armadura média',
  heavy: 'armadura pesada',
  shields: 'escudos'
};

const creatureTypeLabels: Record<string, string> = {
  Humanoid: 'Humanoide',
  Construct: 'Constructo',
  Fey: 'Feérico'
};

const sizeLabel = (value: string): string => value
  .replace(/Medium/g, 'Médio')
  .replace(/Small/g, 'Pequeno')
  .replace(/Large/g, 'Grande')
  .replace(/Tiny/g, 'Miúdo')
  .replace(/ or /g, ' ou ');

const classSpellcastingLabel = (payload: Record<string, unknown>): string | undefined => {
  const spellcasting = asRecord(payload.spellcasting);
  const progression = asString(spellcasting.progression);
  if (progression === 'fullCaster') return 'conjurador completo';
  if (progression === 'halfCaster') return 'meio conjurador';
  if (progression === 'thirdCaster') return 'conjurador parcial';
  if (progression === 'pactMagic') return 'Pact Magic';
  return Object.keys(spellcasting).length ? 'conjuração' : undefined;
};

export const getClassSelectionDescription = (item: StoredCompendiumItem): string => {
  const summary = getSelectionShortDescription(item);
  if (!/^Classe base do PHB 2024/i.test(summary)) return summary;

  const payload = asRecord(item.normalizedJson);
  const hitDie = asNumber(payload.hitDie);
  const primaryAbilities = asStringArray(payload.primaryAbilities).map((ability) => abilityLabels[ability] ?? ability);
  const armorTraining = asStringArray(payload.armorTraining ?? payload.armorProficiencies);
  const parts = [
    hitDie ? `Dado de Vida d${hitDie}` : undefined,
    primaryAbilities.length ? `atributo principal ${primaryAbilities.join(' / ')}` : undefined,
    classSpellcastingLabel(payload),
    armorTraining.length ? `treino: ${armorTraining.map((entry) => armorLabels[entry] ?? entry).join(', ')}` : undefined
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length ? `${parts.join(' · ')}.` : summary;
};

export const getSpeciesSelectionDescription = (item: StoredCompendiumItem): string => {
  const summary = getSelectionShortDescription(item);
  if (!/^Species PHB 2024/i.test(summary)) return summary;

  const payload = asRecord(item.normalizedJson);
  const creatureType = asString(payload.creatureType);
  const size = asString(payload.size);
  const speed = asNumber(payload.speed);
  const parts = [
    creatureType ? (creatureTypeLabels[creatureType] ?? creatureType) : undefined,
    size ? `tamanho ${sizeLabel(size)}` : undefined,
    speed ? `deslocamento ${speed} ft` : undefined
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length ? `${parts.join(' · ')}.` : summary;
};

export interface SelectionFeaturePreview {
  key: string;
  itemId: string;
  name: string;
  levelGained: number;
  summary: string;
}

const resolveFeature = (
  allItems: StoredCompendiumItem[],
  reference: string
): StoredCompendiumItem | undefined =>
  allItems.find((item) => item.type === 'feature' && itemReferenceMatches(item, reference));

const previewForFeature = (
  feature: StoredCompendiumItem,
  levelGained: number,
  key: string
): SelectionFeaturePreview => ({
  key,
  itemId: feature.id,
  name: feature.name,
  levelGained,
  summary: getSelectionShortDescription(feature, 170)
});

export const getClassFeaturePreview = (
  classItem: StoredCompendiumItem,
  allItems: StoredCompendiumItem[],
  classLevel: number | undefined,
  totalLevel: number
): SelectionFeaturePreview[] => {
  const attainedLevel = Math.max(1, Math.min(20, classLevel ?? totalLevel));
  const payload = asRecord(classItem.normalizedJson);
  const progression = Array.isArray(payload.progression) ? payload.progression : [];

  if (progression.length) {
    const result: SelectionFeaturePreview[] = [];
    const seen = new Set<string>();
    for (const entry of progression) {
      const record = asRecord(entry);
      const level = asNumber(record.level);
      if (level === undefined || level > attainedLevel) continue;
      for (const reference of asStringArray(record.featureIds)) {
        const feature = resolveFeature(allItems, reference);
        if (!feature) continue;
        const key = `${feature.id}:${level}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(previewForFeature(feature, level, key));
      }
    }
    return result.sort((left, right) => left.levelGained - right.levelGained || left.name.localeCompare(right.name));
  }

  return asStringArray(payload.featureIds)
    .map((reference) => resolveFeature(allItems, reference))
    .filter((feature): feature is StoredCompendiumItem => Boolean(feature))
    .map((feature) => ({
      feature,
      levelGained: Math.max(1, asNumber(asRecord(feature.normalizedJson).levelGained) ?? 1)
    }))
    .filter(({ levelGained }) => levelGained <= attainedLevel)
    .map(({ feature, levelGained }) => previewForFeature(feature, levelGained, `${feature.id}:${levelGained}`))
    .sort((left, right) => left.levelGained - right.levelGained || left.name.localeCompare(right.name));
};

export const getSpeciesFeaturePreview = (
  speciesItem: StoredCompendiumItem | undefined,
  allItems: StoredCompendiumItem[],
  totalLevel: number
): SelectionFeaturePreview[] => {
  const attainedLevel = Math.max(1, Math.min(20, totalLevel));
  return getSpeciesFeatureItems(speciesItem, allItems)
    .map((feature) => ({
      feature,
      levelGained: Math.max(1, asNumber(asRecord(feature.normalizedJson).levelGained) ?? 1)
    }))
    .filter(({ levelGained }) => levelGained <= attainedLevel)
    .map(({ feature, levelGained }) => previewForFeature(feature, levelGained, `${feature.id}:${levelGained}`))
    .sort((left, right) => left.levelGained - right.levelGained || left.name.localeCompare(right.name));
};
