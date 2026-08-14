import type { Character, RuleSource } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { createEmptyCharacter } from '../data/mockData';
import { backgroundSuggestions, getSelectableFeatCandidates, getSelectableSpellCandidates, isOriginFeatItem } from '../characters/creationData';
import { getClassProficiencyRequirement, buildProficiencySelection } from '../characters/proficiencyRules';
import { getStartingEquipmentOptions, createEquipmentSelection, applyStartingEquipmentSelections } from '../characters/startingEquipmentRules';
import {
  CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER,
  ensureCustomBackgroundCashEquipmentSelection,
  getCustomBackgroundEquipmentCandidates,
  getCustomBackgroundEquipmentSpentCopper,
  setCustomBackgroundEquipmentPurchaseCount,
  validateCustomBackgroundEquipmentSelection
} from '../characters/customBackgroundRules';
import { getFeatChoiceSchema } from '../characters/featChoiceRules';
import { getClassSpellcastingProfile, isSpellItemEligibleForProfile, validateSpellAssignments } from '../characters/spellcastingRules';
import { getProgressionFeatureReferences } from '../compendium/classProgression';
import { getEldritchInvocationLimit, getEligibleEldritchInvocations, getSelectableEldritchInvocations } from '../characters/eldritchInvocationRules';
import { getPactChainFamiliarCandidates } from '../characters/eldritchInvocationChoiceRules';
import { buildPactChainCompanion } from '../characters/pactChainCompanionRules';
import { applyCompendiumItemToCharacter, buildWeaponFromCompendiumItem } from '../compendium/mapper';

interface RawItem {
  id: string;
  kind: StoredCompendiumItem['type'];
  name: string;
  summary?: string;
  source: RuleSource;
  payload: Record<string, unknown>;
}
interface RawPack { id: string; source: RuleSource; items: RawItem[]; }

const v1Pack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v5-complete-invocations.json') as RawPack;
const v2Pack = require('../../assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json') as RawPack;
const importedAt = '2026-08-11T10:00:00.000Z';

const toStored = (pack: RawPack): StoredCompendiumItem[] => pack.items.map((item) => ({
  id: `${pack.id}:${item.id}`,
  importItemId: item.id,
  packId: pack.id,
  sourceId: item.source.id,
  type: item.kind,
  name: item.name,
  summary: item.summary,
  version: item.source.version,
  rawJson: item,
  normalizedJson: {
    ...item.payload,
    id: item.id,
    name: item.name,
    type: item.kind,
    sourceId: item.source.id,
    sourceStatus: item.source.status,
    sourceConfidence: item.source.confidence,
    requiresReview: false
  },
  tags: [item.kind, item.name.toLowerCase(), ...(Array.isArray(item.payload.tags) ? item.payload.tags.filter((tag): tag is string => typeof tag === 'string') : [])],
  status: 'validated',
  reviewDecision: 'approved',
  createdAt: importedAt,
  updatedAt: importedAt
}));

const v1Items = toStored(v1Pack);
const v2Items = toStored(v2Pack);
const enabled = (items: StoredCompendiumItem[]) => Array.from(new Set(items.map((item) => item.sourceId)));
const find = (items: StoredCompendiumItem[], id: string) => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};
const ids = (items: StoredCompendiumItem[]) => items.map((item) => item.importItemId).sort();
const optionShape = (options: ReturnType<typeof getStartingEquipmentOptions>) => options.map((option) => ({
  optionId: option.optionId,
  labels: option.labels,
  goldPieces: option.goldPieces
}));
const characterForWeapon = (): Character => ({
  ...createEmptyCharacter('Parity'),
  abilities: { STR: 10, DEX: 18, CON: 14, INT: 12, WIS: 12, CHA: 16 }
});


