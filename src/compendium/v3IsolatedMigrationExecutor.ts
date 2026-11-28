import {sha256Hex} from '../catalog/catalogBundleDigest';
import {revalidateV3MigrationPlan,verifyV3MigrationPlanStructure,V3_CANDIDATE_NAMESPACE,inspectV3CandidateQuarantine,v3CandidateQuarantineRecord,type V3MigrationPlan} from './v3MigrationPlan';
import type {V3CheckpointReadPorts} from './v3DurableCheckpoint';
import {readV3CheckpointArchive,type PrivateCheckpointArchivePort} from './v3CheckpointArchive';

const schema='dnd-v3-isolated-execution.v1' as const;
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const hash=(v:unknown)=>sha256Hex(JSON.stringify(v));
/** Exclusive create is an adapter contract, not get-then-set. The adapter
 * must own a disposable private namespace, independent of active storage. */
export interface IsolatedCandidatePort {
 read:(key:string)=>Promise<string|null>;
 createExclusive:(key:string,value:string)=>Promise<void>;
}
export interface IsolatedExecutionRequest {
 scope:'disposableCandidateOnly';
 planFingerprint:string;
 acknowledgement:'preserveActiveState';
}
type Row={key:string;value:string};
type Step={row:Row;intent:Row;confirmed:Row};
const fail=(code:string)=>({ok:false as const,code,executable:false as const});
function journal(plan:V3MigrationPlan){
 const prefix=V3_CANDIDATE_NAMESPACE+plan.candidateId+'/journal/';
 const row=(name:string,body:object):Row=>({key:prefix+name,value:JSON.stringify({schemaVersion:schema,candidateId:plan.candidateId,planFingerprint:plan.fingerprint,...body,...flags})});
 const start=row('start',{event:'started',checkpoint:plan.bindings.checkpoint});
 const steps:Step[]=plan.operations.map((operation,i)=>({
  row:{key:operation.key,value:operation.value},
  intent:row(i+'-intent',{event:'intent',ordinal:i,role:operation.role,valueFingerprint:operation.valueFingerprint}),
  confirmed:row(i+'-confirmed',{event:'confirmed',ordinal:i,role:operation.role,valueFingerprint:operation.valueFingerprint})
 }));
 const end=row('end',{event:'completed',records:plan.operations.map(o=>o.valueFingerprint)});
 return {start,steps,end,ordered:[start,...steps.flatMap(s=>[s.intent,s.row,s.confirmed]),end]};
}
/** Exact ordered prefix of the combined journal/data sequence only.
 * This rejects unjournaled artifacts, holes, corruption and foreign bytes. */
async function inspectJournal(plan:V3MigrationPlan,port:Pick<IsolatedCandidatePort,'read'>){
 if(!verifyV3MigrationPlanStructure(plan))return {state:'invalidPlan' as const,verifiedRecords:0,executable:false as const};
 try{
  const {ordered}=journal(plan);let verifiedRecords=0,missing=false;
  for(const row of ordered){
   const raw=await port.read(row.key);
   if(raw===null){missing=true;continue;}
   if(missing||raw!==row.value)return {state:'conflict' as const,verifiedRecords,executable:false as const};
   verifiedRecords++;
  }
  return {state:verifiedRecords===0?'empty' as const:verifiedRecords===ordered.length?'complete' as const:'interrupted' as const,verifiedRecords,executable:false as const};
 }catch{return {state:'unavailable' as const,verifiedRecords:0,executable:false as const};}
}
/** Quarantine takes precedence over any existing completion marker. */
export async function inspectV3IsolatedExecution(plan:V3MigrationPlan,port:Pick<IsolatedCandidatePort,'read'>){
 if(!verifyV3MigrationPlanStructure(plan))return {state:'invalidPlan' as const,verifiedRecords:0,executable:false as const};
 try{
  const before=await inspectV3CandidateQuarantine(plan,key=>port.read(key));
  if(before!=='absent')return {state:before,verifiedRecords:0,executable:false as const};
  const result=await inspectJournal(plan,port);
  const after=await inspectV3CandidateQuarantine(plan,key=>port.read(key));
  return after==='absent'?result:{state:after,verifiedRecords:0,executable:false as const};
 }catch{return {state:'unavailable' as const,verifiedRecords:0,executable:false as const};}
}
/** This executes only candidate artifact writes; no production migration.
 * Intent is durable before each write, confirmation follows exact readback.
 * On any ambiguous failure stop; the next call reopens the same journal.
 * The port must implement exclusive immutable writes, not overwrite. */
