'use strict';
// Same-run aggregate joins; structural closure is not relationship equivalence.
const {digest}=require('./integrated-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sum=o=>Object.values(o).reduce((n,v)=>n+v,0);
const counts=o=>rec(o)&&Object.values(o).every(count);
const nested=o=>rec(o)&&Object.values(o).every(counts);
const totalNested=o=>Object.values(o).reduce((n,v)=>n+sum(v),0);
const bump=(o,k)=>{o[k]=(o[k]||0)+1;};
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false};
const pair=c=>({main:c.main,homebrew:c.homebrew});
const seal=o=>({...o,fingerprint:digest(o)});
function verified(r,schema){
 assert(r?.schemaVersion===schema&&r.readiness==='blocked'&&r.approvedMappings===0&&r.relationshipParityEstablished===0&&r.mechanicalParityEstablished===0&&Object.entries(flags).every(([k,v])=>r[k]===v),'invalidRelationshipMilestoneReport');
 const {fingerprint,...body}=r;assert(digest(body)===fingerprint,'relationshipMilestoneFingerprintMismatch');
}
function buildGraphRelationshipFragment(graph){
 const s=graph.summary;
 assert(graph.schemaVersion==='dnd-upstream-global-graph.v1'&&graph.activation==='review-required'&&s.integrityValid===true&&s.stagingValid===true&&s.runtimeEligible===0&&s.distributionAuthorized===0&&Object.keys(s.issues).length===0,'relationshipGraphNotReviewable');
 const nodes=new Map(),evidenceIds=new Set(),memberships={main:0,homebrew:0},pending={main:0,homebrew:0},edgeCounts={},compatibilityCounts={};
 for(const n of graph.nodes){
  assert(!nodes.has(n.id)&&['main','homebrew'].includes(n.namespace)&&hex(n.fingerprint)&&n.activation==='review-required'&&n.runtimeEligible===false&&Array.isArray(n.evidenceIds)&&count(n.pendingEvidence)&&n.pendingEvidence<=n.evidenceIds.length,'relationshipGraphNodeMismatch');
  nodes.set(n.id,n);memberships[n.namespace]+=n.evidenceIds.length;pending[n.namespace]+=n.pendingEvidence;
  for(const id of n.evidenceIds){assert(!evidenceIds.has(id),'relationshipGraphEvidenceDuplicate');evidenceIds.add(id);}
 }
 const main=[...nodes.values()].filter(n=>n.namespace==='main').map(n=>[n.id,n.fingerprint]).sort((a,b)=>a[0].localeCompare(b[0]));
 assert(main.length===s.mainItems&&nodes.size===s.registry&&nodes.size-main.length===s.homebrewProbes&&digest(main)===s.mainDigest,'relationshipGraphRegistryMismatch');
 for(const e of graph.edges){
  assert(nodes.has(e.from)&&nodes.has(e.to)&&e.activation==='review-required'&&['hard','evidence','precedence'].includes(e.type)&&!(nodes.get(e.from).namespace==='main'&&nodes.get(e.to).namespace==='homebrew'),'relationshipGraphEdgeMismatch');
  bump(edgeCounts[e.type]??={},e.relation);bump(compatibilityCounts[e.type]??={},e.compatibility);
 }
 assert(digest(edgeCounts)===digest(s.edgeCounts)&&digest(compatibilityCounts)===digest(s.compatibilityCounts),'relationshipGraphEdgeAccounting');
 assert(counts(s.byEvidenceStatus)&&nested(s.byEvidenceDomain)&&counts(s.unattachedEvidence)&&sum(s.byEvidenceStatus)===s.evidenceOccurrences&&totalNested(s.byEvidenceDomain)===s.evidenceOccurrences&&sum(memberships)+sum(s.unattachedEvidence)===s.evidenceOccurrences,'relationshipGraphEvidenceAccounting');
 return seal({schemaVersion:'dnd-upstream-relationship-graph-fragment.v1',commits:pair(graph.commits),mainDigest:s.mainDigest,registry:s.registry,mainItems:s.mainItems,homebrewProbes:s.homebrewProbes,evidenceOccurrences:s.evidenceOccurrences,memberships,pending,unattachedEvidence:s.unattachedEvidence,byEvidenceStatus:s.byEvidenceStatus,byEvidenceDomain:s.byEvidenceDomain,edgeCounts,compatibilityCounts,edgeOccurrences:graph.edges.length,precedenceResidual:s.precedenceResidual,readiness:'blocked',approvedMappings:0,relationshipParityEstablished:0,mechanicalParityEstablished:0,...flags});
}
function buildRelationshipMilestoneReview(matrix,family,graph){
 const identity=family.relationshipIdentity,policy=family.relationshipPolicy;
 verified(identity,'dnd-upstream-relationship-identity-review.v1');verified(policy,'dnd-upstream-relationship-policy-review.v1');verified(graph,'dnd-upstream-relationship-graph-fragment.v1');
 const t=matrix.totals,l=identity.legacy,d=identity.dependencies,a=policy.alias,c=policy.category;
 assert(digest(matrix.commits)===digest(family.commits)&&digest(identity.commits)===digest(family.commits)&&digest(policy.commits)===digest(family.commits)&&digest(graph.commits)===digest(pair(family.commits))&&family.bindings.relationshipIdentity===identity.fingerprint&&family.bindings.relationshipPolicy===policy.fingerprint&&identity.bindings.reconciliation===family.reconciliationFingerprint&&policy.bindings.reconciliation===family.reconciliationFingerprint&&policy.bindings.runtimeBundle===identity.bindings.runtime&&graph.mainDigest===family.relationshipMainDigest,'relationshipMilestoneBindingMismatch');
 for(const [k,n] of [['legacyLinks',l.occurrences],['dependencies',d.occurrences],['aliases',a.occurrences],['categories',c.occurrences]])assert(count(n)&&n===t[k]&&n===family.totals[k],'relationshipMilestoneDenominatorMismatch');
 assert(counts(l.byDisposition)&&nested(l.byField)&&sum(l.byDisposition)===l.occurrences&&totalNested(l.byField)===l.occurrences&&counts(d.byDisposition)&&sum(d.byDisposition)===d.occurrences&&counts(d.requiredByDisposition)&&sum(d.requiredByDisposition)===d.requiredByCurrentFilter&&Object.entries(d.requiredByDisposition).every(([k,n])=>n<=(d.byDisposition[k]??0))&&counts(policy.dependencyPolicies)&&sum(policy.dependencyPolicies)===d.occurrences,'relationshipMilestoneDispositionMismatch');
 assert(a.groups===a.selectedActive+a.selectedNonActive&&a.occurrences===a.groups+a.duplicateFromOccurrences&&c.occurrences===c.groups+c.shadowedOccurrences&&c.membershipOccurrences===c.selectedMembershipOccurrences+c.shadowedMembershipOccurrences&&policy.policySections.length===13&&new Set(policy.policySections.map(p=>p.section)).size===13&&policy.policySections.every(p=>hex(p.fingerprint)),'relationshipMilestonePolicyMismatch');
 assert(graph.mainItems===t.mainItems&&graph.homebrewProbes===t.homebrewProbes&&graph.registry===t.mainItems+t.homebrewProbes&&graph.evidenceOccurrences===t.evidenceOccurrences&&counts(graph.memberships)&&counts(graph.pending)&&counts(graph.unattachedEvidence)&&sum(graph.memberships)+sum(graph.unattachedEvidence)===graph.evidenceOccurrences&&nested(graph.byEvidenceDomain)&&counts(graph.byEvidenceStatus)&&totalNested(graph.byEvidenceDomain)===graph.evidenceOccurrences&&sum(graph.byEvidenceStatus)===graph.evidenceOccurrences&&nested(graph.edgeCounts)&&totalNested(graph.edgeCounts)===graph.edgeOccurrences&&nested(graph.compatibilityCounts)&&totalNested(graph.compatibilityCounts)===graph.edgeOccurrences&&graph.precedenceResidual===0,'relationshipMilestoneGraphMismatch');
 for(const ns of ['main','homebrew'])for(const [field,actual] of [['evidenceMemberships',graph.memberships[ns]],['pendingEvidence',graph.pending[ns]]])assert(actual===matrix.rows.reduce((n,r)=>n+(r.graph[ns+':'+field]??0),0),'relationshipMilestoneGraphMembershipMismatch');
 assert(matrix.blockers.includes('dependencyAliasAndRuntimeContractParityPending'),'relationshipMilestoneBlockerMissing');
 return seal({schemaVersion:'dnd-upstream-relationship-milestone-review.v1',commits:family.commits,bindings:{matrix:matrix.fingerprint,family:family.fingerprint,identity:identity.fingerprint,policy:policy.fingerprint,graph:graph.fingerprint},legacy:l,dependencies:d,alias:a,category:c,graph:{mainItems:graph.mainItems,homebrewProbes:graph.homebrewProbes,evidenceOccurrences:graph.evidenceOccurrences,memberships:graph.memberships,pending:graph.pending,unattachedEvidence:graph.unattachedEvidence,byEvidenceDomain:graph.byEvidenceDomain,edgeCounts:graph.edgeCounts,compatibilityCounts:graph.compatibilityCounts},preservation:{legacyLinks:l.occurrences,runtimeDependencies:d.occurrences,runtimeAliases:a.occurrences,runtimeCategories:c.occurrences,policySections:policy.policySections.length},pending:['selectorAndGrantSemanticEquivalence','characterChoiceProviderSelectionCandidateRegression','runtimeRelationAndAliasSemanticEquivalence','installedInventoryAndConfiguration','explicitApproval'],scope:'bundledFixtureAndStagingGraphOnly',readiness:'blocked',approvedMappings:0,relationshipParityEstablished:0,mechanicalParityEstablished:0,...flags});
}
module.exports={buildGraphRelationshipFragment,buildRelationshipMilestoneReview};
