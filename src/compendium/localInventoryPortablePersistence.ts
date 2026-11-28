import {sha256Hex} from '../catalog/catalogBundleDigest';
import {CATALOG_FILTER_PREFERENCES_KEY,CATALOG_FILTER_PREFERENCES_SCHEMA} from '../storage/catalogFilterPreferences';
import type {LocalInventoryInput} from './localInventoryEvidence';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';

export const PORTABLE_PERSISTENCE={
 characters:{key:'dnd-combat-math-characters',version:25},
 scenarios:{key:'dnd-combat-math-combat-scenarios',version:5},
 presets:{key:'dnd-combat-math-build-presets',version:1},
 history:{key:'dnd-combat-math-build-history',version:1},
 catalog:{key:CATALOG_FILTER_PREFERENCES_KEY}
} as const;
type Lane=keyof typeof PORTABLE_PERSISTENCE;
const lanes=Object.keys(PORTABLE_PERSISTENCE) as Lane[];
type Raw={ok:true;raw:string|null}|{ok:false};
type Reads=Record<Lane,Raw>;
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:unknown):unknown=>{
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v))return v;
 if(Array.isArray(v))return v.map(canonical);
 if(record(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null))return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])]));
 throw Error('invalidPortableData');
};
const digest=(v:unknown)=>sha256Hex(JSON.stringify(canonical(v)));
const hasFields=(v:Record<string,unknown>,fields:readonly string[])=>fields.every(k=>Object.prototype.hasOwnProperty.call(v,k))&&Object.keys(v).every(k=>fields.includes(k));
const characterFields=['characters','progressionDrafts','progressionRecovery','compatibilityRemediationPlans','compatibilityRemediationRecovery','compatibilityRemediationQuarantine','catalogAwareReconciliation'] as const;
const ids=(v:unknown)=>Array.isArray(v)&&v.every(x=>record(x)&&typeof x.id==='string'&&x.id.trim())&&new Set(v.map(x=>x.id)).size===v.length;
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const filter=(v:unknown)=>record(v)&&hasFields(v,['bookStates','categoryStates','entityStates'])&&record(v.bookStates)&&record(v.categoryStates)&&record(v.entityStates)&&
 Object.values(v.bookStates).every(x=>typeof x==='boolean')&&Object.values(v.categoryStates).every(x=>typeof x==='boolean')&&Object.values(v.entityStates).every(x=>['enabled','disabled','inherit'].includes(String(x)));
export async function readPortablePersistence(storage:Pick<KeyValueStorageAdapter,'getItem'>):Promise<Reads>{
 return Object.fromEntries(await Promise.all(lanes.map(async lane=>{
  try{return [lane,{ok:true,raw:await storage.getItem(PORTABLE_PERSISTENCE[lane].key)}] as const;}
  catch{return [lane,{ok:false}] as const;}
 }))) as Reads;
}
export const portableReadsChanged=(a:Reads,b:Reads)=>lanes.some(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
type Status='match'|'mismatch'|'unavailable'|'invalid'|'notVerified';
interface Row {lane:Lane;status:Status;fingerprint?:string;code?:string;timestampComparison?:'matched'|'mismatch'|'notObserved'}
/** Read-only exact persisted data comparison. Never migrate, merge or sanitize. */
export function reviewPortablePersistence(reads:Reads,observations:LocalInventoryInput['observations']){
 const portable=observations.portable,runtime=observations.runtime,reconciliation=observations.characterReconciliation;
 const checkpoint=portable?.status==='observed'?portable.value:undefined;
 const rows:Row[]=lanes.map(lane=>{
  const r=reads[lane];
  if(!r.ok||r.raw===null)return {lane,status:'unavailable',code:r.ok?'persistedStateAbsent':'backendReadFailed'};
  try{
   const e:unknown=JSON.parse(r.raw);
   if(!record(e))return {lane,status:'invalid',code:'invalidEnvelope'};
   let persisted:unknown,hydrated:unknown;
   let timestampComparison:Row['timestampComparison'];
   let versionMatches=true;
   if(lane==='catalog'){
    if(e.schemaVersion!==CATALOG_FILTER_PREFERENCES_SCHEMA||typeof e.catalogVersion!=='string'||typeof e.savedAt!=='string'||!Number.isFinite(Date.parse(e.savedAt))||
     !integer(e.revision)||!Array.isArray(e.history)||!filter(e.filterState)||!hasFields(e,['schemaVersion','catalogVersion','savedAt','revision','history','filterState']))return {lane,status:'invalid',code:'invalidCatalogPreferences'};
    persisted={filterState:e.filterState,revision:e.revision,history:e.history};
    if(checkpoint&&runtime?.status==='observed'){
     hydrated={filterState:checkpoint.catalog.filterState,revision:checkpoint.catalog.revision,history:checkpoint.catalog.history};
     versionMatches=e.catalogVersion===runtime.value.snapshot.catalogVersion;
     timestampComparison=checkpoint.catalog.savedAt===undefined?'notObserved':checkpoint.catalog.savedAt===e.savedAt?'matched':'mismatch';
    }
   }else{
    const def=PORTABLE_PERSISTENCE[lane];
    if(e.version!==def.version||!record(e.state)||!hasFields(e,['state','version']))return {lane,status:'invalid',code:'unsupportedEnvelope'};
    const state=e.state;
    if(lane==='characters'){
     if(!hasFields(state,characterFields)||!ids(state.characters)||!characterFields.filter(k=>k!=='characters').every(k=>record(state[k])))return {lane,status:'invalid',code:'invalidCharacterProjection'};
     persisted=state;
     if(checkpoint&&reconciliation?.status==='observed')hydrated={...checkpoint.characterStore,catalogAwareReconciliation:reconciliation.value};
    }else{
     const key=lane==='scenarios'?'scenarios':lane==='presets'?'presets':'snapshots';
     if(!hasFields(state,[key])||!ids(state[key]))return {lane,status:'invalid',code:'invalidCollectionProjection'};
     persisted=state[key];hydrated=lane==='scenarios'?checkpoint?.scenarios:lane==='presets'?checkpoint?.buildPresets:checkpoint?.buildHistorySnapshots;
    }
   }
   // Bind exact envelope (including timestamp/version); no raw values returned.
   const fingerprint=digest(e);
   if(hydrated===undefined)return {lane,status:'notVerified',fingerprint,code:'hydratedStateUnavailable'};
   const status=versionMatches&&timestampComparison!=='mismatch'&&digest(persisted)===digest(hydrated)?'match':'mismatch';
   return {lane,status,fingerprint,...(timestampComparison?{timestampComparison}:{})};
  }catch{return {lane,status:'invalid',code:'invalidPersistedState'};}
 });
 const summary={required:lanes.length,match:0,mismatch:0,unavailable:0,invalid:0,notVerified:0};
 for(const row of rows)summary[row.status]++;
 return {rows,summary,fingerprint:digest(rows),writeAuthorized:false as const,executable:false as const};
}
