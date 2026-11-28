import {sha256Hex} from '../catalog/catalogBundleDigest';
import {readV3CheckpointArchive,rehearseV3CheckpointRestore,type PrivateCheckpointArchivePort} from './v3CheckpointArchive';
import {verifyV3MigrationPlanStructure,revalidateV3MigrationPlan,inspectV3MigrationCandidate,type V3MigrationPlan} from './v3MigrationPlan';
import {inspectV3IsolatedExecution,inspectV3QuarantinedJournal,type IsolatedCandidatePort} from './v3IsolatedMigrationExecutor';
import type {V3CheckpointReadPorts} from './v3DurableCheckpoint';

const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const hash=(v:unknown)=>sha256Hex(JSON.stringify(v));
const fail=(code:string)=>({ok:false as const,code,executable:false as const});
type ReadPort=Pick<IsolatedCandidatePort,'read'>;
export interface V3FinalValidationPorts {
 active:V3CheckpointReadPorts;
 archive:Pick<PrivateCheckpointArchivePort,'read'>;
 completed:ReadPort;
 reverted:ReadPort;
}
/** Independent readback of the same plan in two separately provisioned
 * disposable candidate namespaces. No receipts supplied by caller, writes,
 * restore executor, or acceptance decision. A completed candidate must not
 * be quarantined; the rollback specimen must retain a full exact journal. */
export async function validateV3IsolatedLifecycle(plan:V3MigrationPlan,ports:V3FinalValidationPorts){
 try{
  if(!verifyV3MigrationPlanStructure(plan)||ports.completed===ports.reverted)return fail('finalValidationInvalidScope');
  const archive=await readV3CheckpointArchive(ports.archive,plan.bindings.archive);
  if(!archive||archive.manifest.fingerprint!==plan.bindings.checkpoint)return fail('finalValidationArchiveMismatch');
  const restored=await rehearseV3CheckpointRestore(ports.archive,plan.bindings.archive);
  if(!restored.ok||restored.report.fingerprint!==plan.bindings.restoreRehearsal)return fail('finalValidationRestoreMismatch');
  if(!(await revalidateV3MigrationPlan(plan,ports.active,ports.archive)).ok)return fail('finalValidationActiveMismatch');
  const observe=async()=>{
   const completed=await inspectV3IsolatedExecution(plan,ports.completed);
   const artifacts=await inspectV3MigrationCandidate(plan,{getItem:key=>ports.completed.read(key)});
   const reverted=await inspectV3IsolatedExecution(plan,ports.reverted);
   const revertedArtifacts=await inspectV3MigrationCandidate(plan,{getItem:key=>ports.reverted.read(key)});
   const retained=await inspectV3QuarantinedJournal(plan,ports.reverted);
   if(completed.state!=='complete'||completed.verifiedRecords!==11||artifacts.state!=='complete'||artifacts.matchingRecords!==3||
    reverted.state!=='quarantined'||revertedArtifacts.state!=='quarantined'||!retained.ok||!retained.completeJournal||retained.retainedRecords!==11)return null;
   return {completedRecords:completed.verifiedRecords,artifactRecords:artifacts.matchingRecords,retainedRecords:retained.retainedRecords,
    retainedFingerprint:retained.retainedFingerprint,quarantineFingerprint:retained.quarantineFingerprint};
  };
  const before=await observe();
  if(!before)return fail('finalValidationLifecycleMismatch');
  if(!(await revalidateV3MigrationPlan(plan,ports.active,ports.archive)).ok)return fail('finalValidationActiveMismatch');
  const after=await observe();
  if(!after||hash(before)!==hash(after))return fail('finalValidationLifecycleChanged');
  const body={schemaVersion:'dnd-v3-isolated-lifecycle-validation.v1' as const,scope:'disposableCandidateReadback' as const,
   bindings:{candidate:plan.candidateId,plan:plan.fingerprint,archive:plan.bindings.archive,checkpoint:plan.bindings.checkpoint,preservation:plan.bindings.preservation,restoreRehearsal:restored.report.fingerprint,
    activeRuntime:plan.bindings.activeRuntime,activeCompendium:plan.bindings.activeCompendium,activeKeyValues:plan.bindings.activeKeyValues,portable:plan.bindings.portable},
   observations:{archive:'integrityMatch',restore:'disposableRehearsalMatch',active:'checkpointMatch',completed:'exactJournalAndArtifacts',rollback:'quarantinedFullJournalRetained',...after},
   counts:{...plan.counts,validationWrites:0,acceptedGates:0},
   pending:[...new Set([...plan.pending,'productionAdaptersNotVerified','fullInstalledInventoryNotVerified','candidateNativeEvidenceMissing','explicitCutoverApprovalMissing'])].sort(),
   readiness:'blocked' as const,...flags};
  return {ok:true as const,report:{...body,fingerprint:hash(body)},executable:false as const};
 }catch{return fail('finalValidationUnavailable');}
}
