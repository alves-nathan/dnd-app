'use strict';
// Selected Main origins, feats, optional features and conditions.
// Preserve historical pilots; share their mechanical projections.
const {identity,mainEntityFile}=require('./resolver');
const {createFunctionalResolver,expandFunctionalVersions,retainStructuralEvidence}=require('./functional-resolver');
const {readMainPublications,projectMainSource}=require('./functional-main-source');
const origin=require('./origin-converter'),feature=require('./feature-converter'),condition=require('./condition-converter');
const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const clone=v=>JSON.parse(JSON.stringify(v));
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const fail=code=>{throw Object.assign(Error(code),{code});};
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const coordinate=(p,k,i)=>JSON.stringify([p,k,i]);
const officialNames=new Set('blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed poisoned prone restrained stunned unconscious'.split(' '));
const specs={
 feat:{group:'features',stage:'a5.5',suffix:'feats-features',pilot:feature.pilot},
 optionalfeature:{group:'features',stage:'a5.5',suffix:'feats-features',pilot:feature.pilot},
 race:{group:'origins',stage:'a5.6',suffix:'origins',pilot:origin.pilot},
 subrace:{group:'origins',stage:'a5.6',suffix:'origins',pilot:origin.pilot},
 background:{group:'origins',stage:'a5.6',suffix:'origins',pilot:origin.pilot},
 condition:{group:'conditions',stage:'a5.8',suffix:'conditions',pilot:condition.pilot}
};
const emptyResult=commit=>({commit,packs:[],counts:Object.create(null),diagnostics:[],activation:'review-required'});
function convertCondition(r,resolved,source,commit){
 const e=resolved.entity,name=norm(e.name);
 if(typeof e.name!=='string'||!name||e.name.trim()!==e.name||!Array.isArray(e.entries)||!e.entries.length)fail('invalidConditionEntries');
 const official=Object.hasOwn(condition.pilot,e.source)&&officialNames.has(name);
 const notes=['conditionEffectsPending','conditionEndRulesPending','conditionRuntimeAliasPending','precedencePending'];
 if(!official)notes.push('conditionClassificationPending');
 if(name==='exhaustion')notes.push('stackedConditionEditionPolicyPending');
 return {id:condition.physicalId(e),kind:'condition',name:e.name,source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
 identity:{canonicalKey:'condition:'+name,precedenceScope:source.precedenceScope},
 precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
 provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,sourceCode:e.source,resolverVersion:'a5.8',lineage:resolved.lineage},
 payload:{conditionId:condition.stagingConditionId(e),...(official?{officialCondition:true}:{}),mechanics:{upstreamCondition:clone(e),...(official?{runtimeConditionCandidate:name}:{}),conditionReviewCandidate:{rulesEra:source.rulesEra,stackPolicy:name==='exhaustion'?'editionSpecificPending':'notAssessed',effectPolicy:'unreviewed',endPolicy:'unreviewed',runtimeAlias:'unapproved'}}},
 metadata:{reviewCodes:notes.sort(cmp),upstreamReprintedAs:clone(e.reprintedAs||[])}};
}
function buildFunctionalOriginFeatures(snapshot,selection){
 const results={features:emptyResult(snapshot.commit),origins:emptyResult(snapshot.commit),conditions:emptyResult(snapshot.commit)};
 if(!Array.isArray(selection))fail('functionalOriginSelectionInvalid');
 const wanted=new Map(),seen=new Set();
 for(const r of selection){
  const source=JSON.parse(r.sourceId),key=coordinate(r.path,r.kind,r.index);
  if(!Object.hasOwn(specs,r.kind)||!mainEntityFile(r.path)||!Number.isSafeInteger(r.index)||r.index<0||!Array.isArray(source)||source.length!==2||source[0]!=='main'||typeof source[1]!=='string'||!source[1].trim()||wanted.has(key))fail('functionalOriginSelectionInvalid');
  wanted.set(key,source[1]);
 }
 if(!wanted.size)return results;
 const publications=readMainPublications(snapshot),records=[],selected=[],originals=new Map(),parentKeys=new Set(),featIndex=new Map();
 const summary=(kind,code)=>{
  const result=results[specs[kind].group];
  const c=result.counts[code]??={total:0,converted:0,blocked:0,byKind:Object.create(null),blockCodes:Object.create(null)};
  const k=c.byKind[kind]??={total:0,converted:0,blocked:0};
  return {result,c,k};
 };
 function block(r,reason){
  const {result,c,k}=summary(r.kind,r.entity.source);
  c.blocked++;k.blocked++;bump(c.blockCodes,reason);
  result.diagnostics.push({source:r.entity.source,kind:r.kind,path:r.path,index:r.index,code:reason});
 }
 // Scan root collections once; include unselected records only as resolver
 // context. Ignore unrelated files, never evaluate upstream code.
 for(const path of [...snapshot.files.keys()].filter(mainEntityFile).sort(cmp)){
  const json=snapshot.readJson(path);
  if(!rec(json))continue;
  for(const kind of Object.keys(specs)){
   if(!Array.isArray(json[kind]))continue;
   for(const [index,e] of json[kind].entries()){
    const coord=coordinate(path,kind,index),tracked=wanted.has(coord);
    if(tracked){
     if(!rec(e)||e.source!==wanted.get(coord))fail('functionalOriginSelectionSourceMismatch');
     seen.add(coord);
     const {c,k}=summary(kind,e.source);c.total++;k.total++;
    }
    if(kind==='feat'&&rec(e)&&typeof e.name==='string'&&typeof e.source==='string'){
     const key=JSON.stringify([norm(e.name),norm(e.source)]);
     featIndex.set(key,featIndex.has(key)?null:e);
    }
    if(kind==='subrace'&&rec(e)){
     try{parentKeys.add(identity('race',{name:e.raceName,source:e.raceSource}));}catch{}
    }
    try{
     const key=identity(kind,e),id=JSON.stringify(['main',key]),entity=clone(e);
     // Preserve lineage containers in mechanics, not as fabricated playable
     // variants. Keep the same explicit boundary as the origin converter.
     // The functional resolver separates and validates all version containers.
     originals.set(id,e);
     const r={id,key,kind,origin:'main',path,index,blob:snapshot.files.get(path),entity};
     records.push(r);if(tracked)selected.push(r);
    }catch(err){if(tracked)block({kind,path,index,entity:e},err.code||'invalidIdentity');}
   }
  }
 }
 if(seen.size!==wanted.size)fail('functionalOriginSelectionCoordinateMissing');
 const resolver=createFunctionalResolver(snapshot,records),groups=new Map(),candidates=[],selectedIds=new Set(selected.map(r=>r.id)),existingKeys=new Set(records.map(r=>r.id)),versions=[];
 for(const r of selected){
  try{
   const resolved=resolver.resolve(r),e=resolved.entity,spec=specs[r.kind];
   if(e.source!==r.entity.source)fail('functionalOriginResolvedSourceMismatch');
   const projection=projectMainSource(e.source,publications,e,spec.pilot[e.source]);
   const extra=[];
   let item;
   if(spec.group==='origins'){
    if(r.kind==='subrace'){
     const parent=resolver.lookup('main','race',{name:e.raceName,source:e.raceSource});
     if(!selectedIds.has(parent.id))extra.push('subraceParentNotSelected');
    }
    item=origin.convert(r,resolved,projection.source,snapshot.commit,{resolver,originals,parentKeys,featIndex});
   }else if(spec.group==='features')item=feature.convert(r,resolved,projection.source,snapshot.commit);
   else item=convertCondition(r,resolved,projection.source,snapshot.commit);
   item.metadata.sourceEditionEvidence=projection.editionEvidence;
   item.metadata.reviewCodes=[...new Set([...item.metadata.reviewCodes,...projection.notes,...extra])].sort(cmp);
   retainStructuralEvidence(item,resolved);
   candidates.push({r,item,spec});
   if(resolved.versions?.length){
    const {result,c}=summary(r.kind,r.entity.source);
    const pending=(code,version)=>{
     c.versionsBlocked=(c.versionsBlocked||0)+1;
     result.diagnostics.push({source:r.entity.source,kind:r.kind,path:r.path,index:r.index,code,...(version?{version}:{})});
    };
    if(spec.group==='features'){
     const expanded=expandFunctionalVersions(r,resolved,existingKeys);
     for(const d of expanded.diagnostics)pending(d.code,{containerIndex:d.containerIndex,implementation:d.implementation});
     for(const v of expanded.candidates)versions.push({r,spec,v,resolved,pending});
    }else pending('nestedVersionExpansionPending');
   }
  }catch(err){block(r,err.code||'conversionError');}
 }
 const versionCounts=new Map();
 for(const {v} of versions)versionCounts.set(v.id,(versionCounts.get(v.id)||0)+1);
 for(const {r,spec,v,resolved,pending} of versions){
  try{
   if(versionCounts.get(v.id)!==1)fail('versionIdentityCollision');
   const projection=projectMainSource(v.entity.source,publications,v.entity,spec.pilot[v.entity.source]);
   const result={entity:v.entity,lineage:[r.id,...resolved.lineage],templateLineage:resolved.templateLineage};
   const item=feature.convert(r,result,projection.source,snapshot.commit);
   item.metadata.versionOrigin={parentKey:r.key,versionKey:v.key,containerIndex:v.containerIndex,implementation:v.implementation};
   item.metadata.sourceEditionEvidence=projection.editionEvidence;
   item.metadata.reviewCodes=[...new Set([...item.metadata.reviewCodes,...projection.notes,'versionSemanticsPending'])].sort(cmp);
   retainStructuralEvidence(item,result);
   candidates.push({r,item,spec,version:true});
  }catch(err){pending(err.code||'versionConversionError',{containerIndex:v.containerIndex,implementation:v.implementation});}
 }
 const frequencies=new Map();
 for(const {item} of candidates)frequencies.set(item.id,(frequencies.get(item.id)||0)+1);
 for(const {r,item,spec,version} of candidates){
  const {c,k,result}=summary(r.kind,r.entity.source);
  if(frequencies.get(item.id)!==1){
   if(version){c.versionsBlocked=(c.versionsBlocked||0)+1;result.diagnostics.push({source:r.entity.source,kind:r.kind,path:r.path,index:r.index,code:'versionIdentityCollision'});}
   else block(r,'duplicatePhysicalId');
   continue;
  }
  if(version)c.versionsConverted=(c.versionsConverted||0)+1;
  else {c.converted++;k.converted++;}
  const key=JSON.stringify([spec.group,r.entity.source]),group=groups.get(key)||{spec,code:r.entity.source,items:[]};
  group.items.push(item);groups.set(key,group);
 }
 for(const {spec,code,items} of [...groups.values()].sort((a,b)=>cmp(a.spec.group,b.spec.group)||cmp(a.code,b.code))){
  const source=projectMainSource(code,publications,null,spec.pilot[code]).source;
  results[spec.group].packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':'+spec.suffix,source,metadata:{stage:spec.stage,activation:'review-required',conversionScope:'functionalSelectedSources'},items:items.sort((a,b)=>cmp(a.id,b.id))});
 }
 for(const result of Object.values(results))for(const c of Object.values(result.counts)){
  if(c.total!==c.converted+c.blocked||Object.values(c.byKind).some(k=>k.total!==k.converted+k.blocked))fail('functionalOriginAccountingMismatch');
 }
 return results;
}
module.exports={buildFunctionalOriginFeatures,convertCondition};
