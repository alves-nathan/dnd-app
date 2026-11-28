'use strict';
// a8.12.1: join current-run family evidence with global aggregate evidence.
// Neither a reviewed checkpoint nor an internally valid hash is authorization.
const {digest}=require('./integrated-review');
const {buildMechanicalScopeReview}=require('./mechanical-scope-review');
const {buildMechanicalPreservationReview}=require('./mechanical-preservation-review');
const {buildRelationshipIdentityReview}=require('./relationship-identity-review');
const {KINDS}=require('./cutover-evidence');
const {buildConditionMechanicsReport}=require('./condition-mechanics-preview');
const {buildCapabilityMatrix}=require('./condition-capability-matrix');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const sum=o=>Object.values(o).reduce((n,v)=>n+v,0);
const family=k=>['classFeature','subclassFeature'].includes(k)?'feature':k;
const schemas={equipment:'equipment-parity-evidence',classes:'class-closure-review',spells:'spell-closure-review',origins:'origin-closure-review',feats:'feat-closure-review',remaining:'remaining-closure-review',runtime:'runtime-closure-review'};
const checkpoints={weapon:'equipment',armor:'equipment',class:'classes',subclass:'classes',feature:'classes',spell:'spells',species:'origins',background:'origins',feat:'feats',equipment:'remaining',magicItem:'remaining',creatureStatBlock:'remaining',condition:'conditions'};
const verifyDigest=(r,code)=>{const {fingerprint,...body}=r;assert(digest(body)===fingerprint,code);};
function verifyReports(reports,commits){
 assert(Object.keys(reports).length===Object.keys(schemas).length,'familyReportSetMismatch');
 for(const [k,schema] of Object.entries(schemas)){
  const r=reports[k];
  assert(r?.schemaVersion==='dnd-upstream-'+schema+'.v1'&&r.activation==='review-required'&&r.approvedMappings===0&&r.mechanicalParityEstablished===0&&
   r.retirementAuthorized===false&&r.executable===false&&r.runtimeEligible!==true&&r.writeAuthorized!==true&&digest(r.commits)===digest(commits),'invalidFamilyReport');
  verifyDigest(r,'familyReportFingerprintMismatch');
 }
}
function buildFamilyCheckpointFragment(input,reports){
 const r=input.reconciliation,c=r.commits;
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&
  r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0&&
  ['main','homebrew','application'].every(k=>sha(c[k])),'invalidFamilyReconciliation');
 verifyReports(reports,c);
 const rows=Object.fromEntries(KINDS.map(k=>[k,{checkpoint:checkpoints[k],upstream:0,historical:0,runtime:0,historicalCandidates:0,runtimeCandidates:0,historicalEraPending:0,runtimeEraPending:0}]));
 const outside={historical:0,runtime:0},ids=new Set(),occurrences=new Set();
 for(const i of input.items){
  assert(rows[i.kind]&&!ids.has(i.id)&&i.provenance?.origin==='5etools'&&i.provenance.commit===c.main,'familyUpstreamBindingMismatch');
  ids.add(i.id);rows[i.kind].upstream++;
 }
 const targets=new Map(input.items.map(i=>[i.id,i]));
 for(const [domain,source] of [['historical',r.historical],['runtime',r.runtime]]){
  for(const h of source){
   assert(h.domain===domain&&h.preservation==='required'&&h.decision==='unreviewed'&&h.activation==='review-required'&&!occurrences.has(h.evidenceId),'familyOccurrenceBindingMismatch');
   occurrences.add(h.evidenceId);const row=rows[family(h.kind)];
   if(!row){assert(h.status!=='identityCandidate','outsideFamilyCandidate');outside[domain]++;continue;}
   row[domain]++;
   if(h.status==='identityCandidate'){
    const t=targets.get(h.targetId);assert(t?.kind===family(h.kind)&&digest(t)===h.targetFingerprint,'familyTargetMismatch');
    row[domain+'Candidates']++;if(h.eraStatus!=='sameKnownEra')row[domain+'EraPending']++;
   }
  }
 }
 const totals={upstream:ids.size,historical:r.historical.length,runtime:r.runtime.length,dependencies:r.dependencies.length,aliases:r.aliases.length,categories:r.categories.length,legacyLinks:r.legacyLinks.length};
 assert(totals.historical===r.summary.historicalOccurrences&&totals.runtime===r.summary.runtime&&totals.dependencies===r.summary.runtimeDependencies&&
  totals.aliases===r.summary.runtimeAliases&&totals.categories===r.summary.runtimeCategories&&totals.legacyLinks===r.summary.legacyLinks,'familyDenominatorMismatch');
 const historical=(k,v)=>assert((v?.occurrences??0)===rows[k].historical&&(v?.identityCandidates??0)===rows[k].historicalCandidates&&
  (v?.eraPending??v?.editionPending??0)===rows[k].historicalEraPending,'familyHistoricalMismatch');
 for(const k of ['weapon','armor'])historical(k,reports.equipment.byKind[k]);
 for(const k of ['class','subclass','feature'])historical(k,reports.classes.historical[k]);
 for(const k of ['species','background']){historical(k,reports.origins.historical[k]);assert(reports.origins.origins[k]===rows[k].upstream&&reports.origins.runtime[k].occurrences===rows[k].runtime,'originCheckpointMismatch');}
 historical('spell',reports.spells.historical);historical('feat',reports.feats.historical);
 assert(reports.spells.upstreamSpells===rows.spell.upstream&&reports.spells.runtime.occurrences===rows.spell.runtime&&
  reports.feats.upstream.items===rows.feat.upstream&&reports.feats.runtime.occurrences===rows.feat.runtime,'familyCheckpointMismatch');
 for(const k of ['equipment','magicItem','creatureStatBlock']){
  const v=reports.remaining.coverage[k],x=rows[k];
  for(const field of ['upstream','historical','runtime','historicalCandidates','runtimeCandidates','historicalEraPending','runtimeEraPending'])
   assert(v[field]===x[field],'remainingCheckpointMismatch');
 }
 assert(reports.remaining.totals.upstream===totals.upstream&&reports.remaining.totals.historical===totals.historical&&reports.remaining.totals.runtime===totals.runtime&&
  reports.runtime.identity.entries===totals.runtime&&reports.runtime.identity.runtimeOnly===outside.runtime&&
  reports.runtime.relationships.dependencies.occurrences===totals.dependencies&&reports.runtime.relationships.aliases.occurrences===totals.aliases&&
  reports.runtime.categories.total===totals.categories&&reports.runtime.readiness==='blocked','runtimeCheckpointMismatch');
 // Rebuild both earlier condition checkpoints using the same emitted items.
 const conditionItems=input.items.filter(i=>i.kind==='condition'),pilot={commit:c.main,packs:[{items:conditionItems}]};
 const mechanics=buildConditionMechanicsReport(pilot),capabilities=buildCapabilityMatrix(pilot);
 for(const v of [mechanics,capabilities]){
  verifyDigest(v,'conditionCheckpointFingerprintMismatch');
  assert(v.approvedMappings===0&&v.mechanicalParityEstablished===0&&v.commit===c.main&&v.runtimeEligible===false&&v.writeAuthorized===false,'conditionCheckpointPromoted');
 }
 assert(mechanics.rows.length===rows.condition.upstream&&capabilities.rows.length===conditionItems.filter(i=>i.name!=='Exhaustion').length,'conditionCheckpointMismatch');
 const bindings=Object.fromEntries(Object.entries(reports).map(([k,v])=>[k,v.fingerprint]));
 bindings.conditionMechanics=mechanics.fingerprint;bindings.conditionCapabilities=capabilities.fingerprint;
 const mechanicalScope=buildMechanicalScopeReview(input);
 assert(mechanicalScope.totals.upstream===totals.upstream&&mechanicalScope.totals.historical===totals.historical&&mechanicalScope.totals.runtime===totals.runtime,'mechanicalScopeDenominatorMismatch');
 bindings.mechanicalScope=mechanicalScope.fingerprint;
 const body={schemaVersion:'dnd-upstream-family-checkpoint-fragment.v1',commits:c,bindings,reconciliationFingerprint:digest(r),rows,outside,totals,mechanicalScope,
  runtimeIdentity:reports.runtime.identity,conditionScope:{mechanics:mechanics.byEra,capabilities:capabilities.byEra},
  checkpointBlockers:Object.fromEntries(Object.entries(reports).filter(([,v])=>Array.isArray(v.blockers)).map(([k,v])=>[k,v.blockers])),
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 const mechanicalPreservation=buildMechanicalPreservationReview(body);
 body.bindings.mechanicalPreservation=mechanicalPreservation.fingerprint;
 const relationshipIdentity=buildRelationshipIdentityReview(input);
 assert(relationshipIdentity.legacy.occurrences===totals.legacyLinks&&relationshipIdentity.dependencies.occurrences===totals.dependencies&&relationshipIdentity.bindings.reconciliation===body.reconciliationFingerprint,'relationshipIdentityDenominatorMismatch');
 body.bindings.relationshipIdentity=relationshipIdentity.fingerprint;
 return {...body,mechanicalPreservation,relationshipIdentity,fingerprint:digest({...body,mechanicalPreservation,relationshipIdentity})};
}
function buildGlobalCheckpointReview(matrix,fragment){
 assert(matrix?.schemaVersion==='dnd-upstream-cutover-evidence.v1'&&matrix.activation==='review-required'&&matrix.executable===false&&matrix.runtimeEligible===0&&
  matrix.distributionAuthorized===false&&matrix.retirementAuthorized===false&&matrix.scope==='bundledFixtureAndPilotOnly','invalidGlobalMatrix');
 assert(fragment?.schemaVersion==='dnd-upstream-family-checkpoint-fragment.v1'&&fragment.approvedMappings===0&&fragment.mechanicalParityEstablished===0&&
  Object.entries(flags()).every(([k,v])=>fragment[k]===v),'invalidFamilyFragment');
 verifyDigest(matrix,'globalMatrixFingerprintMismatch');verifyDigest(fragment,'familyFragmentFingerprintMismatch');
 assert(digest(matrix.commits)===digest(fragment.commits),'globalCheckpointCommitMismatch');
 assert(matrix.rows.length===KINDS.length&&new Set(matrix.rows.map(r=>r.kind)).size===KINDS.length&&Object.keys(fragment.rows).length===KINDS.length,'globalCheckpointKindMismatch');
 const rows=[];
 for(const m of matrix.rows){
  const f=fragment.rows[m.kind];
  assert(KINDS.includes(m.kind)&&f?.checkpoint===checkpoints[m.kind]&&m.mechanicalParity==='notEstablished'&&m.runtimeEligible===0&&m.retirementAuthorized===false&&
   f.upstream===m.conversion.emitted&&f.historical===(m.preservation.historical??0)&&f.runtime===(m.preservation.runtime??0)&&
   f.historicalCandidates===(m.preservation['historical:identityCandidate']??0)&&f.runtimeCandidates===(m.preservation['runtime:identityCandidate']??0)&&
   [f.upstream,f.historical,f.runtime,f.historicalCandidates,f.runtimeCandidates,f.historicalEraPending,f.runtimeEraPending].every(count)&&
   f.historicalEraPending<=f.historicalCandidates&&f.runtimeEraPending<=f.runtimeCandidates,'globalCheckpointKindAccounting');
  rows.push({kind:m.kind,...f,conversion:m.conversion,graph:m.graph,storage:m.preservation.storage??0,
   reviewStatus:'scopedEvidenceOnly',nextReview:m.nextReview});
 }
 const t=matrix.totals,u=fragment.totals;
 for(const k of ['historical','runtime','dependencies','aliases','categories','legacyLinks'])assert(t[k]===u[k],'globalCheckpointDenominatorMismatch');
 assert(t.mainItems===u.upstream&&rows.reduce((n,r)=>n+r.upstream,0)===u.upstream&&
  rows.reduce((n,r)=>n+r.historical,0)+fragment.outside.historical===u.historical&&rows.reduce((n,r)=>n+r.runtime,0)+fragment.outside.runtime===u.runtime&&
  Object.values(matrix.outsideHistorical).reduce((n,v)=>n+(v.historical??0),0)===fragment.outside.historical&&
  Object.values(matrix.outsideRuntime).reduce((n,v)=>n+(v.runtime??0),0)===fragment.outside.runtime,'globalCheckpointOutsideAccounting');
 assert(fragment.runtimeIdentity.entries===u.runtime&&fragment.runtimeIdentity.runtimeOnly===fragment.outside.runtime,'globalRuntimeDenominatorMismatch');
 const body={schemaVersion:'dnd-upstream-global-checkpoint-review.v1',commits:matrix.commits,
  bindings:{matrix:matrix.fingerprint,familyFragment:fragment.fingerprint,checkpoints:fragment.bindings},rows,outside:fragment.outside,totals:t,
  runtimeIdentity:fragment.runtimeIdentity,conditionScope:fragment.conditionScope,checkpointBlockers:fragment.checkpointBlockers,
  blockers:matrix.blockers,readiness:'blocked',scope:'bundledFixtureAndPilotOnly',approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildFamilyCheckpointFragment,buildGlobalCheckpointReview};
