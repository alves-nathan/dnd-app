'use strict';
// a8.10.4: consolidate the remaining-family audit, not a cutover decision.
const {digest}=require('./integrated-review');
const {buildRemainingFamilyEvidence}=require('./remaining-family-evidence');
const {buildCreatureCombatProjection}=require('./creature-combat-projection');
const {buildItemMechanicsProjection}=require('./item-mechanics-projection');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const kinds=['equipment','magicItem','creatureStatBlock'];
function verify(r,schema){
 assert(r?.schemaVersion===schema&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&
  Object.entries(flags()).every(([k,v])=>r[k]===v),'invalidRemainingReviewReport');
 const {fingerprint,...body}=r;
 assert(digest(body)===fingerprint,'remainingReviewFingerprintMismatch');
}
function buildRemainingClosureReview(input,{remaining,creatures,itemMechanics}){
 for(const [r,s] of [[remaining,'dnd-upstream-remaining-family-evidence.v1'],[creatures,'dnd-upstream-creature-combat-projection.v1'],
  [itemMechanics,'dnd-upstream-item-mechanics-projection.v1']]){
  verify(r,s);assert(digest(r.commits)===digest(remaining.commits),'remainingReviewCommitMismatch');
 }
 assert(creatures.remainingFingerprint===remaining.fingerprint&&itemMechanics.remainingFingerprint===remaining.fingerprint,'remainingReviewBindingMismatch');
 assert(digest(buildRemainingFamilyEvidence(input))===digest(remaining),'remainingReviewSourceMismatch');
 assert(digest(buildCreatureCombatProjection(input,remaining))===digest(creatures)&&
  digest(buildItemMechanicsProjection(input,remaining))===digest(itemMechanics),'remainingProjectionSourceMismatch');
 const byId=new Map(remaining.upstreamRows.map(r=>[r.itemId,r]));
 assert(byId.size===remaining.upstreamRows.length,'remainingReviewCoverageMismatch');
 const coverage=Object.fromEntries(kinds.map(k=>[k,{upstream:0,historical:0,runtime:0,historicalCandidates:0,runtimeCandidates:0,historicalEraPending:0,runtimeEraPending:0}]));
 const seen=new Set();
 const checkRow=r=>assert(Object.entries(flags()).every(([k,v])=>r[k]===v),'remainingReviewRowPromoted');
 for(const [report,kind] of [[creatures,'creatureStatBlock'],[itemMechanics,null]]){
  for(const r of report.rows){
   checkRow(r);const id=kind?r.creatureId:r.itemId,p=byId.get(id),k=kind??r.kind;
   assert(p&&p.kind===k&&p.rulesEra===r.rulesEra&&p.sourceFingerprint===r.sourceFingerprint&&!seen.has(id)&&kinds.includes(k),'remainingReviewCoverageMismatch');
   checkRow(p);seen.add(id);coverage[k].upstream++;
  }
  assert(report.rows.length===report.summary.items,'remainingReviewCoverageMismatch');
 }
 assert(seen.size===byId.size,'remainingReviewCoverageMismatch');
 const occurrences=new Set();
 for(const [domain,rows] of [['historical',remaining.rows],['runtime',remaining.runtimeRows]]){
  for(const r of rows){
   checkRow(r);
   assert(kinds.includes(r.kind)&&r.preservation==='required'&&typeof r.evidenceId==='string'&&r.evidenceId.length>0&&!occurrences.has(r.evidenceId),'remainingOccurrenceMismatch');
   occurrences.add(r.evidenceId);const c=coverage[r.kind];c[domain]++;
   if(r.identityStatus==='identityCandidate'){
    const p=byId.get(r.targetId);
    assert(p&&p.kind===r.kind&&p.sourceFingerprint===r.targetFingerprint,'remainingOccurrenceTargetMismatch');
    c[domain+'Candidates']++;if(r.eraStatus!=='sameKnownEra')c[domain+'EraPending']++;
   }
  }
 }
 for(const k of kinds){
  const c=coverage[k],u=remaining.coverage.upstream[k],h=remaining.coverage.historical[k],r=remaining.coverage.runtime[k];
  assert(c.upstream===(u?.items??0)&&c.historical===(h?.occurrences??0)&&c.runtime===(r?.occurrences??0)&&
   c.historicalCandidates===(h?.identityCandidates??0)&&c.runtimeCandidates===(r?.identityCandidates??0)&&
   c.historicalEraPending===(h?.eraPending??0)&&c.runtimeEraPending===(r?.eraPending??0)&&
   (k==='creatureStatBlock'||c.upstream===(itemMechanics.summary.byKind[k]??0)),'remainingReviewCoverageMismatch');
 }
 const outside=Object.entries(remaining.coverage.runtime).filter(([,v])=>v.coverage==='outsidePilotContract');
 const body={schemaVersion:'dnd-upstream-remaining-closure-review.v1',commits:remaining.commits,
  bindings:{remaining:remaining.fingerprint,creatures:creatures.fingerprint,itemMechanics:itemMechanics.fingerprint},totals:remaining.totals,coverage,
  runtimeOutsidePilot:{kinds:outside.length,occurrences:outside.reduce((n,[,v])=>n+v.occurrences,0),preservation:'required'},
  creatureCombat:creatures.summary,itemMechanics:itemMechanics.summary,
  blockers:['historicalIdentityAndEditionPending','complexCreatureActionsAndDefensesPending','itemBundleVariantAttunementAndEffectSemanticsPending',
   'chargeRecoverySharingAndDepletionPending','runtimeOnlyContractsNotReplaced','installedInventoryBackupAndRollbackNotEstablished','noEncounterOrInventoryMigrationApproval'],
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildRemainingClosureReview};
