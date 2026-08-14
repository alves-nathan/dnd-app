import type { RuleSource, RuleValidationIssue } from '../types';
import type { CompendiumImportInput, CompendiumItemInput } from './schemas';
import type { CompendiumImportItem } from './importDomain';

export type CompendiumItemType = CompendiumItemInput['kind'];
export type StoredCompendiumItemStatus = 'draft' | 'validated' | 'needsReview' | 'disabled';
export type StoredCompendiumReviewDecision = 'pending' | 'approved' | 'rejected';

export interface StoredCompendiumPack {
  id: string;
  name: string;
  sourceId: string;
  schemaVersion: string;
  checksum: string;
  importedAt: string;
  itemCount: number;
}

export interface StoredCompendiumItem {
  id: string;
  importItemId: string;
  packId: string;
  sourceId: string;
  type: CompendiumItemType;
  name: string;
  summary?: string;
  version?: string;
  rawJson: CompendiumItemInput | CompendiumImportItem;
  normalizedJson: Record<string, unknown>;
  /** Canonical V2 fingerprint used only for deterministic diff/upsert. */
  contentHash?: string;
  tags: string[];
  status: StoredCompendiumItemStatus;
  reviewDecision?: StoredCompendiumReviewDecision;
  reviewNotes?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedCompendiumImport {
  source: RuleSource;
  pack: StoredCompendiumPack;
  items: StoredCompendiumItem[];
  issues: RuleValidationIssue[];
}

export interface CompendiumImportBuildOptions {
  importedAt?: string;
  schemaVersion?: string;
}



export interface CompendiumItemMappingUpdate {
  normalizedJson: Record<string, unknown>;
  status?: StoredCompendiumItemStatus;
  reviewDecision?: StoredCompendiumReviewDecision;
  reviewNotes?: string;
  reviewedBy?: string;
}

export interface CompendiumItemReviewUpdate {
  status?: StoredCompendiumItemStatus;
  reviewDecision?: StoredCompendiumReviewDecision;
  reviewNotes?: string;
  reviewedBy?: string;
}

export interface CompendiumItemReviewBatchEntry {
  itemId: string;
  update: CompendiumItemReviewUpdate;
}

export interface CompendiumItemSearchFilters {
  types?: StoredCompendiumItem['type'][];
  statuses?: StoredCompendiumItemStatus[];
  sourceIds?: string[];
  onlyEnabled?: boolean;
}

export type CompendiumImportPayload = CompendiumImportInput;
