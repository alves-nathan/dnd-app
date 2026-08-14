import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';
import {
  createSyntheticNativeBenchmarkImport,
  formatNativeCompendiumBenchmarkReport,
  runNativeCompendiumBenchmark
} from '../performance/nativeCompendiumBenchmark';

describe('native compendium benchmark harness', () => {
  it('runs against the repository contract and cleans the isolated data', async () => {
    const storage = createMemoryKeyValueStorage();
    const repository = new KeyValueCompendiumRepository(storage);
    const report = await runNativeCompendiumBenchmark(repository, createSyntheticNativeBenchmarkImport(120), {
      batchSize: 30,
      coldRepositoryFactory: () => new KeyValueCompendiumRepository(storage),
      intervalMs: 8
    });

    expect(report.itemCount).toBe(120);
    expect(report.incrementalBatchReview.itemCount).toBe(30);
    expect(report.searches).toHaveLength(4);
    expect(report.searches.every((entry) => entry.resultCount > 0)).toBe(true);
    expect((await repository.loadSnapshot()).items).toHaveLength(0);
    expect(formatNativeCompendiumBenchmarkReport(report)).toContain('Benchmark SQLite nativo');
  });
});
