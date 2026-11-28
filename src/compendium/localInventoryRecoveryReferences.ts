import type {Character,CharacterProgressionOperation,CharacterProgressionSnapshot,CharacterCompendiumLink} from '../types';
import type {PortableRestoreCharacterCheckpoint} from '../backup/portableRestoreSession';
import type {CharacterCompatibilityRemediationPlan} from '../characters/compatibilityRemediation';
import {characterProgressionFingerprint} from '../characters/progressionTransaction';
import {collectBuildReferenceOccurrences} from './localInventoryBuildReferences';
import {collectOwnerInstanceReferences} from './localInventoryInstanceReferences';

type Status='present'|'missing'|'ambiguous'|'ownerMismatch'|'unqualified'|'removed';
type Path=readonly (string|number)[];
type Add=(lane:string,path:Path,value:unknown,status:Status)=>void;
interface Context {
 snapshotId:string;
 choiceStatus:(value:unknown)=>Status;
 linkStatus:(link:CharacterCompendiumLink)=>Status;
 entityExists:(id:string)=>boolean;
 bookExists:(id:string)=>boolean;
 categoryExists:(id:string)=>boolean;
}
const historical=(status:Status):Status=>status==='missing'?'unqualified':status;
const idStatus=(rows:readonly {id?:string}[],value:unknown):Status=>{
 if(typeof value!=='string'||!value.trim())return 'unqualified';
 const n=rows.filter(r=>r.id===value).length;
 return n===0?'missing':n===1?'present':'ambiguous';
};
/** Only inspect explicit fields; recovery routines themselves may write,
 * discard or normalize records and are never called here. */
