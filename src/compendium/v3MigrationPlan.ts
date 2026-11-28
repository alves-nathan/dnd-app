import {sha256Hex} from '../catalog/catalogBundleDigest';
import {prepareV3PreservationCheckpoint} from './importV3Preservation';
import {captureV3DurableCheckpoint,type V3CheckpointReadPorts} from './v3DurableCheckpoint';
import {readV3CheckpointArchive,rehearseV3CheckpointRestore,type PrivateCheckpointArchivePort} from './v3CheckpointArchive';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';

export const V3_MIGRATION_PLAN_SCHEMA='dnd-v3-isolated-migration-plan.v1' as const;
// Deliberately outside the active application key namespace. No active readers.
export const V3_CANDIDATE_NAMESPACE='dnd-v3-isolated-candidate/v1/';
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const hash=(v:unknown)=>sha256Hex(JSON.stringify(v));
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type CandidateOperation={kind:'putIfAbsent';role:'rawPack'|'reviewIndex'|'completionMarker';key:string;value:string;valueFingerprint:string};
export interface V3MigrationPlan {
 schemaVersion:typeof V3_MIGRATION_PLAN_SCHEMA;
 candidateId:string;
 bindings:{archive:string;checkpoint:string;preservation:string;stage:string;rawPack:string;restoreRehearsal:string;activeRuntime:string;activeCompendium:string;activeKeyValues:string;portable:string};
 operations:CandidateOperation[];
 counts:{candidateItems:number;candidateSources:number;preservedStorageItems:number;preservedRuntimeEntries:number;preservedCharacters:number;preservedRawKeys:number;plannedCandidateWrites:3;activeWrites:0;deletes:0;replacements:0};
 pending:string[];
 scope:'isolatedCandidateOnly';
 activation:'review-required';
 runtimeEligible:false;
 writeAuthorized:false;
 distributionAuthorized:false;
 retirementAuthorized:false;
 executable:false;
 fingerprint:string;
}
type PlanResult={ok:false;code:string;executable:false}|{ok:true;plan:V3MigrationPlan;executable:false};
const fail=(code:string)=>({ok:false as const,code,executable:false as const});
const op=(prefix:string,role:CandidateOperation['role'],value:string):CandidateOperation=>({kind:'putIfAbsent',role,key:prefix+role,value,valueFingerprint:sha256Hex(value)});
/** Reopen the archive, independently recapture the active state and rederive
 * the isolated plan. Never pass canonical V3 through a V1/V2 importer. */
export async function prepareV3MigrationPlan(ports:V3CheckpointReadPorts,archivePort:Pick<PrivateCheckpointArchivePort,'read'>,archiveId:string):Promise<PlanResult>{
 try{
  const archive=await readV3CheckpointArchive(archivePort,archiveId);
  if(!archive)return fail('migrationCheckpointArchiveInvalid');
  const rehearsal=await rehearseV3CheckpointRestore(archivePort,archiveId);
  if(!rehearsal.ok)return fail('migrationCheckpointRehearsalFailed');
  const live=await captureV3DurableCheckpoint(ports);
  if(!live.ok)return fail('migrationCurrentCaptureUnavailable');
  if(live.manifest.fingerprint!==archive.manifest.fingerprint)return fail('migrationCheckpointStale');
  const frame=ports.readFrame(),p=frame.preservation;
  const verified=prepareV3PreservationCheckpoint(p);
  if(frame.blocked||frame.backend!==live.manifest.backend||!verified.ok||!verified.checkpoint||verified.checkpoint.fingerprint!==live.manifest.preservationFingerprint)return fail('migrationStageStale');
  const stage=p.stage,checkpoint=archive.manifest;
  const bindings={archive:archiveId,checkpoint:checkpoint.fingerprint,preservation:verified.checkpoint.fingerprint,stage:stage.fingerprint,rawPack:stage.rawFingerprint,
   restoreRehearsal:rehearsal.report.fingerprint,activeRuntime:checkpoint.runtimeFingerprint,activeCompendium:checkpoint.compendiumFingerprint,activeKeyValues:checkpoint.keyValuesFingerprint,portable:checkpoint.portableFingerprint};
  const candidateId=hash({schemaVersion:V3_MIGRATION_PLAN_SCHEMA,bindings}),prefix=V3_CANDIDATE_NAMESPACE+candidateId+'/';
  const rawPack=op(prefix,'rawPack',stage.rawText);
  const index=op(prefix,'reviewIndex',JSON.stringify({schemaVersion:'dnd-v3-isolated-review-index.v1',candidateId,bindings,packId:stage.packId,itemIds:stage.itemIds,sourceIds:stage.sourceIds,upstreamCommit:stage.upstreamCommit,provenanceFingerprint:stage.provenanceReview.fingerprint,validationCodes:stage.validationCodes,...flags}));
  const marker=op(prefix,'completionMarker',JSON.stringify({schemaVersion:'dnd-v3-isolated-completion.v1',candidateId,records:[rawPack,index].map(({role,valueFingerprint})=>({role,valueFingerprint})),...flags}));
  const body:Omit<V3MigrationPlan,'fingerprint'>={schemaVersion:V3_MIGRATION_PLAN_SCHEMA,candidateId,bindings,operations:[rawPack,index,marker],
   counts:{candidateItems:stage.itemIds.length,candidateSources:stage.sourceIds.length,preservedStorageItems:verified.checkpoint.counts.storageItems,preservedRuntimeEntries:verified.checkpoint.counts.runtimeEntries,preservedCharacters:verified.checkpoint.counts.characters,preservedRawKeys:checkpoint.keyCount,plannedCandidateWrites:3,activeWrites:0,deletes:0,replacements:0},
   pending:[...new Set([...verified.checkpoint.blockers,...checkpoint.pending,'relationshipParityNotApproved','isolatedTransactionAndRollbackNotVerified','nativeValidationPending','explicitOwnerApprovalMissing'])].sort(),
   scope:'isolatedCandidateOnly',...flags};
  return {ok:true,plan:{...body,fingerprint:hash(body)},executable:false};
 }catch{return fail('migrationPlanPreparationFailed');}
}
/** Fingerprint and structural checks are not authenticity. A future executor
 * must also rederive the plan against a fresh active capture and archive. */
