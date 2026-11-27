import {buildLocalInventoryEvidence,LOCAL_INVENTORY_SURFACES,type LocalInventoryInput,type InventorySurface} from './localInventoryEvidence';
import {COMPENDIUM_STORAGE_KEY} from '../storage/compendiumSnapshot';
import {CATALOG_PACKAGE_INDEX_KEY,CATALOG_PACKAGE_SCHEMA} from '../storage/catalogPackageRepository';
import {CATALOG_DOWNLOAD_CACHE_INDEX_KEY,CATALOG_DOWNLOAD_CACHE_SCHEMA} from '../storage/catalogDownloadCacheRepository';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';

type Observations=LocalInventoryInput['observations'];
type RawSurface='legacyCompendium'|'packageIndex'|'downloadCache';
export interface InventoryStoreFrame {
 // References and readiness values must be from the same synchronous observation.
 guard:readonly unknown[];
 observations:Observations;
 blocked:boolean;
}
export interface LocalInventoryReadPorts {
 readStores:(captureId:string)=>InventoryStoreFrame;
 storage:Pick<KeyValueStorageAdapter,'getItem'>;
}
const rawKeys:Record<RawSurface,string>={legacyCompendium:COMPENDIUM_STORAGE_KEY,packageIndex:CATALOG_PACKAGE_INDEX_KEY,downloadCache:CATALOG_DOWNLOAD_CACHE_INDEX_KEY};
const rawSurfaces=Object.keys(rawKeys) as RawSurface[];
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sameGuard=(a:readonly unknown[],b:readonly unknown[])=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const statuses=(observations:Observations,status:'busy'|'stale',captureId:string):Observations=>
 Object.fromEntries(Object.keys(observations).map(key=>[key,{status,source:LOCAL_INVENTORY_SURFACES[key as InventorySurface],captureId}])) as Observations;
type ReadResult={ok:true;raw:string|null}|{ok:false};
async function readRaw(ports:LocalInventoryReadPorts):Promise<Record<RawSurface,ReadResult>>{
 const read=async (surface:RawSurface):Promise<ReadResult>=>{
  try{return {ok:true,raw:await ports.storage.getItem(rawKeys[surface])};}catch{return {ok:false};}
 };
 const [legacyCompendium,packageIndex,downloadCache]=await Promise.all(rawSurfaces.map(read));
 return {legacyCompendium:legacyCompendium!,packageIndex:packageIndex!,downloadCache:downloadCache!};
}
function rawObservation(surface:RawSurface,result:ReadResult,captureId:string){
 const source=LOCAL_INVENTORY_SURFACES[surface];
 if(!result.ok||result.raw===null)return {status:'unavailable' as const,source,captureId};
 try{
  const value:unknown=JSON.parse(result.raw);
  if(!record(value))throw Error('invalidEnvelope');
  if(surface==='legacyCompendium'){
   const state=record(value.state)?value.state:value;
   if(!['sources','packs','items','enabledSourceIds'].every(k=>Array.isArray(state[k])))throw Error('invalidLegacyEnvelope');
  }else if(surface==='packageIndex'){
   if(value.schemaVersion!==CATALOG_PACKAGE_SCHEMA||!record(value.active)||!record(value.packages))throw Error('invalidPackageIndex');
  }else if(value.schemaVersion!==CATALOG_DOWNLOAD_CACHE_SCHEMA||!['sessions','manifests','cachedBundles','evidence'].every(k=>record(value[k])))throw Error('invalidCacheIndex');
  // Bind raw representation as well as parsed envelope; no fallback normalization.
  return {status:'observed' as const,source,captureId,value:{raw:result.raw}};
 }catch{return {status:'invalid' as const,source,captureId};}
}
/** Double-read selected raw keys around synchronous store observations.
 * Not a transaction: external writes/ABA and unobserved surfaces remain pending.
 * Returns only aggregate evidence, never store data or raw storage content. */
export async function captureLocalInventoryEvidence(captureId:string,ports:LocalInventoryReadPorts,scope:LocalInventoryInput['scope']='observedLocal'){
 const build=(observations:Observations)=>buildLocalInventoryEvidence({captureId,scope,observations});
 const finish=(captureStatus:'stableObservation'|'blocked'|'stale'|'unavailable',observations:Observations)=>({
  captureStatus,evidence:build(observations),writeAuthorized:false as const,executable:false as const});
 try{
  const before=ports.readStores(captureId);
  if(before.blocked)return finish('blocked',statuses(before.observations,'busy',captureId));
  const initial=build(before.observations);
  const first=await readRaw(ports),second=await readRaw(ports);
  const after=ports.readStores(captureId);
  const changed=after.blocked||!sameGuard(before.guard,after.guard)||initial.fingerprint!==build(after.observations).fingerprint||
   rawSurfaces.some(k=>{const a=first[k],b=second[k];return a.ok!==b.ok||(a.ok&&b.ok&&a.raw!==b.raw);});
  if(changed){
   const all={...before.observations,...Object.fromEntries(rawSurfaces.map(k=>[k,{status:'stale',source:LOCAL_INVENTORY_SURFACES[k],captureId}]))};
   return finish('stale',statuses(all,'stale',captureId));
  }
  const observations={...after.observations,...Object.fromEntries(rawSurfaces.map(k=>[k,rawObservation(k,second[k],captureId)]))} as Observations;
  // A stable observation is not a successful read of every surface.
  return finish('stableObservation',observations);
 }catch{return finish('unavailable',{});}
}
