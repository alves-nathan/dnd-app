import {sha256Hex} from '../catalog/catalogBundleDigest';
import type {LocalInventoryInput} from './localInventoryEvidence';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';

// Explicit persisted contracts; do not run Zustand migrations or merge defaults.
export const AUXILIARY_PERSISTENCE={
 trust:{key:'@dnd-combat-math/catalog-trust/v1',version:1,fields:['registry']},
 updateSessions:{key:'@dnd-combat-math/catalog-update-session/v1',version:2,fields:['activeSession','history']},
 restoreSessions:{key:'dnd-combat-math-portable-restore-session',version:3,fields:['activeSession','history','archivedSessions','evidenceRecords']},
 distribution:{key:'@dnd-combat-math/catalog-distribution/v1',version:2,fields:['policy','manifests','observations','sessions','cachedBundles','evidence','events']},
 publication:{key:'@dnd-combat-math/catalog-publication/v1',version:1,fields:['selectedChannel','cohortId','publications','controls','eligibilityEvidence','events']},
 transparency:{key:'@dnd-combat-math/catalog-transparency/v1',version:1,fields:['logs','remoteManifests','recoveryPolicies','importedTrust','events']},
 rolloutHealth:{key:'@dnd-combat-math/catalog-rollout-health/v1',version:1,fields:['sharingOptIn','policies','directives','operationalOverrides','signals','evidence','events']},
 rolloutAggregation:{key:'@dnd-combat-math/catalog-rollout-aggregation/v1',version:1,fields:['contributorSecret','policies','submissions','reports','approvals','decisions','events']},
 operationalAudit:{key:'@dnd-combat-math/catalog-operational-audit/v1',version:1,fields:['importedAudits','events']},
 operationalAuthorization:{key:'@dnd-combat-math/catalog-operational-authorization/v2',version:2,fields:['authorizations','confirmations','sessions','receipts','events','journal','journalArchives','reconciliations','evidence','recoveryAuthorizations','recoveryConfirmations','recoveryExecutions']},
 operationalFederation:{key:'@dnd-combat-math/catalog-operational-federation/v1',version:1,fields:['importedFederations','events']}
} as const;
type Lane=keyof typeof AUXILIARY_PERSISTENCE;
type Raw={ok:true;raw:string|null}|{ok:false};
type Reads=Record<Lane,Raw>;
const lanes=Object.keys(AUXILIARY_PERSISTENCE) as Lane[];
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:unknown):unknown=>{
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v))return v;
 if(Array.isArray(v))return v.map(canonical);
 if(record(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null))return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])]));
 throw Error('invalidAuxiliaryData');
};
const digest=(v:unknown)=>sha256Hex(JSON.stringify(canonical(v)));
export async function readAuxiliaryPersistence(storage:Pick<KeyValueStorageAdapter,'getItem'>):Promise<Reads>{
 const rows=await Promise.all(lanes.map(async lane=>{
  try{return [lane,{ok:true,raw:await storage.getItem(AUXILIARY_PERSISTENCE[lane].key)}] as const;}
  catch{return [lane,{ok:false}] as const;}
 }));
 return Object.fromEntries(rows) as Reads;
}
export function auxiliaryReadsChanged(a:Reads,b:Reads){return lanes.some(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));}
type Status='match'|'mismatch'|'unavailable'|'invalid'|'notVerified';
interface Row {surface:Lane;status:Status;fingerprint?:string;code?:string}
export function reviewAuxiliaryPersistence(reads:Reads,observations:LocalInventoryInput['observations']){
 const rows:Row[]=lanes.map(surface=>{
  const r=reads[surface],def=AUXILIARY_PERSISTENCE[surface],o=observations[surface];
  if(!r.ok||r.raw===null)return {surface,status:'unavailable',code:r.ok?'persistedStateAbsent':'backendReadFailed'};
  try{
   const e:unknown=JSON.parse(r.raw);
   if(!record(e)||e.version!==def.version||!record(e.state))return {surface,status:'invalid',code:'unsupportedEnvelope'};
   const state=e.state;
   // Every required field must exist, except optional active session/secret.
   const optional=['activeSession','contributorSecret'];
   if(def.fields.some(k=>!optional.includes(k)&&!Object.prototype.hasOwnProperty.call(state,k))||
    Object.keys(state).some(k=>!(def.fields as readonly string[]).includes(k)))return {surface,status:'invalid',code:'persistedProjectionMismatch'};
   const projection:Record<string,unknown>={};
   for(const k of def.fields)if(k!=='contributorSecret'&&state[k]!==undefined)projection[k]=state[k];
   if(surface==='rolloutAggregation')projection.contributorSecretPresent=!!state.contributorSecret;
   const value=surface==='trust'?projection.registry:projection;
   // No raw secret digest in exported evidence. Compare its presence only.
   const fingerprint=digest(value);
   if(o?.status!=='observed')return {surface,status:'notVerified',fingerprint,code:'hydratedStateUnavailable'};
   return {surface,status:digest(o.value)===fingerprint?'match':'mismatch',fingerprint};
  }catch{return {surface,status:'invalid',code:'invalidPersistedState'};}
 });
 const summary={required:lanes.length,match:0,mismatch:0,unavailable:0,invalid:0,notVerified:0};
 for(const row of rows)summary[row.status]++;
 return {rows,summary,fingerprint:digest(rows),writeAuthorized:false as const,executable:false as const};
}
