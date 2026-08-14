import type { StateStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './asyncStorageAdapter';

export const characterStorage: StateStorage = {
  getItem: (name: string): string | null | Promise<string | null> => asyncStorageAdapter.getItem(name),
  setItem: (name: string, value: string): void | Promise<void> => asyncStorageAdapter.setItem(name, value),
  removeItem: (name: string): void | Promise<void> => asyncStorageAdapter.removeItem(name)
};
