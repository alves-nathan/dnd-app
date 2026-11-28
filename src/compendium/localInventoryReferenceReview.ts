import {buildLocalInventoryEvidence,type LocalInventoryInput,type RuntimeInventoryValue} from './localInventoryEvidence';
import type {LocalInventoryCaptureResult} from './localInventoryPanelModel';
import type {CompendiumPersistenceState} from '../storage/compendiumSnapshot';
import type {PortableRestoreDataCheckpoint} from '../backup/portableRestoreSession';
import type {CharacterCompendiumLink} from '../types';
import {collectBuildReferenceOccurrences} from './localInventoryBuildReferences';
import {sha256Hex} from '../catalog/catalogBundleDigest';

export interface BaselineRuntimeOccurrence {id:string;kind:string;sourceFingerprint:string}
interface ReferenceReviewInput {
 captureId:string;scope:LocalInventoryInput['scope'];installed:CompendiumPersistenceState;
 runtime:RuntimeInventoryValue;portable:PortableRestoreDataCheckpoint;baselineRuntime:readonly BaselineRuntimeOccurrence[];
}
type Status='exactEntry'|'changedEntry'|'missingLoadedEntry'|'loadedOnly'|'present'|'missing'|'ambiguous'|'ownerMismatch'|'removed'|'unqualified';
const canonical=(v:unknown):unknown=>{
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)){
  const r=v as Record<string,unknown>;
  return Object.fromEntries(Object.keys(r).sort().filter(k=>r[k]!==undefined).map(k=>[k,canonical(r[k])]));
 }
 throw Error('invalidReferenceData');
};
const digest=(v:unknown)=>sha256Hex(JSON.stringify(canonical(v)));
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const fail=(code:string)=>({ok:false as const,code,...flags});
const tally=(rows:readonly {status:Status}[])=>rows.reduce<Record<string,number>>((a,r)=>{a[r.status]=(a[r.status]??0)+1;return a;},{});
/** Pure, bounded-scope reference inventory. No alias/fuzzy resolution, no
 * provider selection, no application/repair and no inferred approval. */
