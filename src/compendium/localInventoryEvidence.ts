import {sha256Hex} from '../catalog/catalogBundleDigest';
import type {CatalogSnapshot} from '../catalog/types';
import type {PortableRestoreDataCheckpoint} from '../backup/portableRestoreSession';
import type {CompendiumPersistenceState} from '../storage/compendiumSnapshot';
import type {CatalogRuntimePackageRef} from '../storage/catalogPackageRepository';

// Evidence contract only: no adapter invocation, hydration, repair, export,
// storage write, backup generation, catalog activation or migration.
export const LOCAL_INVENTORY_SURFACES = {
 compendium:'activeCompendiumRepository',
 legacyCompendium:'legacyCompendiumStorage',
 portable:'portableDataCheckpoint',
 characterReconciliation:'characterStore',
 runtime:'catalogStore',
 packageIndex:'catalogPackageRepository',
 packageContents:'catalogPackageRepository',
 trust:'catalogTrustStore',
 updateSessions:'catalogUpdateSessionStore',
 restoreSessions:'portableRestoreSessionStore',
 distribution:'catalogDistributionStore',
 downloadCache:'catalogDownloadCacheRepository',
 publication:'catalogPublicationStore',
 transparency:'catalogTransparencyStore',
 rolloutHealth:'catalogRolloutHealthStore',
 rolloutAggregation:'catalogRolloutAggregationStore',
 operationalAudit:'catalogOperationalAuditStore',
 operationalAuthorization:'catalogOperationalAuthorizationStore',
 operationalFederation:'catalogOperationalFederationStore',
 externalPacksAndBackups:'ownerInventory'
} as const;
export type InventorySurface=keyof typeof LOCAL_INVENTORY_SURFACES;
type ObservationSource<K extends InventorySurface>=typeof LOCAL_INVENTORY_SURFACES[K];
export type InventoryObservation<K extends InventorySurface,T> =
 {status:'observed';source:ObservationSource<K>;captureId:string;value:T}|
 {status:'unavailable'|'notInspected'|'busy';source:ObservationSource<K>;captureId:string};
