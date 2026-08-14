import type {
  Character,
  CharacterAction,
  CustomDamageMultiplierRule,
  CustomSpellListAdditionRule,
  CustomSpellReplacementRule,
  CustomTriggeredDamageRule,
  Feature,
  ResourcePool,
  RuleSource
} from '../types';

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

export const customRuleSource = (notes?: string): RuleSource => ({
  id: 'manual-homebrew',
  book: 'Homebrew',
  version: 'custom',
  status: 'active',
  confidence: 'manual',
  notes: notes ?? 'Regra personalizada criada diretamente na ficha.'
});

export interface CharacterRuleFeatureBinding {
  feature: Feature;
  ownerKind: 'feature' | 'feat' | 'species' | 'background';
  ownerId?: string;
  ownerName: string;
}

export const getCharacterRuleFeatures = (character: Character): CharacterRuleFeatureBinding[] => [
  ...(character.features ?? []).map((feature) => ({
    feature,
    ownerKind: 'feature' as const,
    ownerId: feature.id,
    ownerName: feature.name
  })),
  ...(character.feats ?? []).flatMap((feat) => (feat.features ?? []).map((feature) => ({
    feature,
    ownerKind: 'feat' as const,
    ownerId: feat.id,
    ownerName: feat.name
  }))),
  ...(character.species?.features ?? []).map((feature) => ({
    feature,
    ownerKind: 'species' as const,
    ownerId: character.species?.id,
    ownerName: character.species?.name ?? 'Espécie'
  })),
  ...(character.background?.features ?? []).map((feature) => ({
    feature,
    ownerKind: 'background' as const,
    ownerId: character.background?.id,
    ownerName: character.background?.name ?? 'Background'
  }))
];

export const actionDamageTypes = (action: CharacterAction): string[] => {
  const explicit = action.damageTypes ?? [];
  const tags = (action.tags ?? [])
    .filter((tag) => tag.toLowerCase().startsWith('damage-type:'))
    .map((tag) => tag.slice('damage-type:'.length));
  return Array.from(new Set([...explicit, ...tags].map(normalize).filter(Boolean)));
};

export interface CustomDamageMultiplierResolution {
  multiplier: number;
  rules: Array<{ binding: CharacterRuleFeatureBinding; rule: CustomDamageMultiplierRule }>;
}

export const resolveCustomDamageMultiplier = (
  character: Character,
  action: CharacterAction
): CustomDamageMultiplierResolution => {
  const damageTypes = new Set(actionDamageTypes(action));
  const rules = getCharacterRuleFeatures(character).flatMap((binding) =>
    (binding.feature.customRules?.damageMultipliers ?? [])
      .filter((rule) => damageTypes.has(normalize(rule.damageType)))
      .map((rule) => ({ binding, rule }))
  );
  const multiplier = rules.reduce((result, entry) => result * Math.max(0, Number(entry.rule.multiplier) || 1), 1);
  return { multiplier, rules };
};

export const resolveTriggeredDamageRules = (
  character: Character,
  action: CharacterAction
): Array<{ binding: CharacterRuleFeatureBinding; rule: CustomTriggeredDamageRule }> => {
  const damageTypes = new Set(actionDamageTypes(action));
  return getCharacterRuleFeatures(character).flatMap((binding) =>
    (binding.feature.customRules?.triggeredDamage ?? [])
      .filter((rule) => damageTypes.has(normalize(rule.triggerDamageType)))
      .map((rule) => ({ binding, rule }))
  );
};


export interface AvailableSpellListAdditionRule {
  binding: CharacterRuleFeatureBinding;
  rule: CustomSpellListAdditionRule;
}

export const getSpellListAdditionRules = (
  character: Character,
  className?: string
): AvailableSpellListAdditionRule[] => {
  const normalizedClass = className ? normalize(className) : undefined;
  return getCharacterRuleFeatures(character).flatMap((binding) =>
    (binding.feature.customRules?.spellListAdditions ?? []).flatMap((rule) => {
      const applies = !rule.classNames?.length || !normalizedClass || rule.classNames.some((entry) => normalize(entry) === normalizedClass);
      return applies ? [{ binding, rule }] : [];
    })
  );
};

export interface AvailableSpellReplacementRule {
  binding: CharacterRuleFeatureBinding;
  rule: CustomSpellReplacementRule;
  resource?: ResourcePool;
  available: boolean;
}

export const getSpellReplacementRules = (
  character: Character,
  className?: string
): AvailableSpellReplacementRule[] => {
  const normalizedClass = className ? normalize(className) : undefined;
  return getCharacterRuleFeatures(character).flatMap((binding) =>
    (binding.feature.customRules?.spellReplacement ?? []).flatMap((rule) => {
      const applies = !rule.classNames?.length || !normalizedClass || rule.classNames.some((entry) => normalize(entry) === normalizedClass);
      if (!applies) return [];
      const resource = character.resources.find((entry) => entry.id === rule.resourceId);
      return [{ binding, rule, resource, available: (resource?.current ?? 0) > 0 }];
    })
  );
};

export const describeTriggeredDamageRule = (rule: CustomTriggeredDamageRule, ownerName: string): string => {
  const faces = rule.triggerValues.join(', ');
  const radius = rule.radiusFeet ? ` em um raio de ${rule.radiusFeet} pés` : '';
  const save = rule.saveAbility ? `; salvaguarda de ${rule.saveAbility}${rule.saveSuccessDamage === 'half' ? ' reduz o dano à metade' : rule.saveSuccessDamage === 'none' ? ' evita o dano' : ''}` : '';
  const formula = rule.damageMode === 'sameAsTriggeringDamage'
    ? 'repete o dano que acionou o efeito'
    : `causa ${rule.damageFormula?.raw ?? 'dano configurável'}`;
  return `${ownerName}: ao causar ${rule.triggerDamageType}, role ${rule.triggerRoll.count}d${rule.triggerRoll.sides}; em ${faces}, o efeito dispara${radius} e ${formula}${save}.`;
};
