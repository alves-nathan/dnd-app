export interface KeyValueStorageAdapter {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void | Promise<void>;
  removeItem: (name: string) => void | Promise<void>;
}

export const createMemoryKeyValueStorage = (initial: Record<string, string> = {}): KeyValueStorageAdapter & { dump: () => Record<string, string> } => {
  const data = { ...initial };
  return {
    getItem: (name) => data[name] ?? null,
    setItem: (name, value) => {
      data[name] = value;
    },
    removeItem: (name) => {
      delete data[name];
    },
    dump: () => ({ ...data })
  };
};
