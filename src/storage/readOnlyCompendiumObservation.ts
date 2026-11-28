import {sha256Hex} from '../catalog/catalogBundleDigest';
import {COMPENDIUM_PERSISTENCE_VERSION,COMPENDIUM_STORAGE_KEY,type CompendiumPersistenceState} from './compendiumSnapshot';
import type {KeyValueStorageAdapter} from './keyValueStorage';

export type IndependentBackend='sqlite'|'web'|'legacy';
export type IndependentCompendiumObservation=
 {status:'observed';backend:IndependentBackend;snapshotFingerprint:string;rawFingerprint:string;counts:{sources:number;packs:number;items:number;enabledSources:number}}|
 {status:'unavailable'|'invalid'|'stale';backend:IndependentBackend;code:string};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const canonical=(v:unknown):unknown=>{
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
 if(Array.isArray(v))return v.map(canonical);
 if(record(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null))
  return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])]));
 throw Error('invalidJson');
};
const digest=(v:unknown)=>sha256Hex(JSON.stringify(canonical(v)));
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const invalid=(backend:IndependentBackend,code:string):IndependentCompendiumObservation=>({status:'invalid',backend,code});
const unavailable=(backend:IndependentBackend,code:string):IndependentCompendiumObservation=>({status:'unavailable',backend,code});
/** Order-independent collection comparison, but every row and field is bound.
 * Array order within each stored payload remains significant. */
export function fingerprintIndependentCompendiumSnapshot(value:unknown){
 if(!record(value)||!['sources','packs','items','enabledSourceIds'].every(k=>Array.isArray(value[k])))throw Error('invalidSnapshot');
 const collection=(name:string)=>{
  const rows=value[name] as unknown[];
  if(!rows.every(r=>record(r)&&text(r.id)))throw Error('invalidRow');
  const typed=rows as Array<Record<string,unknown>&{id:string}>;
  if(new Set(typed.map(r=>r.id)).size!==typed.length)throw Error('duplicateRow');
  return [...typed].sort((a,b)=>compare(a.id,b.id));
 };
 const sources=collection('sources'),packs=collection('packs'),items=collection('items');
 const sourceIds=new Set(sources.map(s=>s.id)),packIds=new Set(packs.map(p=>p.id));
 const enabled=value.enabledSourceIds as unknown[];
 if(!enabled.every(id=>text(id)&&sourceIds.has(id))||new Set(enabled).size!==enabled.length)throw Error('invalidEnabledSources');
 if(!packs.every(p=>text(p.sourceId)&&sourceIds.has(p.sourceId)))throw Error('invalidPackOwner');
 if(!items.every(i=>text(i.sourceId)&&sourceIds.has(i.sourceId)&&text(i.packId)&&packIds.has(i.packId)&&text(i.importItemId)&&
  text(i.type)&&['draft','validated','needsReview','disabled'].includes(String(i.status))&&record(i.rawJson)&&i.rawJson.id===i.importItemId&&record(i.normalizedJson)))throw Error('invalidItem');
 // Do not require item.sourceId === pack.sourceId: multi-source packs are valid.
 const state={sources,packs,items,enabledSourceIds:[...(enabled as string[])].sort(compare)};
 return {snapshotFingerprint:digest(state),counts:{sources:sources.length,packs:packs.length,items:items.length,enabledSources:enabled.length}};
}
function observed(backend:IndependentBackend,state:unknown,raw:unknown):IndependentCompendiumObservation{
 try{return {status:'observed',backend,...fingerprintIndependentCompendiumSnapshot(state),rawFingerprint:digest(raw)};}
 catch{return invalid(backend,'invalidPersistedSnapshot');}
}
/** Caller supplies a non-initializing raw read port. Ordinary IndexedDB
 * getItem must not be used here: it can create the database on open. */
