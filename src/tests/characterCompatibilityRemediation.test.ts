import { buildCharacterCompatibilityReport } from '../characters/characterCompatibility';
import {
  createCompatibilityRemediationPlan,
  previewCompatibilityRemediation,
  upsertCompatibilityRemediationDecision
} from '../characters/compatibilityRemediation';
import { commitProgressionDraft, createProgressionDraft, rollbackProgressionAudit } from '../characters/progressionTransaction';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { CatalogSnapshot } from '../catalog/types';
import type { Character, CharacterCompendiumLink } from '../types';

const choice = (id: string, kind: CharacterChoiceItem['kind'], name: string, available = true): CharacterChoiceItem => ({
  choiceId: `catalog:${id}`, entityId: id, kind, name, sourceBookId: 'phb-2024', sourceLabel: 'PHB 2024', origin: 'catalog',
  catalogSnapshotId: 'catalog-4.8.0-test', catalogEntityId: id, ownerIds: [], searchableText: name.toLowerCase(), available,
  blockedReasons: available ? [] : [{ code: 'entityDisabled', message: 'Entidade desativada.' }], manualReviewRequired: false, payload: {},
  provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: 'catalog-4.8.0-test', catalogVersion: '4.8.0', catalogEntityId: id, legacyItemIds: [], overrideAuthorized: false }
});

const link = (id: string, choiceId: string, appliedAs: CharacterCompendiumLink['appliedAs'], appliedEntityId: string): CharacterCompendiumLink => ({
  id, characterId: 'character-remediation', itemId: choiceId, importItemId: choiceId, packId: 'official', sourceId: 'phb-2024', itemType: appliedAs,
  appliedAs, appliedEntityId, appliedEntityName: id, status: 'active', addedAt: '2026-08-04T00:00:00.000Z', origin: 'catalog', choiceId,
  catalogEntityId: choiceId.replace('catalog:', ''), catalogSnapshotId: 'catalog-4.7.0-old'
});

const character = (): Character => ({
  id: 'character-remediation', name: 'Remediation Wizard', level: 1, catalogSnapshotId: 'catalog-4.7.0-old',
  classes: [{ id: 'wizard', name: 'Wizard', level: 1 }], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 },
  weapons: [], equipment: [], magicItems: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  spells: [{ id: 'acid', name: 'Acid Splash', level: 0, castingTime: 'action', requiresAttackRoll: false, targeting: { targets: 1 } }],
  feats: [{ id: 'removed-feat', name: 'Removed Feat', features: [] }, { id: 'local-feat', name: 'Local Draft', features: [] }],
  compendiumLinks: [
    link('wizard-link', 'catalog:phb-2024-class-wizard', 'class', 'wizard'),
    link('acid-link', 'catalog:phb-2024-spell-acid-splash', 'spell', 'acid'),
    link('missing-link', 'catalog:removed-app09-feat', 'feat', 'removed-feat'),
    { ...link('local-link', 'compendium:local-draft', 'feat', 'local-feat'), origin: 'compendium', sourceId: 'homebrew', catalogEntityId: undefined }
  ]
});

const snapshot = (): CatalogSnapshot => {
  const entries = [
    { entityId: 'phb-2024-class-wizard', kind: 'class', displayName: 'Wizard', sourceBookId: 'phb-2024', categoryIds: [], manualReviewRequired: false },
    { entityId: 'phb-2024-spell-acid-splash', kind: 'spell', displayName: 'Acid Splash', sourceBookId: 'phb-2024', categoryIds: [], manualReviewRequired: false },
    { entityId: 'phb-2024-spell-fire-bolt', kind: 'spell', displayName: 'Fire Bolt', sourceBookId: 'phb-2024', categoryIds: [], manualReviewRequired: false },
    { entityId: 'phb-2024-feat-origin-alert', kind: 'feat', displayName: 'Alert', sourceBookId: 'phb-2024', categoryIds: [], manualReviewRequired: false }
  ] as any[];
  return {
    snapshotId: 'catalog-4.8.0-test', catalogVersion: '4.8.0', loadedAt: '2026-08-04T00:00:00.000Z',
    manifest: { packageId: 'test', version: '4.8.0', ruleset: '2024', sourceBooks: ['phb-2024'] }, entries,
    registry: new Map(), entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories: [], categoryById: new Map(),
    dependenciesFrom: new Map(), dependenciesTo: new Map(), aliases: new Map(), filterPolicy: {} as any, readinessProfile: {} as any,
    validation: { status: 'passed', checkedAt: '2026-08-04T00:00:00.000Z', checks: {} as any, counts: {} as any, issues: [] }
  };
};

