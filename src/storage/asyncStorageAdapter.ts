import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStorageAdapter } from './keyValueStorage';

export const asyncStorageAdapter: KeyValueStorageAdapter = {
  getItem: (name: string): Promise<string | null> => AsyncStorage.getItem(name),
  setItem: (name: string, value: string): Promise<void> => AsyncStorage.setItem(name, value),
  removeItem: (name: string): Promise<void> => AsyncStorage.removeItem(name)
};
