import {sha256Hex} from '../catalog/catalogBundleDigest';
import {revalidateV3MigrationPlan,verifyV3MigrationPlanStructure,V3_CANDIDATE_NAMESPACE,type V3MigrationPlan} from './v3MigrationPlan';
import type {V3CheckpointReadPorts} from './v3DurableCheckpoint';
import type {PrivateCheckpointArchivePort} from './v3CheckpointArchive';

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
export async function inspectV3IsolatedExecution(plan:V3MigrationPlan,port:Pick<IsolatedCandidatePort,'read'>){
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
/** This executes only candidate artifact writes; no production migration.
 * Intent is durable before each write, confirmation follows exact readback.
 * On any ambiguous failure stop; the next call reopens the same journal.
 * The port must implement exclusive immutable writes, not overwrite. */
export async function executeV3IsolatedMigration(plan:V3MigrationPlan,request:IsolatedExecutionRequest,ports:V3CheckpointReadPorts,archive:Pick<PrivateCheckpointArchivePort,'read'>,candidate:IsolatedCandidatePort){
 try{
  if(request.scope!=='disposableCandidateOnly'||request.acknowledgement!=='preserveActiveState'||request.planFingerprint!==plan.fingerprint||!verifyV3MigrationPlanStructure(plan))return fail('isolatedExecutionRequestInvalid');
  if(!(await revalidateV3MigrationPlan(plan,ports,archive)).ok)return fail('isolatedExecutionCheckpointStale');
  const initial=await inspectV3IsolatedExecution(plan,candidate);
  if(!['empty','interrupted','complete'].includes(initial.state))return fail('isolatedExecutionJournalConflict');
  const {ordered,steps,end}=journal(plan);
  let created=0;
  for(let i=initial.verifiedRecords;i<ordered.length;i++){
   const row=ordered[i];
   // Revalidate before publishing completion marker and final journal event.
   if(row.key===steps[steps.length-1].row.key||row.key===end.key){
    if(!(await revalidateV3MigrationPlan(plan,ports,archive)).ok)return fail('isolatedExecutionCheckpointStale');
   }
   if(await candidate.read(row.key)!==null)return fail('isolatedExecutionConcurrentChange');
   await candidate.createExclusive(row.key,row.value);
   if(await candidate.read(row.key)!==row.value)return fail('isolatedExecutionReadbackMismatch');
   created++;
  }
  const final=await inspectV3IsolatedExecution(plan,candidate);
  if(final.state!=='complete')return fail('isolatedExecutionIncomplete');
  if(!(await revalidateV3MigrationPlan(plan,ports,archive)).ok)return fail('isolatedExecutionCheckpointStale');
  const body={schemaVersion:schema,candidateId:plan.candidateId,planFingerprint:plan.fingerprint,checkpointFingerprint:plan.bindings.checkpoint,
   journalFingerprint:hash(ordered.map(r=>[r.key,sha256Hex(r.value)])),scope:'disposableCandidateOnly',status:'candidateRecordsVerified',
   verifiedRecords:final.verifiedRecords,artifactRecords:plan.operations.length,journalRecords:ordered.length-plan.operations.length,activeWrites:0,
   pending:[...plan.pending,'productionRollbackAndNativeValidationPending'],...flags};
  return {ok:true as const,receipt:{...body,fingerprint:hash(body)},createdRecords:created,executable:false as const};
 }catch{return fail('isolatedExecutionInterrupted');}
}
