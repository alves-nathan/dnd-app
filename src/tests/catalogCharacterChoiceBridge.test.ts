import { ContentPolicyService } from '../catalog/contentPolicyService';
import { listCharacterChoices, resolveCharacterChoice } from '../catalog/characterChoiceBridge';
import { applyCharacterChoice } from '../catalog/characterChoiceApplication';
import { createEmptyCharacter } from '../data/mockData';
import type { CatalogSnapshot, RuntimeCatalogEntry } from '../catalog/types';
import type { StoredCompendiumItem } from '../compendium/types';

const entry = (overrides: Partial<RuntimeCatalogEntry> & Pick<RuntimeCatalogEntry, 'entityId' | 'kind' | 'displayName'>): RuntimeCatalogEntry => ({
  displayContext: ['phb-2024'],
  sourceBookId: 'phb-2024',
  sourceFile: 'fixture.json',
  categoryIds: ['core'],
  status: 'active',
  defaultEnabled: true,
  manualReviewRequired: false,
  dependencyCounts: { outgoing: 0, incoming: 0 },
  searchKey: overrides.displayName.toLowerCase(),
  ...overrides
});

const item = (
  id: string,
  type: StoredCompendiumItem['type'],
  name: string,
  sourceId = 'phb-2024',
  status: StoredCompendiumItem['status'] = 'validated',
  payload: Record<string, unknown> = {}
): StoredCompendiumItem => ({
  id: `pack:${id}`,
  importItemId: id,
  packId: 'pack',
  sourceId,
  type,
  name,
  rawJson: {
    id,
    kind: type,
    name,
    source: { id: sourceId, book: sourceId, status: 'active', confidence: 'exact' },
    payload
  },
  normalizedJson: { ...payload, id, name, type, sourceId },
  tags: [type, name.toLowerCase()],
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
});

const makeSnapshot = (): CatalogSnapshot => {
  const entries = [
    entry({ entityId: 'phb-2024-class-wizard', kind: 'class', displayName: 'Wizard' }),
    entry({ entityId: 'phb-2024-feat-alert', kind: 'feat', displayName: 'Alert', manualReviewRequired: true }),
    entry({ entityId: 'phb-2024-subclass-evoker', kind: 'subclass', displayName: 'Evoker' })
  ];
  const category = {
    id: 'core', kind: 'contentCategory', key: 'core', name: { en: 'Core' }, sourceBookId: 'phb-2024',
    memberCount: entries.length, memberEntityIds: entries.map((candidate) => candidate.entityId), defaultEnabled: true,
    canDisable: true, activationScopes: [], availabilityClasses: [], status: 'active'
  };
  return {
    snapshotId: 'catalog-fixture',
    catalogVersion: '4.8.0',
    loadedAt: '2026-01-01T00:00:00.000Z',
    manifest: { packageId: 'fixture', version: '4.8.0', ruleset: '2024', sourceBooks: ['phb-2024'] },
    entries,
    registry: new Map(entries.map((candidate) => [candidate.entityId, {
      entityId: candidate.entityId, kind: candidate.kind, sourceBookId: candidate.sourceBookId,
      sourceFile: candidate.sourceFile, name: candidate.displayName, status: 'active', defaultEnabled: true,
      manualReviewRequired: candidate.manualReviewRequired
    }])),
    entryById: new Map(entries.map((candidate) => [candidate.entityId, candidate])),
    categories: [category],
    categoryById: new Map([[category.id, category]]),
    dependenciesFrom: new Map([
      ['phb-2024-subclass-evoker', [{
        id: 'owner', fromId: 'phb-2024-subclass-evoker', toId: 'phb-2024-class-wizard', relation: 'ownedByClass',
        strength: 'ownership', resolutionPolicy: 'requireEnabled', crossBook: false, status: 'active'
      }]]
    ]),
    dependenciesTo: new Map(),
    aliases: new Map([['legacy-wizard', {
      id: 'alias', kind: 'alias', from: 'legacy-wizard', to: 'phb-2024-class-wizard', relation: 'renamed',
      resolutionPolicy: 'canonicalize', status: 'active'
    }]]),
    filterPolicy: {
      id: 'policy', kind: 'contentFilterPolicy', version: '1', precedence: [], rules: [], status: 'active',
      profiles: [{ id: 'full-official', name: 'Full', bookStates: { 'phb-2024': true } }]
    },
    readinessProfile: {},
    validation: {
      status: 'passed', checkedAt: '2026-01-01T00:00:00.000Z',
      checks: { bundleChecksum: 'notRequested', versionCoherence: true, counts: true, uniqueEntityIds: true, registryCoverage: true, categoryReferences: true, dependencyReferences: true, aliasReferences: true },
      counts: { runtimeEntries: entries.length, registryEntries: entries.length, dependencyEdges: 1, categories: 1, aliases: 1 }, issues: []
    }
  };
};

