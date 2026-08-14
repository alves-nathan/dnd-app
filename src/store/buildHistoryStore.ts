import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { BuildHistorySnapshot } from '../types';
import { characterStorage } from '../storage/characterStorage';

interface BuildHistoryStore {
  snapshots: BuildHistorySnapshot[];
  addSnapshot: (snapshot: BuildHistorySnapshot) => void;
  removeSnapshot: (snapshotId: string) => void;
  removeCharacterSnapshots: (characterId: string) => void;
  renameSnapshot: (snapshotId: string, name: string) => void;
  updateSnapshotNotes: (snapshotId: string, notes: string) => void;
  setSnapshots: (snapshots: BuildHistorySnapshot[]) => void;
}

const sortSnapshots = (snapshots: BuildHistorySnapshot[]): BuildHistorySnapshot[] =>
  snapshots.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt));

export const useBuildHistoryStore = create<BuildHistoryStore>()(
  persist(
    (set, get) => ({
      snapshots: [],
      addSnapshot: (snapshot) => {
        const withoutExisting = get().snapshots.filter((item) => item.id !== snapshot.id);
        set({ snapshots: sortSnapshots([snapshot, ...withoutExisting]) });
      },
      removeSnapshot: (snapshotId) => {
        set({ snapshots: get().snapshots.filter((snapshot) => snapshot.id !== snapshotId) });
      },
      removeCharacterSnapshots: (characterId) => {
        set({ snapshots: get().snapshots.filter((snapshot) => snapshot.characterId !== characterId) });
      },
      renameSnapshot: (snapshotId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set({
          snapshots: get().snapshots.map((snapshot) =>
            snapshot.id === snapshotId ? { ...snapshot, name: trimmed } : snapshot
          )
        });
      },
      updateSnapshotNotes: (snapshotId, notes) => {
        set({
          snapshots: get().snapshots.map((snapshot) =>
            snapshot.id === snapshotId ? { ...snapshot, notes: notes.trim() || undefined } : snapshot
          )
        });
      },
      setSnapshots: (snapshots) => set({ snapshots: sortSnapshots(snapshots) })
    }),
    {
      name: 'dnd-combat-math-build-history',
      storage: createJSONStorage(() => characterStorage),
      version: 1
    }
  )
);
