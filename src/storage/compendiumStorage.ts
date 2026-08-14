import type { StateStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from './asyncStorageAdapter';
import type { KeyValueStorageAdapter } from './keyValueStorage';

export const createZustandStorageAdapter = (adapter: KeyValueStorageAdapter): StateStorage => ({
  getItem: (name: string): string | null | Promise<string | null> => adapter.getItem(name),
  setItem: (name: string, value: string): void | Promise<void> => adapter.setItem(name, value),
  removeItem: (name: string): void | Promise<void> => adapter.removeItem(name)
});

export const compendiumStorage = createZustandStorageAdapter(asyncStorageAdapter);
