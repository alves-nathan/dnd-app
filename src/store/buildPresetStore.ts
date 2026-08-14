import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { characterStorage } from '../storage/characterStorage';
import type { Character } from '../types';
import { applyBuildPresetToCharacter, ApplyBuildPresetOptions, BuildPreset, createBuildPresetFromCharacter } from '../presets/buildPresets';
import { migrateBuildPresetPersistenceState } from '../releaseCandidate/persistenceMigrations';

export const BUILD_PRESET_STORE_VERSION = 1;

interface BuildPresetStore {
  presets: BuildPreset[];
  createFromCharacter: (character: Character, name?: string, description?: string, tags?: string[]) => BuildPreset;
  removePreset: (presetId: string) => void;
  updatePreset: (presetId: string, update: Partial<Pick<BuildPreset, 'name' | 'description' | 'tags'>>) => void;
  applyPreset: (character: Character, presetId: string, options: ApplyBuildPresetOptions) => Character | undefined;
  setPresets: (presets: BuildPreset[]) => void;
  clearPresets: () => void;
}

export const useBuildPresetStore = create<BuildPresetStore>()(
  persist(
    (set, get) => ({
      presets: [],
      createFromCharacter: (character, name, description, tags = []) => {
        const preset = createBuildPresetFromCharacter(character, name, description, tags);
        set({ presets: [preset, ...get().presets] });
        return preset;
      },
      removePreset: (presetId) => set({ presets: get().presets.filter((preset) => preset.id !== presetId) }),
      updatePreset: (presetId, update) => {
        const updatedAt = new Date().toISOString();
        set({ presets: get().presets.map((preset) => (preset.id === presetId ? { ...preset, ...update, updatedAt } : preset)) });
      },
      applyPreset: (character, presetId, options) => {
        const preset = get().presets.find((entry) => entry.id === presetId);
        if (!preset) return undefined;
        return applyBuildPresetToCharacter(character, preset, options);
      },
      setPresets: (presets) => set({ presets }),
      clearPresets: () => set({ presets: [] })
    }),
    {
      name: 'dnd-combat-math-build-presets',
      version: BUILD_PRESET_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      migrate: (persisted) => migrateBuildPresetPersistenceState(persisted)
    }
  )
);
