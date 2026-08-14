import type {
  AbilityScore,
  Character,
  CharacterAction,
  CharacterProficiencies,
  CustomCharacterModifierRule,
  CustomModifierTarget,
  CustomProficiencyKind
} from '../types';
import { getCharacterRuleFeatures, type CharacterRuleFeatureBinding } from './customRuleEffects';

const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));
const ABILITIES: AbilityScore[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const abilitySet = new Set<string>(ABILITIES);

export interface CustomModifierContext {
  action?: CharacterAction;
  ability?: AbilityScore;
  skill?: string;
  tool?: string;
  spellItemId?: string;
  spellName?: string;
  spellSchool?: string;
  damageTypes?: string[];
  actionType?: 'attack' | 'spell';
  proficiencyKind?: CustomProficiencyKind;
  proficiencyValue?: string;
}

export interface CustomModifierBinding {
  binding: CharacterRuleFeatureBinding;
  rule: CustomCharacterModifierRule;
}

const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);
const proficiencyBonus = (character: Character): number => {
  if (character.proficiencyBonusOverride !== undefined) return character.proficiencyBonusOverride;
  const totalLevel = character.classes.reduce((sum, entry) => sum + entry.level, 0) || character.level || 1;
  return 2 + Math.floor((Math.max(1, totalLevel) - 1) / 4);
};

const contextForAction = (action: CharacterAction, extra: CustomModifierContext = {}): CustomModifierContext => ({
  ...extra,
  action,
  actionType: action.type,
  spellItemId: extra.spellItemId ?? action.origin?.itemId,
  spellName: extra.spellName ?? action.name,
  spellSchool: extra.spellSchool ?? (action.type === 'spell' ? action.spellSchool : undefined),
  damageTypes: extra.damageTypes ?? Array.from(new Set([
    ...(action.damageTypes ?? []),
    ...(action.tags ?? []).filter((tag) => tag.toLowerCase().startsWith('damage-type:')).map((tag) => tag.slice('damage-type:'.length))
  ]))
});

const matchesAny = (actual: string | undefined, expected: string[] | undefined): boolean =>
  !expected?.length || Boolean(actual && expected.some((entry) => normalize(entry) === normalize(actual)));

const matchesMany = (actual: string[] | undefined, expected: string[] | undefined): boolean =>
  !expected?.length || Boolean(actual?.some((entry) => expected.some((candidate) => normalize(candidate) === normalize(entry))));

export const customModifierRuleMatches = (
  rule: CustomCharacterModifierRule,
  context: CustomModifierContext
): boolean => {
  const selector = rule.selector;
  if (!selector) return true;
  if (!matchesAny(context.skill, selector.skills)) return false;
  if (!matchesAny(context.tool, selector.tools)) return false;
  if (selector.abilities?.length && (!context.ability || !selector.abilities.includes(context.ability))) return false;
  if (!matchesAny(context.spellItemId, selector.spellItemIds)) return false;
  if (!matchesAny(context.spellName, selector.spellNames)) return false;
  if (!matchesMany(context.damageTypes, selector.damageTypes)) return false;
  if (!matchesAny(context.spellSchool, selector.spellSchools)) return false;
  if (selector.actionTypes?.length && (!context.actionType || !selector.actionTypes.includes(context.actionType))) return false;
  if (selector.proficiencyKind && selector.proficiencyKind !== context.proficiencyKind) return false;
  if (!matchesAny(context.proficiencyValue, selector.proficiencyValues)) return false;
  return true;
};

export const getCustomModifierBindings = (
  character: Character,
  targets: CustomModifierTarget | CustomModifierTarget[],
  context: CustomModifierContext = {}
): CustomModifierBinding[] => {
  const targetSet = new Set(Array.isArray(targets) ? targets : [targets]);
  const resolvedContext = context.action ? contextForAction(context.action, context) : context;
  return getCharacterRuleFeatures(character).flatMap((binding) =>
    (binding.feature.customRules?.modifiers ?? [])
      .filter((rule) => targetSet.has(rule.target) && customModifierRuleMatches(rule, resolvedContext))
      .map((rule) => ({ binding, rule }))
  );
};

export const customModifierValue = (
  character: Character,
  rule: CustomCharacterModifierRule,
  context: CustomModifierContext = {}
): number => {
  const value = rule.value ?? {};
  const ability = value.ability ?? context.ability;
  const abilityPart = ability ? abilityModifier(character.abilities[ability]) * (value.abilityModifierMultiplier ?? 0) : 0;
  return (value.flat ?? 0) + proficiencyBonus(character) * (value.proficiencyBonusMultiplier ?? 0) + abilityPart;
};

export interface CustomNumericModifierResolution {
  add: number;
  multiplier: number;
  rules: CustomModifierBinding[];
}

export const resolveCustomNumericModifiers = (
  character: Character,
  targets: CustomModifierTarget | CustomModifierTarget[],
  context: CustomModifierContext = {}
): CustomNumericModifierResolution => {
  const rules = getCustomModifierBindings(character, targets, context);
  let add = 0;
  let multiplier = 1;
  for (const entry of rules) {
    if (entry.rule.operation === 'add') add += customModifierValue(character, entry.rule, context);
    if (entry.rule.operation === 'multiply') {
      const raw = entry.rule.value?.multiplier ?? entry.rule.value?.flat ?? 1;
      if (Number.isFinite(raw)) multiplier *= raw;
    }
  }
  return { add, multiplier, rules };
};

export type CustomRollMode = 'normal' | 'advantage' | 'disadvantage';
export interface CustomRollModifierResolution extends CustomNumericModifierResolution {
  rollMode: CustomRollMode;
}

