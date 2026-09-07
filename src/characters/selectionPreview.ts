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

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

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

const humanizeMechanicKey = (value: string): string => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace(/ Feet$/i, '');

const mechanicValueSummary = (key: string, value: unknown): string | undefined => {
  const label = humanizeMechanicKey(key);
  if (value === true) return label;
  if (value === false || value === null || value === undefined) return undefined;
  if (typeof value === 'number') return /Feet$/i.test(key) ? `${label}: ${value} ft` : `${label}: ${value}`;
  if (typeof value === 'string' && value.trim()) return `${label}: ${value.trim()}`;
  if (Array.isArray(value)) {
    const primitive = value.filter((entry) => typeof entry === 'string' || typeof entry === 'number');
    return primitive.length ? `${label}: ${primitive.join(', ')}` : undefined;
  }
  const record = asRecord(value);
  const nested = Object.entries(record)
    .map(([nestedKey, nestedValue]) => mechanicValueSummary(nestedKey, nestedValue))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3);
  return nested.length ? `${label} — ${nested.join(' · ')}` : undefined;
};

const spellNameFromReference = (reference: string): string => {
  const slug = reference.includes('-spell-') ? reference.split('-spell-', 2)[1] ?? reference : reference;
  return slug.split(/[-_]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
};

const speciesFeatureDescription = (item: StoredCompendiumItem): string | undefined => {
  const payload = asRecord(item.normalizedJson);
  if (asString(payload.sourceType) !== 'speciesFeature') return undefined;
  const mechanics = asRecord(payload.mechanics);
  const optionType = asString(mechanics.optionType);
  const parts: string[] = [];

  if (optionType === 'genasiSubrace') {
    const name = asString(mechanics.name) ?? item.name.replace(/^.*?:\s*/, '');
    const resistances = asStringArray(mechanics.damageResistances);
    if (resistances.length) parts.push(`Resistência a ${resistances.join(', ')}.`);
    if (asBoolean(mechanics.amphibious)) parts.push('Anfíbio: respira ar e água.');
    const swim = asNumber(mechanics.swimSpeedFeet);
    if (swim !== undefined) parts.push(`Deslocamento de natação ${swim} ft.`);
    const darkvision = asNumber(asRecord(mechanics.darkvision).feet);
    if (darkvision !== undefined) parts.push(`Darkvision ${darkvision} ft.`);
    const earthWalk = asRecord(mechanics.earthWalk);
    if (asString(earthWalk.ignoreExtraMovementFromDifficultTerrain)) parts.push('Earth Walk: terreno difícil de terra e pedra não custa movimento extra.');
    if (asBoolean(asRecord(mechanics.unendingBreath).holdBreathIndefinitelyWhileNotIncapacitated)) parts.push('Unending Breath: pode prender a respiração indefinidamente enquanto não estiver incapacitado.');

    const spellBlocks = [
      asRecord(mechanics.mingleWithTheWind),
      asRecord(mechanics.passWithoutTrace),
      asRecord(mechanics.reachToTheBlaze),
      asRecord(mechanics.callToTheWave)
    ];
    for (const block of spellBlocks) {
      const directSpell = asString(block.spellId);
      if (directSpell) {
        const recharge = asString(block.recharge);
        parts.push(`${spellNameFromReference(directSpell)} ${asNumber(block.uses) ? `${asNumber(block.uses)}×` : ''}${recharge ? ` por ${recharge === 'longRest' ? 'Long Rest' : recharge}` : ''}; atributo de conjuração ${asString(block.spellcastingAbility) ?? 'definido pela feature'}.`);
      }
      const spells = Array.isArray(block.spells) ? block.spells.map(asRecord) : [];
      for (const spell of spells) {
        const spellName = asString(spell.spellName) ?? (asString(spell.spellId) ? spellNameFromReference(asString(spell.spellId)!) : undefined);
        if (!spellName) continue;
        const minimum = asNumber(spell.minimumCharacterLevel) ?? 1;
        const usage = asString(spell.usage);
        const recharge = asString(spell.recharge);
        parts.push(`${spellName}${minimum > 1 ? ` a partir do nível ${minimum}` : ''}${usage === 'atWillCantrip' ? ' à vontade' : recharge ? ` 1× por ${recharge === 'longRest' ? 'Long Rest' : recharge}` : ''}.`);
      }
    }
    return `${name}: ${parts.join(' ')}`.trim();
  }

  const bonusChecks = asStringArray(mechanics.d4BonusToChecks);
  if (bonusChecks.length) parts.push(`+1d4 em ${bonusChecks.join(', ')}.`);
  const grantedSpells = Array.isArray(mechanics.grantedSpells) ? mechanics.grantedSpells.map(asRecord) : [];
  if (grantedSpells.length) {
    parts.push(`Magias: ${grantedSpells.map((spell) => {
      const name = asString(spell.spellName) ?? (asString(spell.spellId) ? spellNameFromReference(asString(spell.spellId)!) : 'magia');
      return `${name}${asBoolean(spell.atWill) ? ' à vontade' : asString(spell.recharge) === 'longRest' ? ' 1×/Long Rest' : ''}`;
    }).join(', ')}.`);
  }
  if (asString(mechanics.spellcastingAbility)) parts.push(`Atributo de conjuração: ${asString(mechanics.spellcastingAbility)}.`);

  return parts.length ? parts.join(' ') : undefined;
};

const structuredMechanicsDescription = (item: StoredCompendiumItem): string | undefined => {
  const specialized = speciesFeatureDescription(item);
  if (specialized) return specialized;
  const payload = asRecord(item.normalizedJson);
  const mechanics = asRecord(payload.mechanics);
  const parts = Object.entries(mechanics)
    .filter(([key]) => !['legacySource', 'compatibilityTarget', 'optionType', 'choiceType', 'chooseExactly', 'optionFeatureIds'].includes(key))
    .map(([key, value]) => mechanicValueSummary(key, value))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 5);
  return parts.length ? parts.join(' · ') : undefined;
};

