import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  BetaFeedbackEntry,
  BetaFeedbackStatus,
  CreateBetaFeedbackInput,
  createBetaFeedbackEntry,
  updateBetaFeedbackEntry
} from '../release/betaFeedback';
import { characterStorage } from '../storage/characterStorage';

interface BetaFeedbackStore {
  entries: BetaFeedbackEntry[];
  addEntry: (input: CreateBetaFeedbackInput) => BetaFeedbackEntry;
  updateStatus: (id: string, status: BetaFeedbackStatus) => void;
  removeEntry: (id: string) => void;
  clearResolved: () => void;
  replaceEntries: (entries: BetaFeedbackEntry[]) => void;
}

const sortEntries = (entries: BetaFeedbackEntry[]): BetaFeedbackEntry[] =>
  entries.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt));

export const useBetaFeedbackStore = create<BetaFeedbackStore>()(
  persist(
    (set, get) => ({
      entries: [],
      addEntry: (input) => {
        const entry = createBetaFeedbackEntry(input);
        set({ entries: sortEntries([entry, ...get().entries]) });
        return entry;
      },
      updateStatus: (id, status) => {
        set({
          entries: sortEntries(
            get().entries.map((entry) =>
              entry.id === id
                ? updateBetaFeedbackEntry(entry, { status })
                : entry
            )
          )
        });
      },
      removeEntry: (id) => {
        set({ entries: get().entries.filter((entry) => entry.id !== id) });
      },
      clearResolved: () => {
        set({ entries: get().entries.filter((entry) => entry.status !== 'resolved' && entry.status !== 'wontFix') });
      },
      replaceEntries: (entries) => set({ entries: sortEntries(entries) })
    }),
    {
      name: 'dnd-combat-math-beta-feedback',
      storage: createJSONStorage(() => characterStorage),
      version: 1
    }
  )
);
