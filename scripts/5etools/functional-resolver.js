'use strict';
// Opt-in structural expansion, separate from the historical strict baseline.
const {makeResolver}=require('./resolver');
const {createTemplateIndex,previewExternalTemplate,versionSpecs,previewVersion}=require('./variant-lineage');
const fail=code=>{throw Object.assign(Error(code),{code});};
function createFunctionalResolver(snapshot,records){
 let templates;
 return makeResolver(records,{
  separateVersions:true,
  functionalMods:true,
  resolveTemplate(record,resolver){
   templates??=createTemplateIndex(snapshot);
   return previewExternalTemplate(record,resolver,templates,{functional:true});
  }
 });
}
function expandFunctionalVersions(record,resolved,existingKeys,authorize){
 const candidates=[],diagnostics=[];
 for(const [containerIndex,container] of (resolved.versions??[]).entries()){
  let specs;
  try{specs=versionSpecs(container);}
  catch(e){diagnostics.push({containerIndex,implementation:null,code:e.code||'versionExpansionError'});continue;}
  for(const v of specs){
   const location={containerIndex,implementation:v.implementation};
   try{
    if(v.status)fail(v.status);
    if(authorize?!authorize(record,location,v.spec):v.spec.source!==record.entity.source)fail('versionSourceSelectionPending');
    const expanded=previewVersion(record,resolved.entity,v.spec,existingKeys,{functional:true});
    candidates.push({...location,...expanded,specFingerprint:require('./integrated-review').digest(v.spec)});
   }catch(e){diagnostics.push({...location,code:e.code||'versionExpansionError'});}
  }
 }
 return {candidates,diagnostics};
}
function retainStructuralEvidence(item,resolved){
 const notes=[];
 if(resolved.templateLineage?.length){
  item.metadata.externalTemplateLineage=JSON.parse(JSON.stringify(resolved.templateLineage));
  notes.push('externalTemplateSemanticsPending');
 }
 if(resolved.versions?.length){
  item.payload.mechanics??={};
  item.payload.mechanics.upstreamVersionContainer=JSON.parse(JSON.stringify(resolved.versions));
  notes.push('versionContainerReviewPending');
 }
 item.metadata.reviewCodes=[...new Set([...item.metadata.reviewCodes,...notes])].sort();
 return notes;
}
module.exports={createFunctionalResolver,expandFunctionalVersions,retainStructuralEvidence};
