'use strict';
// Exact nested version authorization. Parent/root accounting is unchanged.
const {versionSpecs}=require('./variant-lineage');
const {digest}=require('./integrated-review');
const coord=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0;
const supported=new Set(['spell','monster','feat','optionalfeature']);
function describeVersionScope(r,value,sourceDecisions){
 if(r.origin!=='main'||r.lane!=='resolverEntity'||!supported.has(r.kind)||!Array.isArray(value?._versions))return [];
 const result=[];
 for(const [containerIndex,container] of value._versions.entries()){
  let specs;
  try{specs=versionSpecs(container);}catch(e){specs=[{implementation:null,status:e.code||'versionExpansionError'}];}
  for(const v of specs){
   const source=text(v.spec?.source)?v.spec.source:null,name=text(v.spec?.name)?v.spec.name:null,sourceId=JSON.stringify([r.origin,source]);
   const decision=sourceDecisions.get(sourceId);
   result.push({containerIndex,implementation:v.implementation,sourceId,name,disposition:r.disposition!=='included'?'parentNotIncluded':v.status||!source||!name?'identityPending':decision==='include'?'included':decision==='exclude'?'excluded':'sourcePending',specFingerprint:v.spec?digest(v.spec):null});
  }
 }
 return result;
}
function versionAuthorization(plan){
 const byRoot=new Map(plan.rows.filter(r=>r.versions?.length).map(r=>[coord(r),r]));
 return (record,location,spec)=>{
  const r=byRoot.get(coord(record));
  const v=r?.versions.find(v=>v.containerIndex===location.containerIndex&&v.implementation===location.implementation);
  return !!(r?.disposition==='included'&&v?.disposition==='included'&&v.sourceId===JSON.stringify([record.origin,spec.source])&&v.name===spec.name&&v.specFingerprint===digest(spec));
 };
}
function verifyVersionOutput(row,item){
 const v=item.metadata?.versionOrigin,p=item.provenance;
 if(!v||v.parentKey!==p.entityKey)return false;
 let key;try{key=JSON.parse(v.versionKey);}catch{return false;}
 return Array.isArray(key)&&key.length===3&&key[0]===row.kind&&key[1]===item.name.trim().toLowerCase()&&key[2]===p.sourceCode.trim().toLowerCase()&&row.disposition==='included'&&Array.isArray(row.versions)&&row.versions.some(n=>n.disposition==='included'&&n.containerIndex===v.containerIndex&&n.implementation===v.implementation&&n.sourceId===JSON.stringify([row.origin,p.sourceCode])&&n.name===item.name&&n.specFingerprint===v.specFingerprint);
}
module.exports={describeVersionScope,versionAuthorization,verifyVersionOutput};
