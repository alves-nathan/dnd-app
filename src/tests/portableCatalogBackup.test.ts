import { ContentPolicyService } from '../catalog/contentPolicyService';
import type { CatalogSnapshot, ContentCategory, RuntimeCatalogEntry } from '../catalog/types';
import { createCatalogConfigurationHistoryEntry } from '../catalog/catalogConfigurationHistory';
import {
  comparePortableCatalogAudit,
  createPortableCatalogAuditSection,
  portableCatalogHistoryChecksum,
  preparePortableRemediationPlanImport,
  validatePortableCatalogAuditSection
} from '../backup/portableCatalogBackup';
import { createCharacterDataBackup, parseCharacterDataBackup } from '../backup/characterBackup';
import { createEmptyCharacter } from '../data/mockData';

const spellEntry: RuntimeCatalogEntry = {
  entityId: 'spell-a',
  kind: 'spell',
  displayName: 'Spell A',
  displayContext: [],
  sourceBookId: 'phb-2024',
  sourceFile: 'spells.json',
  categoryIds: ['spells'],
  status: 'published',
  defaultEnabled: true,
  manualReviewRequired: false,
  dependencyCounts: { outgoing: 0, incoming: 0 },
  searchKey: 'spell a'
};

const spellsCategory: ContentCategory = {
  id: 'spells',
  kind: 'contentCategory',
  key: 'spells',
  name: { en: 'Spells' },
  sourceBookId: null,
  memberCount: 1,
  memberEntityIds: ['spell-a'],
  defaultEnabled: true,
  canDisable: true,
  activationScopes: [],
  availabilityClasses: [],
  status: 'published'
};

const snapshot: CatalogSnapshot = {
  snapshotId: 'catalog-4.8.0-test',
  catalogVersion: '4.8.0',
  loadedAt: '2026-08-04T00:00:00.000Z',
  manifest: {
    packageId: 'portable-backup-test',
    version: '4.8.0',
    ruleset: '2024',
    sourceBooks: ['phb-2024']
  },
  entries: [spellEntry],
  entryById: new Map([['spell-a', spellEntry]]),
  registry: new Map(),
  categories: [spellsCategory],
  categoryById: new Map([['spells', spellsCategory]]),
  dependenciesFrom: new Map(),
  dependenciesTo: new Map(),
  aliases: new Map(),
  filterPolicy: {
    id: 'portable-backup-test-policy',
    kind: 'policy',
    version: '4.8.0',
    precedence: [],
    rules: [],
    profiles: [{ id: 'full-official', name: 'Full official', bookStates: { 'phb-2024': true } }],
    status: 'published'
  },
  readinessProfile: {},
  validation: {
    status: 'passed',
    catalogVersion: '4.8.0',
    checkedAt: '2026-08-04T00:00:00.000Z',
    checks: {
      bundleChecksum: 'notRequested',
      versionCoherence: true,
      counts: true,
      uniqueEntityIds: true,
      registryCoverage: true,
      categoryReferences: true,
      dependencyReferences: true,
      aliasReferences: true
    },
    counts: {
      runtimeEntries: 1,
      registryEntries: 0,
      dependencyEdges: 0,
      categories: 1,
      aliases: 0
    },
    issues: []
  }
};

it('exports catalog audit in backup v3 and validates its history', () => {
  const policy = new ContentPolicyService(snapshot);
  const before = policy.createDefaultState();
  const after = { ...before, entityStates: { ...before.entityStates, 'spell-a': 'disabled' as const } };
  const history = [createCatalogConfigurationHistoryEntry({ revision: 1, committedAt: '2026-08-04T01:00:00.000Z', label: 'Disable spell', origin: 'entity', catalogVersion: snapshot.catalogVersion, catalogSnapshotId: snapshot.snapshotId, beforeState: before, afterState: after, impact: policy.previewImpact(before, after) })];
  const section = createPortableCatalogAuditSection({ snapshot, filterState: after, revision: 1, history });
  expect(section.historyIntegrity.checksum).toBe(portableCatalogHistoryChecksum(history));
  const backup = createCharacterDataBackup({ characters: [], scenarios: [], buildPresets: [], buildHistorySnapshots: [] }, { catalogAudit: section });
  expect(backup.schemaVersion).toBe('dnd-combat-character-backup.v3');
  expect(parseCharacterDataBackup(JSON.stringify(backup)).ok).toBe(true);
  expect(validatePortableCatalogAuditSection({ candidate: section, snapshot, fallback: before }).ok).toBe(true);
});

it('detects divergence and preserves local remediation plans', () => {
  const policy = new ContentPolicyService(snapshot);
  const local = policy.createDefaultState();
  const incomingState = { ...local, entityStates: { 'spell-a': 'disabled' as const } };
  const incomingCommit = createCatalogConfigurationHistoryEntry({
    revision: 1,
    committedAt: '2026-08-04T02:00:00.000Z',
    label: 'Incoming disable spell',
    origin: 'entity',
    catalogVersion: snapshot.catalogVersion,
    catalogSnapshotId: snapshot.snapshotId,
    beforeState: local,
    afterState: incomingState,
    impact: policy.previewImpact(local, incomingState)
  });
  const localConflictingCommit = { ...incomingCommit, label: 'Local conflicting commit' };
  const section = createPortableCatalogAuditSection({ snapshot, filterState: incomingState, revision: 1, history: [incomingCommit] });
  const comparison = comparePortableCatalogAudit({
    snapshot,
    localFilterState: local,
    localRevision: 1,
    localHistory: [localConflictingCommit],
    localPlans: {},
    incoming: section
  });
  expect(comparison.relation).toBe('diverged');
  expect(comparison.conflictingCommitIds).toEqual([incomingCommit.id]);
  expect(comparison.changedEntityIds).toEqual(['spell-a']);

  const character = { ...createEmptyCharacter('Imported'), id: 'char-new' };
  const plan = { schemaVersion: 'dnd-character-compatibility-remediation.v1' as const, id: 'plan-a', characterId: 'char-old', createdAt: '', updatedAt: '', baseFingerprint: 'old', targetCatalogSnapshotId: snapshot.snapshotId, decisions: [] };
  const imported = preparePortableRemediationPlanImport({ incomingPlans: [plan], currentPlans: {}, characterIdMap: { 'char-old': 'char-new' }, importedCharacters: [character] });
  expect(imported.accepted[0].characterId).toBe('char-new');
  const conflict = preparePortableRemediationPlanImport({ incomingPlans: [plan], currentPlans: { 'char-new': { ...plan, characterId: 'char-new', id: 'local-plan' } }, characterIdMap: { 'char-old': 'char-new' }, importedCharacters: [character] });
  expect(conflict.accepted).toHaveLength(0);
  expect(conflict.conflictingCharacterIds).toEqual(['char-new']);
});
