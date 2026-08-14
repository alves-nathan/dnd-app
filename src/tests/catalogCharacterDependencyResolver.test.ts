import { resolveCharacterPendingChoice } from '../catalog/characterDependencyResolver';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { CatalogSnapshot, DependencyEdge, RuntimeCatalogEntry } from '../catalog/types';
import { createEmptyCharacter } from '../data/mockData';

const entry = (entityId: string, kind: string, displayName: string): RuntimeCatalogEntry => ({
  entityId,
  kind,
  displayName,
  displayContext: [],
  sourceBookId: 'phb-2024',
  sourceFile: 'test.json',
  categoryIds: [],
  status: 'ready',
  defaultEnabled: true,
  manualReviewRequired: false,
  dependencyCounts: { outgoing: 0, incoming: 0 },
  searchKey: displayName.toLowerCase()
});

const choice = (
  entityId: string,
  kind: CharacterChoiceItem['kind'],
  name: string,
  available = true
): CharacterChoiceItem => ({
  choiceId: `catalog:${entityId}`,
  entityId,
  kind,
  name,
  sourceBookId: 'phb-2024',
  sourceLabel: 'Player’s Handbook (2024)',
  origin: 'catalog',
  catalogSnapshotId: 'catalog-4.8.0-test',
  catalogEntityId: entityId,
  ownerIds: [],
  searchableText: name.toLowerCase(),
  available,
  blockedReasons: available ? [] : [{ code: 'entityDisabled', message: 'Desativado para o teste.' }],
  manualReviewRequired: false,
  payload: {},
  provenance: {
    origin: 'catalog',
    sourceId: 'phb-2024',
    sourceBookId: 'phb-2024',
    catalogSnapshotId: 'catalog-4.8.0-test',
    catalogVersion: '4.8.0',
    catalogEntityId: entityId,
    legacyItemIds: [],
    overrideAuthorized: false
  }
});

const edge = (id: string, fromId: string, toId: string, relation: string): DependencyEdge => ({
  id,
  fromId,
  toId,
  relation,
  strength: 'hard',
  resolutionPolicy: 'requireEnabled',
  crossBook: false,
  status: 'resolved'
});

const snapshotFrom = (entries: RuntimeCatalogEntry[], edges: DependencyEdge[]): CatalogSnapshot => {
  const dependenciesFrom = new Map<string, DependencyEdge[]>();
  const dependenciesTo = new Map<string, DependencyEdge[]>();
  edges.forEach((dependency) => {
    dependenciesFrom.set(dependency.fromId, [...(dependenciesFrom.get(dependency.fromId) ?? []), dependency]);
    dependenciesTo.set(dependency.toId, [...(dependenciesTo.get(dependency.toId) ?? []), dependency]);
  });
  return {
    snapshotId: 'catalog-4.8.0-test',
    catalogVersion: '4.8.0',
    loadedAt: '2026-08-03T00:00:00.000Z',
    manifest: { packageId: 'test', version: '4.8.0', ruleset: '2024', sourceBooks: ['phb-2024'] },
    entries,
    registry: new Map(),
    entryById: new Map(entries.map((item) => [item.entityId, item])),
    categories: [],
    categoryById: new Map(),
    dependenciesFrom,
    dependenciesTo,
    aliases: new Map(),
    filterPolicy: { id: 'policy', kind: 'policy', version: '1', precedence: [], rules: [], profiles: [], status: 'ready' },
    readinessProfile: {},
    validation: {
      status: 'passed',
      catalogVersion: '4.8.0',
      checkedAt: '2026-08-03T00:00:00.000Z',
      checks: {
        bundleChecksum: true,
        versionCoherence: true,
        counts: true,
        uniqueEntityIds: true,
        registryCoverage: true,
        categoryReferences: true,
        dependencyReferences: true,
        aliasReferences: true
      },
      counts: { runtimeEntries: entries.length, registryEntries: entries.length, dependencyEdges: edges.length, categories: 0, aliases: 0 },
      issues: []
    }
  };
};

