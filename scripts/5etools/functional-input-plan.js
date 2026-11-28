'use strict';
// Operational boundary for converters: exact source-scoped raw records, not pilot output.
const {digest}=require('./integrated-review');
const {mainEntityFile,isResolverKind}=require('./resolver');
const {selectFunctionalCorpus}=require('./functional-corpus');
const {describeVersionScope}=require('./functional-version-scope');
const assert=(ok,c)=>{if(!ok)throw Error(c);};
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim()?x:null;
const own=(o,k)=>Object.hasOwn(o,k);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const id=(origin,source)=>JSON.stringify([origin,source]);
const seal=body=>({...body,fingerprint:digest(body)});
const counts=()=>({included:0,excluded:0,sourcePending:0,sharedSupportPending:0});
function verifyInputs(main,homebrew,inventory,draft,selection){
 const {fingerprint,...body}=draft;
 assert(draft.schemaVersion==='dnd-upstream-functional-corpus.v1'&&draft.scope==='privateScopeDraft'&&draft.executable===false&&digest(body)===fingerprint,'functionalInputDraftInvalid');
 assert(main.commit===draft.commits.main&&homebrew.commit===draft.commits.homebrew&&digest(inventory.commits)===digest({main:main.commit,homebrew:homebrew.commit})&&digest(inventory)===draft.bindings.inventory,'functionalInputSnapshotMismatch');
 const scope=selectFunctionalCorpus(draft,selection);
 return {scope,sourceDecisions:new Map(scope.sources.map(s=>[s.id,s.decision?.disposition??null]))};
}
function ownershipIndex(inventory){
 const paths=new Map(),publications=new Map();
 const add=(map,k,v)=>{if(!map.has(k))map.set(k,new Set());map.get(k).add(v);};
 for(const s of inventory.sources){
  for(const p of s.paths??[])add(paths,id(s.origin,p.path),s.code);
  if(s.origin!=='main')continue;
  for(const p of s.publications??[]){
   if(!['book','adventure'].includes(p.kind)||!text(p.id)||! /^[A-Za-z0-9_-]+$/.test(p.id))continue;
   add(publications,'data/'+p.kind+'/'+p.kind+'-'+p.id.toLowerCase()+'.json',s.code);
  }
 }
 return {paths,publications};
}
function unique(set){return set?.size===1?[...set][0]:null;}
function classify(origin,path,kind,scanned,isArray){
 if(scanned)return 'resolverEntity';
 if(origin==='main'&&((/^data\/book\/book-[^/]+\.json$/.test(path)&&['data','bookData'].includes(kind))||(/^data\/adventure\/adventure-[^/]+\.json$/.test(path)&&['data','adventureData'].includes(kind))))return 'publicationSection';
 if(origin==='main'&&((path==='data/books.json'&&kind==='book')||(path==='data/adventures.json'&&kind==='adventure')))return 'publicationIndex';
 if(kind==='_meta'||kind.startsWith('_')||origin==='homebrew'&&path.startsWith('_generated/'))return 'supportMetadata';
 if(isArray&&isResolverKind(kind))return 'unscannedEntity';
 return isArray?'otherCollection':'supportValue';
}
function* enumerate(main,homebrew,inventory,sourceDecisions){
 const index=ownershipIndex(inventory),brewIndex=homebrew.readJson('_generated/index-sources.json');
 assert(rec(brewIndex),'functionalInputBrewIndexInvalid');
 const brewPaths=new Set(Object.values(brewIndex)),seen=new Set();
 for(const f of [...inventory.files].sort((a,b)=>cmp(id(a.origin,a.path),id(b.origin,b.path)))){
  const fileId=id(f.origin,f.path);
  assert(!seen.has(fileId)&&['main','homebrew'].includes(f.origin),'functionalInputDuplicateFile');
  seen.add(fileId);
  const snapshot=f.origin==='main'?main:homebrew;
  assert(snapshot.files.get(f.path)===f.blob,'functionalInputBlobMismatch');
  const json=snapshot.readJson(f.path),root=rec(json)?Object.entries(json).sort(([a],[b])=>cmp(a,b)):[['$root',json]];
  for(const [kind,v] of root){
   const array=Array.isArray(v),scanned=array&&(f.origin==='main'?mainEntityFile(f.path):brewPaths.has(f.path))&&isResolverKind(kind);
   const lane=classify(f.origin,f.path,kind,scanned,array);
   const values=array?v:[v];
   for(let i=0;i<values.length;i++){
    const value=values[i];
    let source=text(value?.source)||(kind==='magicvariant'?text(value?.inherits?.source):null),attribution=source?'explicitRecord':'unattributed';
    if(lane==='publicationIndex'&&!source){source=text(value?.id);if(source)attribution='publicationIndexId';}
    // Publication sections are owned by the containing publication; a conflicting
    // direct source is retained for review, not silently reassigned.
    if(lane==='publicationSection'){
     const owner=unique(index.publications.get(f.path));
     const wrapper=kind==='bookData'||kind==='adventureData';
     const wrapperValid=!wrapper||rec(value)&&Array.isArray(value.data)&&text(value.id)&&text(value.source)&&text(value.id).toLowerCase()===f.path.slice(f.path.lastIndexOf('/')+1).replace(/^(?:book|adventure)-/,'').replace(/\.json$/,'');
     if(owner&&wrapperValid&&(!source||source===owner)){source=owner;attribution='publicationPath';}
     else if(owner&&source!==owner||wrapper&&!wrapperValid){source=null;attribution='conflictingPublicationSource';}
    }
    if(!source&&attribution==='unattributed'&&!scanned&&lane!=='unscannedEntity'){
     const owner=unique(index.paths.get(fileId));
     if(owner){source=owner;attribution='uniqueIndexedFile';}
    }
    const sourceId=id(f.origin,source),decision=source===null?null:sourceDecisions.get(sourceId);
    const disposition=decision==='include'?'included':decision==='exclude'?'excluded':source===null&&['supportMetadata','supportValue'].includes(lane)?'sharedSupportPending':'sourcePending';
    const descriptor={origin:f.origin,path:f.path,blob:f.blob,kind,index:array?i:null,rootArray:array,lane,sourceId,attribution,disposition,valueFingerprint:digest(value)};
    const versions=describeVersionScope(descriptor,value,sourceDecisions);
    if(versions.length)descriptor.versions=versions;
    yield {descriptor,value};
   }
  }
 }
}
function buildFunctionalInputPlan(main,homebrew,inventory,draft,selection){
 const {scope,sourceDecisions}=verifyInputs(main,homebrew,inventory,draft,selection);
 const totals={main:{resolverRows:0,otherRootRows:0,nonArrayValues:0,...counts()},homebrew:{resolverRows:0,otherRootRows:0,nonArrayValues:0,...counts()}};
 const rows=[],lanes={};
 for(const {descriptor:r} of enumerate(main,homebrew,inventory,sourceDecisions)){
  const t=totals[r.origin];
  t[r.rootArray?(r.lane==='resolverEntity'?'resolverRows':'otherRootRows'):'nonArrayValues']++;
  t[r.disposition]++;
  const l=lanes[r.lane]??=counts();l[r.disposition]++;
  rows.push(r);
 }
 for(const origin of ['main','homebrew']){
  const t=totals[origin],d=draft.totals[origin];
  assert(t.resolverRows===d.resolverRows&&t.otherRootRows===d.otherRootRows&&t.included+t.excluded+t.sourcePending+t.sharedSupportPending===t.resolverRows+t.otherRootRows+t.nonArrayValues,'functionalInputDenominatorMismatch');
 }
 return seal({schemaVersion:'dnd-upstream-functional-input-plan.v1',commits:draft.commits,bindings:{corpus:draft.fingerprint,scope:scope.fingerprint,inventory:draft.bindings.inventory},totals,lanes,rows,scope:'privateConversionInputs',bootstrapRequired:true,executable:false});
}
// Read actual immutable input values for the next converter. Rebuild the plan
// before exposing any value; keep nested payload intact, including _versions.
function* readSelectedFunctionalInputs(main,homebrew,inventory,draft,selection,plan){
 const rebuilt=buildFunctionalInputPlan(main,homebrew,inventory,draft,selection);
 assert(digest(rebuilt)===digest(plan),'functionalInputPlanMismatch');
 const {sourceDecisions}=verifyInputs(main,homebrew,inventory,draft,selection);
 let i=0;
 for(const row of enumerate(main,homebrew,inventory,sourceDecisions)){
  assert(digest(row.descriptor)===digest(rebuilt.rows[i++]),'functionalInputChanged');
  if(row.descriptor.disposition==='included')yield row;
 }
 assert(i===rebuilt.rows.length,'functionalInputChanged');
}
function publicInputPlanSummary(plan){
 return {schemaVersion:plan.schemaVersion,commits:plan.commits,bindings:plan.bindings,totals:plan.totals,lanes:plan.lanes,fingerprint:plan.fingerprint,scope:plan.scope,bootstrapRequired:true,executable:false};
}
module.exports={buildFunctionalInputPlan,readSelectedFunctionalInputs,publicInputPlanSummary};
