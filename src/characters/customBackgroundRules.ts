import type {
  AbilityScore,
  CharacterCurrency,
  CharacterCustomBackgroundChoice,
  CharacterEquipmentSelection,
  CharacterEquipmentSelectionItem,
  RuleValidationIssue
} from '../types';
import type { StoredCompendiumItem } from '../compendium/types';
import { manualSource } from '../data/mockData';
import { createId } from '../utils/id';

export const CUSTOM_BACKGROUND_ITEM_ID = 'custom-background';
export const CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER = 5000;
export const CUSTOM_BACKGROUND_ABILITY_COUNT = 3;
export const CUSTOM_BACKGROUND_SKILL_COUNT = 2;
export const CUSTOM_BACKGROUND_TOOL_COUNT = 1;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

export const createDefaultCustomBackgroundChoice = (): CharacterCustomBackgroundChoice => ({
  name: 'Background personalizado',
  abilityScoreOptions: [],
  skillProficiencies: []
});

export const sanitizeCustomBackgroundChoice = (value: unknown): CharacterCustomBackgroundChoice | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const abilities = Array.isArray(record.abilityScoreOptions)
    ? record.abilityScoreOptions.filter((entry): entry is AbilityScore => typeof entry === 'string' && ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(entry))
    : [];
  const skills = Array.isArray(record.skillProficiencies)
    ? record.skillProficiencies.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];
  const toolProficiency = typeof record.toolProficiency === 'string' && record.toolProficiency.trim()
    ? record.toolProficiency.trim()
    : undefined;
  return {
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Background personalizado',
    abilityScoreOptions: unique(abilities).slice(0, CUSTOM_BACKGROUND_ABILITY_COUNT),
    skillProficiencies: unique(skills).slice(0, CUSTOM_BACKGROUND_SKILL_COUNT),
    toolProficiency
  };
};

export const validateCustomBackgroundOrigin = (
  choice: CharacterCustomBackgroundChoice
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  if (!choice.name.trim()) {
    issues.push({ severity: 'error', code: 'CUSTOM_BACKGROUND_NAME_REQUIRED', message: 'Informe um nome para o background personalizado.' });
  }
  if (unique(choice.abilityScoreOptions).length !== CUSTOM_BACKGROUND_ABILITY_COUNT) {
    issues.push({
      severity: 'error',
      code: 'CUSTOM_BACKGROUND_ABILITY_COUNT',
      message: `Escolha exatamente ${CUSTOM_BACKGROUND_ABILITY_COUNT} atributos disponíveis para o background personalizado.`
    });
  }
  return issues;
};

export const validateCustomBackgroundProficiencies = (
  choice: CharacterCustomBackgroundChoice
): RuleValidationIssue[] => {
  const issues: RuleValidationIssue[] = [];
  if (unique(choice.skillProficiencies).length !== CUSTOM_BACKGROUND_SKILL_COUNT) {
    issues.push({
      severity: 'error',
      code: 'CUSTOM_BACKGROUND_SKILL_COUNT',
      message: `O background personalizado exige exatamente ${CUSTOM_BACKGROUND_SKILL_COUNT} perícias.`
    });
  }
  if (!choice.toolProficiency?.trim()) {
    issues.push({
      severity: 'error',
      code: 'CUSTOM_BACKGROUND_TOOL_COUNT',
      message: 'O background personalizado exige exatamente 1 proficiência em ferramenta.'
    });
  }
  return issues;
};

