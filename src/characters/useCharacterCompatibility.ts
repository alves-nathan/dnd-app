import { useMemo } from 'react';
import { useCatalogStore } from '../store/catalogStore';
import type { Character } from '../types';
import { useCharacterChoiceBridge } from '../catalog/useCharacterChoiceBridge';
import { buildCharacterCompatibilityReport, type CharacterCompatibilityReport } from './characterCompatibility';

export interface CharacterCompatibilityView {
  status: 'loading' | 'ready' | 'failed';
  report?: CharacterCompatibilityReport;
  error?: string;
}

export const useCharacterCompatibility = (character: Character | undefined): CharacterCompatibilityView => {
  const catalogStatus = useCatalogStore((state) => state.status);
  const snapshot = useCatalogStore((state) => state.snapshot);
  const filterState = useCatalogStore((state) => state.filterState);
  const catalogError = useCatalogStore((state) => state.lastError);
  const bridge = useCharacterChoiceBridge();

  return useMemo(() => {
    if (!character) return { status: 'failed', error: 'Personagem não encontrado.' };
    if (catalogStatus === 'failed' || bridge.status === 'failed' || catalogError) {
      return { status: 'failed', error: catalogError ?? 'Não foi possível carregar o catálogo para diagnosticar a ficha.' };
    }
    if (!snapshot || !filterState || catalogStatus !== 'ready' || bridge.status !== 'ready') {
      return { status: 'loading' };
    }
    return {
      status: 'ready',
      report: buildCharacterCompatibilityReport({ character, snapshot, filterState, choices: bridge.choices })
    };
  }, [bridge.choices, bridge.status, catalogError, catalogStatus, character, filterState, snapshot]);
};