export const resolveCustomRollModifiers = (
  character: Character,
  targets: CustomModifierTarget | CustomModifierTarget[],
  context: CustomModifierContext = {}
): CustomRollModifierResolution => {
  const numeric = resolveCustomNumericModifiers(character, targets, context);
  const rules = getCustomModifierBindings(character, targets, context);
  const advantage = rules.some((entry) => entry.rule.operation === 'advantage');
  const disadvantage = rules.some((entry) => entry.rule.operation === 'disadvantage');
  return { ...numeric, rules, rollMode: advantage === disadvantage ? 'normal' : advantage ? 'advantage' : 'disadvantage' };
};

const proficiencyArray = (proficiencies: CharacterProficiencies, kind: CustomProficiencyKind): string[] => {
  if (kind === 'skill') return proficiencies.skills;
  if (kind === 'tool') return proficiencies.tools;
  if (kind === 'weapon') return proficiencies.weapons;
  if (kind === 'armor') return proficiencies.armor;
  if (kind === 'language') return proficiencies.languages;
  return proficiencies.savingThrows;
};

const setProficiencyArray = (
  proficiencies: CharacterProficiencies,
  kind: CustomProficiencyKind,
  values: string[]
): CharacterProficiencies => {
  if (kind === 'skill') return { ...proficiencies, skills: values };
  if (kind === 'tool') return { ...proficiencies, tools: values };
  if (kind === 'weapon') return { ...proficiencies, weapons: values };
  if (kind === 'armor') return { ...proficiencies, armor: values };
  if (kind === 'language') return { ...proficiencies, languages: values };
  return { ...proficiencies, savingThrows: values.filter((value): value is AbilityScore => abilitySet.has(value)) };
};

export interface CustomCheckResolution {
  bonus: number;
  rollMode: CustomRollMode;
  rules: CustomModifierBinding[];
}

export const resolveCharacterCheck = (
  character: Character,
  target: 'abilityCheck' | 'skillCheck' | 'toolCheck' | 'savingThrow' | 'attackRoll' | 'spellAttackRoll',
  baseBonus: number,
  context: CustomModifierContext = {}
): CustomCheckResolution => {
  const targets: CustomModifierTarget[] = target === 'skillCheck' || target === 'toolCheck'
    ? ['abilityCheck', target]
    : target === 'spellAttackRoll'
      ? ['attackRoll', 'spellAttackRoll']
      : [target];
  const resolved = resolveCustomRollModifiers(character, targets, context);
  return {
    bonus: Math.floor((baseBonus + resolved.add) * resolved.multiplier),
    rollMode: resolved.rollMode,
    rules: resolved.rules
  };
};

export const applyCustomProficiencyModifiers = (character: Character): Character => {
  let proficiencies = { ...character.proficiencies };
  // For proficiency mutations, proficiencyKind/proficiencyValues describe the mutation target itself.
  // They must not be evaluated as contextual filters before the grant/remove can run.
  const bindings: CustomModifierBinding[] = getCharacterRuleFeatures(character).flatMap((binding) =>
    (binding.feature.customRules?.modifiers ?? [])
      .filter((rule) => rule.target === 'proficiency')
      .map((rule) => ({ binding, rule }))
  );
  for (const { rule } of bindings) {
    const kind = rule.selector?.proficiencyKind;
    const values = rule.selector?.proficiencyValues ?? [];
    if (!kind || !values.length) continue;
    const current = proficiencyArray(proficiencies, kind);
    if (rule.operation === 'grantProficiency') proficiencies = setProficiencyArray(proficiencies, kind, unique([...current, ...values]));
    if (rule.operation === 'removeProficiency') {
      const denied = new Set(values.map(normalize));
      proficiencies = setProficiencyArray(proficiencies, kind, current.filter((value) => !denied.has(normalize(value))));
    }
  }
  proficiencies = {
    ...proficiencies,
    expertiseSkills: proficiencies.expertiseSkills.filter((skill) => proficiencies.skills.some((entry) => normalize(entry) === normalize(skill)))
  };
  return { ...character, proficiencies };
};

export const describeCustomModifier = (rule: CustomCharacterModifierRule): string => {
  const selector = rule.selector ?? {};
  const filters = [
    selector.skills?.length ? `perícias: ${selector.skills.join(', ')}` : undefined,
    selector.tools?.length ? `ferramentas: ${selector.tools.join(', ')}` : undefined,
    selector.abilities?.length ? `atributos: ${selector.abilities.join(', ')}` : undefined,
    selector.spellNames?.length ? `magias: ${selector.spellNames.join(', ')}` : undefined,
    selector.damageTypes?.length ? `dano: ${selector.damageTypes.join(', ')}` : undefined,
    selector.spellSchools?.length ? `escolas: ${selector.spellSchools.join(', ')}` : undefined,
    selector.proficiencyKind ? `${selector.proficiencyKind}: ${(selector.proficiencyValues ?? []).join(', ')}` : undefined
  ].filter(Boolean).join(' · ');
  const value = rule.value ?? {};
  const parts = [
    value.flat ? `${value.flat >= 0 ? '+' : ''}${value.flat}` : undefined,
    value.proficiencyBonusMultiplier ? `${value.proficiencyBonusMultiplier >= 0 ? '+' : ''}${value.proficiencyBonusMultiplier}×PB` : undefined,
    value.abilityModifierMultiplier ? `${value.abilityModifierMultiplier >= 0 ? '+' : ''}${value.abilityModifierMultiplier}×${value.ability ?? 'atributo'}` : undefined,
    value.multiplier !== undefined ? `×${value.multiplier}` : undefined
  ].filter(Boolean).join(' ');
  return `${rule.label ?? rule.target}: ${rule.operation}${parts ? ` ${parts}` : ''}${filters ? ` · ${filters}` : ''}`;
};