export const createCustomBackgroundCompendiumItem = (
  choice: CharacterCustomBackgroundChoice
): StoredCompendiumItem => {
  const now = new Date(0).toISOString();
  const toolProficiencies = choice.toolProficiency ? [choice.toolProficiency] : [];
  const payload = {
    abilityScoreOptions: [...choice.abilityScoreOptions],
    abilityScoreIncreaseRule: {
      chooseOnePlus2AndDifferentOnePlus1: true,
      orIncreaseAllBy1: true,
      maximumScoreAfterIncrease: 20
    },
    featIds: [],
    skillProficiencies: [...choice.skillProficiencies],
    toolProficiencies,
    customBackground: true
  };
  return {
    id: CUSTOM_BACKGROUND_ITEM_ID,
    importItemId: CUSTOM_BACKGROUND_ITEM_ID,
    packId: 'manual-custom-background',
    sourceId: manualSource.id,
    type: 'background',
    name: choice.name.trim() || 'Background personalizado',
    summary: 'Background personalizado criado durante a criação do personagem.',
    rawJson: {
      id: CUSTOM_BACKGROUND_ITEM_ID,
      kind: 'background',
      name: choice.name.trim() || 'Background personalizado',
      summary: 'Background personalizado criado durante a criação do personagem.',
      source: manualSource,
      payload
    },
    normalizedJson: payload,
    tags: ['custom', 'background'],
    status: 'validated',
    reviewDecision: 'approved',
    reviewedBy: 'Criação de personagem',
    createdAt: now,
    updatedAt: now
  };
};

export const parseEquipmentCostToCopper = (value: unknown): number | undefined => {
  const multiplier: Record<string, number> = { CP: 1, SP: 10, EP: 50, GP: 100, PP: 1000 };
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? record.amount : undefined;
    const unit = typeof record.unit === 'string' ? record.unit.toUpperCase() : undefined;
    if (amount === undefined || amount < 0 || !unit || multiplier[unit] === undefined) return undefined;
    return Math.round(amount * multiplier[unit]);
  }
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(CP|SP|EP|GP|PP)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]?.replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * (multiplier[match[2]?.toUpperCase() ?? 'GP'] ?? 100));
};

export const formatCopperCost = (copper: number): string => {
  const normalized = Math.max(0, Math.floor(copper));
  const gp = Math.floor(normalized / 100);
  const sp = Math.floor((normalized % 100) / 10);
  const cp = normalized % 10;
  return [gp ? `${gp} GP` : '', sp ? `${sp} SP` : '', cp ? `${cp} CP` : ''].filter(Boolean).join(' ') || '0 GP';
};

export const copperToCurrency = (copper: number): Partial<CharacterCurrency> => {
  let remaining = Math.max(0, Math.floor(copper));
  const gp = Math.floor(remaining / 100);
  remaining -= gp * 100;
  const sp = Math.floor(remaining / 10);
  remaining -= sp * 10;
  return { gp, sp, cp: remaining };
};

export interface CustomBackgroundEquipmentCandidate {
  item: StoredCompendiumItem;
  costCopper: number;
  purchaseQuantity: number;
}

export const getCustomBackgroundEquipmentCandidates = (
  items: StoredCompendiumItem[],
  enabledSourceIds: string[]
): CustomBackgroundEquipmentCandidate[] => {
  const enabled = new Set(enabledSourceIds);
  return items
    .filter((item) => item.status !== 'disabled' && enabled.has(item.sourceId))
    .flatMap((item): CustomBackgroundEquipmentCandidate[] => {
      if (item.type !== 'equipment' && item.type !== 'weapon') return [];
      const payload = asRecord(item.normalizedJson);
      if (item.type === 'weapon' && String(payload.weaponCategory ?? '').trim().toLowerCase() !== 'simple') return [];
      const costCopper = parseEquipmentCostToCopper(payload.cost);
      if (costCopper === undefined || costCopper <= 0 || costCopper > CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER) return [];
      const quantity = typeof payload.quantity === 'number' && Number.isFinite(payload.quantity)
        ? Math.max(1, Math.floor(payload.quantity))
        : 1;
      return [{ item, costCopper, purchaseQuantity: quantity }];
    })
    .sort((left, right) => left.costCopper - right.costCopper || left.item.name.localeCompare(right.item.name));
};

const customSelection = (selections: CharacterEquipmentSelection[]): CharacterEquipmentSelection | undefined =>
  selections.find((entry) => entry.sourceKind === 'background' && entry.sourceItemId === CUSTOM_BACKGROUND_ITEM_ID);

export const getCustomBackgroundEquipmentPurchaseCount = (
  selections: CharacterEquipmentSelection[],
  candidate: CustomBackgroundEquipmentCandidate
): number => {
  const selected = customSelection(selections)?.items?.find((entry) => entry.compendiumItemId === candidate.item.id);
  if (!selected) return 0;
  return Math.max(0, Math.round(selected.quantity / candidate.purchaseQuantity));
};

