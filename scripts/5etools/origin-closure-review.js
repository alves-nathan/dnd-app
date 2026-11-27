'use strict';
// a8.8.4: origin closure evidence, not mechanical approval or creation.
const {digest}=require('./integrated-review');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k)=>o[k]=(o[k]||0)+1;
function verify(r,schema){
 assert(r?.schemaVersion===schema&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&r.retirementAuthorized===false&&
  r.runtimeEligible===false&&r.writeAuthorized===false&&r.executable===false&&r.activation==='review-required','invalidOriginReviewReport');
 const {fingerprint,...body}=r;assert(digest(body)===fingerprint,'originReviewFingerprintMismatch');
}
function buildOriginClosureReview({parity,chassis,grants}){
 for(const [r,s] of [[parity,'dnd-upstream-origin-parity-evidence.v1'],[chassis,'dnd-upstream-origin-chassis-projection.v1'],[grants,'dnd-upstream-origin-grant-evidence.v1']]){
  verify(r,s);assert(digest(r.commits)===digest(parity.commits),'originReviewCommitMismatch');
 }
 assert(chassis.evidenceFingerprint===parity.fingerprint&&grants.parityFingerprint===parity.fingerprint&&grants.chassisFingerprint===chassis.fingerprint,'originReviewBindingMismatch');
 const byId=new Map(parity.upstreamRows.map(r=>[r.itemId,r])),kindCounts={species:0,background:0};
 assert(byId.size===parity.upstreamRows.length,'originReviewCoverageMismatch');
 for(const p of byId.values()){
  assert(['species','background'].includes(p.kind),'originReviewKindMismatch');kindCounts[p.kind]++;
 }
 for(const k of ['species','background'])assert(kindCounts[k]===parity.upstream[k].items,'originReviewCoverageMismatch');
 const cp=new Map();
 for(const report of [chassis,grants]){
  const seen=new Set(),counts={species:0,background:0};
  for(const row of report.rows){
   const p=byId.get(row.itemId);
   assert(p&&!seen.has(row.itemId)&&row.kind===p.kind&&row.rulesEra===p.rulesEra&&row.sourceFingerprint===p.sourceFingerprint,'originReviewSourceMismatch');
   assert(row.runtimeEligible===false&&row.writeAuthorized===false&&row.retirementAuthorized===false&&row.activation==='review-required','originReviewRowPromoted');
   seen.add(row.itemId);counts[row.kind]++;
   if(report===chassis)cp.set(row.itemId,row);
   else{
    assert(row.variantReviewRequired===cp.get(row.itemId)?.variantReviewRequired&&digest(row.featEdges)===digest(p.featEdges),'originGrantReviewBindingMismatch');
    const parent=row.traits.parent;
    if(parent.status==='parentIdentityCandidate'||parent.status==='parentEditionPending'){
     const target=byId.get(parent.parentId);
     assert(target?.kind==='species'&&target.sourceFingerprint===parent.parentFingerprint&&
      (parent.status!=='parentIdentityCandidate'||target.rulesEra===row.rulesEra),'originParentReviewBindingMismatch');
    }
   }
  }
  assert(seen.size===byId.size&&['species','background'].every(k=>counts[k]===kindCounts[k]&&report.summary[k]===counts[k]),'originReviewCoverageMismatch');
 }
 const historicalCounts={species:0,background:0},historicalIds=new Set(),coverage={};
 for(const row of parity.rows){
  assert(['species','background'].includes(row.kind)&&!historicalIds.has(row.evidenceId),'historicalOriginCoverageMismatch');
  historicalIds.add(row.evidenceId);historicalCounts[row.kind]++;
  if(row.identityStatus==='identityCandidate'){
   const targets=[...byId.values()].filter(t=>t.kind===row.kind&&t.sourceFingerprint===row.targetFingerprint);
   assert(targets.length===1,'historicalOriginTargetMismatch');
  }
  bump(coverage,row.identityStatus);
 }
 assert(['species','background'].every(k=>historicalCounts[k]===parity.historical[k].occurrences),'historicalOriginCoverageMismatch');
 const body={schemaVersion:'dnd-upstream-origin-closure-review.v1',commits:parity.commits,
  bindings:{parity:parity.fingerprint,chassis:chassis.fingerprint,grants:grants.fingerprint},
  origins:kindCounts,historical:parity.historical,historicalIdentity:coverage,runtime:parity.runtime,
  chassis:chassis.summary,grants:grants.summary,
  blockers:['historicalEditionAndMechanicalParityPending','missingCreatureTypeAndConditionalMovement','variantAndTraitApplicationPending','featAndSpellGrantEligibilityPending','UsageRecoveryAndEquipmentSemanticsPending','originCreationAndReconfigurationNotApproved'],
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildOriginClosureReview};
