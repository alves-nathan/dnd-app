import type { CatalogFilterState, CatalogSnapshot } from './types';
import type { StoredCompendiumItem } from '../compendium/types';
import type { Character, CharacterCompendiumLink, RuleValidationIssue } from '../types';

export type CharacterChoiceKind = StoredCompendiumItem['type'];
export type CharacterChoiceOrigin = 'catalog' | 'compendium';

export type CharacterChoiceBlockReasonCode =
  | 'sourceBookDisabled'
  | 'entityDisabled'
  | 'categoryDisabled'
  | 'localSourceDisabled'
  | 'localItemNotValidated'
  | 'catalogPayloadUnavailable'
  | 'ambiguousCollision'
  | 'unsupportedKind';

export interface CharacterChoiceBlockReason {
  code: CharacterChoiceBlockReasonCode;
  message: string;
}

export interface CharacterChoiceProvenance {
  origin: CharacterChoiceOrigin;
  sourceBookId?: string;
  sourceId: string;
  packId?: string;
  catalogSnapshotId?: string;
  catalogVersion?: string;
  catalogEntityId?: string;
  compendiumItemId?: string;
  carrierCompendiumItemId?: string;
  legacyItemIds: string[];
  overrideAuthorized: boolean;
}

export interface CharacterChoiceItem {
  choiceId: string;
  entityId: string;
  kind: CharacterChoiceKind;
  name: string;
  summary?: string;
  sourceBookId?: string;
  sourceLabel: string;
  origin: CharacterChoiceOrigin;
  catalogSnapshotId?: string;
  catalogEntityId?: string;
  compendiumItemId?: string;
  ownerIds: string[];
  searchableText: string;
  available: boolean;
  blockedReasons: CharacterChoiceBlockReason[];
  manualReviewRequired: boolean;
  payload: Record<string, unknown>;
  provenance: CharacterChoiceProvenance;
}

export interface CharacterChoiceBridgeInput {
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  compendiumItems: readonly StoredCompendiumItem[];
  enabledSourceIds: readonly string[];
}

export interface CharacterChoiceQuery {
  text?: string;
  kinds?: CharacterChoiceKind[];
  sourceBookIds?: string[];
  origins?: CharacterChoiceOrigin[];
  includeUnavailable?: boolean;
  includeManualReview?: boolean;
  limit?: number;
}

export interface CharacterChoiceQueryResult {
  choices: CharacterChoiceItem[];
  totalBeforeLimit: number;
  hiddenDuplicateCount: number;
  unavailableCount: number;
  ambiguousCollisionCount: number;
}

export interface CharacterChoiceResolution {
  ok: boolean;
  choice?: CharacterChoiceItem;
  canonicalChoiceId?: string;
  issues: RuleValidationIssue[];
}

export interface CharacterChoiceApplicationInput {
  character: Character;
  choice: CharacterChoiceItem;
}

export interface CharacterChoiceApplicationPreview {
  ok: boolean;
  choice: CharacterChoiceItem;
  issues: RuleValidationIssue[];
  alreadyApplied: boolean;
}

export interface CharacterChoiceApplicationResult {
  ok: boolean;
  character: Character;
  choice: CharacterChoiceItem;
  link?: CharacterCompendiumLink;
  issues: RuleValidationIssue[];
}