export function collectRecoveryAndTransactionReferences(checkpoint:PortableRestoreCharacterCheckpoint,context:Context,add:Add){
 const chars=checkpoint.characters;
 const emit=(lane:string,path:Path,value:unknown,status:Status)=>{if(value!==undefined&&value!==null)add(lane,path,value,status);};
 const snapshotStatus=(id:string)=>id===context.snapshotId?'present':'unqualified';
 const inspectSnapshot=(lane:string,path:Path,s:CharacterProgressionSnapshot,ownerId:string)=>{
  emit(lane,[...path,'id'],s.id,s.id===ownerId?'present':'ownerMismatch');
  if(s.catalogSnapshotId)emit(lane,[...path,'catalogSnapshotId'],s.catalogSnapshotId,snapshotStatus(s.catalogSnapshotId));
  for(const occurrence of collectBuildReferenceOccurrences(s,'character'))emit(lane,[...path,...occurrence.path],occurrence.value,historical(context.choiceStatus(occurrence.value)));
  for(const occurrence of collectOwnerInstanceReferences(s,ownerId))emit(lane,[...path,...occurrence.path],occurrence.value,occurrence.status);
  for(const [i,l] of (s.compendiumLinks??[]).entries())emit(lane,[...path,'compendiumLinks',i],l,l.characterId!==ownerId?'ownerMismatch':historical(context.linkStatus(l)));
 };
 const operations=(lane:string,path:Path,ops:readonly CharacterProgressionOperation[],snapshots:readonly CharacterProgressionSnapshot[])=>{
  const pending=[...new Set(snapshots.flatMap(s=>(s.pendingChoices??[]).map(v=>v.id)))].map(id=>({id}));
  ops.forEach((op,i)=>{
   const p=[...path,i];
   emit(lane,[...p,'pendingChoiceId'],op.pendingChoiceId,historical(idStatus(pending,op.pendingChoiceId)));
   op.choiceIds?.forEach((id,j)=>emit(lane,[...p,'choiceIds',j],id,historical(context.choiceStatus(id))));
   // Metadata is intentionally opaque: arbitrary strings are not IDs.
  });
 };
 const drafts=Object.values(checkpoint.progressionDrafts),plans=Object.values(checkpoint.compatibilityRemediationPlans);
 for(const [key,d] of Object.entries(checkpoint.progressionDrafts)){
  const lane='progressionDraft',p=[key],owner=chars.find(c=>c.id===d.characterId);
  emit(lane,[...p,'characterId'],d.characterId,key===d.characterId?idStatus(chars,d.characterId):'ownerMismatch');
  emit(lane,[...p,'baseFingerprint'],d.baseFingerprint,owner?characterProgressionFingerprint(owner)===d.baseFingerprint?'present':'ownerMismatch':'unqualified');
  emit(lane,[...p,'baseSnapshotFingerprint'],d.baseFingerprint,characterProgressionFingerprint(d.baseCharacter)===d.baseFingerprint?'present':'ownerMismatch');
  if(d.targetCatalogSnapshotId)emit(lane,[...p,'targetCatalogSnapshotId'],d.targetCatalogSnapshotId,d.targetCatalogSnapshotId===context.snapshotId?'present':'ownerMismatch');
  inspectSnapshot(lane,[...p,'baseCharacter'],d.baseCharacter,d.characterId);
  inspectSnapshot(lane,[...p,'workingCharacter'],d.workingCharacter,d.characterId);
  operations(lane,[...p,'operations'],d.operations,[d.baseCharacter,d.workingCharacter]);
 }
 const inspectPlan=(lane:string,p:Path,plan:CharacterCompatibilityRemediationPlan,key:string)=>{
  const owner=chars.find(c=>c.id===plan.characterId);
  emit(lane,[...p,'characterId'],plan.characterId,key===plan.characterId?idStatus(chars,plan.characterId):'ownerMismatch');
  emit(lane,[...p,'baseFingerprint'],plan.baseFingerprint,owner?characterProgressionFingerprint(owner)===plan.baseFingerprint?'present':'ownerMismatch':'unqualified');
  if(plan.baseCatalogSnapshotId)emit(lane,[...p,'baseCatalogSnapshotId'],plan.baseCatalogSnapshotId,snapshotStatus(plan.baseCatalogSnapshotId));
  emit(lane,[...p,'targetCatalogSnapshotId'],plan.targetCatalogSnapshotId,plan.targetCatalogSnapshotId===context.snapshotId?'present':'ownerMismatch');
  plan.decisions.forEach((d,i)=>{
   emit(lane,[...p,'decisions',i,'replacementChoiceId'],d.replacementChoiceId,context.choiceStatus(d.replacementChoiceId));
   emit(lane,[...p,'decisions',i,'referenceKey'],d.referenceKey,'unqualified');
   emit(lane,[...p,'decisions',i,'issueId'],d.issueId,'unqualified');
  });
  const c=plan.preventiveContext;
  if(c){
   emit(lane,[...p,'preventiveContext','catalogSnapshotId'],c.catalogSnapshotId,snapshotStatus(c.catalogSnapshotId));
   c.disabledEntityIds.forEach((id,i)=>emit(lane,[...p,'preventiveContext','disabledEntityIds',i],id,context.entityExists(id)?'present':'missing'));
   c.affectedBookIds.forEach((id,i)=>emit(lane,[...p,'preventiveContext','affectedBookIds',i],id,context.bookExists(id)?'present':'missing'));
   c.affectedCategoryIds.forEach((id,i)=>emit(lane,[...p,'preventiveContext','affectedCategoryIds',i],id,context.categoryExists(id)?'present':'missing'));
  }
 };
 for(const [key,plan] of Object.entries(checkpoint.compatibilityRemediationPlans))inspectPlan('remediationPlan',[key],plan,key);
 const pr=checkpoint.progressionRecovery;
 for(const key of ['recoverableCharacterIds','conflictedCharacterIds'] as const)pr[key].forEach((id,i)=>{
  emit('progressionRecovery',[key,i,'character'],id,idStatus(chars,id));
  emit('progressionRecovery',[key,i,'draft'],id,idStatus(drafts.map(d=>({id:d.characterId})),id));
 });
 pr.issues.forEach((issue,i)=>{
  emit('progressionRecovery',['issues',i,'characterId'],issue.characterId,historical(idStatus(chars,issue.characterId)));
  emit('progressionRecovery',['issues',i,'draftId'],issue.draftId,historical(idStatus(drafts,issue.draftId)));
 });
 const cr=checkpoint.compatibilityRemediationRecovery,quarantine=checkpoint.compatibilityRemediationQuarantine;
 for(const key of ['pendingAcknowledgementCharacterIds','conflictedCharacterIds','staleCatalogCharacterIds'] as const)cr[key].forEach((id,i)=>{
  emit('remediationRecovery',[key,i,'character'],id,idStatus(chars,id));
  emit('remediationRecovery',[key,i,'plan'],id,idStatus(plans.map(p=>({id:p.characterId})),id));
 });
 if(cr.currentCatalogSnapshotId)emit('remediationRecovery',['currentCatalogSnapshotId'],cr.currentCatalogSnapshotId,snapshotStatus(cr.currentCatalogSnapshotId));
 cr.quarantinedPlanIds.forEach((id,i)=>emit('remediationRecovery',['quarantinedPlanIds',i],id,Object.prototype.hasOwnProperty.call(quarantine,id)?'present':'missing'));
 cr.issues.forEach((issue,i)=>{
  emit('remediationRecovery',['issues',i,'characterId'],issue.characterId,historical(idStatus(chars,issue.characterId)));
  emit('remediationRecovery',['issues',i,'planId'],issue.planId,historical(idStatus([...plans,...Object.values(quarantine).map(q=>({id:q.planId}))],issue.planId)));
 });
 for(const [key,q] of Object.entries(quarantine)){
  emit('remediationQuarantine',[key,'id'],q.id,key===q.id?'present':'ownerMismatch');
  emit('remediationQuarantine',[key,'characterId'],q.characterId,historical(idStatus(chars,q.characterId)));
  emit('remediationQuarantine',[key,'planId'],q.planId,'unqualified');
  // Raw invalid/orphaned payload remains opaque and bound by the portable
  // checkpoint hash. Never treat arbitrary quarantined fields as live IDs.
  add('remediationQuarantine',[key,'rawPlan'],q.rawPlan===undefined?null:q.rawPlan,'unqualified');
 }
 for(const c of chars){
  const lane='characterTransaction';
  const owner=(p:Path,t:{characterId:string})=>emit(lane,[...p,'characterId'],t.characterId,t.characterId===c.id?'present':'ownerMismatch');
  const live=(p:Path,value:unknown,rows:readonly {id?:string}[])=>emit(lane,p,value,historical(idStatus(rows,value)));
  const external=(p:Path,value:unknown)=>emit(lane,p,value,historical(context.choiceStatus(value)));
  (c.resourceTransactions??[]).forEach((t,i)=>{const p=[c.id,'resourceTransactions',i];owner(p,t);live([...p,'resourceId'],t.resourceId,c.resources);});
  (c.abilityUseTransactions??[]).forEach((t,i)=>{
   const p=[c.id,'abilityUseTransactions',i];owner(p,t);
   emit(lane,[...p,'abilityId'],t.abilityId,'unqualified');external([...p,'sourceItemId'],t.sourceItemId);
   emit(lane,[...p,'sourceEntityId'],t.sourceEntityId,'unqualified');
   t.resourceChanges.forEach((r,j)=>live([...p,'resourceChanges',j,'resourceId'],r.resourceId,c.resources));
   t.spellSlotChanges.forEach((r,j)=>{live([...p,'spellSlotChanges',j,'poolId'],r.poolId,c.spellSlots);live([...p,'spellSlotChanges',j,'sourceClassId'],r.sourceClassId,c.classes);});
  });
  (c.spellSlotTransactions??[]).forEach((t,i)=>{const p=[c.id,'spellSlotTransactions',i];owner(p,t);live([...p,'poolId'],t.poolId,c.spellSlots);live([...p,'sourceClassId'],t.sourceClassId,c.classes);});
  (c.spellChangeTransactions??[]).forEach((t,i)=>{const p=[c.id,'spellChangeTransactions',i];owner(p,t);live([...p,'classEntityId'],t.classEntityId,c.classes);external([...p,'spellItemId'],t.spellItemId);external([...p,'replacedSpellItemId'],t.replacedSpellItemId);});
  (c.activeEffectTransactions??[]).forEach((t,i)=>{const p=[c.id,'activeEffectTransactions',i];owner(p,t);live([...p,'effectId'],t.effectId,c.activeEffects);});
  (c.hitDieTransactions??[]).forEach((t,i)=>{const p=[c.id,'hitDieTransactions',i];owner(p,t);live([...p,'poolId'],t.poolId,c.hitDice??[]);live([...p,'classEntityId'],t.classEntityId,c.classes);});
  (c.healingTransactions??[]).forEach((t,i)=>{const p=[c.id,'healingTransactions',i];owner(p,t);external([...p,'sourceItemId'],t.sourceItemId);live([...p,'hitDiePoolId'],t.hitDiePoolId,c.hitDice??[]);});
  (c.protectionTransactions??[]).forEach((t,i)=>owner([c.id,'protectionTransactions',i],t));
  const history=c.progressionTransactions??[];
  history.forEach((t,i)=>{
   const l='progressionHistory',p=[c.id,i];
   emit(l,[...p,'rolledBackTransactionId'],t.rolledBackTransactionId,historical(idStatus(history.map(h=>({id:h.transactionId})),t.rolledBackTransactionId)));
   if(t.catalogSnapshotBefore)emit(l,[...p,'catalogSnapshotBefore'],t.catalogSnapshotBefore,snapshotStatus(t.catalogSnapshotBefore));
   if(t.catalogSnapshotAfter)emit(l,[...p,'catalogSnapshotAfter'],t.catalogSnapshotAfter,snapshotStatus(t.catalogSnapshotAfter));
   inspectSnapshot(l,[...p,'before'],t.before,c.id);inspectSnapshot(l,[...p,'after'],t.after,c.id);
   operations(l,[...p,'operations'],t.operations,[t.before,t.after]);
  });
 }
}