const isGenericImportedSummary = (value: string | undefined): boolean => Boolean(
  value && (
    /^Legacy .* (rule|feature|player ancestry option|background option|subclass)/i.test(value) ||
    /^.* (rule|feature): /i.test(value)
  )
);

export const getSelectionShortDescription = (
  item: StoredCompendiumItem,
  maxLength = 240
): string => {
  const payload = asRecord(item.normalizedJson);
  const summary = asString(item.summary) ?? asString(payload.summary) ?? asString(payload.description);
  const mechanics = structuredMechanicsDescription(item);
  return compact(
    isGenericImportedSummary(summary) && mechanics
      ? mechanics
      : summary ?? mechanics ?? 'Descrição resumida indisponível.',
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
  const payload = asRecord(item.normalizedJson);
  const summary = getSelectionShortDescription(item);
  const mechanics = asRecord(payload.mechanics);
  const creatureType = asString(payload.creatureType);
  const size = asString(payload.size);
  const speed = asNumber(payload.speed);
  const languages = asStringArray(payload.languages);
  const baseSpecies = asString(payload.baseSpecies);
  const optionType = asString(payload.optionType) ?? asString(mechanics.optionType);
  const isLegacy = asString(payload.compatibility) === 'legacySourceNative' || asBoolean(mechanics.legacySource) === true;
  const parts = [
    optionType === 'subrace' || optionType === 'variantRace'
      ? `${optionType === 'subrace' ? 'Subespécie' : 'Variante'} de ${baseSpecies ?? 'uma espécie-base'}`
      : undefined,
    creatureType ? (creatureTypeLabels[creatureType] ?? creatureType) : undefined,
    size ? `tamanho ${sizeLabel(size)}` : undefined,
    speed ? `deslocamento ${speed} ft` : undefined,
    languages.length ? `idiomas ${languages.join(', ')}` : undefined,
    isLegacy ? 'compatibilidade 2024: ASI legado ignorado' : undefined
  ].filter((entry): entry is string => Boolean(entry));

  if (parts.length) return `${parts.join(' · ')}. ${summary}`;
  return summary;
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
  summary: getSelectionShortDescription(feature, 280)
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