export interface RuntimeInventoryValue {snapshot:CatalogSnapshot;ref:CatalogRuntimePackageRef}
type InventoryValues={compendium:CompendiumPersistenceState;portable:PortableRestoreDataCheckpoint;runtime:RuntimeInventoryValue};
export interface LocalInventoryInput {
 captureId:string;
 scope:'disposableFixture'|'observedLocal';
 observations:Partial<{[K in InventorySurface]:InventoryObservation<K,K extends keyof InventoryValues?InventoryValues[K]:unknown>}>;
}
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
type SurfaceStatus='observed'|'notInspected'|'unavailable'|'busy'|'invalid'|'stale';
interface SurfaceResult {surface:InventorySurface;source:string;status:SurfaceStatus;fingerprint?:string;counts?:Record<string,number>;codes:string[]}
const rec=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0;
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const keys=Object.keys(LOCAL_INVENTORY_SURFACES) as InventorySurface[];
// Restrict to JSON data. Do not hash Zustand actions, Maps, or native handles
// as empty objects. Optional undefined object fields are omitted as in exports.
function canonical(x:unknown):unknown {
 if(x===null||typeof x==='string'||typeof x==='boolean')return x;
 if(typeof x==='number'&&Number.isFinite(x))return x;
 if(Array.isArray(x))return Array.from(x,v=>canonical(v));
 if(rec(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
  return Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])]));
 }
 throw Error('nonJsonInventory');
}
const digest=(x:unknown)=>sha256Hex(JSON.stringify(canonical(x)));
const ids=(v:unknown):string[]=>{
 if(!Array.isArray(v)||!v.every(x=>rec(x)&&text(x.id)))throw Error('invalidIdentityCollection');
 const list=v.map(x=>x.id as string);
 if(new Set(list).size!==list.length)throw Error('duplicateIdentity');
 return list;
};
function objectCount(x:unknown){if(!rec(x))throw Error('invalidRecordCollection');return Object.keys(x).length;}
function compendiumCounts(v:CompendiumPersistenceState){
 const sources=new Set(ids(v.sources)),packs=new Set(ids(v.packs));ids(v.items);
 if(!Array.isArray(v.enabledSourceIds)||new Set(v.enabledSourceIds).size!==v.enabledSourceIds.length||!v.enabledSourceIds.every(id=>sources.has(id)))throw Error('invalidEnabledSources');
 const packById=new Map(v.packs.map(p=>[p.id,p]));
 let unresolved=0,manual=0,legacyV1=0,legacyV2=0,otherFormat=0;
 for(const p of v.packs){
  if(!sources.has(p.sourceId))unresolved++;
  if(p.schemaVersion==='dnd-combat-import.v1')legacyV1++;
  else if(p.schemaVersion==='dnd-combat-import.v2')legacyV2++;
  else otherFormat++;
 }
 for(const i of v.items){
  if(!text(i.importItemId)||!text(i.type)||!rec(i.rawJson)||!rec(i.normalizedJson))throw Error('invalidStoredItem');
  if(!sources.has(i.sourceId)||!packs.has(i.packId)||packById.get(i.packId)?.sourceId!==i.sourceId)unresolved++;
  if(i.reviewNotes!==undefined||i.reviewedBy!==undefined||i.reviewDecision==='rejected')manual++;
 }
 return {sources:sources.size,packs:packs.size,items:v.items.length,enabledSources:v.enabledSourceIds.length,
  v1Packs:legacyV1,v2Packs:legacyV2,otherFormatPacks:otherFormat,itemsWithReviewMarkers:manual,unresolvedStorageReferences:unresolved};
}
function portableCounts(v:PortableRestoreDataCheckpoint){
 const c=v.characterStore,characters=new Set(ids(c.characters));
 const scenarios=ids(v.scenarios),presets=ids(v.buildPresets),history=ids(v.buildHistorySnapshots);
 if(!rec(c.progressionRecovery)||!rec(c.compatibilityRemediationRecovery)||!rec(v.catalog.filterState)||
  !rec(v.catalog.filterState.bookStates)||!rec(v.catalog.filterState.categoryStates)||!rec(v.catalog.filterState.entityStates)||
  !integer(v.catalog.revision)||!Array.isArray(v.catalog.history))throw Error('invalidPortableState');
 return {characters:characters.size,scenarios:scenarios.length,presets:presets.length,buildHistory:history.length,
  progressionDrafts:objectCount(c.progressionDrafts),remediationPlans:objectCount(c.compatibilityRemediationPlans),
  remediationQuarantine:objectCount(c.compatibilityRemediationQuarantine),catalogRevision:v.catalog.revision,catalogHistory:v.catalog.history.length,
  scenariosWithoutCharacter:v.scenarios.filter(s=>!characters.has(s.characterId)).length};
}
function runtimeValue(v:RuntimeInventoryValue){
 const s=v.snapshot,ref=v.ref;
 if(s.validation.status!=='passed'||!text(s.snapshotId)||!text(s.catalogVersion)||
  !(ref.kind==='bundled'||ref.kind==='stored'&&text(ref.packageId)))throw Error('invalidRuntimeSnapshot');
 if(s.entries.length!==s.registry.size||s.entryById.size!==s.registry.size||
  new Set(s.entries.map(e=>e.entityId)).size!==s.entries.length||
  s.entries.some(e=>!s.registry.has(e.entityId)||s.entryById.get(e.entityId)!==e))throw Error('runtimeIdentityMismatch');
 // Loaded graph only: raw alias occurrences, policies omitted by loader,
 // stored package bytes and trust are separate evidence obligations.
 const data={ref,snapshotId:s.snapshotId,catalogVersion:s.catalogVersion,bundleSha256:s.bundleSha256,
  manifest:s.manifest,entries:s.entries,registry:[...s.registry],entryById:[...s.entryById],categories:s.categories,categoryById:[...s.categoryById],
  dependenciesFrom:[...s.dependenciesFrom],dependenciesTo:[...s.dependenciesTo],aliases:[...s.aliases],
  filterPolicy:s.filterPolicy,readinessProfile:s.readinessProfile};
 return {data,counts:{entries:s.entries.length,registry:s.registry.size,categories:s.categories.length,
  dependencyOccurrences:[...s.dependenciesFrom.values()].reduce((n,a)=>n+a.length,0),loadedAliasKeys:s.aliases.size}};
}
export function buildLocalInventoryEvidence(input:LocalInventoryInput){
 const surfaces:SurfaceResult[]=[],codes:string[]=[];
 const validContext=text(input.captureId)&&['disposableFixture','observedLocal'].includes(input.scope);
 if(!validContext)codes.push('invalidCaptureContext');
 if(Object.keys(input.observations).some(k=>!keys.includes(k as InventorySurface)))codes.push('unknownInventorySurface');
 for(const surface of keys){
  const source=LOCAL_INVENTORY_SURFACES[surface],o=input.observations[surface];
  const row:SurfaceResult={surface,source,status:'notInspected',codes:[]};
  surfaces.push(row);
  if(!o)continue;
  if(!validContext||o.captureId!==input.captureId){row.status='stale';row.codes.push('captureBindingMismatch');continue;}
  if(o.source!==source){row.status='invalid';row.codes.push('sourceBindingMismatch');continue;}
  if(o.status==='unavailable'||o.status==='notInspected'||o.status==='busy'){row.status=o.status;continue;}
  if(o.status!=='observed'){row.status='invalid';row.codes.push('invalidObservationStatus');continue;}
  try{
   let data:unknown=o.value;
   if(surface==='compendium')row.counts=compendiumCounts(o.value as CompendiumPersistenceState);
   else if(surface==='portable')row.counts=portableCounts(o.value as PortableRestoreDataCheckpoint);
   else if(surface==='runtime'){const runtime=runtimeValue(o.value as RuntimeInventoryValue);data=runtime.data;row.counts=runtime.counts;}
   else if(!rec(data)&&!Array.isArray(data))throw Error('invalidObservationShape');
   row.fingerprint=digest(data);row.status='observed';
  }catch{row.status='invalid';row.codes.push('invalidSurfaceData');delete row.counts;}
 }
 const summary={required:keys.length,observed:surfaces.filter(s=>s.status==='observed').length,
  notInspected:surfaces.filter(s=>s.status==='notInspected').length,unavailable:surfaces.filter(s=>s.status==='unavailable').length,
  busy:surfaces.filter(s=>s.status==='busy').length,invalid:surfaces.filter(s=>s.status==='invalid').length,stale:surfaces.filter(s=>s.status==='stale').length};
 const body={schemaVersion:'dnd-local-inventory-evidence.v1',scope:input.scope,captureFingerprint:digest({captureId:validContext?input.captureId:null}),
  surfaces,summary,codes,readiness:'blocked',inventoryAcceptance:'notEstablished',
  blockers:['callerSuppliedObservationsNotIndependentCapture','installedCompletenessAndCrossStoreCoherenceNotVerified',
   'packageBytesTrustAndExternalInventoryNotVerified','noDurableCheckpointOrMigrationAuthorization'],...flags};
 return {...body,fingerprint:digest(body)};
}
