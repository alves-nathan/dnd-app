import { useEffect } from 'react';
import { useCatalogStore } from '../store/catalogStore';
import { usePortableRestoreSessionStore } from '../store/portableRestoreSessionStore';
import { capturePortableRestoreCheckpoint } from './portableRestoreSessionExecutor';

const REVALIDATION_INTERVAL_MS = 60 * 60 * 1000;

export const usePortableRestoreEvidenceRevalidation = (): void => {
  const catalogStatus = useCatalogStore((state) => state.status);
  const catalogRevision = useCatalogStore((state) => state.revision);

  useEffect(() => {
    if (catalogStatus !== 'ready') return undefined;
    const run = (force = false) => {
      try {
        const history = useCatalogStore.getState().history;
        usePortableRestoreSessionStore.getState().revalidateEvidenceHistory(
          capturePortableRestoreCheckpoint(),
          history,
          force
        );
      } catch {
        // A inicialização do catálogo ou de alguma store ainda não terminou.
      }
    };
    run(false);
    const timer = setInterval(() => run(false), REVALIDATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [catalogRevision, catalogStatus]);
};
