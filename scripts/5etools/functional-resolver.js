'use strict';
// Opt-in structural expansion, separate from the historical strict baseline.
const {makeResolver}=require('./resolver');
const {createTemplateIndex,previewExternalTemplate,versionSpecs,previewVersion}=require('./variant-lineage');
const fail=code=>{throw Object.assign(Error(code),{code});};
function createFunctionalResolver(snapshot,records){
 let templates;
 return makeResolver(records,{
  separateVersions:true,
  resolveTemplate(record,resolver){
   templates??=createTemplateIndex(snapshot);
   return previewExternalTemplate(record,resolver,templates);
  }
 });
}
function expandFunctionalVersions(record,resolved,existingKeys){
 const candidates=[],diagnostics=[];
 for(const [containerIndex,container] of (resolved.versions??[]).entries()){
  let specs;
  try{specs=versionSpecs(container);}
  catch(e){diagnostics.push({containerIndex,implementation:null,code:e.code||'versionExpansionError'});continue;}
  for(const v of specs){
   const location={containerIndex,implementation:v.implementation};
   try{
    if(v.status)fail(v.status);
    if(v.spec.source!==record.entity.source)fail('versionSourceSelectionPending');
    const expanded=previewVersion(record,resolved.entity,v.spec,existingKeys);
    candidates.push({...location,...expanded});
   }catch(e){diagnostics.push({...location,code:e.code||'versionExpansionError'});}
  }
 }
 return {candidates,diagnostics};
}
module.exports={createFunctionalResolver,expandFunctionalVersions};
