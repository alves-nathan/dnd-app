import type { KeyValueStorageAdapter } from './keyValueStorage';

const DB_NAME = 'dnd-combat-math-web-storage';
const DB_VERSION = 1;
const STORE_NAME = 'key-value';

interface IndexedDbRequestLike<T = unknown> {
  result: T;
  error?: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

interface IndexedDbObjectStoreLike {
  get: (key: string) => IndexedDbRequestLike<unknown>;
  put: (value: string, key: string) => IndexedDbRequestLike<unknown>;
  delete: (key: string) => IndexedDbRequestLike<unknown>;
}

interface IndexedDbTransactionLike {
  error?: Error | null;
  oncomplete: (() => void) | null;
  onabort: (() => void) | null;
  onerror: (() => void) | null;
  objectStore: (name: string) => IndexedDbObjectStoreLike;
}

interface IndexedDbDatabaseLike {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => unknown;
  transaction: (name: string, mode: 'readonly' | 'readwrite') => IndexedDbTransactionLike;
  close: () => void;
}

interface IndexedDbFactoryLike {
  open: (name: string, version: number) => IndexedDbRequestLike<IndexedDbDatabaseLike>;
}

const indexedDbFactory = (): IndexedDbFactoryLike => {
  const factory = (globalThis as unknown as { indexedDB?: IndexedDbFactoryLike }).indexedDB;
  if (!factory) throw new Error('IndexedDB não está disponível neste navegador.');
  return factory;
};

const openDatabase = (): Promise<IndexedDbDatabaseLike> => new Promise((resolve, reject) => {
  const request = indexedDbFactory().open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o IndexedDB do compêndio.'));
});

const completeTransaction = (transaction: IndexedDbTransactionLike): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('Transação IndexedDB abortada.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('Falha na transação IndexedDB.'));
});

const waitForRequest = <T>(request: IndexedDbRequestLike<T>, fallbackMessage: string): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(fallbackMessage));
  });

export const indexedDbStorageAdapter: KeyValueStorageAdapter = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const completion = completeTransaction(transaction);
      const value = await waitForRequest(
        transaction.objectStore(STORE_NAME).get(name),
        'Falha ao ler o IndexedDB do compêndio.'
      );
      await completion;
      return typeof value === 'string' ? value : null;
    } finally {
      db.close();
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).put(value, name);
      await Promise.all([
        waitForRequest(request, 'Falha ao gravar o IndexedDB do compêndio.'),
        completeTransaction(transaction)
      ]);
    } finally {
      db.close();
    }
  },
  removeItem: async (name: string): Promise<void> => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).delete(name);
      await Promise.all([
        waitForRequest(request, 'Falha ao remover dados do IndexedDB do compêndio.'),
        completeTransaction(transaction)
      ]);
    } finally {
      db.close();
    }
  }
};
