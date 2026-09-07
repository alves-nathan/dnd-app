import type { AbilityScore, CharacterProficiencies } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { emptyCharacterProficiencies, mergeProficiencies } from './proficiencies';

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : [];

const asNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asBoolean = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;

const humanizeToken = (value: string): string => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const spellNameFromReference = (reference: string): string => {
  const slug = reference.includes('-spell-') ? reference.split('-spell-', 2)[1] ?? reference : reference;
  return slug.split(/[-_]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
};

const compactMechanicValue = (key: string, value: unknown): string | undefined => {
  const label = humanizeToken(key);
  if (value === true) return label;
  if (value === false || value === null || value === undefined) return undefined;
  if (typeof value === 'number') return `${label}: ${value}${/feet$/i.test(key) ? ' ft' : ''}`;
  if (typeof value === 'string' && value.trim()) return `${label}: ${humanizeToken(value)}`;
  if (Array.isArray(value)) {
    const values = value.filter((entry) => typeof entry === 'string' || typeof entry === 'number');
    return values.length ? `${label}: ${values.join(', ')}` : undefined;
  }
  const nested = Object.entries(asRecord(value))
    .map(([nestedKey, nestedValue]) => compactMechanicValue(nestedKey, nestedValue))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3);
  return nested.length ? `${label} — ${nested.join(' · ')}` : undefined;
};

const isGenericInvocationSummary = (value: string | undefined): boolean => Boolean(
  value && (
    /^Legacy Eldritch Invocation from /i.test(value) ||
    /^Eldritch Invocation(?: option)?(?: from| de) /i.test(value)
  )
);

