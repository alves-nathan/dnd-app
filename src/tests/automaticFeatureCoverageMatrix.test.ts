import type { StoredCompendiumItem } from '../compendium/types';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { buildPersistedCompendiumImport } from '../compendium/importer';
import {
  buildAutomaticFeatureCoverageReport,
  classifyAutomaticFeatureCoverage
} from '../compendium/automaticFeatureCoverage';

const items = BUNDLED_COMPENDIUM_PACKS.flatMap((pack) =>
  buildPersistedCompendiumImport(pack.load() as Parameters<typeof buildPersistedCompendiumImport>[0], {
    importedAt: '2026-08-19T00:00:00.000Z'
  }).items
);

const byImportId = (id: string): StoredCompendiumItem => {
  const item = items.find((candidate) => candidate.importItemId === id);
  if (!item) throw new Error(`Fixture ausente: ${id}`);
  return item;
};

const kinds = (id: string): string[] =>
  classifyAutomaticFeatureCoverage(byImportId(id)).signals.map((signal) => signal.kind);

describe('automatic feature/resource coverage matrix', () => {
  it('keeps every bundled class/subclass progression feature explicitly represented', () => {
    const report = buildAutomaticFeatureCoverageReport(items);

    expect(report.progressionFeatureCount).toBeGreaterThan(600);
    expect(report.failures.missingProgressionFeatures).toEqual([]);
    expect(report.failures.uncoveredFeatures).toEqual([]);
    expect(report.failures.malformedResourceConsumers).toEqual([]);
    expect(report.failures.malformedGrantedActions).toEqual([]);
    expect(report.failures.unresolvedSpellAccessFeatures).toEqual([]);
    expect(report.entries.some((entry) => entry.importItemId === 'phb-2024-spell-list-bard')).toBe(false);

    expect(report.coverageCounts.passive).toBeGreaterThan(0);
    expect(report.coverageCounts.resourcePool).toBeGreaterThan(0);
    expect(report.coverageCounts.resourceConsumer).toBeGreaterThan(0);
    expect(report.coverageCounts.resourceUpdater).toBeGreaterThan(0);
    expect(report.coverageCounts.grantedAction).toBeGreaterThan(0);
    expect(report.coverageCounts.grantedSpell).toBeGreaterThan(0);
    expect(report.coverageCounts.choice).toBeGreaterThan(0);
    expect(report.coverageCounts.manual).toBeGreaterThan(0);
  });

  it('classifies sentinel mechanics without conflating pools, consumers, choices, spells and actions', () => {
    expect(kinds('phb-2024-feature-bard-college-of-glamour-mantle-of-inspiration')).toContain('resourceConsumer');
    expect(kinds('phb-2024-feature-bard-college-of-glamour-beguiling-magic')).toContain('resourcePool');
    const actionSurge = classifyAutomaticFeatureCoverage(byImportId('phb-2024-feature-fighter-action-surge'));
    expect(actionSurge.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resourcePool' }),
      expect.objectContaining({ kind: 'grantedAction', runtime: 'executable' })
    ]));
    expect(kinds('phb-2024-feature-fighter-extra-attack')).toContain('passive');
    expect(kinds('phb-2024-feature-fighter-fighting-style')).toContain('choice');
    expect(kinds('phb-2024-feature-fighter-eldritch-knight-spellcasting')).toContain('grantedSpell');
    expect(kinds('phb-2024-feature-bard-spellcasting')).toContain('grantedSpell');
    expect(kinds('phb-2024-feature-warlock-pact-magic')).toContain('grantedSpell');
    expect(kinds('phb-2024-feature-monk-martial-arts')).toContain('grantedAction');
  });

  it('keeps unsupported/complex mechanics visible as manual instead of pretending they are executable', () => {
    const superior = classifyAutomaticFeatureCoverage(byImportId('phb-2024-feature-bard-superior-inspiration'));
    expect(superior.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resourceUpdater', runtime: 'manual' })
    ]));
  });

  it('marks variable consumers as manual without treating them as malformed', () => {
    const base = byImportId('phb-2024-feature-bard-college-of-glamour-mantle-of-inspiration');
    const synthetic: StoredCompendiumItem = {
      ...base,
      id: 'coverage-variable-consumer',
      importItemId: 'coverage-variable-consumer',
      name: 'Variable Consumer',
      normalizedJson: {
        ...base.normalizedJson,
        consumes: [{ resourceId: 'sorcerer-sorcery-points', amount: '1-5' }]
      }
    };
    const coverage = classifyAutomaticFeatureCoverage(synthetic);
    expect(coverage.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resourceConsumer', runtime: 'manual' }),
      expect.objectContaining({ kind: 'manual', runtime: 'manual' })
    ]));
    expect(coverage.gaps).toEqual([]);
  });


  it('keeps truly malformed action declarations visible as gate failures', () => {
    const base = byImportId('phb-2024-feature-fighter-action-surge');
    const synthetic: StoredCompendiumItem = {
      ...base,
      id: 'coverage-malformed-action',
      importItemId: 'coverage-malformed-action',
      name: 'Malformed Action',
      normalizedJson: {
        ...base.normalizedJson,
        grantsActions: [{ name: 'Missing type' }]
      }
    };
    const coverage = classifyAutomaticFeatureCoverage(synthetic);
    expect(coverage.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grantedAction', runtime: 'manual' })
    ]));
    expect(coverage.gaps).toEqual(expect.arrayContaining([
      expect.stringMatching(/^GRANTED_ACTION_DECLARATION_MALFORMED:/)
    ]));
  });


});
