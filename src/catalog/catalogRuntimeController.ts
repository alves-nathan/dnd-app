import { CatalogLoader } from './catalogLoader';
import { CatalogQueryService } from './catalogQueryService';
import { ContentPolicyService } from './contentPolicyService';
import type { CatalogFilterState, CatalogLoadOptions, CatalogSnapshot } from './types';

export type CatalogRuntimeStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface CatalogRuntimeState {
  status: CatalogRuntimeStatus;
  snapshot?: CatalogSnapshot;
  filterState?: CatalogFilterState;
  error?: Error;
}

export class CatalogRuntimeController {
  private state: CatalogRuntimeState = { status: 'idle' };
  private readonly listeners = new Set<(state: CatalogRuntimeState) => void>();

  getState(): CatalogRuntimeState {
    return this.state;
  }

  subscribe(listener: (state: CatalogRuntimeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async initialize(rawText: string, options: CatalogLoadOptions = {}): Promise<CatalogSnapshot> {
    this.setState({ status: 'loading' });
    try {
      const snapshot = await new CatalogLoader().initializeFromText(rawText, options);
      const filterState = new ContentPolicyService(snapshot).createDefaultState();
      this.setState({ status: 'ready', snapshot, filterState });
      return snapshot;
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(String(error));
      this.setState({ status: 'failed', error: resolved });
      throw resolved;
    }
  }

  setFilterState(filterState: CatalogFilterState): void {
    if (this.state.status !== 'ready' || !this.state.snapshot) throw new Error('CatalogRuntimeController ainda não está pronto.');
    this.setState({ ...this.state, filterState });
  }

  query(): CatalogQueryService {
    if (!this.state.snapshot) throw new Error('Catálogo ainda não foi carregado.');
    return new CatalogQueryService(this.state.snapshot);
  }

  policy(): ContentPolicyService {
    if (!this.state.snapshot) throw new Error('Catálogo ainda não foi carregado.');
    return new ContentPolicyService(this.state.snapshot);
  }

  private setState(next: CatalogRuntimeState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
