import { parseAndBuildPersistedImport } from '../compendium/importer';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';

export interface BenchmarkDistribution {
  samplesMs: number[];
  minMs: number;
  medianMs: number;
  maxMs: number;
  averageMs: number;
}

export interface CompendiumBenchmarkReport {
  inputBytes: number;
  itemCount: number;
  parseAndNormalize: BenchmarkDistribution;
  persistSnapshot: BenchmarkDistribution;
  hydrateSnapshot: BenchmarkDistribution;
  searches: Array<{ query: string; resultCount: number; timing: BenchmarkDistribution }>;
  filterSwitches: BenchmarkDistribution;
  heapDeltaBytes?: number;
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

const memoryUsage = (): number | undefined => {
  const runtime = globalThis as typeof globalThis & {
    process?: { memoryUsage?: () => { heapUsed: number } };
  };
  return runtime.process?.memoryUsage?.().heapUsed;
};

const distribution = (samples: number[]): BenchmarkDistribution => {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2
    ? sorted[middle] ?? 0
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const sum = sorted.reduce((total, sample) => total + sample, 0);
  return {
    samplesMs: samples,
    minMs: sorted[0] ?? 0,
    medianMs,
    maxMs: sorted.at(-1) ?? 0,
    averageMs: samples.length ? sum / samples.length : 0
  };
};

const timeSync = <T>(operation: () => T): { durationMs: number; value: T } => {
  const started = now();
  const value = operation();
  return { durationMs: now() - started, value };
};

const timeAsync = async <T>(operation: () => Promise<T>): Promise<{ durationMs: number; value: T }> => {
  const started = now();
  const value = await operation();
  return { durationMs: now() - started, value };
};

export interface RunCompendiumBenchmarkOptions {
  iterations?: number;
  searchIterations?: number;
  queries?: string[];
}

/**
 * Benchmarks the same pure/import and key-value persistence paths used by the
 * app. SQLite device measurements are exposed separately in Diagnostics,
 * because expo-sqlite requires a native runtime.
 */
export const runCompendiumBenchmark = async (
  json: string,
  options: RunCompendiumBenchmarkOptions = {}
): Promise<CompendiumBenchmarkReport> => {
  const iterations = Math.max(1, options.iterations ?? 3);
  const searchIterations = Math.max(1, options.searchIterations ?? 5);
  const queries = options.queries?.length ? options.queries : ['spell', 'class', 'ability score improvement', 'weapon'];
  const heapBefore = memoryUsage();

  const parseSamples: number[] = [];
  let parsed = parseAndBuildPersistedImport(json);
  for (let index = 0; index < iterations; index += 1) {
    const sample = timeSync(() => parseAndBuildPersistedImport(json));
    parseSamples.push(sample.durationMs);
    parsed = sample.value;
  }
  if (!parsed.ok || !parsed.persisted) {
    throw new Error(parsed.issues.map((issue) => issue.message).join('\n') || 'Benchmark input is not a valid compendium import.');
  }

  const storage = createMemoryKeyValueStorage();
  const repository = new KeyValueCompendiumRepository(storage, 'benchmark-compendium');
  const persistSamples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const sample = await timeAsync(() => repository.saveImportJson(json));
    if (!sample.value.ok) throw new Error(sample.value.issues.map((issue) => issue.message).join('\n'));
    persistSamples.push(sample.durationMs);
  }

  const hydrateSamples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const sample = await timeAsync(() => repository.loadSnapshot());
    hydrateSamples.push(sample.durationMs);
  }

  const searches: CompendiumBenchmarkReport['searches'] = [];
  for (const query of queries) {
    const samples: number[] = [];
    let resultCount = 0;
    for (let index = 0; index < searchIterations; index += 1) {
      const sample = await timeAsync(() => repository.searchItems(query, { onlyEnabled: false }));
      samples.push(sample.durationMs);
      resultCount = sample.value.length;
    }
    searches.push({ query, resultCount, timing: distribution(samples) });
  }

  const filterVariants = [
    { types: ['class' as const], onlyEnabled: false },
    { types: ['subclass' as const], onlyEnabled: false },
    { types: ['feat' as const], onlyEnabled: false },
    { types: ['spell' as const], onlyEnabled: false },
    { statuses: ['needsReview' as const], onlyEnabled: false },
    { statuses: ['validated' as const], onlyEnabled: false }
  ];
  const filterSamples: number[] = [];
  for (let index = 0; index < searchIterations; index += 1) {
    const sample = await timeAsync(async () => {
      for (const filters of filterVariants) await repository.searchItems('', filters);
    });
    filterSamples.push(sample.durationMs);
  }

  const heapAfter = memoryUsage();
  return {
    inputBytes: new TextEncoder().encode(json).byteLength,
    itemCount: parsed.persisted.items.length,
    parseAndNormalize: distribution(parseSamples),
    persistSnapshot: distribution(persistSamples),
    hydrateSnapshot: distribution(hydrateSamples),
    searches,
    filterSwitches: distribution(filterSamples),
    heapDeltaBytes: heapBefore !== undefined && heapAfter !== undefined ? heapAfter - heapBefore : undefined
  };
};

export const formatCompendiumBenchmarkReport = (report: CompendiumBenchmarkReport): string => {
  const line = (label: string, timing: BenchmarkDistribution) =>
    `${label}: mediana ${timing.medianMs.toFixed(2)} ms · média ${timing.averageMs.toFixed(2)} ms · min ${timing.minMs.toFixed(2)} · max ${timing.maxMs.toFixed(2)}`;
  return [
    `Compendium benchmark · ${(report.inputBytes / 1024 / 1024).toFixed(2)} MiB · ${report.itemCount} itens`,
    line('Parse/normalização', report.parseAndNormalize),
    line('Persistência key-value', report.persistSnapshot),
    line('Hidratação', report.hydrateSnapshot),
    line('Troca de filtros', report.filterSwitches),
    ...report.searches.map((entry) => `${line(`Busca "${entry.query}"`, entry.timing)} · ${entry.resultCount} resultado(s)`),
    report.heapDeltaBytes === undefined ? 'Delta de heap: indisponível neste runtime' : `Delta de heap: ${(report.heapDeltaBytes / 1024 / 1024).toFixed(2)} MiB`
  ].join('\n');
};
