import { ContentPolicyService } from '../catalog/contentPolicyService';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { CatalogSnapshot } from '../catalog/types';
import {
  buildCatalogChangeCharacterImpact,
  createPreventiveCompatibilityPlans
} from '../characters/catalogChangeImpact';
import { createCompatibilityRemediationPlan } from '../characters/compatibilityRemediation';
import type { Character } from '../types';

const makeSnapshot = (): CatalogSnapshot => {
  const categories = [{
    id: 'phb-spells', kind: 'contentCategory', key: 'spells', name: { 'pt-BR': 'Magias' }, sourceBookId: 'phb-2024',
    memberCount: 1, memberEntityIds: ['acid'], defaultEnabled: true, canDisable: true, activationScopes: [], availabilityClasses: [], status: 'active'
  }];
  const entries = [{
    entityId: 'acid', kind: 'spell', displayName: 'Acid Splash', displayContext: [], sourceBookId: 'phb-2024', sourceFile: 'spells.json',
    categoryIds: ['phb-spells'], status: 'active', defaultEnabled: true, manualReviewRequired: false,
    dependencyCounts: { outgoing: 0, incoming: 0 }, searchKey: 'acid splash'
  }];
  return {
    snapshotId: 'catalog-test', catalogVersion: '4.8.0', loadedAt: '2026-08-04T00:00:00.000Z',
    manifest: { packageId: 'test', version: '4.8.0', ruleset: '2024', sourceBooks: ['phb-2024'] },
    entries, registry: new Map(), entryById: new Map(entries.map((entry) => [entry.entityId, entry])), categories,
    categoryById: new Map(categories.map((category) => [category.id, category])), dependenciesFrom: new Map(), dependenciesTo: new Map(), aliases: new Map(),
    filterPolicy: { id: 'policy', kind: 'policy', version: '1', precedence: [], rules: [], profiles: [{ id: 'full-official', name: 'Full', bookStates: { 'phb-2024': true } }], status: 'active' },
    readinessProfile: {}, validation: { status: 'passed', checkedAt: '2026-08-04T00:00:00.000Z', checks: { bundleChecksum: true, versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true }, counts: { runtimeEntries: 1, registryEntries: 1, dependencyEdges: 0, categories: 1, aliases: 0 }, issues: [] }
  };
};

const choice: CharacterChoiceItem = {
  choiceId: 'catalog:acid', entityId: 'acid', kind: 'spell', name: 'Acid Splash', sourceBookId: 'phb-2024', sourceLabel: 'PHB', origin: 'catalog',
  catalogSnapshotId: 'catalog-test', catalogEntityId: 'acid', ownerIds: [], searchableText: 'acid splash', available: true, blockedReasons: [],
  manualReviewRequired: false, payload: {}, provenance: { origin: 'catalog', sourceBookId: 'phb-2024', sourceId: 'phb-2024', catalogSnapshotId: 'catalog-test', catalogVersion: '4.8.0', catalogEntityId: 'acid', legacyItemIds: [], overrideAuthorized: false }
};

const character = (id: string): Character => ({
  id, name: id, level: 1, catalogSnapshotId: 'catalog-test', classes: [], subclasses: [],
  proficiencies: { skills: [], expertiseSkills: [], tools: [], weapons: [], armor: [], languages: [], savingThrows: [] },
  abilities: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 10 }, weapons: [], equipment: [], magicItems: [], feats: [], spells: [], features: [], resources: [], spellSlots: [], activeEffects: [], rotations: [],
  compendiumLinks: [{ id: `${id}-link`, characterId: id, itemId: 'catalog:acid', importItemId: 'acid', packId: 'official', sourceId: 'phb-2024', itemType: 'spell', appliedAs: 'spell', appliedEntityId: `${id}-acid`, appliedEntityName: 'Acid Splash', status: 'active', addedAt: '2026-08-04T00:00:00.000Z', choiceId: 'catalog:acid', origin: 'catalog', catalogEntityId: 'acid', catalogSnapshotId: 'catalog-test' }]
});

describe('APP-11 preventive catalog impact', () => {
  it('attributes only new incompatibilities and creates explicit empty plans', () => {
    const snapshot = makeSnapshot();
    const policy = new ContentPolicyService(snapshot);
    const before = policy.createDefaultState();
    const after = { ...before, entityStates: { acid: 'disabled' as const } };
    const characters = [character('a'), character('b')];
    const serialized = JSON.stringify(characters);
    const preview = buildCatalogChangeCharacterImpact({
      label: 'Desativar Acid Splash', characters, snapshot, beforeFilterState: before, afterFilterState: after,
      choices: [choice], impact: policy.previewImpact(before, after)
    });
    expect(preview.counts.affectedCharacters).toBe(2);
    expect(preview.counts.newBlockingIssues).toBe(2);
    expect(preview.groups.find((group) => group.kind === 'entity')?.characterIds).toHaveLength(2);
    expect(preview.requiresAcknowledgement).toBe(true);

    const existing = createCompatibilityRemediationPlan({ character: characters[1], report: preview.affectedCharacters[1].reportAfter });
    const result = createPreventiveCompatibilityPlans({ preview, characters, existingPlans: { b: existing } });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].origin).toBe('preventiveCatalogChange');
    expect(result.plans[0].decisions).toEqual([]);
    expect(result.skippedCharacterIds).toEqual(['b']);
    expect(JSON.stringify(characters)).toBe(serialized);
  });
});