const representativeBuildShape = (items: StoredCompendiumItem[]) => {
  let character = createEmptyCharacter('Representative PHB Build');
  for (const itemId of [
    'phb-2024-class-warlock',
    'phb-2024-species-human',
    'phb-2024-background-criminal',
    'phb-2024-feat-alert',
    'phb-2024-spell-eldritch-blast'
  ]) {
    const result = applyCompendiumItemToCharacter(character, find(items, itemId));
    if (!result.ok) throw new Error(`Não foi possível aplicar ${itemId}: ${result.issues.map((entry) => entry.code).join(', ')}`);
    character = result.character;
  }

  const warlock = find(items, 'phb-2024-class-warlock');
  const criminal = find(items, 'phb-2024-background-criminal');
  const equipmentOption = getStartingEquipmentOptions(warlock, 'class')[0];
  if (!equipmentOption) throw new Error('Warlock sem equipamento inicial na fixture.');
  character = applyStartingEquipmentSelections(character, [createEquipmentSelection(equipmentOption, items)], items);

  const proficiencySelection = buildProficiencySelection({
    startingClassItem: warlock,
    backgroundItem: criminal,
    allItems: items,
    classSkillChoices: ['Arcana', 'Deception'],
    classToolChoices: [],
    expertiseSkills: []
  });
  if (!proficiencySelection.ok) throw new Error(`Proficiências inválidas: ${proficiencySelection.issues.map((entry) => entry.code).join(', ')}`);

  return {
    level: character.level,
    classes: character.classes.map((entry) => ({ name: entry.name, level: entry.level, hitDie: entry.hitDie })),
    species: character.species?.name,
    background: character.background?.name,
    feats: character.feats.map((entry) => entry.name).sort(),
    spells: character.spells.map((entry) => ({ name: entry.name, level: entry.level, castingTime: entry.castingTime })).sort((left, right) => left.name.localeCompare(right.name)),
    weapons: character.weapons.map((entry) => ({ name: entry.name, attackAbility: entry.attackAbility, damageAbility: entry.damageAbility, damage: entry.damage.raw })).sort((left, right) => left.name.localeCompare(right.name)),
    armors: (character.armors ?? []).map((entry) => entry.name).sort(),
    armorAccessories: (character.armorAccessories ?? []).map((entry) => entry.name).sort(),
    equipment: character.equipment.map((entry) => ({ name: entry.name, quantity: entry.quantity })).sort((left, right) => left.name.localeCompare(right.name)),
    currency: character.currency,
    proficiencies: proficiencySelection.proficiencies
  };
};

const applyOne = (items: StoredCompendiumItem[], itemId: string) => {
  const result = applyCompendiumItemToCharacter(createEmptyCharacter('Parity'), find(items, itemId));
  expect(result.ok).toBe(true);
  return result.character;
};

