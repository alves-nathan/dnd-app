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

/** Separate audit boundary: never use the normal openDatabase() helper.
 * A browser without database enumeration fails closed. Enumeration is not
 * atomic with open; abort every version-change transaction before commit. */
export interface ExistingIndexedDbFactory {
  databases?: () => Promise<readonly {name?:string;version?:number}[]>;
  open: (name:string,version:number)=>ExistingIndexedDbOpenRequest;
}
interface ExistingIndexedDbOpenRequest {
  result:ExistingIndexedDbDatabase;
  transaction?:{abort:()=>void}|null;
  onsuccess:(()=>void)|null;
  onerror:(()=>void)|null;
  onblocked:(()=>void)|null;
  onupgradeneeded:(()=>void)|null;
}
interface ExistingIndexedDbDatabase {
  version:number;
  objectStoreNames:{contains:(name:string)=>boolean};
  transaction:(name:string,mode:'readonly')=>ExistingIndexedDbTransaction;
  close:()=>void;
}
interface ExistingIndexedDbTransaction {
  oncomplete:(()=>void)|null;
  onabort:(()=>void)|null;
  onerror:(()=>void)|null;
  objectStore:(name:string)=>{get:(key:string)=>IndexedDbRequestLike<unknown>};
}
type ExistingValueResult={status:'read';value:string|null}|{status:'unavailable'|'invalid';code:string};
const unavailableExisting=(code:string):ExistingValueResult=>({status:'unavailable',code});
/** Returns a raw value only to the in-process observation helper. The
 * readonly transaction must complete before any successful result. */
export async function readExistingIndexedDbValue(name:string,factory:ExistingIndexedDbFactory|undefined=
 (globalThis as unknown as {indexedDB?:ExistingIndexedDbFactory}).indexedDB):Promise<ExistingValueResult>{
  if(!factory||typeof factory.databases!=='function')return unavailableExisting('indexedDbEnumerationUnavailable');
  // Bound the entire probe, including enumeration and a blocked open. Any
  // late open success is closed; any late upgrade is still aborted.
  return new Promise(resolve=>{
    let settled=false;
    const finish=(result:ExistingValueResult)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);resolve(result);
    };
    const timer=setTimeout(()=>finish(unavailableExisting('indexedDbReadTimeout')),5000);
    void (async()=>{
      try{
        const entries=await factory.databases!();
        if(settled)return;
        const matches=entries.filter(e=>e.name===DB_NAME);
        if(matches.length!==1){finish(unavailableExisting('indexedDbDatabaseAbsentOrAmbiguous'));return;}
        if(matches[0].version!==DB_VERSION){finish(unavailableExisting('indexedDbVersionMismatch'));return;}
        const request=factory.open(DB_NAME,DB_VERSION);
        request.onupgradeneeded=()=>{
          // IDB supplies an active versionchange transaction here. Abort
          // rolls back a raced creation/upgrade; never create an object store.
          try{request.transaction?.abort();}catch{/* failure remains unavailable */}
          finish(unavailableExisting('indexedDbUpgradeAborted'));
        };
        request.onblocked=()=>finish(unavailableExisting('indexedDbOpenBlocked'));
        request.onerror=()=>finish(unavailableExisting('indexedDbOpenFailed'));
        request.onsuccess=()=>{
          const db=request.result;
          let closed=false;
          const close=()=>{if(!closed){closed=true;try{db.close();}catch{/* no repair */}}};
          if(settled){close();return;}
          try{
            if(db.version!==DB_VERSION||!db.objectStoreNames.contains(STORE_NAME)){
              close();finish(unavailableExisting('indexedDbSchemaMismatch'));return;
            }
            const tx=db.transaction(STORE_NAME,'readonly');
            let read=false,value:unknown;
            const failed=()=>{close();finish(unavailableExisting('indexedDbReadFailed'));};
            tx.onabort=failed;tx.onerror=failed;
            tx.oncomplete=()=>{
              close();
              if(!read){finish(unavailableExisting('indexedDbReadIncomplete'));return;}
              if(value===undefined){finish({status:'read',value:null});return;}
              if(typeof value!=='string'){finish({status:'invalid',code:'indexedDbValueTypeMismatch'});return;}
              finish({status:'read',value});
            };
            const get=tx.objectStore(STORE_NAME).get(name);
            get.onsuccess=()=>{read=true;value=get.result;};
            get.onerror=failed;
          }catch{close();finish(unavailableExisting('indexedDbReadFailed'));}
        };
      }catch{finish(unavailableExisting('indexedDbEnumerationOrOpenFailed'));}
    })();
  });
}
