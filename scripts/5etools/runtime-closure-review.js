'use strict';
// a8.11.3: bind the runtime evidence and unchanged-bundle comparison.
// Readiness obligations are not approvals, even with zero observed gaps.
const {digest}=require('./integrated-review');
const {compareRuntimeContractPreservation}=require('./runtime-contract-preservation');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const sum=o=>Object.values(o).reduce((n,v)=>n+v,0);
function verify(r,schema){
 assert(r?.schemaVersion===schema&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&
  Object.entries(flags()).every(([k,v])=>r[k]===v),'invalidRuntimeClosureReport');
 const {fingerprint,...body}=r;
 assert(digest(body)===fingerprint,'runtimeClosureFingerprintMismatch');
}
function buildRuntimeClosureReview(input,{evidence,preservation}){
 verify(evidence,'dnd-upstream-runtime-contract-evidence.v1');
 verify(preservation,'dnd-upstream-runtime-contract-preservation.v1');
 assert(digest(evidence.commits)===digest(preservation.commits)&&preservation.evidenceFingerprint===evidence.fingerprint&&
  preservation.baselineFingerprint===evidence.bundleFingerprint,'runtimeClosureBindingMismatch');
 assert(preservation.status==='runtimeContractPreservationCandidate'&&preservation.codes.length===0&&preservation.changedSections.length===0&&
  preservation.currentFingerprint===evidence.bundleFingerprint&&preservation.afterFingerprint===evidence.bundleFingerprint,'runtimeClosurePreservationBlocked');
 const b=input.runtimeBundle;
 const actual=compareRuntimeContractPreservation(input,evidence,b,b);
 assert(digest(actual)===digest(preservation),'runtimeClosureSourceMismatch');
 const s=evidence.summary,byKind=s.byKind;
 const identity={entries:s.entries,pilotReview:s.pilotReview,runtimeOnly:s.runtimeOnly,candidates:0,pending:0,editionPending:0,manualReview:s.manualReview};
 let pilot=0,outside=0;
 for(const c of Object.values(byKind)){
  assert(['runtimeOnlyPreserve','pilotIdentityReview'].includes(c.coverage)&&
   [c.entries,c.identityCandidates,c.identityPending,c.eraPending,c.manualReview].every(count)&&
   c.entries===c.identityCandidates+c.identityPending&&c.eraPending<=c.identityCandidates&&c.manualReview<=c.entries,'runtimeClosureKindAccounting');
  if(c.coverage==='runtimeOnlyPreserve'){assert(c.identityCandidates===0,'runtimeOnlyCandidatePromoted');outside+=c.entries;}else pilot+=c.entries;
  identity.candidates+=c.identityCandidates;identity.pending+=c.identityPending;identity.editionPending+=c.eraPending;
 }
 assert(pilot===s.pilotReview&&outside===s.runtimeOnly&&pilot+outside===s.entries&&identity.candidates+identity.pending===s.entries&&
  sum(s.byStatus)===s.entries&&sum(s.defaultStates)===s.entries,'runtimeClosureIdentityAccounting');
 const relationships={dependencies:{occurrences:0,requiredByCurrentFilter:0,requiredWithCandidateEndpoints:0,requiredWithPendingEndpoints:0,
  other:0,otherWithCandidateEndpoints:0,otherWithPendingEndpoints:0,duplicateIds:s.dependencies.duplicateIds},
  aliases:{occurrences:0,active:0,nonActive:0,activeFromGroups:0,activeFromWithMultipleOccurrences:0,activeFromWithConflictingTargets:0,
   activeOccurrencesShadowedByLaterRecord:0,endpointCandidates:0,endpointPending:0,duplicateIds:s.aliases.duplicateIds}};
 for(const [index,e] of b.dependencyGraph.edges.entries()){
  const row=evidence.dependencies[index],d=relationships.dependencies;
  assert(row.index===index&&row.sourceFingerprint===digest(e),'runtimeClosureDependencyBindingMismatch');
  // Mirror ContentPolicyService's *current* filter-break predicate only.
  // This is not a claim that every resolutionPolicy is semantically handled.
  const required=e.resolutionPolicy==='requireEnabled'||e.strength==='hard'||e.strength==='ownership';
  const mapped=row.mappingStatus==='bothEndpointsCandidate';
  d.occurrences++;
  if(required){d.requiredByCurrentFilter++;d[mapped?'requiredWithCandidateEndpoints':'requiredWithPendingEndpoints']++;}
  else{d.other++;d[mapped?'otherWithCandidateEndpoints':'otherWithPendingEndpoints']++;}
 }
 const groups=new Map(),lastIndex=new Map(),a=relationships.aliases;
 for(const [index,e] of b.aliases.entities.entries()){
  const row=evidence.aliases[index];
  assert(row.index===index&&row.sourceFingerprint===digest(e),'runtimeClosureAliasBindingMismatch');
  a.occurrences++;a[row.mappingStatus==='bothEndpointsCandidate'?'endpointCandidates':'endpointPending']++;
  lastIndex.set(e.from,index);
  if(e.status==='active'){
   a.active++;const g=groups.get(e.from)??{count:0,targets:new Set()};g.count++;g.targets.add(e.to);groups.set(e.from,g);
  }else a.nonActive++;
 }
 a.activeFromGroups=groups.size;
 for(const g of groups.values()){
  if(g.count>1)a.activeFromWithMultipleOccurrences++;
  if(g.targets.size>1)a.activeFromWithConflictingTargets++;
 }
 // Loader indexes aliases by from and last occurrence wins. Report loss of
 // visibility, never infer that a selected alias is an approved mapping.
 for(const [index,e] of b.aliases.entities.entries())if(e.status==='active'&&lastIndex.get(e.from)!==index)a.activeOccurrencesShadowedByLaterRecord++;
 const d=relationships.dependencies;
 assert(d.occurrences===s.dependencies.total&&d.requiredByCurrentFilter+d.other===d.occurrences&&
  d.requiredWithCandidateEndpoints+d.requiredWithPendingEndpoints===d.requiredByCurrentFilter&&
  d.otherWithCandidateEndpoints+d.otherWithPendingEndpoints===d.other&&
  d.requiredWithCandidateEndpoints+d.otherWithCandidateEndpoints===(s.dependencies.byMapping.bothEndpointsCandidate??0)&&
  a.occurrences===s.aliases.total&&a.active+a.nonActive===a.occurrences&&a.endpointCandidates+a.endpointPending===a.occurrences&&
  a.endpointCandidates===(s.aliases.byMapping.bothEndpointsCandidate??0),'runtimeClosureRelationAccounting');
 const categories={...s.categories,preservation:'required',directionalDeclarations:'notReconciled'};
 const policies={total:s.policies,sections:evidence.policies.map(p=>({section:p.section,fingerprint:p.sourceFingerprint,status:'preservationRequired'}))};
 const blockers=[
  {code:'runtimeOnlyContractSemanticsNotReplaced',observed:identity.runtimeOnly},
  {code:'runtimeIdentityPending',observed:identity.pending},
  {code:'runtimeEditionPending',observed:identity.editionPending},
  {code:'runtimeEditorialReviewPending',observed:identity.manualReview},
  {code:'dependencySemanticsNotApproved',observed:d.occurrences},
  {code:'requiredDependencyEndpointMappingPending',observed:d.requiredWithPendingEndpoints},
  {code:'aliasSemanticsNotApproved',observed:a.occurrences},
  {code:'activeAliasShadowingReview',observed:a.activeOccurrencesShadowedByLaterRecord},
  {code:'categoryDirectionalReview',observed:categories.entryCategoryReferencesPending+categories.inverseMembershipPending},
  {code:'filterSelectionProviderPolicySemanticsNotApproved',observed:policies.total},
  {code:'installedRuntimeInventoryAndConfigurationNotVerified'},
  {code:'durableBackupAndTransactionalRollbackNotVerified'},
  {code:'rightsTrustNativeValidationAndExplicitApprovalPending'}
 ];
 const body={schemaVersion:'dnd-upstream-runtime-closure-review.v1',commits:evidence.commits,
  bindings:{evidence:evidence.fingerprint,preservation:preservation.fingerprint,bundle:evidence.bundleFingerprint,reconciliation:evidence.reconciliationFingerprint},
  scope:'bundledFixtureOnly',identity,relationships,categories,policies,blockers,
  preservationStatus:'unchangedBundledFixtureCandidate',filterBoundary:'disposableComparisonOnly',readiness:'blocked',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildRuntimeClosureReview};