describe('PHB 2024 V1 × canonical V2 functional parity', () => {
  it('preserves creation-facing feat and spell candidates', () => {
    expect(ids(getSelectableFeatCandidates(v2Items, enabled(v2Items)))).toEqual(ids(getSelectableFeatCandidates(v1Items, enabled(v1Items))));
    expect(ids(getSelectableSpellCandidates(v2Items, enabled(v2Items)))).toEqual(ids(getSelectableSpellCandidates(v1Items, enabled(v1Items))));

    const v1Origin = getSelectableFeatCandidates(v1Items, enabled(v1Items)).filter(isOriginFeatItem);
    const v2Origin = getSelectableFeatCandidates(v2Items, enabled(v2Items)).filter(isOriginFeatItem);
    expect(ids(v2Origin)).toEqual(ids(v1Origin));
    expect(v2Origin.length).toBeGreaterThan(0);
  });

  it('assembles a representative level-1 character from canonical V2 with the same gameplay state as V1', () => {
    const v1Build = representativeBuildShape(v1Items);
    const v2Build = representativeBuildShape(v2Items);
    expect(v2Build).toEqual(v1Build);
    expect(v2Build).toMatchObject({
      level: 1,
      species: 'Human',
      background: 'Criminal',
      classes: [{ name: 'Warlock', level: 1, hitDie: 8 }]
    });
    expect(v2Build.feats).toContain('Alert');
    expect(v2Build.spells.map((entry) => entry.name)).toContain('Eldritch Blast');
    expect(v2Build.proficiencies.skills).toEqual(expect.arrayContaining(['Arcana', 'Deception', 'Sleight of Hand', 'Stealth']));
  });

  it('preserves background suggestions and class/background proficiency behavior', () => {
    const criminalV1 = find(v1Items, 'phb-2024-background-criminal');
    const criminalV2 = find(v2Items, 'phb-2024-background-criminal');
    expect(backgroundSuggestions(criminalV2)).toEqual(backgroundSuggestions(criminalV1));
    expect(backgroundSuggestions(criminalV2)).toMatchObject({
      abilityOptions: ['DEX', 'CON', 'INT'],
      proficiencies: { skills: ['Sleight of Hand', 'Stealth'], tools: ["Thieves' Tools"] }
    });

    const warlockV1 = find(v1Items, 'phb-2024-class-warlock');
    const warlockV2 = find(v2Items, 'phb-2024-class-warlock');
    expect(getClassProficiencyRequirement(warlockV2, 1, v2Items)).toEqual(getClassProficiencyRequirement(warlockV1, 1, v1Items));

    const selectionV1 = buildProficiencySelection({
      startingClassItem: warlockV1,
      backgroundItem: criminalV1,
      allItems: v1Items,
      classSkillChoices: ['Arcana', 'Deception'],
      classToolChoices: [],
      expertiseSkills: []
    });
    const selectionV2 = buildProficiencySelection({
      startingClassItem: warlockV2,
      backgroundItem: criminalV2,
      allItems: v2Items,
      classSkillChoices: ['Arcana', 'Deception'],
      classToolChoices: [],
      expertiseSkills: []
    });
    expect(selectionV2.ok).toBe(true);
    expect(selectionV2.proficiencies).toEqual(selectionV1.proficiencies);
  });

  it('preserves class and background starting equipment after structured V2 normalization', () => {
    for (const [id, kind] of [
      ['phb-2024-class-warlock', 'class'],
      ['phb-2024-class-fighter', 'class'],
      ['phb-2024-background-criminal', 'background']
    ] as const) {
      const v1Options = getStartingEquipmentOptions(find(v1Items, id), kind);
      const v2Options = getStartingEquipmentOptions(find(v2Items, id), kind);
      expect(optionShape(v2Options)).toEqual(optionShape(v1Options));
      expect(v2Options.length).toBeGreaterThan(0);
      const firstSelection = createEquipmentSelection(v2Options[0]!, v2Items);
      expect(firstSelection.labels).toEqual(v2Options[0]!.labels);
    }
  });

  it('keeps all eligible custom-background equipment and simple-weapon pricing equivalent', () => {
    const v1 = getCustomBackgroundEquipmentCandidates(v1Items, enabled(v1Items));
    const v2 = getCustomBackgroundEquipmentCandidates(v2Items, enabled(v2Items));
    const shape = (entries: typeof v1) => entries.map((entry) => ({ id: entry.item.importItemId, costCopper: entry.costCopper, purchaseQuantity: entry.purchaseQuantity }));
    expect(shape(v2)).toEqual(shape(v1));
    expect(v2.find((entry) => entry.item.importItemId === 'phb-2024-weapon-spear')?.costCopper).toBe(100);
    expect(v2.some((entry) => entry.item.importItemId === 'phb-2024-weapon-longsword')).toBe(false);
  });

  it('preserves the custom-background 50 GP budget and rejects purchases beyond the budget', () => {
    const candidates = getCustomBackgroundEquipmentCandidates(v2Items, enabled(v2Items));
    const spear = candidates.find((entry) => entry.item.importItemId === 'phb-2024-weapon-spear');
    expect(spear).toBeDefined();
    let selections = ensureCustomBackgroundCashEquipmentSelection([]);
    expect(getCustomBackgroundEquipmentSpentCopper(selections, candidates)).toBe(0);
    expect(validateCustomBackgroundEquipmentSelection(selections, candidates)).toEqual([]);

    selections = setCustomBackgroundEquipmentPurchaseCount(selections, spear!, 1, candidates);
    expect(getCustomBackgroundEquipmentSpentCopper(selections, candidates)).toBe(100);
    expect(selections.find((entry) => entry.sourceItemId === 'custom-background')?.currency?.gp).toBe(49);

    const beforeOverflow = selections;
    selections = setCustomBackgroundEquipmentPurchaseCount(selections, spear!, 51, candidates);
    expect(selections).toBe(beforeOverflow);
    expect(getCustomBackgroundEquipmentSpentCopper(selections, candidates)).toBeLessThanOrEqual(CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER);
  });

  it('preserves Origin Feat internal choice schemas', () => {
    for (const featId of ['phb-2024-feat-alert', 'phb-2024-feat-musician', 'phb-2024-feat-magic-initiate']) {
      expect(getFeatChoiceSchema(find(v2Items, featId))).toEqual(getFeatChoiceSchema(find(v1Items, featId)));
    }
    const musician = getFeatChoiceSchema(find(v2Items, 'phb-2024-feat-musician'));
    expect(musician.toolChoiceCount).toBe(3);
    expect(musician.toolOptions.length).toBeGreaterThan(3);
  });

  it('preserves Wizard and Warlock spellcasting profiles, eligibility, and deferred selection validation', () => {
    for (const [classId, level] of [
      ['phb-2024-class-wizard', 1],
      ['phb-2024-class-wizard', 7],
      ['phb-2024-class-warlock', 1],
      ['phb-2024-class-warlock', 7]
    ] as const) {
      const v1Profile = getClassSpellcastingProfile(find(v1Items, classId), level);
      const v2Profile = getClassSpellcastingProfile(find(v2Items, classId), level);
      expect(v2Profile).toEqual(v1Profile);
      expect(v2Profile).toBeDefined();
    }

    const wizardV1 = getClassSpellcastingProfile(find(v1Items, 'phb-2024-class-wizard'), 1)!;
    const wizardV2 = getClassSpellcastingProfile(find(v2Items, 'phb-2024-class-wizard'), 1)!;
    const eligibleV1 = v1Items.filter((item) => isSpellItemEligibleForProfile(item, wizardV1));
    const eligibleV2 = v2Items.filter((item) => isSpellItemEligibleForProfile(item, wizardV2));
    expect(ids(eligibleV2)).toEqual(ids(eligibleV1));

    const fireBoltV1 = find(v1Items, 'phb-2024-spell-fire-bolt');
    const fireBoltV2 = find(v2Items, 'phb-2024-spell-fire-bolt');
    const partialV1 = validateSpellAssignments({ assignments: { [fireBoltV1.id]: wizardV1.classItemId }, spellItems: v1Items, profiles: [wizardV1], requireExact: false });
    const partialV2 = validateSpellAssignments({ assignments: { [fireBoltV2.id]: wizardV2.classItemId }, spellItems: v2Items, profiles: [wizardV2], requireExact: false });
    expect(partialV2.ok).toBe(true);
    expect(partialV2.countsByClassItemId[wizardV2.classItemId]).toEqual(partialV1.countsByClassItemId[wizardV1.classItemId]);
  });

  it('maps V2 casting-time objects to the canonical runtime action economy', () => {
    for (const [spellId, expected, compareLegacy] of [
      ['phb-2024-spell-fire-bolt', 'action', true],
      ['phb-2024-spell-misty-step', 'bonusAction', true],
      ['phb-2024-spell-counterspell', 'reaction', true],
      // V1 stores Shield as the trigger alias "reactionOnHitOrMagicMissile".
      // V2 intentionally promotes that alias to the canonical actionCost "reaction".
      ['phb-2024-spell-shield', 'reaction', false]
    ] as const) {
      const v2Spell = applyOne(v2Items, spellId).spells.at(-1);
      expect(v2Spell?.castingTime).toBe(expected);
      if (compareLegacy) {
        const v1Spell = applyOne(v1Items, spellId).spells.at(-1);
        expect(v2Spell?.castingTime).toBe(v1Spell?.castingTime);
      }
    }
  });

  it('preserves flexible weapon ability resolution after AbilityReference normalization', () => {
    const daggerV1 = buildWeaponFromCompendiumItem(characterForWeapon(), find(v1Items, 'phb-2024-weapon-dagger')).weapon;
    const daggerV2 = buildWeaponFromCompendiumItem(characterForWeapon(), find(v2Items, 'phb-2024-weapon-dagger')).weapon;
    expect(daggerV2.attackAbility).toBe('DEX');
    expect(daggerV2.damageAbility).toBe('DEX');
    expect({ attack: daggerV2.attackAbility, damage: daggerV2.damageAbility, raw: daggerV2.damage.raw }).toEqual({
      attack: daggerV1.attackAbility,
      damage: daggerV1.damageAbility,
      raw: daggerV1.damage.raw
    });
  });

  it('preserves Warlock progression, invocation limits, eligible invocations, and Pact Chain familiars', () => {
    const warlockV1 = find(v1Items, 'phb-2024-class-warlock');
    const warlockV2 = find(v2Items, 'phb-2024-class-warlock');
    for (const level of [1, 3, 5, 7, 10, 20]) {
      expect(getProgressionFeatureReferences(warlockV2, level)).toEqual(getProgressionFeatureReferences(warlockV1, level));
    }

    const entriesV1 = [{ item: warlockV1, level: 3 }];
    const entriesV2 = [{ item: warlockV2, level: 3 }];
    expect(getEldritchInvocationLimit(3, entriesV2, v2Items)).toBe(getEldritchInvocationLimit(3, entriesV1, v1Items));
    expect(ids(getSelectableEldritchInvocations(v2Items, enabled(v2Items)))).toEqual(ids(getSelectableEldritchInvocations(v1Items, enabled(v1Items))));
    expect(ids(getEligibleEldritchInvocations(v2Items, enabled(v2Items), 3))).toEqual(ids(getEligibleEldritchInvocations(v1Items, enabled(v1Items), 3)));
    const eligible = ids(getEligibleEldritchInvocations(v2Items, enabled(v2Items), 3));
    expect(eligible).toEqual(expect.arrayContaining([
      'phb-2024-feature-warlock-eldritch-mind',
      'phb-2024-feature-warlock-pact-of-the-blade',
      'phb-2024-feature-warlock-pact-of-the-chain'
    ]));

    const familiarV1 = getPactChainFamiliarCandidates(v1Items, enabled(v1Items));
    const familiarV2 = getPactChainFamiliarCandidates(v2Items, enabled(v2Items));
    expect(familiarV2.map((entry) => [entry.item.importItemId, entry.variant])).toEqual(familiarV1.map((entry) => [entry.item.importItemId, entry.variant]));
  });

  it('preserves companion stat-block runtime behavior, including canonical structured speeds', () => {
    const impV1 = find(v1Items, 'phb-2024-creature-imp');
    const impV2 = find(v2Items, 'phb-2024-creature-imp');
    const character = characterForWeapon();
    const base = { character, invocationItemId: find(v2Items, 'phb-2024-feature-warlock-pact-of-the-chain').id, variant: 'special' as const, investmentActive: false };
    const c1 = buildPactChainCompanion({ ...base, creatureItem: impV1 });
    const c2 = buildPactChainCompanion({ ...base, creatureItem: impV2 });
    expect({ ac: c2.armorClass, hp: c2.hitPoints.max, speed: c2.speed, actions: c2.actions.map((entry) => entry.name) }).toEqual({
      ac: c1.armorClass,
      hp: c1.hitPoints.max,
      speed: c1.speed,
      actions: c1.actions.map((entry) => entry.name)
    });

    const conditional = find(v2Items, 'phb-2024-creature-bestial-spirit');
    const payload = conditional.normalizedJson as Record<string, unknown>;
    const fly = (payload.speed as Record<string, unknown> | undefined)?.fly as Record<string, unknown> | undefined;
    if (fly && typeof fly.value === 'number') {
      const companion = buildPactChainCompanion({ ...base, creatureItem: conditional, variant: 'standard' });
      expect(companion.speed.fly).toBe(fly.value);
    }
  });

  it('preserves representative resources, granted actions, effects, and creature candidate tags', () => {
    const innateV1 = applyOne(v1Items, 'phb-2024-feature-sorcerer-innate-sorcery');
    const innateV2 = applyOne(v2Items, 'phb-2024-feature-sorcerer-innate-sorcery');
    expect(innateV2.resources.map(({ id, max, recharge }) => ({ id, max, recharge }))).toEqual(innateV1.resources.map(({ id, max, recharge }) => ({ id, max, recharge })));

    const surgeV1 = applyOne(v1Items, 'phb-2024-feature-fighter-action-surge');
    const surgeV2 = applyOne(v2Items, 'phb-2024-feature-fighter-action-surge');
    expect(surgeV2.features.at(-1)?.grantsActions?.map((action) => [action.name, action.actionCost])).toEqual(surgeV1.features.at(-1)?.grantsActions?.map((action) => [action.name, action.actionCost]));

    const rageV1 = applyOne(v1Items, 'phb-2024-feature-barbarian-rage');
    const rageV2 = applyOne(v2Items, 'phb-2024-feature-barbarian-rage');
    const effectShape = (effects: NonNullable<typeof rageV2.features[number]['effectTemplates']> | undefined) => (effects ?? []).map(({ source: _source, ...gameplay }) => gameplay);
    expect(effectShape(rageV2.features.at(-1)?.effectTemplates)).toEqual(effectShape(rageV1.features.at(-1)?.effectTemplates));

    const tagIds = (items: StoredCompendiumItem[], tag: string) => items
      .filter((item) => item.type === 'creatureStatBlock' && Array.isArray(item.normalizedJson.tags) && (item.normalizedJson.tags as unknown[]).includes(tag))
      .map((item) => item.importItemId)
      .sort();
    expect(tagIds(v2Items, 'wild-shape-candidate')).toEqual(tagIds(v1Items, 'wild-shape-candidate'));
    expect(tagIds(v2Items, 'find-familiar-form')).toEqual(tagIds(v1Items, 'find-familiar-form'));
    expect(tagIds(v2Items, 'wild-shape-candidate')).toEqual(expect.arrayContaining(['phb-2024-creature-wolf', 'phb-2024-creature-dire-wolf']));
    expect(tagIds(v2Items, 'find-familiar-form')).toContain('phb-2024-creature-owl');
  });
});
