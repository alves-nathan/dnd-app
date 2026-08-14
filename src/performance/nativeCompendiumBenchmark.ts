import type { CompendiumRepository } from '../storage/compendiumRepository';

export interface NativeBenchmarkTiming {
  durationMs: number;
  itemCount?: number;
}

export interface EventLoopJankSummary {
  samples: number;
  delayedOver32Ms: number;
  delayedOver50Ms: number;
  maximumDelayMs: number;
  p95DelayMs: number;
}

export interface NativeCompendiumBenchmarkReport {
  generatedAt: string;
  inputBytes: number;
  itemCount: number;
  importPackage: NativeBenchmarkTiming;
  coldHydration: NativeBenchmarkTiming;
  incrementalBatchReview: NativeBenchmarkTiming;
  searches: Array<{ query: string; resultCount: number; durationMs: number }>;
  removePack: NativeBenchmarkTiming;
  eventLoopJank: EventLoopJankSummary;
}

export interface NativeBenchmarkOptions {
  coldRepositoryFactory?: () => CompendiumRepository;
  batchSize?: number;
  queries?: string[];
  intervalMs?: number;
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const percentile = (values: number[], ratio: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const startEventLoopMonitor = (intervalMs: number) => {
  const delays: number[] = [];
  let expected = now() + intervalMs;
  const timer = setInterval(() => {
    const current = now();
    delays.push(Math.max(0, current - expected));
    expected = current + intervalMs;
  }, intervalMs);

  return () => {
    clearInterval(timer);
    return {
      samples: delays.length,
      delayedOver32Ms: delays.filter((delay) => delay > 32).length,
      delayedOver50Ms: delays.filter((delay) => delay > 50).length,
      maximumDelayMs: Math.max(0, ...delays),
      p95DelayMs: percentile(delays, 0.95)
    } satisfies EventLoopJankSummary;
  };
};

const timed = async <T>(operation: () => Promise<T>): Promise<{ durationMs: number; value: T }> => {
  const started = now();
  const value = await operation();
  return { durationMs: now() - started, value };
};

export const createSyntheticNativeBenchmarkImport = (itemCount = 1263): string => {
  const source = {
    id: 'native-benchmark-source',
    book: 'Synthetic native benchmark',
    version: '2024',
    status: 'active' as const,
    confidence: 'exact' as const
  };
  const categories = ['spell', 'class', 'weapon', 'ability score improvement'];
  return JSON.stringify({
    id: 'native-benchmark-pack',
    source,
    items: Array.from({ length: itemCount }, (_, index) => {
      const category = categories[index % categories.length] ?? 'feature';
      return {
        id: `native-benchmark-feature-${index}`,
        kind: 'feature',
        name: `${category} native benchmark ${index}`,
        summary: `Synthetic ${category} item for an isolated native SQLite benchmark.`,
        source,
        payload: { sourceType: 'classFeature', benchmarkIndex: index, tags: [category] }
      };
    })
  });
};

export const runNativeCompendiumBenchmark = async (
  repository: CompendiumRepository,
  json: string,
  options: NativeBenchmarkOptions = {}
): Promise<NativeCompendiumBenchmarkReport> => {
  const stopJankMonitor = startEventLoopMonitor(Math.max(8, options.intervalMs ?? 16));
  const queries = options.queries?.length ? options.queries : ['spell', 'class', 'ability score improvement', 'weapon'];

  await repository.clearSnapshot();
  try {
    const imported = await timed(() => repository.saveImportJson(json));
    if (!imported.value.ok || !imported.value.imported) {
      throw new Error(imported.value.issues.map((issue) => issue.message).join('\n') || 'Importação de benchmark falhou.');
    }

    const coldRepository = options.coldRepositoryFactory?.() ?? repository;
    const hydrated = await timed(() => coldRepository.loadSnapshot());
    const batchSize = Math.min(Math.max(1, options.batchSize ?? 250), imported.value.imported.items.length);
    const batchEntries = imported.value.imported.items.slice(0, batchSize).map((item) => ({
      itemId: item.id,
      update: {
        status: 'needsReview' as const,
        reviewDecision: 'pending' as const,
        reviewNotes: 'Native benchmark batch update.',
        reviewedBy: 'benchmark'
      }
    }));
    const batch = await timed(() => repository.updateItemsReview(batchEntries));

    const searches: NativeCompendiumBenchmarkReport['searches'] = [];
    for (const query of queries) {
      const search = await timed(() => repository.searchItems(query, { onlyEnabled: false }));
      searches.push({ query, resultCount: search.value.length, durationMs: search.durationMs });
    }

    const removed = await timed(() => repository.removePack(imported.value.imported!.pack.id));
    return {
      generatedAt: new Date().toISOString(),
      inputBytes: bytes(json),
      itemCount: imported.value.imported.items.length,
      importPackage: { durationMs: imported.durationMs, itemCount: imported.value.imported.items.length },
      coldHydration: { durationMs: hydrated.durationMs, itemCount: hydrated.value.items.length },
      incrementalBatchReview: { durationMs: batch.durationMs, itemCount: batchSize },
      searches,
      removePack: { durationMs: removed.durationMs, itemCount: removed.value.items.length },
      eventLoopJank: stopJankMonitor()
    };
  } catch (error) {
    stopJankMonitor();
    throw error;
  } finally {
    await repository.clearSnapshot();
  }
};

export const formatNativeCompendiumBenchmarkReport = (report: NativeCompendiumBenchmarkReport): string => [
  `Benchmark SQLite nativo · ${(report.inputBytes / 1024 / 1024).toFixed(2)} MiB · ${report.itemCount} itens`,
  `Importação incremental: ${report.importPackage.durationMs.toFixed(2)} ms`,
  `Hidratação em nova instância: ${report.coldHydration.durationMs.toFixed(2)} ms`,
  `Revisão em lote (${report.incrementalBatchReview.itemCount ?? 0} itens): ${report.incrementalBatchReview.durationMs.toFixed(2)} ms`,
  ...report.searches.map((entry) => `Busca "${entry.query}": ${entry.durationMs.toFixed(2)} ms · ${entry.resultCount} resultado(s)`),
  `Remoção do pacote: ${report.removePack.durationMs.toFixed(2)} ms`,
  `Atraso do event loop: p95 ${report.eventLoopJank.p95DelayMs.toFixed(2)} ms · máximo ${report.eventLoopJank.maximumDelayMs.toFixed(2)} ms · >50 ms ${report.eventLoopJank.delayedOver50Ms}`,
  'Observação: o atraso do event loop é um indicador JS. Memória do processo e jank nativo devem ser confirmados no Android Studio/Xcode.'
].join('\n');
