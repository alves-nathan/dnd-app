import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import type { CharacterCompendiumLink, RuleValidationIssue } from '../types';
import { characterChoiceToMapperItem } from './catalogCompendiumAdapter';
import type {
  CharacterChoiceApplicationInput,
  CharacterChoiceApplicationPreview,
  CharacterChoiceApplicationResult
} from './characterChoiceTypes';

const canonicalLinkMatches = (
  link: CharacterCompendiumLink,
  choiceId: string,
  catalogEntityId?: string
): boolean =>
  link.status === 'active' && (
    link.choiceId === choiceId ||
    link.itemId === choiceId ||
    Boolean(catalogEntityId && link.catalogEntityId === catalogEntityId)
  );

const blockedIssues = (input: CharacterChoiceApplicationInput): RuleValidationIssue[] =>
  input.choice.blockedReasons.map((reason) => ({
    severity: reason.code === 'ambiguousCollision' ? 'warning' : 'error',
    code: `CHARACTER_CHOICE_${reason.code.toUpperCase()}`,
    message: reason.message
  }));

export const previewCharacterChoiceApplication = (
  input: CharacterChoiceApplicationInput
): CharacterChoiceApplicationPreview => {
  const alreadyApplied = (input.character.compendiumLinks ?? []).some((link) =>
    canonicalLinkMatches(link, input.choice.choiceId, input.choice.catalogEntityId)
  );
  const issues = blockedIssues(input);
  if (alreadyApplied) {
    issues.push({
      severity: 'warning',
      code: 'CHARACTER_CHOICE_ALREADY_APPLIED',
      message: `${input.choice.name} já está aplicado ao personagem.`
    });
  }
  if (input.choice.manualReviewRequired) {
    issues.push({
      severity: 'warning',
      code: 'CHARACTER_CHOICE_EDITORIAL_REVIEW',
      message: `${input.choice.name} está disponível, mas mantém sinalização de revisão editorial.`
    });
  }
  return {
    ok: input.choice.available && !alreadyApplied,
    choice: input.choice,
    issues,
    alreadyApplied
  };
};

export const applyCharacterChoice = (
  input: CharacterChoiceApplicationInput
): CharacterChoiceApplicationResult => {
  const preview = previewCharacterChoiceApplication(input);
  if (!preview.ok) {
    return {
      ok: false,
      character: input.character,
      choice: input.choice,
      issues: preview.issues
    };
  }

  const mapperItem = characterChoiceToMapperItem(input.choice);
  const applied = applyCompendiumItemToCharacter(input.character, mapperItem);
  if (!applied.ok) {
    return {
      ok: false,
      character: applied.character,
      choice: input.choice,
      issues: [...preview.issues, ...applied.issues]
    };
  }

  return {
    ok: true,
    character: {
      ...applied.character,
      catalogSnapshotId: input.choice.catalogSnapshotId ?? applied.character.catalogSnapshotId
    },
    choice: input.choice,
    link: applied.link,
    issues: [...preview.issues, ...applied.issues]
  };
};