export function verifyV3MigrationPlanStructure(plan:V3MigrationPlan):boolean{
 try{
  const {fingerprint,...body}=plan;
  const prefix=V3_CANDIDATE_NAMESPACE+plan.candidateId+'/';
  if(plan.schemaVersion!==V3_MIGRATION_PLAN_SCHEMA||plan.scope!=='isolatedCandidateOnly'||!hex(plan.candidateId)||
   hash({schemaVersion:V3_MIGRATION_PLAN_SCHEMA,bindings:plan.bindings})!==plan.candidateId||!Object.values(plan.bindings).every(hex)||
   !Object.entries(flags).every(([k,v])=>plan[k as keyof V3MigrationPlan]===v)||hash(body)!==fingerprint||
   plan.operations.length!==3||plan.counts.plannedCandidateWrites!==3||plan.counts.activeWrites!==0||plan.counts.deletes!==0||plan.counts.replacements!==0)return false;
  const roles=['rawPack','reviewIndex','completionMarker'];
  if(!plan.operations.every((o,i)=>o.kind==='putIfAbsent'&&o.role===roles[i]&&o.key===prefix+o.role&&typeof o.value==='string'&&sha256Hex(o.value)===o.valueFingerprint))return false;
  const [raw,index,marker]=plan.operations;
  if(raw.valueFingerprint!==plan.bindings.rawPack)return false;
  const review=JSON.parse(index.value),completed=JSON.parse(marker.value);
  return review.schemaVersion==='dnd-v3-isolated-review-index.v1'&&review.candidateId===plan.candidateId&&hash(review.bindings)===hash(plan.bindings)&&
   Array.isArray(review.itemIds)&&review.itemIds.length===plan.counts.candidateItems&&Array.isArray(review.sourceIds)&&review.sourceIds.length===plan.counts.candidateSources&&
   completed.schemaVersion==='dnd-v3-isolated-completion.v1'&&completed.candidateId===plan.candidateId&&hash(completed.records)===hash([raw,index].map(({role,valueFingerprint})=>({role,valueFingerprint})))&&
   [review,completed].every(x=>Object.entries(flags).every(([k,v])=>x[k]===v));
 }catch{return false;}
}
export async function revalidateV3MigrationPlan(plan:V3MigrationPlan,ports:V3CheckpointReadPorts,archivePort:Pick<PrivateCheckpointArchivePort,'read'>){
 if(!verifyV3MigrationPlanStructure(plan))return {ok:false,executable:false as const};
 const result=await prepareV3MigrationPlan(ports,archivePort,plan.bindings.archive);
 return {ok:result.ok&&result.plan.fingerprint===plan.fingerprint,executable:false as const};
}
/** Immutable terminal marker; no candidate or journal bytes are deleted.
 * Consumers must check this marker even when a completion marker exists. */
export function v3CandidateQuarantineRecord(plan:V3MigrationPlan){
 return {key:V3_CANDIDATE_NAMESPACE+plan.candidateId+'/quarantine',value:JSON.stringify({schemaVersion:'dnd-v3-isolated-quarantine.v1',candidateId:plan.candidateId,planFingerprint:plan.fingerprint,checkpointFingerprint:plan.bindings.checkpoint,disposition:'quarantined',...flags})};
}
export async function inspectV3CandidateQuarantine(plan:V3MigrationPlan,read:(key:string)=>Promise<string|null>|string|null):Promise<'absent'|'quarantined'|'conflict'>{
 const marker=v3CandidateQuarantineRecord(plan),raw=await read(marker.key);
 return raw===null?'absent':raw===marker.value?'quarantined':'conflict';
}
export type V3CandidateState='empty'|'matchingPrefix'|'complete'|'quarantined'|'conflict'|'unavailable'|'invalidPlan';
/** Read-only idempotency classifier: only an exact ordered prefix is a
 * recoverable partial candidate. A later record without its predecessor is
 * a conflict, not an invitation to repair or overwrite. */
export async function inspectV3MigrationCandidate(plan:V3MigrationPlan,storage:Pick<KeyValueStorageAdapter,'getItem'>):Promise<{state:V3CandidateState;matchingRecords:number;executable:false}>{
 const result=(state:V3CandidateState,matchingRecords=0)=>({state,matchingRecords,executable:false as const});
 if(!verifyV3MigrationPlanStructure(plan))return result('invalidPlan');
 try{
  const before=await inspectV3CandidateQuarantine(plan,storage.getItem);
  if(before!=='absent')return result(before);
  let matching=0,missing=false;
  for(const operation of plan.operations){
   const value=await storage.getItem(operation.key);
   if(value===null){missing=true;continue;}
   if(missing||value!==operation.value)return result('conflict');
   matching++;
  }
  const after=await inspectV3CandidateQuarantine(plan,storage.getItem);
  if(after!=='absent')return result(after);
  return result(matching===0?'empty':matching===plan.operations.length?'complete':'matchingPrefix',matching);
 }catch{return result('unavailable');}
}