describe('APP-04 dependency-aware pending choices', () => {
  it('traverses choice contracts and separates available from blocked candidates', () => {
    const feat = entry('feat-magic-training', 'feat', 'Magic Training');
    const contract = entry('feat-magic-training-choice-spells', 'choiceContract', 'Spell choices');
    const spellA = entry('spell-light', 'spell', 'Light');
    const spellB = entry('spell-mage-hand', 'spell', 'Mage Hand');
    const snapshot = snapshotFrom([feat, contract, spellA, spellB], [
      edge('e1', feat.entityId, contract.entityId, 'offersChoice'),
      edge('e2', contract.entityId, spellA.entityId, 'referencesSpell'),
      edge('e3', contract.entityId, spellB.entityId, 'referencesSpell')
    ]);
    const choices = [
      choice(feat.entityId, 'feat', feat.displayName),
      choice(spellA.entityId, 'spell', spellA.displayName),
      choice(spellB.entityId, 'spell', spellB.displayName, false)
    ];
    const character = createEmptyCharacter('Resolver');
    character.feats = [{ id: 'feat-instance', name: feat.displayName, source: { id: 'test', status: 'active', confidence: 'exact' } }];
    character.compendiumLinks = [{
      id: 'link-feat',
      characterId: character.id,
      itemId: `catalog:${feat.entityId}`,
      choiceId: `catalog:${feat.entityId}`,
      catalogEntityId: feat.entityId,
      origin: 'catalog',
      importItemId: feat.entityId,
      packId: 'catalog',
      sourceId: 'phb-2024',
      itemType: 'feat',
      appliedAs: 'feat',
      appliedEntityId: 'feat-instance',
      appliedEntityName: feat.displayName,
      status: 'active',
      addedAt: '2026-08-03T00:00:00.000Z'
    }];
    const pendingChoice = {
      id: 'pending-feat-options',
      kind: 'featOptions' as const,
      title: 'Escolha magias',
      description: 'Selecione as magias concedidas.',
      sourceEntityId: 'feat-instance',
      status: 'pending' as const,
      createdAt: '2026-08-03T00:00:00.000Z'
    };

    const result = resolveCharacterPendingChoice({ character, pendingChoice, choices, snapshot });

    expect(result.mode).toBe('dependency');
    expect(result.relationTypes).toEqual(['offersChoice', 'referencesSpell']);
    expect(result.availableCandidateChoices.map((item) => item.choiceId)).toEqual(['catalog:spell-light']);
    expect(result.blockedCandidateChoices.map((item) => item.choiceId)).toEqual(['catalog:spell-mage-hand']);
    expect(result.issues.some((issue) => issue.code === 'CATALOG_PENDING_CHOICE_BLOCKED_CANDIDATES')).toBe(true);
  });

  it('falls back by compatible kind when a legacy pending choice has no canonical source', () => {
    const spell = entry('spell-shield', 'spell', 'Shield');
    const snapshot = snapshotFrom([spell], []);
    const character = createEmptyCharacter('Legacy');
    const pendingChoice = {
      id: 'pending-legacy-spell',
      kind: 'spellSelection' as const,
      title: 'Escolha uma magia',
      description: 'Pendência anterior ao catálogo.',
      status: 'pending' as const,
      createdAt: '2026-08-03T00:00:00.000Z'
    };

    const result = resolveCharacterPendingChoice({
      character,
      pendingChoice,
      choices: [choice(spell.entityId, 'spell', spell.displayName)],
      snapshot
    });

    expect(result.mode).toBe('kindFallback');
    expect(result.availableCandidateChoices[0]?.choiceId).toBe('catalog:spell-shield');
    expect(result.issues.some((issue) => issue.code === 'CATALOG_PENDING_CHOICE_SOURCE_UNRESOLVED')).toBe(true);
  });
});
