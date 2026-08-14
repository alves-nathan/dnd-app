import { buildCharacterCompatibilityReport } from '../characters/characterCompatibility';
import type { CatalogSnapshot } from '../catalog/types';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { Character } from '../types';

const snapshot = (): CatalogSnapshot => {
  const entries = [
    { entityId: 'phb-2024-class-wizard', kind: 'class', displayName: 'Wizard', displayContext: [], sourceBookId: 'phb-2024', sourceFile: 'classes.json', categoryIds: [], status: 'active', defaultEnabled: true, manualReviewRequired: false, dependencyCounts: { outgoing: 0, incoming: 0 }, searchKey: 'wizard' },
    { entityId: 'phb-2024-spell-acid-splash', kind: 'spell', displayName: 'Acid Splash', displayContext: [], sourceBookId: 'phb-2024', sourceFile: 'spells.json', categoryIds: [], status: 'active', defaultEnabled: true, manualReviewRequired: false, dependencyCounts: { outgoing: 0, incoming: 0 }, searchKey: 'acid splash' }
  ];
  return {
    snapshotId: 'catalog-4.8.0-test', catalogVersion: '4.8.0', loadedAt: '2026-08-04T00:00:00.000Z',
    manifest: { packageId: 'test', version: '4.8.0', ruleset: '2024', sourceBooks: ['phb-2024'] },
    entries, registry: new Map(), entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories: [], categoryById: new Map(),
    dependenciesFrom: new Map(), dependenciesTo: new Map(), aliases: new Map(),
    filterPolicy: { id: 'policy', kind: 'policy', version: '1', precedence: [], rules: [], profiles: [{ id: 'full-official', name: 'Full', bookStates: { 'phb-2024': true } }], status: 'active' },
    readinessProfile: {}, validation: { status: 'passed', checkedAt: '2026-08-04T00:00:00.000Z', checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true }, counts: { runtimeEntries: 2, registryEntries: 2, dependencyEdges: 0, categories: 0, aliases: 0 }, issues: [] }
  };
};

const character = (): Character => ({
  id: 'character-test', catalogSnapshotId: 'catalog-4.7.0-test', name: 'Test Wizard', level: 1,
  classes: [{ id: 'wizard', name: 'Wizard', level: 1 }], subclasses: [], proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 }, weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  compendiumLinks: [
    { id: 'link-wizard', characterId: 'character-test', itemId: 'catalog:phb-2024-class-wizard', importItemId: 'phb-2024-class-wizard', packId: 'official', sourceId: 'phb-2024', itemType: 'class', appliedAs: 'class', appliedEntityId: 'wizard', appliedEntityName: 'Wizard', status: 'active', addedAt: '2026-08-04T00:00:00.000Z', origin: 'catalog', choiceId: 'catalog:phb-2024-class-wizard', catalogEntityId: 'phb-2024-class-wizard', catalogSnapshotId: 'catalog-4.7.0-test' },
    { id: 'link-spell', characterId: 'character-test', itemId: 'catalog:phb-2024-spell-acid-splash', importItemId: 'phb-2024-spell-acid-splash', packId: 'official', sourceId: 'phb-2024', itemType: 'spell', appliedAs: 'spell', appliedEntityId: 'acid-splash', appliedEntityName: 'Acid Splash', status: 'active', addedAt: '2026-08-04T00:00:00.000Z', origin: 'catalog', choiceId: 'catalog:phb-2024-spell-acid-splash', catalogEntityId: 'phb-2024-spell-acid-splash', catalogSnapshotId: 'catalog-4.7.0-test' },
    { id: 'link-missing', characterId: 'character-test', itemId: 'catalog:removed-entity', importItemId: 'removed-entity', packId: 'official', sourceId: 'phb-2024', itemType: 'feat', appliedAs: 'feat', appliedEntityId: 'removed', appliedEntityName: 'Removed Feat', status: 'active', addedAt: '2026-08-04T00:00:00.000Z', origin: 'catalog', choiceId: 'catalog:removed-entity', catalogEntityId: 'removed-entity', catalogSnapshotId: 'catalog-4.7.0-test' }
  ]
});

const choice = (entityId: string, kind: CharacterChoiceItem['kind'], name: string): CharacterChoiceItem => ({
  choiceId: `catalog:${entityId}`, entityId, kind, name, sourceBookId: 'phb-2024', sourceLabel: 'PHB 2024', origin: 'catalog', catalogSnapshotId: 'catalog-4.8.0-test', catalogEntityId: entityId, ownerIds: [], searchableText: name.toLowerCase(), available: true, blockedReasons: [], manualReviewRequired: false, payload: {},
  provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: 'catalog-4.8.0-test', catalogVersion: '4.8.0', catalogEntityId: entityId, legacyItemIds: [], overrideAuthorized: false }
});

describe('APP-08 character rules compatibility', () => {
  it('builds a read-only manifest and reports disabled, missing and stale references', () => {
    const inputCharacter = character();
    const before = JSON.stringify(inputCharacter);
    const report = buildCharacterCompatibilityReport({
      character: inputCharacter,
      snapshot: snapshot(),
      filterState: { bookStates: { 'phb-2024': true }, categoryStates: {}, entityStates: { 'phb-2024-spell-acid-splash': 'disabled' } },
      choices: [choice('phb-2024-class-wizard', 'class', 'Wizard'), choice('phb-2024-spell-acid-splash', 'spell', 'Acid Splash')],
      now: () => new Date('2026-08-04T03:00:00.000Z')
    });
    expect(report.status).toBe('blocked');
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['CHARACTER_SNAPSHOT_MISMATCH', 'CHARACTER_CATALOG_ENTITY_DISABLED', 'CHARACTER_CATALOG_ENTITY_MISSING']));
    expect(report.manifest.sourceBookIds).toEqual(['phb-2024']);
    expect(report.manifest.catalogSnapshotIds).toEqual(['catalog-4.7.0-test']);
    expect(report.manifest.counts.missing).toBe(1);
    expect(report.manifest.counts.disabled).toBe(1);
    expect(JSON.stringify(inputCharacter)).toBe(before);
  });
});
