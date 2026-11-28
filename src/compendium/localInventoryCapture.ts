import {buildLocalInventoryEvidence,LOCAL_INVENTORY_SURFACES,type LocalInventoryInput,type InventorySurface} from './localInventoryEvidence';
import {COMPENDIUM_STORAGE_KEY} from '../storage/compendiumSnapshot';
import {CATALOG_PACKAGE_INDEX_KEY,CATALOG_PACKAGE_SCHEMA} from '../storage/catalogPackageRepository';
import {CATALOG_DOWNLOAD_CACHE_INDEX_KEY,CATALOG_DOWNLOAD_CACHE_SCHEMA} from '../storage/catalogDownloadCacheRepository';
import {observeIndexedPackageContents,compareLoadedPackage} from './localInventoryPackageObservation';
import {compareIndependentCompendiumReads,type IndependentCompendiumObservation,type IndependentBackend} from '../storage/readOnlyCompendiumObservation';
import {readAuxiliaryPersistence,auxiliaryReadsChanged,reviewAuxiliaryPersistence} from './localInventoryAuxiliaryPersistence';
import {readPortablePersistence,portableReadsChanged,reviewPortablePersistence} from './localInventoryPortablePersistence';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';

type Observations=LocalInventoryInput['observations'];
type RawSurface='legacyCompendium'|'packageIndex'|'downloadCache';
export interface InventoryStoreFrame {
 // References and readiness values must be from the same synchronous observation.
 guard:readonly unknown[];
 observations:Observations;
 blocked:boolean;
 activeBackend?:'sqlite'|'web'|'legacy';
}
export interface LocalInventoryReadPorts {
 readStores:(captureId:string)=>InventoryStoreFrame;
 storage:Pick<KeyValueStorageAdapter,'getItem'>;
 /** Optional for offline callers; live adapter never initializes storage. */
 readActivePersistence?:()=>Promise<IndependentCompendiumObservation>;
 observeAuxiliaryPersistence?:boolean;
 observePortablePersistence?:boolean;
}
export interface InventoryCoherence {runtimePackage:string;activePersistence:string;packageCode?:string;independentPersistence?:IndependentCompendiumObservation;auxiliaryPersistence?:ReturnType<typeof reviewAuxiliaryPersistence>;portablePersistence?:ReturnType<typeof reviewPortablePersistence>}
async function readIndependent(ports:LocalInventoryReadPorts,backend:IndependentBackend|undefined):Promise<IndependentCompendiumObservation|undefined>{
 if(!ports.readActivePersistence||!backend)return undefined;
 try{return await ports.readActivePersistence();}catch{return {status:'unavailable',backend,code:'backendReadFailed'};}
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
 const finish=(captureStatus:'stableObservation'|'blocked'|'stale'|'unavailable',observations:Observations,coherence:InventoryCoherence={runtimePackage:'notVerified',activePersistence:'notVerified'})=>({
  captureStatus,evidence:build(observations),coherence,writeAuthorized:false as const,executable:false as const});
 try{
  const before=ports.readStores(captureId);
  if(before.blocked)return finish('blocked',statuses(before.observations,'busy',captureId));
  const initial=build(before.observations);
  const independentFirst=await readIndependent(ports,before.activeBackend);
  const auxiliaryFirst=ports.observeAuxiliaryPersistence?await readAuxiliaryPersistence(ports.storage):undefined;
  const portableFirst=ports.observePortablePersistence?await readPortablePersistence(ports.storage):undefined;
  const first=await readRaw(ports);
  const packagesFirst=await observeIndexedPackageContents(first.packageIndex.ok?first.packageIndex.raw:null,ports.storage);
  const second=await readRaw(ports);
  const packagesSecond=await observeIndexedPackageContents(second.packageIndex.ok?second.packageIndex.raw:null,ports.storage);
  // Re-read index after the final chunk read to catch a concurrent replacement.
  let finalIndex:ReadResult;
  try{finalIndex={ok:true,raw:await ports.storage.getItem(CATALOG_PACKAGE_INDEX_KEY)};}catch{finalIndex={ok:false};}
  const portableSecond=ports.observePortablePersistence?await readPortablePersistence(ports.storage):undefined;
  const auxiliarySecond=ports.observeAuxiliaryPersistence?await readAuxiliaryPersistence(ports.storage):undefined;
  const independentSecond=await readIndependent(ports,before.activeBackend);
  const independentChanged=JSON.stringify(independentFirst)!==JSON.stringify(independentSecond)||
   independentFirst?.status==='stale'||independentSecond?.status==='stale'||
   (!!independentFirst&&independentFirst.backend!==before.activeBackend)||
   (!!independentSecond&&independentSecond.backend!==before.activeBackend);
  const indexStable=JSON.stringify(second.packageIndex)===JSON.stringify(finalIndex);
  const after=ports.readStores(captureId);
  const changed=(!!portableFirst&&!!portableSecond&&portableReadsChanged(portableFirst,portableSecond))||(!!auxiliaryFirst&&!!auxiliarySecond&&auxiliaryReadsChanged(auxiliaryFirst,auxiliarySecond))||independentChanged||!indexStable||JSON.stringify(packagesFirst)!==JSON.stringify(packagesSecond)||before.activeBackend!==after.activeBackend||after.blocked||!sameGuard(before.guard,after.guard)||initial.fingerprint!==build(after.observations).fingerprint||
   rawSurfaces.some(k=>{const a=first[k],b=second[k];return a.ok!==b.ok||(a.ok&&b.ok&&a.raw!==b.raw);});
  if(changed){
   const all={...before.observations,...Object.fromEntries([...rawSurfaces,'packageContents' as const].map(k=>[k,{status:'stale',source:LOCAL_INVENTORY_SURFACES[k],captureId}]))};
   return finish('stale',statuses(all,'stale',captureId),{runtimePackage:'notVerified',activePersistence:'notVerified',...(independentChanged&&before.activeBackend?{independentPersistence:{status:'stale',backend:before.activeBackend,code:'independentReadChanged'} as const}:{})});
  }
  const observations={...after.observations,...Object.fromEntries(rawSurfaces.map(k=>[k,rawObservation(k,second[k],captureId)]))} as Observations;
  const packageSource=LOCAL_INVENTORY_SURFACES.packageContents;
  observations.packageContents=packagesSecond.status==='observed'?{status:'observed',source:packageSource,captureId,value:packagesSecond}:
   {status:packagesSecond.status,source:packageSource,captureId};
  const runtime=after.observations.runtime;
  const runtimePackage=compareLoadedPackage(runtime?.status==='observed'?runtime.value:undefined,packagesSecond);
  let activePersistence='notVerified';
  const hydrated=after.observations.compendium;
  if(independentFirst&&independentSecond&&hydrated?.status==='observed'&&initial.surfaces.find(s=>s.surface==='compendium')?.status==='observed'){
   const comparison=compareIndependentCompendiumReads(independentFirst,independentSecond,hydrated.value);
   if(comparison==='snapshotMatch')activePersistence=independentSecond.backend==='sqlite'?'sqliteSnapshotMatch':independentSecond.backend==='web'?'webSnapshotMatch':'legacySnapshotMatch';
   else if(comparison==='mismatch')activePersistence='mismatch';
  }
  // Compatibility for older offline callers without the independent port.
  // The live adapter always supplies the strict read; no fallback on failure.
  if(!ports.readActivePersistence&&after.activeBackend==='legacy'&&second.legacyCompendium.ok&&second.legacyCompendium.raw!==null&&observations.legacyCompendium?.status==='observed'){
   const raw=JSON.parse(second.legacyCompendium.raw),state=record(raw.state)?raw.state:raw;
   const stored=build({compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:state}});
   const a=stored.surfaces.find(s=>s.surface==='compendium'),b=initial.surfaces.find(s=>s.surface==='compendium');
   if(a?.status==='observed'&&b?.status==='observed')activePersistence=a.fingerprint===b.fingerprint?'legacySnapshotMatch':'mismatch';
  }
  // A stable observation is not a successful read or accepted gate.
  return finish('stableObservation',observations,{runtimePackage,activePersistence,...(portableSecond?{portablePersistence:reviewPortablePersistence(portableSecond,observations)}:{}),...(auxiliarySecond?{auxiliaryPersistence:reviewAuxiliaryPersistence(auxiliarySecond,observations)}:{}),...(independentSecond?{independentPersistence:independentSecond}:{}),...(packagesSecond.status==='observed'?{}:{packageCode:packagesSecond.code})});
 }catch{return finish('unavailable',{});}
}
