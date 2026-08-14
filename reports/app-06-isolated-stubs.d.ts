declare module 'react' {
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  export function useRef<T>(initial: T): { current: T };
}
declare module 'zustand' {
  export type SetState<T> = (partial: Partial<T> | T | ((state: T) => Partial<T> | T)) => void;
  export type StateCreator<T> = (set: SetState<T>, get: () => T) => T;
  export interface UseBoundStore<T> {
    <U>(selector: (state: T) => U): U;
    getState(): T;
    setState(value: Partial<T> | ((state: T) => Partial<T>)): void;
  }
  export function create<T>(): (initializer: StateCreator<T>) => UseBoundStore<T>;
}
declare module 'zustand/middleware' {
  import type { StateCreator } from 'zustand';
  export interface StateStorage {
    getItem(name: string): string | null | Promise<string | null>;
    setItem(name: string, value: string): void | Promise<void>;
    removeItem(name: string): void | Promise<void>;
  }
  export function createJSONStorage<T>(factory: () => StateStorage): unknown;
  export function persist<T>(initializer: StateCreator<T>, options: {
    name: string;
    storage?: unknown;
    version?: number;
    migrate?: (persisted: unknown, version: number) => any;
    onRehydrateStorage?: () => (state?: T, error?: unknown) => void;
  }): StateCreator<T>;
}
declare module '@react-native-async-storage/async-storage' {
  const storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export default storage;
}
declare module 'zod' {
  export const z: any;
  export namespace z {
    type infer<T> = any;
  }
}
declare module 'expo-sqlite' {
  export function openDatabaseAsync(name: string): Promise<any>;
}
declare module 'expo-file-system' {
  const value: any;
  export = value;
}
declare module 'expo-crypto' {
  export function digestStringAsync(...args: any[]): Promise<string>;
  export const CryptoDigestAlgorithm: any;
}
