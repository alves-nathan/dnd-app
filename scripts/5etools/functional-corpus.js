'use strict';
// Source selection and denominator inventory only. No raw payloads in reports.
const {createHash}=require('node:crypto');
const {mainEntityFile,isResolverKind}=require('./resolver');
const {buildInventory}=require('./inventory');
const {digest}=require('./integrated-review');
const lock=require('./functional-inputs.json');
const assert=(v,c)=>{if(!v)throw Error(c);};
const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const code=v=>typeof v==='string'&&v.trim()?v:null;
const key=(origin,source)=>JSON.stringify([origin,source]);
const blank=()=>({resolverRows:0,otherRootRows:0,nestedNamedSourceNodes:0,nestedVersionRows:0,explicitEditionObservations:0});
const sum=(o,k)=>Object.values(o).reduce((n,v)=>n+v[k],0);
const countKeys=['observed','identityInvalid','structuralBlocked','structuralResolved','eligible','outsidePilot','validRow','invalidRow','notEmitted','templateNoOutput','emitted','stagingValid','stagingInvalid','singleOutputRows','multipleOutputRows','extraOutputOccurrences'];
const seal=b=>({...b,fingerprint:digest(b)});
function verifyPinnedInputs(main,homebrew){
 assert(main.commit===lock.main.commit&&homebrew.commit===lock.homebrew.commit,'functionalSnapshotLockMismatch');
}
// Count root array slots outside the resolver and nested observations separately.
// Nested nodes are evidence leads, not a disjoint denominator of mechanical entities.
function scanCorpusFiles(main,homebrew,inventory){
 const brewPaths=new Set(Object.values(homebrew.readJson('_generated/index-sources.json')));
 const totals={main:{...blank(),files:0,nonObjectFiles:0},homebrew:{...blank(),files:0,nonObjectFiles:0}};
 const sources=new Map(),files=[];
 const get=(origin,source)=>{const id=key(origin,source);if(!sources.has(id))sources.set(id,{origin,source,...blank()});return sources.get(id);};
 for(const f of [...inventory.files].sort((a,b)=>cmp(key(a.origin,a.path),key(b.origin,b.path)))){
  const snapshot=f.origin==='main'?main:homebrew,t=totals[f.origin];
  assert(t&&snapshot.files.get(f.path)===f.blob,'functionalInventoryFileBindingMismatch');
  const json=snapshot.readJson(f.path),observations=blank();
  t.files++;
  if(!rec(json))t.nonObjectFiles++;
  const root=rec(json)?Object.entries(json):Array.isArray(json)?[['$root',json]]:[];
  const bump=(field,source)=>{observations[field]++;get(f.origin,source)[field]++;};
  const stack=[];
  for(const [kind,value] of root){
   if(Array.isArray(value)){
    const scanned=(f.origin==='main'?mainEntityFile(f.path):brewPaths.has(f.path))&&isResolverKind(kind);
    for(const item of value){
     const source=code(item?.source)||(kind==='magicvariant'?code(item?.inherits?.source):null);
     bump(scanned?'resolverRows':'otherRootRows',source);
     if(rec(item)&&code(item.edition))bump('explicitEditionObservations',source);
     if(rec(item))for(const [field,child] of Object.entries(item))stack.push({field,value:child,source});
     else if(Array.isArray(item))stack.push({field:kind,value:item,source});
    }
   }else if(rec(value))stack.push({field:kind,value,source:null});
  }
  while(stack.length){
   const {field,value,source}=stack.pop();
   if(Array.isArray(value)){
    if(field==='_versions')for(const item of value)bump('nestedVersionRows',code(item?.source)||source);
    for(const child of value)if(rec(child)||Array.isArray(child))stack.push({field:'',value:child,source});
   }else if(rec(value)){
    const explicit=code(value.source),effective=explicit||source;
    if(explicit&&code(value.name))bump('nestedNamedSourceNodes',explicit);
    if(code(value.edition))bump('explicitEditionObservations',effective);
    for(const [k,child] of Object.entries(value))if(rec(child)||Array.isArray(child))stack.push({field:k,value:child,source:effective});
   }
  }
  for(const k of Object.keys(observations))t[k]+=observations[k];
  files.push({origin:f.origin,path:f.path,blob:f.blob,...observations});
 }
 return {totals,sources:[...sources.values()].sort((a,b)=>cmp(key(a.origin,a.source),key(b.origin,b.source))),fileFingerprint:digest(files)};
}
function buildFunctionalCorpus(baseline,inventory,scan,applicationCommit){
 assert(baseline?.schemaVersion==='dnd-upstream-coverage-baseline.v1'&&baseline.activation==='review-required'&&Object.keys(baseline.issues).length===0&&baseline.asOf===inventory.asOf&&digest(baseline.commits)===digest(inventory.commits)&&/^[a-f0-9]{40}$/.test(applicationCommit),'functionalBaselineInvalid');
 const rows=new Map();
 const get=(origin,source)=>{const id=key(origin,source);if(!rows.has(id))rows.set(id,{id,origin,source,publications:0,observations:blank(),coverage:{},proposal:source===null?'identifySource':origin==='main'?'includeForPrivateReview':'ownerSourceDecisionRequired',editionPolicy:'preservePerRecordNoDateInference'});return rows.get(id);};
 for(const b of baseline.sources){
  const r=get(b.origin,b.source);assert(!Object.keys(r.coverage).length,'functionalDuplicateSource');
  r.publications=b.publications;
  for(const [kind,c] of Object.entries(b.kinds)){
   assert(countKeys.every(k=>count(c[k]))&&c.observed===c.identityInvalid+c.structuralBlocked+c.structuralResolved&&c.observed===c.eligible+c.outsidePilot&&c.eligible===c.validRow+c.invalidRow+c.notEmitted+c.templateNoOutput&&c.emitted===c.singleOutputRows+c.multipleOutputRows+c.extraOutputOccurrences&&c.validRow+c.invalidRow===c.singleOutputRows+c.multipleOutputRows,'functionalSourceAccountingMismatch');
   r.coverage[kind]=Object.fromEntries(countKeys.map(k=>[k,c[k]]));
  }
 }
 for(const s of scan.sources){const r=get(s.origin,s.source);r.observations=Object.fromEntries(Object.keys(blank()).map(k=>[k,s[k]]));}
 const sources=[...rows.values()].sort((a,b)=>cmp(a.id,b.id));
 const totals={};
 for(const origin of ['main','homebrew']){
  const rr=sources.filter(r=>r.origin===origin),all=rr.flatMap(r=>Object.values(r.coverage));
  const c=Object.fromEntries(countKeys.map(k=>[k,all.reduce((n,v)=>n+v[k],0)]));
  assert(countKeys.every(k=>c[k]===baseline.totalsByOrigin[origin][k])&&scan.totals[origin].resolverRows===c.observed,'functionalDenominatorMismatch');
  for(const k of Object.keys(blank()))assert(rr.reduce((n,r)=>n+r.observations[k],0)===scan.totals[origin][k],'functionalScanAccountingMismatch');
  totals[origin]={...c,withoutPilotOutput:c.observed-c.validRow-c.invalidRow,sourceRows:rr.length,unattributedRows:rr.filter(r=>r.source===null).reduce((n,r)=>n+Object.values(r.coverage).reduce((a,b)=>a+b.observed,0),0),...scan.totals[origin]};
 }
 assert(totals.main.emitted+totals.homebrew.emitted===baseline.uniquePhysicalIds,'functionalOutputAccountingMismatch');
 const body={schemaVersion:'dnd-upstream-functional-corpus.v1',commits:{...baseline.commits,application:applicationCommit},asOf:baseline.asOf,
  contractRevision:lock.contractRevision,bindings:{baseline:digest(baseline),inventory:digest(inventory),fileObservations:scan.fileFingerprint,runtime:baseline.runtime.sha256},
  baselineRuntime:{entries:baseline.runtime.total,unmappedEntries:baseline.runtime.books.filter(b=>b.source===null).reduce((n,b)=>n+b.total,0)},totals,sources,
  pending:['ownerCorpusSelection','historicalAndInstalledSourceMapping','nestedAndOtherRootDisposition','manyToOneConversionDisposition','mechanicalAndRelationshipImplementation','homebrewSourcePolicyReview'],scope:'privateScopeDraft',bootstrapRequired:true,activation:'review-required',executable:false};
 return seal(body);
}
// Decisions bind the exact immutable draft, never implicit wildcard approval.
// This is a scope selection, not an installation, mechanical or rights grant.
function selectFunctionalCorpus(draft,selection){
 const {fingerprint,...body}=draft;
 assert(draft.schemaVersion==='dnd-upstream-functional-corpus.v1'&&draft.scope==='privateScopeDraft'&&draft.executable===false&&digest(body)===fingerprint,'functionalDraftInvalid');
 assert(selection?.schemaVersion==='dnd-upstream-functional-source-selection.v1'&&selection.corpusFingerprint===fingerprint&&Array.isArray(selection.decisions),'functionalSelectionInvalid');
 const known=new Map(draft.sources.map(s=>[s.id,s])),decisions=new Map();
 for(const d of selection.decisions){
  assert(known.has(d.sourceId)&&!decisions.has(d.sourceId)&&['include','exclude'].includes(d.disposition)&&code(d.reason),'functionalSourceDecisionInvalid');
  // Unknown-source rows cannot be approved by a blanket selection.
  assert(known.get(d.sourceId).source!==null,'functionalUnattributedDecision');
  decisions.set(d.sourceId,{sourceId:d.sourceId,disposition:d.disposition,reason:d.reason});
 }
 const selected=draft.sources.map(s=>({...s,decision:decisions.get(s.id)??null}));
 const pendingSources=selected.filter(s=>!s.decision).length;
 return seal({schemaVersion:'dnd-upstream-functional-scope.v1',corpusFingerprint:fingerprint,commits:draft.commits,sources:selected,
  counts:{included:decisions.size-[...decisions.values()].filter(d=>d.disposition==='exclude').length,excluded:[...decisions.values()].filter(d=>d.disposition==='exclude').length,pending:pendingSources},
  scope:'privateSourceSelectionOnly',bootstrapRequired:true,activation:'review-required',executable:false});
}
function buildPinnedFunctionalCorpus(main,homebrew,baseline,applicationCommit){
 verifyPinnedInputs(main,homebrew);
 assert(baseline.asOf===lock.asOf,'functionalAsOfMismatch');
 const inventory=buildInventory(main,homebrew,lock.asOf),scan=scanCorpusFiles(main,homebrew,inventory);
 return buildFunctionalCorpus(baseline,inventory,scan,applicationCommit);
}
function publicFunctionalSummary(r){
 return {schemaVersion:r.schemaVersion,commits:r.commits,asOf:r.asOf,contractRevision:r.contractRevision,totals:r.totals,baselineRuntime:r.baselineRuntime,pending:r.pending,scope:r.scope,bootstrapRequired:r.bootstrapRequired,executable:false,fingerprint:r.fingerprint};
}
module.exports={verifyPinnedInputs,scanCorpusFiles,buildFunctionalCorpus,buildPinnedFunctionalCorpus,selectFunctionalCorpus,publicFunctionalSummary};
