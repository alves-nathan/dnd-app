'use strict';
// Consolidation of already generated evidence. Fingerprints bind the
// observed reports, not source trust or editorial approval.
const {digest}=require('./integrated-review');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k)=>o[k]=(o[k]||0)+1;
function verify(r,schema){
 assert(r?.schemaVersion===schema&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&r.retirementAuthorized===false&&r.activation==='review-required','invalidReviewReport');
 const {fingerprint,...body}=r;
 assert(digest(body)===fingerprint,'reviewFingerprintMismatch');
}
function buildClassClosureReview({progression,mechanics,projection,features,resources}){
 for(const [r,s] of [[progression,'dnd-upstream-class-progression-evidence.v1'],[mechanics,'dnd-upstream-class-mechanics-evidence.v1'],
 [projection,'dnd-upstream-class-projection-preview.v1'],[features,'dnd-upstream-feature-resource-evidence.v1'],[resources,'dnd-upstream-base-resource-projection.v1']])verify(r,s);
 assert(digest(progression.commits)===digest(mechanics.commits)&&digest(progression.commits)===digest(features.commits)&&
 digest(progression.commits)===digest(resources.commits)&&projection.commit===progression.commits.main&&
 mechanics.progressionFingerprint===progression.fingerprint&&resources.evidenceFingerprint===features.fingerprint,'reviewReportBindingMismatch');
 const byId=new Map(features.rows.map(r=>[r.itemId,r]));
 assert(byId.size===features.rows.length,'duplicateEvidenceItem');
 const ids=new Set();
 for(const r of projection.rows){
  const f=byId.get(r.itemId);
  assert(!ids.has(r.itemId)&&f&&f.family===r.kind&&f.sourceFingerprint===r.sourceFingerprint&&f.rulesEra===r.rulesEra,'projectionSourceBindingMismatch');
  ids.add(r.itemId);
 }
 assert(ids.size===features.rows.filter(r=>['class','subclass'].includes(r.family)).length,'projectionCoverageMismatch');
 const hist=new Map(progression.rows.map(r=>[r.evidenceId,r]));
 assert(hist.size===progression.rows.length,'duplicateHistoricalEvidence');
 const seen=new Set();
 for(const r of features.historicalRows){
  const p=hist.get(r.evidenceId);
  assert(p&&p.identityStatus==='identityCandidate'&&p.kind===r.kind&&p.sourceFingerprint===r.sourceFingerprint&&p.targetFingerprint===r.targetFingerprint&&!seen.has(r.evidenceId),'historicalReviewBindingMismatch');
  seen.add(r.evidenceId);
 }
 assert(seen.size===progression.rows.filter(r=>r.identityStatus==='identityCandidate').length,'historicalReviewCoverageMismatch');
 for(const r of resources.rows.filter(r=>r.status==='baseResourceCandidate')){
  const c=byId.get(r.classId),f=byId.get(r.featureId);
  assert(c?.family==='class'&&f?.family==='classFeature'&&c.sourceFingerprint===r.sourceFingerprint&&f.sourceFingerprint===r.featureFingerprint&&c.rulesEra===r.rulesEra&&f.rulesEra===r.rulesEra,'resourceReviewBindingMismatch');
 }
 const historical={},grants={},choices={},resourceCosts={};
 for(const r of progression.rows){const c=historical[r.kind]??={occurrences:0,identityCandidates:0,identityPending:0,editionPending:0};c.occurrences++;if(r.identityStatus==='identityCandidate'){c.identityCandidates++;if(r.eraStatus!=='sameKnownEra')c.editionPending++;}else c.identityPending++;}
 for(const r of features.rows){for(const g of r.grants)bump(grants,g.status);for(const c of r.choices)bump(choices,c.kind+':'+c.status);if(r.cost)bump(resourceCosts,r.cost.status);}
 const body={schemaVersion:'dnd-upstream-class-closure-review.v1',commits:progression.commits,
  bindings:{progression:progression.fingerprint,mechanics:mechanics.fingerprint,projection:projection.fingerprint,features:features.fingerprint,resources:resources.fingerprint},
  historical,grants,choices,resourceCosts,baseResources:resources.counts,
  blockers:['historicalIdentityAndEditionPending','grantAndChoiceSemanticsPending','featureActionsEffectsAndResourcesPending','missingClassOwnerDependencies','levelUpTransactionAndRuntimeParityNotApproved'],
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
// A one-level, same-class hypothetical transition. Explicit selected
// subclass and unlock facts, no inferred grants from a name or a table.
function previewLevelGrantBoundary(projection,features,request){
 const pending=reason=>({...flags(),status:'indeterminate',reason});
 try{
  verify(projection,'dnd-upstream-class-projection-preview.v1');verify(features,'dnd-upstream-feature-resource-evidence.v1');
  if(projection.commit!==features.commits.main||request?.projectionFingerprint!==projection.fingerprint||request.evidenceFingerprint!==features.fingerprint)return pending('evidenceBindingMismatch');
  if(request.inventoryComplete!==true||request.subclassSelectionComplete!==true||!['2014','2024'].includes(request.rulesEra)||
   !Number.isInteger(request.beforeLevel)||request.beforeLevel<1||request.beforeLevel>=20||request.afterLevel!==request.beforeLevel+1||
   !Number.isInteger(request.totalBefore)||request.totalBefore<request.beforeLevel||request.totalBefore>=20)return pending('explicitOneLevelContextRequired');
  const cl=projection.rows.find(r=>r.itemId===request.classId&&r.kind==='class'&&r.rulesEra===request.rulesEra);
  if(!cl)return pending('classIdentityPending');
  const owners=[cl];
  if(request.subclassId!==undefined){
   const sub=projection.rows.find(r=>r.itemId===request.subclassId&&r.kind==='subclass'&&r.classId===cl.itemId&&r.rulesEra===request.rulesEra);
   if(!sub||request.subclassGrantConfirmed!==true||!Number.isInteger(request.subclassUnlockLevel)||request.subclassUnlockLevel<1||request.subclassUnlockLevel>request.afterLevel)return pending('subclassOwnerOrGrantPending');
   owners.push(sub);
  }
  const grants=[],choices=[],byStatus={};
  for(const owner of owners){
   const r=features.rows.find(x=>x.itemId===owner.itemId);
   if(!r||r.sourceFingerprint!==owner.sourceFingerprint||r.rulesEra!==owner.rulesEra||r.family!==owner.kind)return pending('ownerEvidenceMismatch');
   const newlySelected=owner.kind==='subclass'&&request.subclassUnlockLevel===request.afterLevel;
   for(const g of r.grants.filter(g=>g.level<=request.afterLevel&&(newlySelected||g.level>request.beforeLevel))){
    const target=features.rows.find(x=>x.itemId===g.targetId);
    const status=!target||target.rulesEra!==request.rulesEra?'grantEditionOrTargetPending':g.status==='directContextCandidate'?'mechanicalGrantReviewRequired':'grantOptionsPending';
    grants.push({ownerId:owner.itemId,targetId:g.targetId,level:g.level,status});bump(byStatus,status);
   }
   for(const c of r.choices){
    // Context-wide and sparse schedules remain pending; do not equate
    // total observed counts with grant or replacement eligibility.
    const entries=c.schedule?.scope==='level'?c.schedule.entries:[];
    if(c.status!=='selectorAndSchedule'||!entries.some(e=>e.level===request.beforeLevel)||!entries.some(e=>e.level===request.afterLevel)){
     choices.push({ownerId:owner.itemId,kind:c.kind,status:'choiceCheckpointPending'});
    }else choices.push({ownerId:owner.itemId,kind:c.kind,status:'choicePolicyPending'});
   }
  }
  return {...flags(),status:'levelGrantReviewCandidate',grants,choices,byStatus,
   blockers:['mechanicalGrantReviewRequired','spellResourceAndChoiceEffectsPending','preservationAndTransactionApprovalRequired']};
 }catch{return pending('levelGrantReviewFailed');}
}
module.exports={buildClassClosureReview,previewLevelGrantBoundary};