export function reviewLocalInventoryReferences(input:ReferenceReviewInput,capture:LocalInventoryCaptureResult){
 try{
  const {installed,runtime,portable,captureId,scope,baselineRuntime}=input;
  const e=capture.evidence,{fingerprint,...body}=e;
  if(capture.captureStatus!=='stableObservation'||e.scope!==scope||e.captureFingerprint!==digest({captureId})||
   e.readiness!=='blocked'||e.inventoryAcceptance!=='notEstablished'||capture.writeAuthorized!==false||capture.executable!==false||
   e.writeAuthorized!==false||e.executable!==false||digest(body)!==fingerprint)return fail('captureBindingMismatch');
  const fresh=buildLocalInventoryEvidence({captureId,scope,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},
   runtime:{status:'observed',source:'catalogStore',captureId,value:runtime},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:portable}
  }});
  for(const surface of ['compendium','runtime','portable'] as const){
   const a=fresh.surfaces.find(s=>s.surface===surface),b=e.surfaces.filter(s=>s.surface===surface);
   if(a?.status!=='observed'||b.length!==1||b[0].status!=='observed'||a.fingerprint!==b[0].fingerprint||digest(a.counts)!==digest(b[0].counts))return fail('coreObservationBindingMismatch');
  }
  const snapshot=runtime.snapshot,byId=new Map(baselineRuntime.map(r=>[r.id,r]));
  if(byId.size!==baselineRuntime.length||baselineRuntime.some(r=>!r.id||!r.kind||!/^[a-f0-9]{64}$/.test(r.sourceFingerprint)))return fail('invalidRuntimeBaseline');
  const runtimeRows:Array<{status:Status;fingerprint:string}>=[];
  for(const r of baselineRuntime){
   const entry=snapshot.entryById.get(r.id);
   const status:Status=!entry?'missingLoadedEntry':entry.kind===r.kind&&digest(entry)===r.sourceFingerprint?'exactEntry':'changedEntry';
   runtimeRows.push({status,fingerprint:digest({baseline:r,loaded:entry??null,status})});
  }
  for(const entry of snapshot.entries)if(!byId.has(entry.entityId))runtimeRows.push({status:'loadedOnly',fingerprint:digest({entry,status:'loadedOnly'})});
  const chars=new Set(portable.characterStore.characters.map(c=>c.id)),scenarios=new Map(portable.scenarios.map(s=>[s.id,s]));
  const storage=new Map(installed.items.map(i=>[i.id,i]));
  const canonicalIds=new Map<string,number>();
  for(const i of installed.items)canonicalIds.set(i.importItemId,(canonicalIds.get(i.importItemId)??0)+1);
  const references:Array<{lane:string;status:Status;fingerprint:string}>=[];
  const add=(lane:string,coordinate:unknown,value:unknown,status:Status)=>references.push({lane,status,fingerprint:digest({lane,coordinate,value,status})});
  const linkStatus=(l:CharacterCompendiumLink):Status=>{
   if(l.status==='removed')return 'removed';
   if(l.origin==='catalog'){
    if(!l.catalogEntityId)return 'unqualified';
    if(!snapshot.registry.has(l.catalogEntityId))return 'missing';
    return l.catalogSnapshotId&&l.catalogSnapshotId!==snapshot.snapshotId?'ownerMismatch':'present';
   }
   if(l.origin==='compendium'){
    const row=storage.get(l.itemId);
    if(!row)return (canonicalIds.get(l.importItemId)??0)>1?'ambiguous':'missing';
    return row.importItemId===l.importItemId&&row.packId===l.packId&&row.sourceId===l.sourceId?'present':'ownerMismatch';
   }
   return 'unqualified';
  };
  const choiceStatus=(value:unknown):Status=>{
   if(typeof value!=='string'||!value.trim()||value!==value.trim())return 'unqualified';
   if(value.startsWith('catalog:'))return snapshot.registry.has(value.slice(8))?'present':'missing';
   if(value.startsWith('compendium:')){
    const id=value.slice(11);if(storage.has(id))return 'present';
    return (canonicalIds.get(id)??0)>1?'ambiguous':canonicalIds.has(id)?'unqualified':'missing';
   }
   const hits=(snapshot.registry.has(value)?1:0)+(storage.has(value)?1:0)+(canonicalIds.get(value)??0);
   return hits>1?'ambiguous':hits===0?'missing':'unqualified';
  };
  for(const c of portable.characterStore.characters){
   if(c.catalogSnapshotId)add('characterSnapshot',c.id,c.catalogSnapshotId,c.catalogSnapshotId===snapshot.snapshotId?'present':'ownerMismatch');
   for(const occurrence of collectBuildReferenceOccurrences(c,'character'))add('characterBuildChoice',[c.id,...occurrence.path],occurrence.value,choiceStatus(occurrence.value));
   for(const [i,l] of (c.compendiumLinks??[]).entries())add('characterLink',[c.id,i],l,l.characterId!==c.id?'ownerMismatch':linkStatus(l));
  }
  for(const p of portable.buildPresets){
   for(const occurrence of collectBuildReferenceOccurrences(p.snapshot,'preset'))add('presetBuildReference',[p.id,...occurrence.path],occurrence.value,choiceStatus(occurrence.value));
   for(const [i,l] of (p.snapshot.compendiumLinks??[]).entries())add('presetLink',[p.id,i],l,linkStatus(l));
  }
  for(const s of portable.scenarios)add('scenarioCharacter',s.id,s.characterId,chars.has(s.characterId)?'present':'missing');
  for(const h of portable.buildHistorySnapshots){
   add('historyCharacter',h.id,h.characterId,chars.has(h.characterId)?'present':'missing');
   const s=scenarios.get(h.scenario.id);
   add('historyScenario',h.id,h.scenario.id,!s?'missing':s.characterId===h.characterId?'present':'ownerMismatch');
  }
  for(const [id,state] of Object.entries(portable.catalog.filterState.entityStates))add('filterEntity',id,state,snapshot.registry.has(id)?'present':'missing');
  for(const [id,state] of Object.entries(portable.catalog.filterState.categoryStates))add('filterCategory',id,state,snapshot.categoryById.has(id)?'present':'missing');
  for(const [id,state] of Object.entries(portable.catalog.filterState.bookStates))add('filterBook',id,state,snapshot.manifest.sourceBooks.includes(id)?'present':'missing');
  const lanes=[...new Set(references.map(r=>r.lane))].sort().map(lane=>({lane,total:references.filter(r=>r.lane===lane).length,statuses:tally(references.filter(r=>r.lane===lane))}));
  const result={schemaVersion:'dnd-local-inventory-reference-review.v1',scope,bindings:{capture:fingerprint,captureEnvelope:digest(capture),
   baselineRuntime:digest(baselineRuntime),installed:fresh.surfaces.find(s=>s.surface==='compendium')!.fingerprint!,
   runtime:fresh.surfaces.find(s=>s.surface==='runtime')!.fingerprint!,portable:fresh.surfaces.find(s=>s.surface==='portable')!.fingerprint!},
   summary:{baselineEntries:baselineRuntime.length,loadedEntries:snapshot.entries.length,runtimeDispositions:tally(runtimeRows),referenceOccurrences:references.length,referenceLanes:lanes},
   runtimeRowsFingerprint:digest(runtimeRows),referenceRowsFingerprint:digest(references),
   obligations:[
    {criterion:'completeInstalledCompendiumAndPortableStateInventory',status:'partial',pending:['independentBackend','buildChoiceProviderAndTacticalReferences','draftRecoveryQuarantineReferences','auxiliaryPersistence']},
    {criterion:'exactRuntimePackageAndConfigurationBinding',status:'partial',pending:['registryDependencyAliasAndCategoryDispositions','bundledBytesAndPackageTrust','configurationHistoryReferences']},
    {criterion:'legacyVersionsManualMappingsAndExternalPacksInventory',status:'pending',pending:['legacyVersionAndManualMappingReview','externalOwnerInventory']},
    {criterion:'explicitUnmatchedAndExcludedOccurrenceLedger',status:'partial',pending:['historicalLedgerJoin','ownerExclusionDecisions']}
   ],readiness:'blocked',inventoryAcceptance:'notEstablished',...flags};
  return {ok:true as const,review:{...result,fingerprint:digest(result)},...flags};
 }catch{return fail('referenceReviewFailed');}
}