describe('APP-09 compatibility remediation', () => {
  it('previews replacements/removals without mutation and commits atomically with rollback', () => {
    const current = character();
    const before = JSON.stringify(current);
    const choices = [choice('phb-2024-class-wizard', 'class', 'Wizard'), choice('phb-2024-spell-acid-splash', 'spell', 'Acid Splash', false), choice('phb-2024-spell-fire-bolt', 'spell', 'Fire Bolt'), choice('phb-2024-feat-origin-alert', 'feat', 'Alert'), {
      ...choice('local-draft', 'feat', 'Local Draft', false), choiceId: 'compendium:local-draft', origin: 'compendium' as const, compendiumItemId: 'local-draft', provenance: { origin: 'compendium' as const, sourceId: 'homebrew', compendiumItemId: 'local-draft', legacyItemIds: ['local-draft'], overrideAuthorized: false }
    }];
    const catalog = snapshot();
    const filterState = { bookStates: { 'phb-2024': true }, categoryStates: {}, entityStates: { 'phb-2024-spell-acid-splash': 'disabled' as const } };
    const report = buildCharacterCompatibilityReport({ character: current, snapshot: catalog, filterState, choices });
    let plan = createCompatibilityRemediationPlan({ character: current, report });
    const issue = (code: string) => report.issues.find((entry) => entry.code === code)!;
    plan = upsertCompatibilityRemediationDecision(plan, { issueId: issue('CHARACTER_SNAPSHOT_MISMATCH').id, kind: 'adoptSnapshot' });
    plan = upsertCompatibilityRemediationDecision(plan, { issueId: issue('CHARACTER_CATALOG_ENTITY_DISABLED').id, referenceKey: issue('CHARACTER_CATALOG_ENTITY_DISABLED').referenceKey, kind: 'replace', replacementChoiceId: 'catalog:phb-2024-spell-fire-bolt' });
    plan = upsertCompatibilityRemediationDecision(plan, { issueId: issue('CHARACTER_CATALOG_ENTITY_MISSING').id, referenceKey: issue('CHARACTER_CATALOG_ENTITY_MISSING').referenceKey, kind: 'replace', replacementChoiceId: 'catalog:phb-2024-feat-origin-alert' });
    plan = upsertCompatibilityRemediationDecision(plan, { issueId: issue('CHARACTER_LOCAL_ITEM_DISABLED').id, referenceKey: issue('CHARACTER_LOCAL_ITEM_DISABLED').referenceKey, kind: 'remove' });
    const preview = previewCompatibilityRemediation({ character: current, report, plan, snapshot: catalog, filterState, choices });
    expect(preview.ok).toBe(true);
    expect(preview.afterReport.blockingIssueCount).toBe(0);
    expect(preview.impact.replacements).toBe(2);
    expect(preview.impact.removals).toBe(1);
    expect(JSON.stringify(current)).toBe(before);
    const committed = commitProgressionDraft(current, createProgressionDraft({ character: current, workingCharacter: preview.projectedCharacter, kind: 'compatibilityRemediation', targetCatalogSnapshotId: plan.targetCatalogSnapshotId, migrationApproved: true, operations: preview.operations }));
    expect(committed.ok).toBe(true);
    expect(committed.auditEntry?.kind).toBe('compatibilityRemediation');
    const rollback = rollbackProgressionAudit(committed.character, committed.auditEntry!);
    expect(rollback.character.catalogSnapshotId).toBe('catalog-4.7.0-old');
    expect(rollback.character.spells.some((entry) => entry.id === 'acid')).toBe(true);
  });
});
