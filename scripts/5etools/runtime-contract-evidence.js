'use strict';
// a8.11.1: preserve runtime-only contracts, not a replacement or graph rewrite.
const {digest}=require('./integrated-review');
const {converters}=require('./pilot-coverage');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length>0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const same=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
const pilot=new Set(converters.flatMap(c=>c.kinds));
const canonicalKind=k=>['classFeature','subclassFeature'].includes(k)?'feature':k;
const lane=k=>pilot.has(canonicalKind(k))?'pilotIdentityReview':'runtimeOnlyPreserve';
const policySections=['manifest','sourcePackage','sourceFiles','sourceChecksums','contentFilterPolicy','readinessProfile','integrationContract','runtimeOperations','runtimeErrors','snapshotMigrationPolicy','activationPolicy','selectionContracts','providerCollections'];
const arrays=(b)=>({entries:b.runtimeIndex?.entries,registry:b.entityRegistry?.entries,dependencies:b.dependencyGraph?.edges,aliases:b.aliases?.entities,categories:b.contentCategories?.entities});
function indexed(rows,key,code){
 assert(Array.isArray(rows),code);const m=new Map();
 for(const r of rows){assert(rec(r)&&text(r[key])&&!m.has(r[key]),code);m.set(r[key],r);}
 return m;
}
function buildRuntimeContractEvidence({reconciliation:r,items,runtimeBundle:b}){
 assert(r?.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&
  r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0&&
  ['application','main','homebrew'].every(k=>sha(r.commits[k])),'invalidRuntimeReconciliation');
 assert(b?.schemaVersion==='dnd-combat-runtime-bundle.v1'&&text(b.catalogVersion)&&
  b.manifest?.version===b.catalogVersion&&b.sourcePackage?.version===b.catalogVersion,'invalidRuntimeBundle');
 const a=arrays(b),entries=indexed(a.entries,'entityId','runtimeEntryIdentityMismatch'),registry=indexed(a.registry,'entityId','runtimeRegistryIdentityMismatch');
 const rr=indexed(r.runtime,'id','runtimeReconciliationIdentityMismatch'),targets=indexed(items,'id','runtimeTargetIdentityMismatch');
 assert(entries.size===registry.size&&entries.size===rr.size&&entries.size===r.summary.runtime&&entries.size===b.runtimeIndex.entryCount&&
  registry.size===b.dependencyGraph.nodeCount&&a.dependencies.length===b.dependencyGraph.edgeCount,'runtimeContractCoverageMismatch');
 const byKind=dict(),rows=[],byId=new Map(),evidenceIds=new Set();
 const summary={entries:0,registry:registry.size,runtimeOnly:0,pilotReview:0,byKind,byStatus:dict(),defaultStates:dict(),manualReview:0,
  dependencies:{total:0,byLane:dict(),byMapping:dict(),byContract:dict(),duplicateIds:0},
  aliases:{total:0,byLane:dict(),byMapping:dict(),byContract:dict(),duplicateIds:0},
  categories:{total:0,memberships:0,runtimeOnlyMemberships:0,mappedMemberships:0,duplicateMembers:0,duplicateIds:0,entryCategoryReferencesPending:0,inverseMembershipPending:0},
  policies:0};
 for(const [id,e] of entries){
  const reg=registry.get(id),h=rr.get(id);
  assert(reg&&h&&h.domain==='runtime'&&h.kind===e.kind&&h.sourceId===e.sourceBookId&&h.sourceFingerprint===digest(e)&&
   h.preservation==='required'&&h.decision==='unreviewed'&&h.activation==='review-required'&&text(h.evidenceId)&&!evidenceIds.has(h.evidenceId)&&
   reg.kind===e.kind&&reg.sourceBookId===e.sourceBookId,'runtimeContractBindingMismatch');
  evidenceIds.add(h.evidenceId);
  const coverage=lane(e.kind),c=byKind[e.kind]??={coverage,entries:0,identityCandidates:0,identityPending:0,eraPending:0,manualReview:0};
  c.entries++;summary.entries++;summary[coverage==='runtimeOnlyPreserve'?'runtimeOnly':'pilotReview']++;
  bump(summary.byStatus,e.status);bump(summary.defaultStates,String(e.defaultEnabled));
  if(e.manualReviewRequired===true){c.manualReview++;summary.manualReview++;}
  const row={id,kind:e.kind,coverage,sourceFingerprint:digest(e),registryFingerprint:digest(reg),identityStatus:h.status,preservation:'required',...flags()};
  if(h.status==='identityCandidate'){
   const t=targets.get(h.targetId);
   assert(coverage==='pilotIdentityReview'&&t?.kind===canonicalKind(e.kind)&&digest(t)===h.targetFingerprint&&t.provenance?.origin==='5etools'&&t.provenance.commit===r.commits.main,'runtimeContractTargetMismatch');
   c.identityCandidates++;if(h.eraStatus!=='sameKnownEra')c.eraPending++;
   Object.assign(row,{targetId:t.id,targetFingerprint:h.targetFingerprint,eraStatus:h.eraStatus});
  }else c.identityPending++;
  rows.push(row);byId.set(id,row);
 }
 const mapped=id=>byId.get(id)?.targetId;
 const endpointLane=(from,to)=>{
  const x=byId.get(from),y=byId.get(to);assert(x&&y,'runtimeRelationEndpointMissing');
  return x.coverage===y.coverage?x.coverage:'mixedPreservation';
 };
 const relationRows={dependencies:[],aliases:[]};
 for(const type of ['dependencies','aliases']){
  const source=a[type],reconciled=r[type],s=summary[type],ids=new Set();
  assert(Array.isArray(source)&&Array.isArray(reconciled)&&source.length===reconciled.length&&source.length===r.summary[type==='dependencies'?'runtimeDependencies':'runtimeAliases'],'runtimeRelationCoverageMismatch');
  for(const [index,e] of source.entries()){
   const h=reconciled[index],from=type==='dependencies'?e.fromId:e.from,to=type==='dependencies'?e.toId:e.to;
   assert(rec(e)&&text(e.id)&&h?.id===e.id&&h.fingerprint===digest(e)&&h.preservation==='required'&&h.statusOriginal===e.status&&
    (type==='dependencies'?h.fromId===from&&h.toId===to&&h.strength===e.strength&&h.crossBook===e.crossBook:h.from===from&&h.to===to&&h.kind===e.kind)&&
    h.relation===e.relation&&h.resolutionPolicy===e.resolutionPolicy&&h.status===e.status,'runtimeRelationBindingMismatch');
   const coverage=endpointLane(from,to),both=!!mapped(from)&&!!mapped(to);
   const mapping=both?'bothEndpointsCandidate':type==='dependencies'?'endpointMappingPending':'endpointOrAliasSemanticsPending';
   assert(h.mappingStatus===mapping&&h.fromCandidate===mapped(from)&&h.toCandidate===mapped(to),'runtimeRelationMappingMismatch');
   if(ids.has(e.id))s.duplicateIds++;ids.add(e.id);
   s.total++;bump(s.byLane,coverage);bump(s.byMapping,mapping);
   bump(s.byContract,JSON.stringify(type==='dependencies'?[e.relation,e.strength,e.status,e.resolutionPolicy]:[e.kind,e.relation,e.status,e.resolutionPolicy]));
   relationRows[type].push({index,id:e.id,from,to,coverage,mappingStatus:mapping,sourceFingerprint:h.fingerprint,
    endpointFingerprints:[byId.get(from).sourceFingerprint,byId.get(to).sourceFingerprint],preservation:'required',...flags()});
  }
 }
 const categories=[],categoryMembers=new Map(),cs=summary.categories;
 assert(Array.isArray(a.categories)&&Array.isArray(r.categories)&&a.categories.length===r.categories.length&&a.categories.length===r.summary.runtimeCategories,'runtimeCategoryCoverageMismatch');
 for(const [index,c] of a.categories.entries()){
  const h=r.categories[index];
  assert(text(c.id)&&h?.id===c.id&&h.fingerprint===digest(c)&&h.book===c.sourceBookId&&same(h.memberIds,c.memberEntityIds)&&
   h.preservation==='required'&&Array.isArray(c.memberEntityIds)&&c.memberCount===c.memberEntityIds.length,'runtimeCategoryBindingMismatch');
  const members=c.memberEntityIds,unique=new Set(members);
  assert(members.every(id=>byId.has(id)),'runtimeCategoryEndpointMissing');
  const mappedCount=members.filter(id=>!!mapped(id)).length,runtimeOnly=members.filter(id=>byId.get(id).coverage==='runtimeOnlyPreserve').length;
  assert(h.mappedMembers===mappedCount,'runtimeCategoryMappingMismatch');
  if(categoryMembers.has(c.id))cs.duplicateIds++;
  const previous=categoryMembers.get(c.id)??new Set();for(const id of unique)previous.add(id);categoryMembers.set(c.id,previous);
  cs.total++;cs.memberships+=members.length;cs.runtimeOnlyMemberships+=runtimeOnly;cs.mappedMemberships+=mappedCount;cs.duplicateMembers+=members.length-unique.size;
  categories.push({index,id:c.id,sourceFingerprint:h.fingerprint,membershipFingerprint:digest(members),memberships:members.length,mappedMemberships:mappedCount,
   runtimeOnlyMemberships:runtimeOnly,preservation:'required',...flags()});
 }
 // These are separate directional declarations, not an inferred membership repair.
 for(const [id,e] of entries){
  assert(Array.isArray(e.categoryIds),'runtimeEntryCategoryShapeMismatch');
  for(const c of e.categoryIds)if(!categoryMembers.get(c)?.has(id))cs.entryCategoryReferencesPending++;
 }
 for(const [c,members] of categoryMembers)for(const id of members)if(!entries.get(id).categoryIds.includes(c))cs.inverseMembershipPending++;
 const policies=policySections.map(section=>{
  assert(rec(b[section]),'runtimePolicySectionMissing');
  return {section,sourceFingerprint:digest(b[section]),preservation:'required',...flags()};
 });
 summary.policies=policies.length;
 const body={schemaVersion:'dnd-upstream-runtime-contract-evidence.v1',commits:r.commits,bundleFingerprint:digest(b),reconciliationFingerprint:digest(r),
  summary,rows,dependencies:relationRows.dependencies,aliases:relationRows.aliases,categories,policies,
  scope:'bundled runtime metadata and policy preservation; no alias resolution, relationship rewrite, activation or migration',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,dependencies,aliases,categories,policies,...summary}=r;return summary;}
module.exports={buildRuntimeContractEvidence,publicSummary};
