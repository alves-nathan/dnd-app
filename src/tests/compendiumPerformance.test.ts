import fs from 'node:fs';
import path from 'node:path';
import { formatCompendiumBenchmarkReport, runCompendiumBenchmark } from '../performance/compendiumBenchmarks';

const source = {
  id: 'benchmark-source',
  book: 'Synthetic benchmark',
  version: '2024',
  status: 'active' as const,
  confidence: 'exact' as const
};

const syntheticImport = JSON.stringify({
  id: 'synthetic-performance-pack',
  source,
  items: Array.from({ length: 1263 }, (_, index) => {
    const categories = ['spell', 'class', 'weapon', 'ability score improvement'];
    const category = categories[index % categories.length]!;
    return {
      id: `benchmark-feature-${index}`,
      kind: 'feature',
      name: `${category} benchmark ${index}`,
      summary: `Synthetic ${category} item used for deterministic performance regression tests.`,
      source,
      payload: { sourceType: 'classFeature', benchmarkIndex: index, tags: [category] }
    };
  })
});

describe('compendium performance harness', () => {
  it('measures a PHB-sized synthetic package without pathological regressions', async () => {
    const report = await runCompendiumBenchmark(syntheticImport, { iterations: 2, searchIterations: 2 });
    console.info(`\n${formatCompendiumBenchmarkReport(report)}\n`);

    expect(report.itemCount).toBe(1263);
    expect(report.parseAndNormalize.medianMs).toBeLessThan(5000);
    expect(report.persistSnapshot.medianMs).toBeLessThan(5000);
    expect(report.hydrateSnapshot.medianMs).toBeLessThan(5000);
    expect(report.filterSwitches.medianMs).toBeLessThan(5000);
    expect(report.searches.every((entry) => entry.resultCount > 0)).toBe(true);
  }, 30000);

  const fullBenchmark = process.env.RUN_PHB_BENCHMARK === '1' ? it : it.skip;
  fullBenchmark('benchmarks the complete PHB package supplied through PHB_IMPORT_PATH', async () => {
    const configuredPath = process.env.PHB_IMPORT_PATH;
    if (!configuredPath) throw new Error('Set PHB_IMPORT_PATH to the consolidated PHB JSON file.');
    const absolutePath = path.resolve(configuredPath);
    const json = fs.readFileSync(absolutePath, 'utf8');
    const report = await runCompendiumBenchmark(json, { iterations: 3, searchIterations: 5 });
    console.info(`\n${formatCompendiumBenchmarkReport(report)}\n`);
    expect(report.itemCount).toBeGreaterThan(1000);
  }, 120000);
});