export async function observeExistingKeyValueCompendium(backend:'legacy'|'web',storage:Pick<KeyValueStorageAdapter,'getItem'>):Promise<IndependentCompendiumObservation>{
 let raw:string|null;
 try{raw=await storage.getItem(COMPENDIUM_STORAGE_KEY);}catch{return unavailable(backend,'backendReadFailed');}
 if(raw===null)return unavailable(backend,'persistedSnapshotAbsent');
 try{
  const parsed:unknown=JSON.parse(raw);
  if(!record(parsed)||parsed.version!==COMPENDIUM_PERSISTENCE_VERSION||!record(parsed.state))return invalid(backend,'unsupportedPersistedEnvelope');
  return observed(backend,parsed.state,raw);
 }catch{return invalid(backend,'invalidPersistedEnvelope');}
}
// One statement provides one SQLite read snapshot across all three tables.
// Project mirrored columns as well as JSON; never filter failed rows away.
export const INDEPENDENT_COMPENDIUM_SQL=
 "SELECT 'source' AS lane,id,json,enabled,NULL AS source_id,NULL AS pack_id,NULL AS import_item_id,NULL AS type,NULL AS name,NULL AS status FROM compendium_sources "+
 "UNION ALL SELECT 'pack',id,json,NULL,source_id,NULL,NULL,NULL,NULL,NULL FROM compendium_packs "+
 "UNION ALL SELECT 'item',id,json,NULL,source_id,pack_id,import_item_id,type,name,status FROM compendium_items ORDER BY lane,id";
export interface IndependentSQLiteReadPort {getAllAsync:<T>(query:string)=>Promise<T[]>}
interface SQLiteRow {lane:string;id:string;json:string;enabled:number|null;source_id:string|null;pack_id:string|null;import_item_id:string|null;type:string|null;name:string|null;status:string|null}
export async function observeOpenSQLiteCompendium(db:IndependentSQLiteReadPort|undefined):Promise<IndependentCompendiumObservation>{
 if(!db)return unavailable('sqlite','connectionNotInitialized');
 let rows:SQLiteRow[];
 try{rows=await db.getAllAsync<SQLiteRow>(INDEPENDENT_COMPENDIUM_SQL);}catch{return unavailable('sqlite','backendReadFailed');}
 try{
  const state:{sources:unknown[];packs:unknown[];items:unknown[];enabledSourceIds:string[]}={sources:[],packs:[],items:[],enabledSourceIds:[]};
  for(const r of rows){
   const v:unknown=JSON.parse(r.json);
   if(!record(v)||!text(r.id)||v.id!==r.id)return invalid('sqlite','rowIdentityMismatch');
   if(r.lane==='source'){
    if(r.enabled!==0&&r.enabled!==1)return invalid('sqlite','invalidEnabledFlag');
    state.sources.push(v);if(r.enabled===1)state.enabledSourceIds.push(r.id);
   }else if(r.lane==='pack'){
    if(v.sourceId!==r.source_id)return invalid('sqlite','rowMirrorMismatch');
    state.packs.push(v);
   }else if(r.lane==='item'){
    if(v.sourceId!==r.source_id||v.packId!==r.pack_id||v.importItemId!==r.import_item_id||v.type!==r.type||v.name!==r.name||v.status!==r.status)return invalid('sqlite','rowMirrorMismatch');
    state.items.push(v);
   }else return invalid('sqlite','unknownRowLane');
  }
  return observed('sqlite',state,rows);
 }catch{return invalid('sqlite','invalidPersistedRow');}
}
/** Compare repeated independent reads against the store, without exporting
 * raw values. Does not rule out ABA or writes after the second read. */
export function compareIndependentCompendiumReads(first:IndependentCompendiumObservation,second:IndependentCompendiumObservation,hydrated:CompendiumPersistenceState){
 if(digest(first)!==digest(second))return 'stale' as const;
 if(second.status!=='observed')return 'notVerified' as const;
 try{return fingerprintIndependentCompendiumSnapshot(hydrated).snapshotFingerprint===second.snapshotFingerprint?'snapshotMatch' as const:'mismatch' as const;}
 catch{return 'notVerified' as const;}
}
