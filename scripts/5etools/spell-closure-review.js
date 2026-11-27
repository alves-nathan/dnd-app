'use strict';
// a8.7.6: consolidation, not mechanical parity or authorization.
const {digest}=require('./integrated-review');
const {previewCastingRequirements}=require('./spell-casting-projection');
const {previewSpellAccessAndSlot}=require('./spell-access-projection');
const {buildSpellLifecycleProjection}=require('./spell-lifecycle-projection');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
const pending=reason=>({...flags(),status:'indeterminate',reason});
function verify(r,schema){
 assert(r?.schemaVersion===schema&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&r.retirementAuthorized===false&&
 r.runtimeEligible===false&&r.writeAuthorized===false&&r.executable===false&&r.activation==='review-required','invalidSpellReviewReport');
 const {fingerprint,...body}=r;assert(digest(body)===fingerprint,'spellReviewFingerprintMismatch');
}
function buildSpellClosureReview({parity,casting,effects,lifecycle,access}){
 const reports=[[parity,'dnd-upstream-spell-parity-evidence.v1'],[casting,'dnd-upstream-spell-casting-projection.v1'],
 [effects,'dnd-upstream-spell-effect-projection.v1'],[lifecycle,'dnd-upstream-spell-lifecycle-projection.v1'],[access,'dnd-upstream-spell-access-projection.v1']];
 for(const [r,s] of reports){verify(r,s);assert(digest(r.commits)===digest(parity.commits),'spellReviewCommitMismatch');}
 assert(casting.evidenceFingerprint===parity.fingerprint&&lifecycle.evidenceFingerprint===parity.fingerprint&&
 access.spellFingerprint===parity.fingerprint&&effects.castingFingerprint===casting.fingerprint,'spellReviewBindingMismatch');
 const byId=new Map(parity.upstreamRows.map(r=>[r.itemId,r]));
 assert(byId.size===parity.upstreamRows.length&&byId.size===parity.upstream.items,'spellReviewCoverageMismatch');
 for(const [report,key] of [[casting,'itemId'],[lifecycle,'itemId'],[access,'spellId']]){
  const seen=new Set();
  for(const row of report.rows){
   const p=byId.get(row[key]);
   assert(p&&!seen.has(row[key])&&p.sourceFingerprint===row.sourceFingerprint&&p.rulesEra===row.rulesEra,'spellReviewSourceMismatch');
   seen.add(row[key]);
  }
  assert(seen.size===byId.size&&report.summary.items===byId.size,'spellReviewCoverageMismatch');
 }
 const reviewed=new Set(),candidateIds=new Set();
 for(const row of effects.rows){
  assert(!reviewed.has(row.itemId),'duplicateEffectReview');reviewed.add(row.itemId);
  if(row.status!=='baseEffectCandidate')continue;
  const p=byId.get(row.itemId);
  assert(p&&p.sourceFingerprint===row.sourceFingerprint&&p.rulesEra===row.rulesEra,'spellEffectBindingMismatch');
  candidateIds.add(row.itemId);
 }
 assert(effects.upstreamSpells===byId.size&&candidateIds.size===(effects.counts.baseEffectCandidate||0),'spellEffectCoverageMismatch');
 assert(new Set(parity.rows.map(r=>r.evidenceId)).size===parity.rows.length&&parity.rows.length===parity.historical.occurrences,'historicalReviewCoverageMismatch');
 const body={schemaVersion:'dnd-upstream-spell-closure-review.v1',commits:parity.commits,
 bindings:{parity:parity.fingerprint,casting:casting.fingerprint,effects:effects.fingerprint,lifecycle:lifecycle.fingerprint,access:access.fingerprint,classProjection:access.classFingerprint},
 historical:parity.historical,runtime:parity.runtime,upstreamSpells:byId.size,casting:casting.summary,access:access.summary,lifecycle:lifecycle.summary,
 effectCoverage:{reviewedDefinitionCandidates:candidateIds.size,withoutBaseEffectCandidate:byId.size-candidateIds.size,byFamily:effects.byFamily},
 blockers:['historicalIdentityAndEditionPending','qualifiedAndAdditionalAccessPending','preparationAndReplacementPolicyPending','mostSpellEffectsNotReviewed','persistentEffectAndSpecialTerminationPending','freeCastAndMaterialTransactionsPending','integratedCastingAndRuntimeParityNotApproved'],
 approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
// Compose two existing previews only for a normal, instantaneous cast's
// slot-cost boundary. Effects, actions and inventory are not applied.
function previewInstantSlotBoundary(input,request){
 try{
  if(request?.contextComplete!==true||request.otherCostsAndEffectsExcludedConfirmed!==true||!request.casting||!request.access)
   return pending('explicitBoundaryContextRequired');
  const c=request.casting,a=request.access;
  if(a.cast?.mode!=='normal'||c.ritual!==false||a.rulesEra!==c.rulesEra)return pending('castModeOrEditionMismatch');
  if(!Array.isArray(a.assignments))return pending('assignmentBindingPending');
  const assigned=a.assignments.find(x=>x.assignmentId===a.cast.assignmentId);
  if(!assigned||assigned.spellId!==c.spellId||assigned.classInstanceId!==a.classInstanceId)return pending('castSpellBindingMismatch');
  const requirements=previewCastingRequirements(input,c);
  if(requirements.status!=='castingRequirementsCandidate')return pending('castingRequirementsPending');
  if(requirements.timing.status!=='actionCandidate')return pending('extendedCastingBoundaryPending');
  const lifecycle=buildSpellLifecycleProjection(input),row=lifecycle.rows.find(r=>r.itemId===c.spellId);
  if(!row||row.sourceFingerprint!==assigned.sourceFingerprint||row.rulesEra!==c.rulesEra||row.duration.status!=='instantaneous'||row.concentration!=='notRequired')
   return pending('persistentEffectBoundaryPending');
  const m=requirements.material;
  if(m?.kind==='specific'&&(m.consumption==='required'||m.consumption==='optionalPending'||
    (m.consumption==='notDeclared'&&request.noMaterialConsumptionConfirmed!==true)))return pending('materialTransactionPending');
  const slots=previewSpellAccessAndSlot(input,a);
  if(slots.status!=='spellSlotTransactionCandidate')return pending('slotOrAccessPending');
  return {...flags(),status:'instantSlotBoundaryCandidate',spellId:c.spellId,slotCosts:slots.slotCosts,pools:slots.pools,
   assignments:slots.assignments,blockers:['effectAndActionTransactionsNotApplied','liveCharacterBindingNotEstablished','noV3CastAuthorization']};
 }catch{return pending('spellBoundaryReviewFailed');}
}
module.exports={buildSpellClosureReview,previewInstantSlotBoundary};