export const getCustomBackgroundEquipmentSpentCopper = (
  selections: CharacterEquipmentSelection[],
  candidates: CustomBackgroundEquipmentCandidate[]
): number => {
  return candidates.reduce((sum, candidate) =>
    sum + getCustomBackgroundEquipmentPurchaseCount(selections, candidate) * candidate.costCopper, 0);
};

const selectionItemForCandidate = (
  candidate: CustomBackgroundEquipmentCandidate,
  purchaseCount: number
): CharacterEquipmentSelectionItem => ({
  label: `${candidate.purchaseQuantity * purchaseCount} ${candidate.item.name}`,
  quantity: candidate.purchaseQuantity * purchaseCount,
  goldPieces: 0,
  compendiumItemId: candidate.item.id,
  compendiumItemType: candidate.item.type === 'weapon' ? 'weapon' : 'equipment'
});

export const setCustomBackgroundEquipmentPurchaseCount = (
  selections: CharacterEquipmentSelection[],
  candidate: CustomBackgroundEquipmentCandidate,
  purchaseCount: number,
  candidates: CustomBackgroundEquipmentCandidate[]
): CharacterEquipmentSelection[] => {
  const current = customSelection(selections);
  const otherSelections = selections.filter((entry) => entry.sourceKind !== 'background');
  const count = Math.max(0, Math.floor(purchaseCount));
  const currentItems = current?.items ?? [];
  const remainingItems = currentItems.filter((entry) => entry.compendiumItemId !== candidate.item.id);
  const nextItems = count > 0 ? [...remainingItems, selectionItemForCandidate(candidate, count)] : remainingItems;

  const provisional: CharacterEquipmentSelection = {
    id: current?.id ?? createId('equipmentChoice'),
    sourceKind: 'background',
    sourceItemId: CUSTOM_BACKGROUND_ITEM_ID,
    optionId: 'custom-package',
    labels: nextItems.map((entry) => entry.label),
    items: nextItems
  };
  const provisionalSelections = [...otherSelections, provisional];
  const spentCopper = getCustomBackgroundEquipmentSpentCopper(provisionalSelections, candidates);
  if (spentCopper > CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER) return selections;
  const remainder = CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER - spentCopper;
  const next: CharacterEquipmentSelection = {
    ...provisional,
    labels: [...nextItems.map((entry) => entry.label), `${formatCopperCost(remainder)} restantes`],
    currency: copperToCurrency(remainder),
    goldPieces: 0
  };
  return [...otherSelections, next];
};

export const ensureCustomBackgroundCashEquipmentSelection = (
  selections: CharacterEquipmentSelection[]
): CharacterEquipmentSelection[] => {
  const nonBackgroundSelections = selections.filter((entry) => entry.sourceKind !== 'background');
  const existing = customSelection(selections);
  if (existing) return [...nonBackgroundSelections, existing];
  return [...nonBackgroundSelections, {
    id: createId('equipmentChoice'),
    sourceKind: 'background',
    sourceItemId: CUSTOM_BACKGROUND_ITEM_ID,
    optionId: 'custom-package',
    labels: ['50 GP'],
    goldPieces: 0,
    currency: { gp: 50 },
    items: []
  }];
};

export const validateCustomBackgroundEquipmentSelection = (
  selections: CharacterEquipmentSelection[],
  candidates: CustomBackgroundEquipmentCandidate[]
): RuleValidationIssue[] => {
  const selection = customSelection(selections);
  if (!selection) {
    return [{
      severity: 'error',
      code: 'CUSTOM_BACKGROUND_EQUIPMENT_REQUIRED',
      message: 'Escolha o equipamento do background personalizado ou mantenha os 50 GP.'
    }];
  }
  const spent = getCustomBackgroundEquipmentSpentCopper(selections, candidates);
  if (spent > CUSTOM_BACKGROUND_EQUIPMENT_BUDGET_COPPER) {
    return [{
      severity: 'error',
      code: 'CUSTOM_BACKGROUND_EQUIPMENT_BUDGET',
      message: 'O equipamento do background personalizado ultrapassa o orçamento de 50 GP.'
    }];
  }
  return [];
};