const invocationDescription = (item: StoredCompendiumItem): string | undefined => {
  const payload = asRecord(item.normalizedJson);
  if ((asString(payload.sourceType) ?? '').toLowerCase() !== 'eldritchinvocation') return undefined;
  const mechanics = asRecord(payload.mechanics);
  const parts: string[] = [];
  const prerequisite = asString(payload.prerequisite);
  if (prerequisite) parts.push(`Pré-requisito: ${prerequisite}.`);

  // Several PHB 2024 invocations are intentionally modeled with a concise
  // mechanical summary and no payload.mechanics object. The previous
  // formatter returned as soon as it recognized an invocation, which meant
  // those perfectly useful summaries disappeared and the UI showed only the
  // prerequisite. Preserve any non-generic source summary before enriching it
  // with structured mechanics.
  const sourceSummary = asString(payload.description) ?? asString(payload.summary) ?? asString(item.summary);
  if (sourceSummary && !isGenericInvocationSummary(sourceSummary)) parts.push(sourceSummary);

  if (asBoolean(mechanics.noLongerNeedsSleep)) {
    const rest = asRecord(mechanics.longRest);
    const hours = asNumber(rest.hours) ?? 8;
    parts.push(`Você não precisa dormir; pode passar as ${hours} horas de um Long Rest em atividade leve e não pode ser forçado a dormir.`);
  }

  const healing = asRecord(mechanics.whenYouRegainHitPoints);
  const familiarRange = asNumber(healing.requiresFamiliarWithinFeet);
  if (familiarRange !== undefined && asString(healing.healingDiceForYou) === 'treatEveryDieAsMaximumResult') {
    parts.push(`Quando recuperar PV enquanto seu familiar estiver a até ${familiarRange} ft, cada dado de cura usado para você conta como o resultado máximo.`);
  }

  const moveTarget = asRecord(mechanics.moveTarget);
  const moveFeet = asNumber(moveTarget.feet);
  if (moveFeet !== undefined) {
    const direction = asString(moveTarget.direction) === 'straightLineCloserToYou'
      ? 'em linha reta para mais perto de você'
      : humanizeToken(asString(moveTarget.direction) ?? '');
    const trigger = asString(mechanics.trigger);
    parts.push(`${trigger?.includes('EldritchBlast') ? 'Uma vez em cada um de seus turnos, quando você atingir com Eldritch Blast' : 'Quando o gatilho da invocation ocorrer'}, você pode mover o alvo ${moveFeet} ft ${direction}.`);
  }

  const temporaryHitPoints = asString(mechanics.temporaryHitPointsFormula);
  if (temporaryHitPoints) parts.push(`Concede ${temporaryHitPoints} pontos de vida temporários conforme o gatilho da invocation.`);
  const teleportFeet = asNumber(mechanics.teleportFeet);
  if (teleportFeet !== undefined) parts.push(`Permite teleporte de até ${teleportFeet} ft conforme o gatilho da invocation.`);
  const speedReductionFeet = asNumber(mechanics.speedReductionFeet);
  if (speedReductionFeet !== undefined) parts.push(`Reduz o deslocamento do alvo em ${speedReductionFeet} ft conforme o efeito da invocation.`);
  const seeThrough = asNumber(mechanics.seeThroughSolidObjectsFeet);
  if (seeThrough !== undefined) parts.push(`Permite enxergar através de objetos sólidos até ${seeThrough} ft enquanto o efeito estiver ativo.`);

  const atWill = asRecord(mechanics.atWillCasting);
  const atWillSpell = asString(atWill.spellId);
  if (atWillSpell) parts.push(`Permite conjurar ${spellNameFromReference(atWillSpell)} à vontade${asBoolean(atWill.materialComponentsRequired) === false ? ', sem componentes materiais' : ''}.`);
  const freeCasting = asRecord(mechanics.freeCasting);
  const freeSpell = asString(freeCasting.spellId);
  if (freeSpell) {
    const uses = asNumber(freeCasting.uses) ?? asNumber(mechanics.uses);
    const recharge = asString(freeCasting.recharge) ?? asString(mechanics.recharge);
    parts.push(`Permite conjurar ${spellNameFromReference(freeSpell)}${uses ? ` ${uses} vez(es)` : ''}${recharge ? `; recarrega em ${humanizeToken(recharge)}` : ''}.`);
  }

  const pactWeapon = asRecord(mechanics.pactWeapon);
  if (Object.keys(pactWeapon).length) {
    const details = [
      asBoolean(pactWeapon.canBeSpellcastingFocusForWarlockSpells)
        ? 'pode ser usada como foco de conjuração para suas magias de Warlock'
        : undefined,
      asNumber(pactWeapon.attackAndDamageBonus) !== undefined
        ? `recebe +${asNumber(pactWeapon.attackAndDamageBonus)} nas jogadas de ataque e dano`
        : undefined,
      asBoolean(pactWeapon.bonusDoesNotApplyIfMagicWeaponAlreadyHasBonusToThoseRolls)
        ? 'esse bônus não se acumula com um bônus mágico já existente nessas jogadas'
        : undefined,
      asBoolean(pactWeapon.attackAbilityOverride) ? 'usa o atributo configurado pela invocation' : undefined,
      asString(pactWeapon.damageBonusFormula) ? `bônus de dano ${asString(pactWeapon.damageBonusFormula)}` : undefined,
      asStringArray(pactWeapon.additionalConjurableWeaponTypes).length
        ? `também pode conjurar ${asStringArray(pactWeapon.additionalConjurableWeaponTypes).join(', ')}`
        : undefined
    ].filter((entry): entry is string => Boolean(entry));
    parts.push(`Sua arma de pacto ${details.length ? details.join('; ') : 'recebe os benefícios descritos pela invocation'}.`);
  }

  if (asBoolean(mechanics.optionalClassFeature) && asString(mechanics.item)) {
    const itemName = asString(mechanics.item);
    const bonusDie = asString(mechanics.bonusDie);
    const uses = asString(mechanics.uses);
    const recharge = asString(mechanics.recharge);
    const trigger = asString(mechanics.trigger);
    const ceremony = asRecord(mechanics.replacementCeremony);
    const duration = asString(ceremony.duration);
    parts.push([
      `Concede ${itemName}`,
      trigger ? `quando ${trigger}` : undefined,
      bonusDie ? `o portador pode adicionar ${bonusDie}` : undefined,
      uses ? `${uses} usos` : undefined,
      recharge ? `recarrega em ${humanizeToken(recharge)}` : undefined,
      duration ? `pode recriar o talismã em uma cerimônia de ${duration}` : undefined
    ].filter((entry): entry is string => Boolean(entry)).join('; ') + '.');
  }

  const describedKeys = new Set([
    'prerequisites', 'legacySource', 'compatibilityTarget', 'actionTiming',
    'noLongerNeedsSleep', 'cannotBeForcedToSleep', 'longRest', 'whenYouRegainHitPoints',
    'moveTarget', 'trigger', 'temporaryHitPointsFormula', 'teleportFeet', 'speedReductionFeet',
    'seeThroughSolidObjectsFeet', 'atWillCasting', 'freeCasting', 'pactWeapon',
    'optionalClassFeature', 'requiresDmApproval', 'item', 'bonusDie', 'uses', 'recharge',
    'replacementCeremony', 'talismanTurnsToAshWhenYouDie'
  ]);
  const fallback = Object.entries(mechanics)
    .filter(([key]) => !describedKeys.has(key))
    .map(([key, value]) => compactMechanicValue(key, value))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 4);
  if (fallback.length) parts.push(...fallback.map((entry) => `${entry}.`));

  if (!parts.length) return undefined;
  return parts.join(' ');
};
const abilitySet = new Set(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
export const ALL_BACKGROUND_ABILITY_OPTIONS: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const asAbilities = (value: unknown): AbilityScore[] => asStringArray(value).map((entry) => entry.toUpperCase()).filter((entry): entry is AbilityScore => abilitySet.has(entry));

export const itemReferenceMatches = (item: StoredCompendiumItem, reference: string): boolean =>
  item.id === reference || item.importItemId === reference || asString(asRecord(item.rawJson).id) === reference;

export const backgroundSuggestions = (item?: StoredCompendiumItem) => {
  const payload = asRecord(item?.normalizedJson);
  return {
    abilityOptions: asAbilities(payload.abilityScoreOptions),
    featIds: asStringArray(payload.featIds),
    proficiencies: {
      ...emptyCharacterProficiencies(),
      skills: asStringArray(payload.skillProficiencies),
      tools: asStringArray(payload.toolProficiencies),
      languages: asStringArray(payload.languages)
    }
  };
};


export const getBackgroundAbilityOptions = (item?: StoredCompendiumItem): AbilityScore[] => {
  const configured = backgroundSuggestions(item).abilityOptions;
  return configured.length ? configured : [...ALL_BACKGROUND_ABILITY_OPTIONS];
};

export const speciesHasIgnoredAbilityScoreIncrease = (item?: StoredCompendiumItem): boolean => {
  if (!item || item.type !== 'species') return false;
  const payload = asRecord(item.normalizedJson);
  return payload.abilityScoreIncreaseRule !== undefined || payload.abilityScoreIncrease !== undefined;
};

export const classProficiencies = (item: StoredCompendiumItem): CharacterProficiencies => {
  const payload = asRecord(item.normalizedJson);
  return {
    skills: asStringArray(payload.skillProficiencies),
    expertiseSkills: [],
    tools: asStringArray(payload.toolProficiencies),
    weapons: asStringArray(payload.weaponProficiencies),
    armor: asStringArray(payload.armorTraining ?? payload.armorProficiencies),
    languages: asStringArray(payload.languages),
    savingThrows: asAbilities(payload.savingThrowProficiencies)
  };
};

export const suggestedProficienciesForItems = (items: StoredCompendiumItem[]): CharacterProficiencies =>
  items.reduce((result, item) => item.type === 'background' ? mergeProficiencies(result, backgroundSuggestions(item).proficiencies) : item.type === 'class' ? mergeProficiencies(result, classProficiencies(item)) : result, emptyCharacterProficiencies());

export const featCategory = (item: StoredCompendiumItem): string => {
  const payload = asRecord(item.normalizedJson);
  return (asString(payload.category) ?? asString(payload.featCategory) ?? asString(payload.type) ?? '').toLowerCase();
};

export const isOriginFeatItem = (item: StoredCompendiumItem): boolean =>
  item.type === 'feat' && (featCategory(item).includes('origin') || item.tags.some((tag) => tag.toLowerCase().includes('origin')) || /origin feat/i.test(item.summary ?? ''));

export const getSelectableFeatCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => {
  const enabledSources = new Set(enabledSourceIds);
  return items
    .filter((item) => item.type === 'feat' && item.status !== 'disabled')
    .filter((item) => enabledSources.has(item.sourceId))
    .sort((left, right) => left.name.localeCompare(right.name));
};


export const getSelectableSpellCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): StoredCompendiumItem[] => {
  const enabledSources = new Set(enabledSourceIds);
  return items
    .filter((item) => item.type === 'spell' && item.status !== 'disabled')
    .filter((item) => enabledSources.has(item.sourceId))
    .sort((left, right) => {
      const leftLevel = Number(asRecord(left.normalizedJson).level ?? 0);
      const rightLevel = Number(asRecord(right.normalizedJson).level ?? 0);
      return leftLevel - rightLevel || left.name.localeCompare(right.name);
    });
};

export const getCompendiumChoiceDescription = (
  item: StoredCompendiumItem
): string => {
  const payload = asRecord(item.normalizedJson);
  const description = (
    invocationDescription(item) ??
    asString(payload.description) ??
    asString(payload.summary) ??
    asString(item.summary) ??
    'Descrição resumida indisponível. Consulte os detalhes do item no compêndio.'
  );
  const metadata = asRecord(payload.__characterChoice);
  const provenance = asRecord(metadata.provenance);
  const origin = asString(metadata.origin);
  const source = asString(provenance.sourceBookId) ?? asString(provenance.sourceId) ?? item.sourceId;
  const review = metadata.manualReviewRequired === true ? ' · revisão editorial' : '';
  const originLabel = origin === 'catalog' ? 'Oficial' : origin === 'compendium' ? 'Local/homebrew' : undefined;
  return originLabel ? `${description}
${originLabel} · ${source}${review}` : description;
};
