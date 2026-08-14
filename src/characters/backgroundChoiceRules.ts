import type { CharacterBackgroundChoice, RuleValidationIssue } from '../types';
import type { StoredCompendiumItem } from '../compendium/types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export interface BackgroundChoiceRequirement {
  backgroundItemId: string;
  choiceType: string;
  label: string;
  options: string[];
}

export const getBackgroundChoiceRequirements = (
  backgroundItem?: StoredCompendiumItem
): BackgroundChoiceRequirement[] => {
  if (!backgroundItem) return [];
  const payload = asRecord(backgroundItem.normalizedJson);
  if (payload.requiresChoice !== true) return [];
  const choiceType = asString(payload.choiceType);
  const choices = Array.isArray(payload.choices)
    ? payload.choices.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];
  // Tool choices are already handled by proficiencyRules, which has richer category expansion.
  if (!choiceType || choiceType === 'tool' || !choices.length) return [];
  return [{
    backgroundItemId: backgroundItem.id,
    choiceType,
    label: choiceType === 'dragonmarkedHouse' ? 'Casa dracônica' : 'Configuração do background',
    options: choices
  }];
};

export const backgroundChoiceForRequirement = (
  choices: CharacterBackgroundChoice[],
  requirement: BackgroundChoiceRequirement
): CharacterBackgroundChoice | undefined =>
  choices.find((choice) => choice.backgroundItemId === requirement.backgroundItemId && choice.choiceType === requirement.choiceType);

export const setBackgroundChoiceOption = (
  choices: CharacterBackgroundChoice[],
  requirement: BackgroundChoiceRequirement,
  optionId: string
): CharacterBackgroundChoice[] => [
  ...choices.filter((choice) => !(choice.backgroundItemId === requirement.backgroundItemId && choice.choiceType === requirement.choiceType)),
  { backgroundItemId: requirement.backgroundItemId, choiceType: requirement.choiceType, optionId }
];

export const validateBackgroundChoices = (
  requirements: BackgroundChoiceRequirement[],
  choices: CharacterBackgroundChoice[]
): RuleValidationIssue[] => requirements.flatMap((requirement): RuleValidationIssue[] => {
  const choice = backgroundChoiceForRequirement(choices, requirement);
  if (!choice) return [{ severity: 'error', code: 'BACKGROUND_DIRECT_CHOICE_REQUIRED', message: `Escolha ${requirement.label.toLowerCase()} para o background.` }];
  if (!requirement.options.includes(choice.optionId)) return [{ severity: 'error', code: 'BACKGROUND_DIRECT_CHOICE_INVALID', message: `A opção escolhida para ${requirement.label.toLowerCase()} não está disponível.` }];
  return [];
});
