import { createId } from '../utils/id';

export type BetaFeedbackPlatform = 'android' | 'ios' | 'web' | 'unknown';
export type BetaFeedbackSeverity = 'low' | 'medium' | 'high' | 'blocking';
export type BetaFeedbackStatus = 'open' | 'triaged' | 'resolved' | 'wontFix';
export type BetaFeedbackCategory =
  | 'characterCreation'
  | 'progression'
  | 'compendium'
  | 'combat'
  | 'performance'
  | 'accessibility'
  | 'backup'
  | 'other';

export interface BetaFeedbackEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  platform: BetaFeedbackPlatform;
  severity: BetaFeedbackSeverity;
  status: BetaFeedbackStatus;
  category: BetaFeedbackCategory;
  summary: string;
  steps?: string;
  expected?: string;
  actual?: string;
  device?: string;
  appVersion?: string;
  notes?: string;
}

export interface CreateBetaFeedbackInput {
  platform: BetaFeedbackPlatform;
  severity: BetaFeedbackSeverity;
  category: BetaFeedbackCategory;
  summary: string;
  steps?: string;
  expected?: string;
  actual?: string;
  device?: string;
  appVersion?: string;
  notes?: string;
}

export interface BetaFeedbackExport {
  schemaVersion: 'dnd-combat-beta-feedback.v1';
  exportedAt: string;
  privacy: {
    remoteTelemetryEnabled: false;
    userInitiatedExport: true;
    warning: string;
  };
  summary: {
    total: number;
    open: number;
    blocking: number;
    byCategory: Partial<Record<BetaFeedbackCategory, number>>;
  };
  entries: BetaFeedbackEntry[];
}

const normalizeOptional = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized || undefined;
};

export const createBetaFeedbackEntry = (
  input: CreateBetaFeedbackInput,
  now = new Date().toISOString()
): BetaFeedbackEntry => {
  const summary = input.summary.trim();
  if (!summary) throw new Error('O resumo do feedback é obrigatório.');

  return {
    id: createId('betaFeedback'),
    createdAt: now,
    updatedAt: now,
    platform: input.platform,
    severity: input.severity,
    status: 'open',
    category: input.category,
    summary,
    steps: normalizeOptional(input.steps),
    expected: normalizeOptional(input.expected),
    actual: normalizeOptional(input.actual),
    device: normalizeOptional(input.device),
    appVersion: normalizeOptional(input.appVersion),
    notes: normalizeOptional(input.notes)
  };
};

export const updateBetaFeedbackEntry = (
  entry: BetaFeedbackEntry,
  update: Partial<Omit<BetaFeedbackEntry, 'id' | 'createdAt'>>,
  now = new Date().toISOString()
): BetaFeedbackEntry => ({
  ...entry,
  ...update,
  summary: update.summary !== undefined ? update.summary.trim() : entry.summary,
  updatedAt: now
});

export const createBetaFeedbackExport = (
  entries: BetaFeedbackEntry[],
  now = new Date().toISOString()
): BetaFeedbackExport => {
  const byCategory: Partial<Record<BetaFeedbackCategory, number>> = {};
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  }

  return {
    schemaVersion: 'dnd-combat-beta-feedback.v1',
    exportedAt: now,
    privacy: {
      remoteTelemetryEnabled: false,
      userInitiatedExport: true,
      warning: 'Revise os campos livres antes de compartilhar. Eles podem conter informações inseridas manualmente pelo usuário.'
    },
    summary: {
      total: entries.length,
      open: entries.filter((entry) => entry.status === 'open' || entry.status === 'triaged').length,
      blocking: entries.filter((entry) => entry.severity === 'blocking' && entry.status !== 'resolved' && entry.status !== 'wontFix').length,
      byCategory
    },
    entries: entries
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  };
};


export interface BetaFeedbackTriageSummary {
  total: number;
  unresolved: number;
  unresolvedBlocking: number;
  unresolvedHigh: number;
  unresolvedMedium: number;
  unresolvedLow: number;
  resolved: number;
  releaseGate: 'blocked' | 'needsReview' | 'ready';
}

const isFeedbackClosed = (entry: BetaFeedbackEntry): boolean =>
  entry.status === 'resolved' || entry.status === 'wontFix';

export const summarizeBetaFeedbackTriage = (
  entries: BetaFeedbackEntry[]
): BetaFeedbackTriageSummary => {
  const unresolvedEntries = entries.filter((entry) => !isFeedbackClosed(entry));
  const count = (severity: BetaFeedbackSeverity): number =>
    unresolvedEntries.filter((entry) => entry.severity === severity).length;

  const unresolvedBlocking = count('blocking');
  const unresolvedHigh = count('high');
  const unresolvedMedium = count('medium');
  const unresolvedLow = count('low');
  const releaseGate = unresolvedBlocking || unresolvedHigh
    ? 'blocked'
    : unresolvedMedium || unresolvedLow
      ? 'needsReview'
      : 'ready';

  return {
    total: entries.length,
    unresolved: unresolvedEntries.length,
    unresolvedBlocking,
    unresolvedHigh,
    unresolvedMedium,
    unresolvedLow,
    resolved: entries.length - unresolvedEntries.length,
    releaseGate
  };
};

export const betaFeedbackExportToJson = (
  feedbackExport: BetaFeedbackExport
): string => JSON.stringify(feedbackExport, null, 2);
