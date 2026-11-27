'use strict';
// a8.9.5: bind all feat audit stages, without mechanical or migration approval.
const {digest}=require('./integrated-review');
const {buildFeatGrantEvidence}=require('./feat-grant-evidence');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const text=x=>typeof x==='string'&&x.length>0;
const bump=(o,k)=>o[k]=(o[k]||0)+1;
function verify(r,schema){
 assert(r?.schemaVersion===schema&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&r.activation==='review-required'&&
  r.runtimeEligible===false&&r.writeAuthorized===false&&r.retirementAuthorized===false&&r.executable===false,'invalidFeatReviewReport');
 const {fingerprint,...body}=r;
 assert(digest(body)===fingerprint,'featReviewFingerprintMismatch');
}
function verifyRow(row){
 assert(row.activation==='review-required'&&row.runtimeEligible===false&&row.writeAuthorized===false&&row.retirementAuthorized===false&&row.executable!==true,'featReviewRowPromoted');
}
function buildFeatClosureReview(input,{parity,requirements,allocation,grants}){
 for(const [r,s] of [[parity,'dnd-upstream-feat-parity-evidence.v1'],[requirements,'dnd-upstream-feat-requirement-projection.v1'],
  [allocation,'dnd-upstream-feat-allocation-projection.v1'],[grants,'dnd-upstream-feat-grant-evidence.v1']]){
  verify(r,s);assert(digest(r.commits)===digest(parity.commits),'featReviewCommitMismatch');
 }
 assert(requirements.evidenceFingerprint===parity.fingerprint&&allocation.evidenceFingerprint===parity.fingerprint&&allocation.requirementFingerprint===requirements.fingerprint&&
  grants.evidenceFingerprint===parity.fingerprint&&grants.requirementFingerprint===requirements.fingerprint&&grants.allocationFingerprint===allocation.fingerprint,'featReviewBindingMismatch');
 // Rebuild from the existing in-memory evidence inputs. A rehashed forged
 // report is not accepted merely because its internal digest is consistent.
 const actual=buildFeatGrantEvidence(input);
 assert(digest(actual)===digest(grants),'featReviewSourceMismatch');
 const byId=new Map(parity.upstreamRows.map(r=>[r.itemId,r]));
 assert(byId.size===parity.upstreamRows.length&&byId.size===parity.upstream.items,'featReviewCoverageMismatch');
 for(const r of parity.upstreamRows)verifyRow(r);
 for(const report of [requirements,allocation,grants]){
  const seen=new Set();
  for(const row of report.rows){
   verifyRow(row);const p=byId.get(row.featId);
   assert(p&&!seen.has(row.featId)&&p.rulesEra===row.rulesEra&&p.sourceFingerprint===row.sourceFingerprint,'featReviewCoverageMismatch');
   seen.add(row.featId);
  }
  assert(seen.size===byId.size&&report.summary.items===seen.size,'featReviewCoverageMismatch');
 }
 const historical={},runtime={},seen=new Set();
 for(const [rows,summary,counts] of [[parity.rows,parity.historical,historical],[parity.runtimeRows,parity.runtime,runtime]]){
  let candidates=0,eraPending=0;
  for(const row of rows){
   verifyRow(row);
   assert(text(row.evidenceId)&&!seen.has(row.evidenceId)&&row.preservation==='required','featOccurrenceCoverageMismatch');
   seen.add(row.evidenceId);bump(counts,row.identityStatus);
   if(row.identityStatus==='identityCandidate'){
    const t=byId.get(row.targetId);
    assert(t&&t.sourceFingerprint===row.targetFingerprint,'featOccurrenceTargetMismatch');
    candidates++;if(row.eraStatus!=='sameKnownEra')eraPending++;
   }
  }
  assert(rows.length===summary.occurrences&&candidates===summary.identityCandidates&&rows.length-candidates===summary.identityPending&&eraPending===summary.eraPending,'featOccurrenceCoverageMismatch');
 }
 const body={schemaVersion:'dnd-upstream-feat-closure-review.v1',commits:parity.commits,bindings:{parity:parity.fingerprint,requirements:requirements.fingerprint,allocation:allocation.fingerprint,grants:grants.fingerprint},
  historical:parity.historical,historicalIdentity:historical,runtime:parity.runtime,runtimeIdentity:runtime,upstream:parity.upstream,
  requirements:requirements.summary,allocation:allocation.summary,grants:grants.summary,
  blockers:['historicalEditionAndMechanicalParityPending','prerequisiteAndCategoryContextPending','conditionalRepeatabilityAndAllocationPending','choiceAndGrantApplicationPending','resourceRecoveryAndEffectSemanticsPending','characterAcquisitionRemovalAndMigrationNotApproved'],
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildFeatClosureReview};
