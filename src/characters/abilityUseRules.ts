import type { ActionCost, Character, ResourceCost, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { findCompendiumItemForCharacterLink } from '../compendium/characterLinkIdentity';
import type { AbilityUseDefinition } from '../rules-engine/abilities/abilityUseTransactions';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asPositiveInteger = (value: unknown): number | undefined => {
  const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : undefined;
};

const actionCost = (value: unknown): ActionCost | undefined =>
  value === 'action' || value === 'bonusAction' || value === 'reaction' || value === 'movement' || value === 'free' || value === 'special'
    ? value
    : undefined;

const humanizeResourceId = (value: string): string => {
  const special: Record<string, string> = {
    'bardic-inspiration': 'Bardic Inspiration',
    'cleric-channel-divinity': 'Channel Divinity',
    'paladin-channel-divinity': 'Channel Divinity',
    'druid-wild-shape': 'Wild Shape',
    'fighter-second-wind': 'Second Wind',
    'monk-focus-points': 'Focus Points',
    'sorcerer-sorcery-points': 'Sorcery Points',
    'battle-master-superiority-dice': 'Superiority Dice'
  };
  return special[value] ?? value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const warning = (code: string, message: string): RuleValidationIssue => ({ severity: 'warning', code, message });

export interface CharacterAbilityUse {
  id: string;
  kind: 'sharedConsumer' | 'poolUse' | 'manual';
  name: string;
  description?: string;
  actionCost?: ActionCost;
  actionLabel?: string;
  costLabels: string[];
  executable: boolean;
  issues: RuleValidationIssue[];
  definition?: AbilityUseDefinition;
}

const actionLabel = (value: ActionCost | undefined): string | undefined => {
  if (value === 'action') return 'Ação';
  if (value === 'bonusAction') return 'Ação bônus';
  if (value === 'reaction') return 'Reação';
  if (value === 'free') return 'Sem ação';
  if (value === 'movement') return 'Movimento';
  if (value === 'special') return 'Especial';
  return undefined;
};

const explicitCosts = (
  character: Character,
  payload: Record<string, unknown>
): { costs: ResourceCost[]; labels: string[]; issues: RuleValidationIssue[]; hasExplicit: boolean } => {
  const costs: ResourceCost[] = [];
  const labels: string[] = [];
  const issues: RuleValidationIssue[] = [];
  const consumes = Array.isArray(payload.consumes) ? payload.consumes.map(asRecord) : [];
  const hasExplicit = consumes.length > 0;

  for (const consume of consumes) {
    const resourceId = typeof consume.resourceId === 'string' ? consume.resourceId : undefined;
    if (!resourceId) {
      issues.push(warning('ABILITY_RESOURCE_REFERENCE_UNSUPPORTED', 'O custo existe, mas não referencia um resourceId executável.'));
      continue;
    }
    const resource = character.resources.find((candidate) => candidate.id === resourceId);
    const name = resource?.name ?? humanizeResourceId(resourceId);
    const amount = asPositiveInteger(consume.amount);
    if (!amount) {
      const rawAmount = typeof consume.amount === 'string' && consume.amount.trim() ? consume.amount.trim() : 'variável';
      labels.push(`${rawAmount} ${name}`);
      issues.push(warning('ABILITY_VARIABLE_RESOURCE_COST', `O custo de ${name} exige uma quantidade escolhida/manual.`));
      continue;
    }
    costs.push({ resourceId, amount, label: name });
    labels.push(`${amount} ${name}`);
  }

  return { costs, labels, issues, hasExplicit };
};

const implicitSingleUseCost = (
  character: Character,
  payload: Record<string, unknown>
): { cost?: ResourceCost; label?: string } => {
  const resourceSpec = asRecord(payload.resource);
  const resourceId = typeof resourceSpec.id === 'string' ? resourceSpec.id : undefined;
  if (!resourceId) return {};
  const resource = character.resources.find((candidate) => candidate.id === resourceId);
  if (!resource || resource.max !== 1) return {};
  return { cost: { resourceId, amount: 1, label: resource.name }, label: `1 ${resource.name}` };
};

export const getCharacterAbilityUses = (
  character: Character,
  items: StoredCompendiumItem[]
): CharacterAbilityUse[] => {
  const uses: CharacterAbilityUse[] = [];
  const seen = new Set<string>();

  for (const link of character.compendiumLinks ?? []) {
    if (link.status !== 'active' || link.appliedAs !== 'feature') continue;
    const feature = character.features.find((candidate) => candidate.id === link.appliedEntityId);
    if (!feature) continue;
    const item = findCompendiumItemForCharacterLink(items, link);
    if (!item || item.type !== 'feature') continue;
    const key = `${item.importItemId || item.id}:${feature.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const payload = asRecord(item.normalizedJson);
    const explicit = explicitCosts(character, payload);
    const costs = [...explicit.costs];
    const labels = [...explicit.labels];
    if (!costs.length && !explicit.issues.length) {
      const implicit = implicitSingleUseCost(character, payload);
      if (implicit.cost && implicit.label) {
        costs.push(implicit.cost);
        labels.push(implicit.label);
      }
    }
    if (!labels.length && !explicit.issues.length) continue;

    const useActionCost = actionCost(payload.actionCost) ?? feature.actionCost;
    const definition: AbilityUseDefinition | undefined = costs.length && !explicit.issues.length ? {
      id: `feature-use:${item.importItemId || item.id}:${feature.id}`,
      name: item.name,
      sourceItemId: item.id,
      sourceEntityId: feature.id,
      actionCost: useActionCost,
      resourceCosts: costs
    } : undefined;

    uses.push({
      id: definition?.id ?? `feature-use-manual:${item.importItemId || item.id}:${feature.id}`,
      kind: explicit.hasExplicit ? 'sharedConsumer' : costs.length ? 'poolUse' : 'manual',
      name: item.name,
      description: item.summary ?? feature.summary,
      actionCost: useActionCost,
      actionLabel: actionLabel(useActionCost),
      costLabels: labels,
      executable: Boolean(definition),
      issues: explicit.issues,
      definition
    });
  }

  return uses.sort((left, right) => left.name.localeCompare(right.name));
};
