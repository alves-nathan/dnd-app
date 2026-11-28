'use strict';
// Physical identity/relationship candidates only. No alias following, rewrite or approval.
const {digest}=require('./integrated-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const text=x=>typeof x==='string'&&!!x.trim();
const coord=(path,index)=>JSON.stringify([path,index]);
const family=k=>['classFeature','subclassFeature'].includes(k)?'feature':k;
const bump=(o,k)=>{o[k]=(o[k]||0)+1;};
const knownEra=x=>['2014','2024'].includes(x);
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false};
const singles={classId:'class',subclassId:'subclass',speciesId:'species'};
const lists={classIds:'class',featureIds:'feature',featIds:'feat'};
function links(payload){
 const p=payload||{},out=[];
 for(const [field,kind] of Object.entries(singles))if(text(p[field]))out.push({field,kind,toId:p[field],ordinal:0});
 for(const [field,kind] of Object.entries(lists))if(Array.isArray(p[field]))for(const [ordinal,toId] of p[field].entries())if(text(toId))out.push({field,kind,toId,ordinal});
 if(Array.isArray(p.progression))for(const [stepIndex,step] of p.progression.entries())if(Array.isArray(step?.featureIds))for(const [ordinal,toId] of step.featureIds.entries())if(text(toId))out.push({field:'progression.featureIds',kind:'feature',toId,ordinal,stepIndex,level:step.level??null});
 return out;
}
function buildRelationshipIdentityReview({reconciliation:r,rawHistorical,items,runtimeBundle}){
 assert(r?.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0,'invalidRelationshipReconciliation');
 const targets=new Map(),raw=new Map(),historicalGroups=new Map(),runtime=new Map(),seen=new Set();
 for(const i of items){
  assert(text(i.id)&&!targets.has(i.id)&&i.provenance?.origin==='5etools'&&i.provenance.commit===r.commits.main&&text(i.provenance.sourceCode),'relationshipTargetInvalid');
  targets.set(i.id,i);
 }
 for(const x of rawHistorical){const k=coord(x.path,x.index);assert(!raw.has(k),'relationshipHistoricalCoordinateDuplicate');raw.set(k,x.item);}
 function bind(h,domain,source){
  assert(h.domain===domain&&h.preservation==='required'&&h.decision==='unreviewed'&&h.activation==='review-required'&&text(h.evidenceId)&&!seen.has(h.evidenceId)&&source&&digest(source)===h.sourceFingerprint,'relationshipOccurrenceBindingMismatch');
  seen.add(h.evidenceId);
  if(h.status!=='identityCandidate')return null;
  const t=targets.get(h.targetId);
  assert(t&&t.kind===family(h.kind)&&digest(t)===h.targetFingerprint,'relationshipCandidateBindingMismatch');
  return t;
 }
 const historic=[];
 for(const h of r.historical){
  const source=raw.get(coord(h.path,h.index)),t=bind(h,'historical',source);
  assert(source.id===h.id,'relationshipHistoricalIdMismatch');
  const row={h,source,t};historic.push(row);
  if(!historicalGroups.has(h.id))historicalGroups.set(h.id,[]);
  historicalGroups.get(h.id).push(row);
 }
 const runtimeRaw=new Map(runtimeBundle.runtimeIndex.entries.map(e=>[e.entityId,e]));
 assert(runtimeRaw.size===runtimeBundle.runtimeIndex.entries.length&&runtimeRaw.size===r.runtime.length,'relationshipRuntimeCoverageMismatch');
 for(const h of r.runtime){assert(!runtime.has(h.id),'relationshipRuntimeDuplicate');const source=runtimeRaw.get(h.id),t=bind(h,'runtime',source);runtime.set(h.id,{h,source,t});}
 const qualified=x=>!!x.t&&x.h.eraStatus==='sameKnownEra'&&knownEra(x.t.source?.rulesEra);
 function historicalEndpoint(id,kind){
  const group=historicalGroups.get(id);
  if(!group)return {status:'targetMissing'};
  if(group.some(x=>family(x.h.kind)!==kind))return {status:'targetKindConflict'};
  if(group.some(x=>!x.t))return {status:group.length>1?'targetVariantsPending':'targetIdentityPending'};
  if(new Set(group.map(x=>x.t.id)).size!==1)return {status:'targetVariantsPending'};
  if(group.some(x=>!qualified(x)))return {status:'targetEditionPending'};
  return {status:'qualified',target:group[0].t};
 }
 const legacy={occurrences:0,byDisposition:{},byField:{},repeatedDeclarations:0},legacyRows=[],declarations=[];
 for(const x of historic){
  const duplicate=new Map(),consumed=new Map(),candidateLinks=x.t?links(x.t.payload):[];
  for(const l of links(x.source.payload)){
   const endpoint=historicalEndpoint(l.toId,l.kind);
   const original={fromId:x.h.id,path:x.h.path,index:x.h.index,field:l.field,toId:l.toId,status:historicalGroups.has(l.toId)?'historicalEndpointObserved':'historicalEndpointPending',preservation:'required'};
   declarations.push(original);
   const key=JSON.stringify([l.field,l.stepIndex??null,l.toId]);
   const occurrence=(duplicate.get(key)||0)+1;duplicate.set(key,occurrence);
   if(occurrence>1)legacy.repeatedDeclarations++;
   let status;
   if(!x.t)status='ownerIdentityPending';
   else if(!qualified(x))status='ownerEditionPending';
   else if(endpoint.status!=='qualified')status=endpoint.status;
   else if(l.field==='progression.featureIds'&&(!Number.isInteger(l.level)||l.level<1||l.level>20))status='progressionLevelPending';
   else{
    const sameField=candidateLinks.filter(c=>c.field===l.field&&c.toId===endpoint.target.id);
    const matches=l.field==='progression.featureIds'?sameField.filter(c=>c.level===l.level):sameField;
    // Repeated declarations remain individually counted. They never inherit one match.
    const matchKey=JSON.stringify([l.field,l.field==='progression.featureIds'?l.level:null,endpoint.target.id]);
    const used=consumed.get(matchKey)||0;
    status=matches.length>used?'explicitPhysicalRelationCandidate':sameField.length?'relationLevelOrMultiplicityPending':'physicalRelationNotObserved';
    if(status==='explicitPhysicalRelationCandidate')consumed.set(matchKey,used+1);
   }
   legacy.occurrences++;bump(legacy.byDisposition,status);bump(legacy.byField[l.field]??={},status);
   legacyRows.push({coordinateFingerprint:digest([x.h.path,x.h.index,l]),sourceFingerprint:x.h.sourceFingerprint,ownerCandidateFingerprint:x.h.targetFingerprint??null,targetCandidateFingerprint:endpoint.target?digest(endpoint.target):null,status});
  }
 }
 assert(declarations.length===r.summary.legacyLinks&&digest(declarations)===digest(r.legacyLinks),'relationshipLegacyDeclarationMismatch');
 const dependencies={occurrences:0,byDisposition:{},requiredByCurrentFilter:0,requiredByDisposition:{},duplicateIds:0},dependencyRows=[],ids=new Set();
 const edges=runtimeBundle.dependencyGraph.edges;
 assert(edges.length===r.dependencies.length&&edges.length===r.summary.runtimeDependencies,'relationshipDependencyCoverageMismatch');
 for(const [index,e] of edges.entries()){
  const h=r.dependencies[index],from=runtime.get(e.fromId),to=runtime.get(e.toId);
  assert(from&&to&&h?.id===e.id&&h.fingerprint===digest(e)&&h.fromId===e.fromId&&h.toId===e.toId&&h.relation===e.relation&&h.strength===e.strength&&h.resolutionPolicy===e.resolutionPolicy&&h.statusOriginal===e.status&&h.preservation==='required','relationshipDependencyBindingMismatch');
  const both=!!from.t&&!!to.t;
  assert(h.fromCandidate===from.t?.id&&h.toCandidate===to.t?.id&&h.mappingStatus===(both?'bothEndpointsCandidate':'endpointMappingPending'),'relationshipDependencyMappingMismatch');
  if(ids.has(e.id))dependencies.duplicateIds++;ids.add(e.id);
  const status=!both?'endpointIdentityPending':!qualified(from)||!qualified(to)?'endpointEditionPending':'qualifiedEndpointsRelationSemanticsPending';
  const required=e.resolutionPolicy==='requireEnabled'||e.strength==='hard'||e.strength==='ownership';
  dependencies.occurrences++;bump(dependencies.byDisposition,status);
  if(required){dependencies.requiredByCurrentFilter++;bump(dependencies.requiredByDisposition,status);}
  dependencyRows.push({index,sourceFingerprint:h.fingerprint,endpointFingerprints:[from.h.sourceFingerprint,to.h.sourceFingerprint],status,required});
 }
 const body={schemaVersion:'dnd-upstream-relationship-identity-review.v1',commits:r.commits,bindings:{reconciliation:digest(r),historical:digest(rawHistorical),targets:digest(items),runtime:digest(runtimeBundle)},legacy,dependencies,
  occurrenceFingerprints:{legacy:digest(legacyRows),dependencies:digest(dependencyRows)},scope:'explicitLegacyFieldsAndRuntimeDependencyEndpointsOnly',pending:['aliasesAndCategories','referenceSelectorsAndGrants','runtimeRelationSemanticEquivalence','installedInventory'],preservation:'required',relationshipParityEstablished:0,approvedMappings:0,mechanicalParityEstablished:0,readiness:'blocked',...flags};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildRelationshipIdentityReview};