describe('APP-03 character choice bridge', () => {
  it('combines official and local content without duplicating official carriers', () => {
    const snapshot = makeSnapshot();
    const filterState = new ContentPolicyService(snapshot).createDefaultState();
    const officialCarrier = item('legacy-wizard', 'class', 'Wizard');
    const officialFeat = item('phb-2024-feat-alert', 'feat', 'Alert');
    const subclass = item('phb-2024-subclass-evoker', 'subclass', 'Evoker', 'phb-2024', 'validated', { classId: 'phb-2024-class-wizard' });
    const homebrew = item('homebrew-wizard', 'class', 'Wizard', 'homebrew');
    const needsReview = item('draft-class', 'class', 'Draft Class', 'homebrew', 'needsReview');
    const disabledLocal = item('disabled-class', 'class', 'Disabled Class', 'homebrew', 'disabled');

    const result = listCharacterChoices({
      snapshot,
      filterState,
      compendiumItems: [officialCarrier, officialFeat, subclass, homebrew, needsReview, disabledLocal],
      enabledSourceIds: ['phb-2024', 'homebrew']
    });

    expect(result.choices.filter((choice) => choice.name === 'Wizard')).toHaveLength(2);
    expect(result.choices.some((choice) => choice.choiceId === 'catalog:phb-2024-class-wizard')).toBe(true);
    expect(result.choices.some((choice) => choice.choiceId === `compendium:${officialCarrier.id}`)).toBe(false);
    const reviewChoice = result.choices.find((choice) => choice.choiceId === `compendium:${needsReview.id}`);
    expect(reviewChoice).toMatchObject({
      available: true,
      manualReviewRequired: true,
      blockedReasons: []
    });
    expect(result.choices.find((choice) => choice.entityId === 'phb-2024-feat-alert')?.manualReviewRequired).toBe(true);
    expect(result.choices.some((choice) => choice.choiceId === `compendium:${disabledLocal.id}`)).toBe(false);
    expect(result.choices.find((choice) => choice.entityId === 'phb-2024-subclass-evoker')?.ownerIds).toContain('phb-2024-class-wizard');
  });

  it('keeps technical spell-list and import-index records out of character choices', () => {
    const snapshot = makeSnapshot();
    const filterState = new ContentPolicyService(snapshot).createDefaultState();
    const spellList = item('phb-2024-spell-list-wizard', 'feature', 'Wizard Spell List', 'phb-2024', 'needsReview', {
      sourceType: 'spellList',
      listKind: 'classSpellList',
      classId: 'phb-2024-class-wizard'
    });
    const importIndex = item('phb-2024-import-index-and-dependencies', 'feature', 'PHB 2024 Import Index and Dependencies', 'phb-2024', 'needsReview', {
      sourceType: 'importIndex'
    });

    const input = {
      snapshot,
      filterState,
      compendiumItems: [spellList, importIndex],
      enabledSourceIds: ['phb-2024']
    };
    const visible = listCharacterChoices(input);
    const inspectable = listCharacterChoices(input, { includeUnavailable: true });

    expect(visible.choices).toHaveLength(0);
    expect(inspectable.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        choiceId: `compendium:${spellList.id}`,
        available: false,
        blockedReasons: expect.arrayContaining([expect.objectContaining({ code: 'unsupportedKind' })])
      }),
      expect.objectContaining({
        choiceId: `compendium:${importIndex.id}`,
        available: false,
        blockedReasons: expect.arrayContaining([expect.objectContaining({ code: 'unsupportedKind' })])
      })
    ]));
  });

  it('applies an enabled local needsReview feat without changing its editorial state', () => {
    const snapshot = makeSnapshot();
    const filterState = new ContentPolicyService(snapshot).createDefaultState();
    const reviewFeat = item('tcoe-2020-feat-metamagic-adept', 'feat', 'Metamagic Adept', 'tcoe-2020', 'needsReview', { category: 'general' });
    const result = listCharacterChoices({
      snapshot,
      filterState,
      compendiumItems: [reviewFeat],
      enabledSourceIds: ['tcoe-2020']
    });
    const reviewChoice = result.choices.find((candidate) => candidate.compendiumItemId === reviewFeat.id);

    expect(reviewChoice).toMatchObject({ available: true, manualReviewRequired: true });
    const applied = applyCharacterChoice({ character: createEmptyCharacter('Wizard'), choice: reviewChoice! });

    expect(applied.ok).toBe(true);
    expect(applied.character.feats.map((feat) => feat.name)).toContain('Metamagic Adept');
    expect(applied.character.compendiumLinks?.find((link) => link.appliedAs === 'feat')).toMatchObject({
      status: 'active',
      manualReviewRequired: true,
      choiceId: reviewChoice?.choiceId
    });
    expect(reviewFeat.status).toBe('needsReview');
  });

  it('respects book filters and resolves legacy references', () => {
    const snapshot = makeSnapshot();
    const defaultState = new ContentPolicyService(snapshot).createDefaultState();
    const carrier = item('legacy-wizard', 'class', 'Wizard');
    const input = { snapshot, filterState: defaultState, compendiumItems: [carrier], enabledSourceIds: ['phb-2024'] };

    expect(resolveCharacterChoice(carrier.id, input).canonicalChoiceId).toBe('catalog:phb-2024-class-wizard');

    const disabled = { ...defaultState, bookStates: { 'phb-2024': false } };
    expect(listCharacterChoices({ ...input, filterState: disabled }, { kinds: ['class'] }).choices).toHaveLength(0);
    const unavailable = listCharacterChoices({ ...input, filterState: disabled }, { kinds: ['class'], includeUnavailable: true }).choices[0];
    expect(unavailable?.available).toBe(false);
    expect(unavailable?.blockedReasons[0]?.code).toBe('sourceBookDisabled');
  });
});