export async function executeV3IsolatedMigration(plan:V3MigrationPlan,request:IsolatedExecutionRequest,ports:V3CheckpointReadPorts,archive:Pick<PrivateCheckpointArchivePort,'read'>,candidate:IsolatedCandidatePort){
 try{
  if(request.scope!=='disposableCandidateOnly'||request.acknowledgement!=='preserveActiveState'||request.planFingerprint!==plan.fingerprint||!verifyV3MigrationPlanStructure(plan))return fail('isolatedExecutionRequestInvalid');
  if(!(await revalidateV3MigrationPlan(plan,ports,archive)).ok)return fail('isolatedExecutionCheckpointStale');
  const initial=await inspectV3IsolatedExecution(plan,candidate);
  if(initial.state==='quarantined')return fail('isolatedExecutionQuarantined');
  if(!['empty','interrupted','complete'].includes(initial.state))return fail('isolatedExecutionJournalConflict');
  const {ordered,steps,end}=journal(plan);
  let created=0;
  for(let i=initial.verifiedRecords;i<ordered.length;i++){
   const row=ordered[i];
   // Revalidate before publishing completion marker and final journal event.
   if(row.key===steps[steps.length-1].row.key||row.key===end.key){
    if(!(await revalidateV3MigrationPlan(plan,ports,archive)).ok)return fail('isolatedExecutionCheckpointStale');
   }
   if(await inspectV3CandidateQuarantine(plan,key=>candidate.read(key))!=='absent')return fail('isolatedExecutionQuarantinedOrConflict');
   if(await candidate.read(row.key)!==null)return fail('isolatedExecutionConcurrentChange');
   await candidate.createExclusive(row.key,row.value);
   if(await candidate.read(row.key)!==row.value)return fail('isolatedExecutionReadbackMismatch');
   created++;
  }
  const final=await inspectV3IsolatedExecution(plan,candidate);
  if(final.state!=='complete')return fail('isolatedExecutionIncomplete');
  if(!(await revalidateV3MigrationPlan(plan,ports,archive)).ok)return fail('isolatedExecutionCheckpointStale');
  if(await inspectV3CandidateQuarantine(plan,key=>candidate.read(key))!=='absent')return fail('isolatedExecutionQuarantinedOrConflict');
  const body={schemaVersion:schema,candidateId:plan.candidateId,planFingerprint:plan.fingerprint,checkpointFingerprint:plan.bindings.checkpoint,
   journalFingerprint:hash(ordered.map(r=>[r.key,sha256Hex(r.value)])),scope:'disposableCandidateOnly',status:'candidateRecordsVerified',
   verifiedRecords:final.verifiedRecords,artifactRecords:plan.operations.length,journalRecords:ordered.length-plan.operations.length,activeWrites:0,
   pending:[...plan.pending,'productionRollbackAndNativeValidationPending'],...flags};
  return {ok:true as const,receipt:{...body,fingerprint:hash(body)},createdRecords:created,executable:false as const};
 }catch{return fail('isolatedExecutionInterrupted');}
}

export interface IsolatedRollbackRequest {
 scope:'disposableCandidateOnly';
 planFingerprint:string;
 acknowledgement:'quarantineCandidateKeepEvidence';
}
/** Logical rollback, not deletion: atomically publish an immutable tombstone
 * in the isolated namespace, retain the exact journal and candidate bytes.
 * A stale active state does not prevent quarantine, but cannot earn a
 * preservation receipt. No writes to active repositories or archive. */
export async function rollbackV3IsolatedMigration(plan:V3MigrationPlan,request:IsolatedRollbackRequest,ports:V3CheckpointReadPorts,archive:Pick<PrivateCheckpointArchivePort,'read'>,candidate:IsolatedCandidatePort){
 try{
  if(request.scope!=='disposableCandidateOnly'||request.acknowledgement!=='quarantineCandidateKeepEvidence'||request.planFingerprint!==plan.fingerprint||!verifyV3MigrationPlanStructure(plan))return fail('isolatedRollbackRequestInvalid');
  const checkpoint=await readV3CheckpointArchive(archive,plan.bindings.archive);
  if(!checkpoint||checkpoint.manifest.fingerprint!==plan.bindings.checkpoint||checkpoint.manifest.preservationFingerprint!==plan.bindings.preservation||
   checkpoint.manifest.runtimeFingerprint!==plan.bindings.activeRuntime||checkpoint.manifest.compendiumFingerprint!==plan.bindings.activeCompendium||
   checkpoint.manifest.keyValuesFingerprint!==plan.bindings.activeKeyValues||checkpoint.manifest.portableFingerprint!==plan.bindings.portable)return fail('isolatedRollbackArchiveMismatch');
  const marker=v3CandidateQuarantineRecord(plan);
  const before=await inspectJournal(plan,candidate);
  const prior=await inspectV3CandidateQuarantine(plan,key=>candidate.read(key));
  if(prior==='conflict')return fail('isolatedRollbackMarkerConflict');
  // Corrupt or incomplete artifacts are not repaired. Quarantine may still
  // block them; only an exact stable journal qualifies for verified receipt.
  const activeBefore=(await revalidateV3MigrationPlan(plan,ports,archive)).ok;
  let createdRecords=0;
  if(prior==='absent'){
   await candidate.createExclusive(marker.key,marker.value);createdRecords=1;
  }
  if(await candidate.read(marker.key)!==marker.value)return fail('isolatedRollbackReadbackMismatch');
  const after=await inspectJournal(plan,candidate);
  const activeAfter=(await revalidateV3MigrationPlan(plan,ports,archive)).ok;
  if(await inspectV3CandidateQuarantine(plan,key=>candidate.read(key))!=='quarantined')return fail('isolatedRollbackReadbackMismatch');
  const journalVerified=['empty','interrupted','complete'].includes(before.state)&&before.state===after.state&&before.verifiedRecords===after.verifiedRecords;
  const activePreservation=activeBefore&&activeAfter?'checkpointMatch' as const:'notVerified' as const;
  const body={schemaVersion:'dnd-v3-isolated-rollback.v1',candidateId:plan.candidateId,planFingerprint:plan.fingerprint,checkpointFingerprint:plan.bindings.checkpoint,
   quarantineFingerprint:sha256Hex(marker.value),scope:'disposableCandidateOnly',status:journalVerified&&activePreservation==='checkpointMatch'?'quarantineVerified' as const:'quarantinedReviewRequired' as const,
   journalVerified,retainedRecords:after.verifiedRecords,activePreservation,activeWrites:0,deletes:0,
   pending:[...plan.pending,'nativeAndProductionRollbackPending'],...flags};
  return {ok:true as const,receipt:{...body,fingerprint:hash(body)},createdRecords,executable:false as const};
 }catch{return fail('isolatedRollbackInterrupted');}
}
