'use strict';
// Same-run structural reconciliation, never an acceptance or release authority.
const {createHash}=require('node:crypto');
const {digest}=require('./integrated-review');
const {buildGlobalCheckpointReview}=require('./global-checkpoint-review');
const {buildCutoverAcceptanceMatrix}=require('./cutover-acceptance-matrix');
const {buildMechanicalPreservationReview}=require('./mechanical-preservation-review');
const {buildRelationshipMilestoneReview}=require('./relationship-milestone-review');
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false};
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const commit=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...k].sort().join('|');
const rawDigest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b)=>digest(a)===digest(b);
const observationValues={archive:'integrityMatch',restore:'disposableRehearsalMatch',active:'checkpointMatch',completed:'exactJournalAndArtifacts',rollback:'quarantinedFullJournalRetained',completedRecords:11,artifactRecords:3,retainedRecords:11};
const countValues={plannedCandidateWrites:3,activeWrites:0,deletes:0,replacements:0,validationWrites:0,acceptedGates:0};
const variableCounts=['candidateItems','candidateSources','preservedStorageItems','preservedRuntimeEntries','preservedCharacters','preservedRawKeys'];
const bindingKeys=['candidate','plan','archive','checkpoint','preservation','restoreRehearsal','activeRuntime','activeCompendium','activeKeyValues','portable'];
const requiredPending=['productionAdaptersNotVerified','fullInstalledInventoryNotVerified','candidateNativeEvidenceMissing','explicitCutoverApprovalMissing','isolatedTransactionAndRollbackNotVerified','nativeValidationPending','mechanicalParityNotApproved','relationshipParityNotApproved','durableFullCheckpointNotVerified','productionTransactionAndRollbackNotVerified'];
function reviewLocalLifecycleFragment(fragment,applicationCommit){
 assert(keys(fragment,['schemaVersion','scope','applicationCommit','validation','fingerprint'])&&fragment.schemaVersion==='dnd-upstream-local-lifecycle-fixture.v1'&&fragment.scope==='syntheticFixtureOnly'&&commit(applicationCommit)&&fragment.applicationCommit===applicationCommit,'finalLifecycleScopeOrCommitMismatch');
 const {fingerprint,...body}=fragment;
 assert(digest(body)===fingerprint,'finalLifecycleFragmentFingerprintMismatch');
 const r=fragment.validation;
 assert(keys(r,['schemaVersion','scope','bindings','observations','counts','pending','readiness','fingerprint',...Object.keys(flags)])&&r.schemaVersion==='dnd-v3-isolated-lifecycle-validation.v1'&&r.scope==='disposableCandidateReadback'&&r.readiness==='blocked'&&Object.entries(flags).every(([k,v])=>r[k]===v),'finalLifecycleNotReviewable');
 const {fingerprint:rf,...rb}=r;
 // The application seals its ordered JSON, not the canonical script digest.
 assert(rawDigest(rb)===rf,'finalLifecycleValidationFingerprintMismatch');
 assert(keys(r.bindings,bindingKeys)&&Object.values(r.bindings).every(hex),'finalLifecycleBindingsInvalid');
 assert(keys(r.observations,[...Object.keys(observationValues),'retainedFingerprint','quarantineFingerprint'])&&Object.entries(observationValues).every(([k,v])=>r.observations[k]===v)&&hex(r.observations.retainedFingerprint)&&hex(r.observations.quarantineFingerprint),'finalLifecycleObservationMismatch');
 assert(keys(r.counts,[...Object.keys(countValues),...variableCounts])&&Object.entries(countValues).every(([k,v])=>r.counts[k]===v)&&variableCounts.every(k=>count(r.counts[k]))&&r.counts.candidateItems>0&&r.counts.candidateSources>0&&r.counts.preservedRawKeys>0,'finalLifecycleAccountingMismatch');
 assert(Array.isArray(r.pending)&&r.pending.every(x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(x))&&new Set(r.pending).size===r.pending.length&&requiredPending.every(x=>r.pending.includes(x)),'finalLifecyclePendingMismatch');
 return {scope:'syntheticFixtureOnly',fragmentFingerprint:fingerprint,validationFingerprint:rf,observations:{...observationValues},counts:{...r.counts},pending:[...r.pending]};
}
function buildFinalAcceptanceReview(matrix,family,relationshipGraph,localFragment){
 const global=buildGlobalCheckpointReview(matrix,family);
 const acceptance=buildCutoverAcceptanceMatrix(matrix,family,global);
 const mechanical=buildMechanicalPreservationReview(family);
 assert(same(mechanical,family.mechanicalPreservation)&&family.bindings.mechanicalPreservation===mechanical.fingerprint,'finalMechanicalBindingMismatch');
 const relationship=buildRelationshipMilestoneReview(matrix,family,relationshipGraph);
 const local=reviewLocalLifecycleFragment(localFragment,matrix.commits.application);
 const t=matrix.totals;
 assert(mechanical.totals.upstream===t.mainItems&&mechanical.totals.historical===t.historical&&mechanical.totals.runtime===t.runtime&&mechanical.totals.legacyPreservationRequired===t.historical+t.runtime&&relationship.preservation.legacyLinks===t.legacyLinks&&relationship.preservation.runtimeDependencies===t.dependencies&&relationship.preservation.runtimeAliases===t.aliases&&relationship.preservation.runtimeCategories===t.categories,'finalGlobalAccountingMismatch');
 assert(acceptance.summary.gates===8&&acceptance.summary.accepted===0&&acceptance.summary.blocked===8&&acceptance.summary.criteria===31,'finalAcceptanceAccountingMismatch');
 const scopes={
  inventory:['bundledStorageAndHistoricalOccurrenceAccounting','installedScopeNotInspected'],
  rightsTrust:['upstreamAndHomebrewOriginAccounting','candidateTrustAndRightsNotVerified'],
  mechanicalParity:['familyPreservationAccounting','syntheticConsumerScopeNotOccurrenceParity'],
  relationshipParity:['relationshipMilestoneAccounting','selectorGrantAndInstalledParityPending'],
  durableCheckpoint:['syntheticArchiveReadbackAndRestoreRehearsal','nativeAndCompleteInstalledCheckpointNotVerified'],
  transactionRollback:['syntheticCompleteAndQuarantinedJournalReadback','productionTransactionAndRollbackNotVerified'],
  nativeValidation:['notExecutedForCandidate'],
  cutoverApproval:['explicitOwnerDecisionMissing']
 };
 const gates=acceptance.gates.map(g=>{
  assert(scopes[g.id]&&g.status==='blocked'&&g.acceptanceCriteria.every(c=>c.status==='requiredNotVerified'),'finalAcceptanceGatePromoted');
  return {id:g.id,blocker:g.blocker,dependsOn:g.dependsOn,criteria:g.acceptanceCriteria,observedScope:scopes[g.id],status:'blocked'};
 });
 const body={schemaVersion:'dnd-upstream-final-acceptance-review.v1',commits:matrix.commits,bindings:{matrix:matrix.fingerprint,family:family.fingerprint,global:global.fingerprint,acceptance:acceptance.fingerprint,mechanical:mechanical.fingerprint,relationship:relationship.fingerprint,localLifecycle:local.fragmentFingerprint},scope:'sameApplicationCommitSeparateFixtureScopes',globalCounts:{...t},localFixture:local,gates,blockers:[...global.blockers],summary:{...acceptance.summary,approvedMappings:0,mechanicalParityEstablished:0,relationshipParityEstablished:0},
  nextEngineeringStep:'isolatedCandidateRehearsalOnly',nativeValidation:'pending',productionReadiness:'blocked',readiness:'blocked',...flags};
 return {...body,fingerprint:digest(body)};
}
module.exports={reviewLocalLifecycleFragment,buildFinalAcceptanceReview};
