'use strict';
// a6.1: row-level coverage ledger, not runtime migration or semantic equivalence.
const {collect,audit}=require('./resolver');
const {buildInventory}=require('./inventory');
const {converters}=require('./pilot-coverage');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const sourceOf=r=>typeof r.entity?.source==='string'&&r.entity.source.trim()?r.entity.source:
  r.kind==='magicvariant'&&typeof r.entity?.inherits?.source==='string'&&r.entity.inherits.source.trim()?r.entity.inherits.source:null;
const coord=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const sourceKey=(origin,source)=>JSON.stringify([origin,source]);
const bump=(obj,k,n=1)=>obj[k]=(obj[k]||0)+n;
const dict=()=>Object.create(null);
const rarities=new Set(['common','uncommon','rare','very rare','legendary','artifact','varies','unknown','unknown (magic)']);
const bootstrapCodes=new Set(['PHB','XPHB','XMM','EFA','AAG','BAM','LoX','TCE','XDMG']);
// Only explicit runtime book IDs documented by catalog types; other IDs remain unmapped.
const runtimeBookMap=Object.freeze({'phb-2024':'XPHB','dmg-2024':'XDMG','mm-2025':'XMM'});
function runtimeProfile(bundle,digest){
  if(bundle?.schemaVersion!=='dnd-combat-runtime-bundle.v1'||!Array.isArray(bundle.runtimeIndex?.entries)||
    bundle.runtimeIndex.entryCount!==bundle.runtimeIndex.entries.length)throw Error('invalidRuntimeIndex');
  const byBook=new Map(),ids=new Set();
  for(const e of bundle.runtimeIndex.entries){
    if(typeof e.entityId!=='string'||ids.has(e.entityId)||typeof e.kind!=='string')throw Error('invalidRuntimeEntry');
    ids.add(e.entityId);
    const book=e.sourceBookId??null;
    if(book!==null&&typeof book!=='string')throw Error('invalidRuntimeBookId');
    if(!byBook.has(book))byBook.set(book,{book,source:book!==null&&own(runtimeBookMap,book)?runtimeBookMap[book]:null,total:0,defaultEnabled:0,manualReview:0,kinds:dict()});
    const b=byBook.get(book);b.total++;if(e.defaultEnabled===true)b.defaultEnabled++;if(e.manualReviewRequired===true)b.manualReview++;bump(b.kinds,e.kind);
  }
  return {catalogVersion:bundle.catalogVersion,sha256:digest,total:ids.size,books:[...byBook.values()].sort((a,b)=>String(a.book).localeCompare(String(b.book))),scope:'bundled-runtime-index-only; defaultEnabled is not installed user state; no entity equivalence'};
}
function readRuntimeProfile(bundlePath){
  const raw=fs.readFileSync(bundlePath),actual=createHash('sha256').update(raw).digest('hex');
  const expected=fs.readFileSync(bundlePath+'.sha256','utf8').trim().split(/\s+/)[0];
  if(actual!==expected)throw Error('runtimeChecksumMismatch');
  return runtimeProfile(JSON.parse(raw.toString('utf8')),actual);
}
function scopeFor(r,stageSources,indexPaths){
  if(r.origin!=='main')return {stages:[],reason:'homebrewConversionPending'};
  const code=sourceOf(r),e=r.entity||{},stages=[];
  const add=stage=>{if(stageSources[stage]?.has(code))stages.push(stage);};
  const p=r.path,k=r.kind;
  let supported=false;
  if(k==='spell'&&indexPaths.spell.has(p)){supported=true;add('a5.1');}
  if(k==='monster'&&indexPaths.monster.has(p)){supported=true;add('a5.2');}
  if(k==='baseitem'&&p==='data/items-base.json'||k==='item'&&p==='data/items.json'){
    supported=true;
    if(e.rarity==='none'||e.mundane===true&&e.rarity===undefined)add('a5.3');
    if(k==='item'&&(rarities.has(norm(e.rarity))||e.wondrous===true&&e.rarity!=='none'))add('a5.4');
    if(!stages.length&&!(e.rarity==='none'||e.mundane===true&&e.rarity===undefined||k==='item'&&(rarities.has(norm(e.rarity))||e.wondrous===true&&e.rarity!=='none')))return {stages,reason:'itemClassificationOutsidePilot'};
  }
  if(k==='magicvariant'&&p==='data/magicvariants.json'){supported=true;add('a5.4');}
  if(k==='feat'&&p==='data/feats.json'||k==='optionalfeature'&&p==='data/optionalfeatures.json'){supported=true;add('a5.5');}
  if(['race','subrace'].includes(k)&&p==='data/races.json'||k==='background'&&p==='data/backgrounds.json'){supported=true;add('a5.6');}
  if(['class','subclass','classFeature','subclassFeature'].includes(k)&&/^data\/class\/class-[^/]+\.json$/.test(p)){supported=true;add('a5.7');}
  if(k==='condition'&&p==='data/conditionsdiseases.json'){supported=true;add('a5.8');}
  return {stages,reason:stages.length?null:supported?'sourceOutsidePilot':'kindOrPathOutsidePilot'};
}
const counters=()=>({observed:0,identityInvalid:0,structuralBlocked:0,structuralResolved:0,eligible:0,outsidePilot:0,
  validRow:0,invalidRow:0,notEmitted:0,templateNoOutput:0,emitted:0,stagingValid:0,stagingInvalid:0,semanticReviewRequired:0,
  invalidIdentityWithOutput:0,structuralBlockedWithOutput:0,scopeReasons:dict(),reviewCodes:dict()});
function reconcileCoverage({collection,structural,inventory,runs,indexPaths,runtime,validate}){
  if(typeof validate!=='function')throw Error('stagingValidatorRequired');
  const bySource=new Map(),rows=new Map(),resolved=new Set(structural.entities.map(coord)),issues=dict(),physicalIds=new Set(),byConverter=dict(),canonical=dict(),canonicalValidation=dict();
  const stageSources=Object.fromEntries(runs.map(({stage,result})=>[stage,new Set(Object.keys(result.counts))]));
  function source(origin,code){
    const key=sourceKey(origin,code);
    if(!bySource.has(key))bySource.set(key,{origin,source:code,publications:0,releaseStatus:'unknown',priority:origin==='main'&&bootstrapCodes.has(code)?'bootstrap':'unmapped-or-expansion',kinds:dict()});
    return bySource.get(key);
  }
  for(const s of inventory.sources){const b=source(s.origin,s.code);b.publications=s.publications.length;b.releaseStatus=s.releaseStatus;}
  for(const [list,invalid] of [[collection.records,false],[collection.invalidRecords,true]]){
    for(const r of list){
      const key=coord(r);if(rows.has(key)){bump(issues,'duplicateUpstreamCoordinate');continue;}
      const b=source(r.origin,sourceOf(r)),c=b.kinds[r.kind]??=(counters());
      const status=invalid?'identityInvalid':resolved.has(key)?'structuralResolved':'structuralBlocked';
      c.observed++;c[status]++;
      const scope=scopeFor(r,stageSources,indexPaths);
      if(scope.stages.length)c.eligible++;else{c.outsidePilot++;bump(c.scopeReasons,scope.reason);}
      rows.set(key,{r,c,status,scope,outputs:0,invalidOutputs:0});
    }
  }
  for(const {stage,result} of runs){
    if(result.commit!==structural.commits.main)bump(issues,'snapshotMismatch');
    if(result.activation!=='review-required')bump(issues,'activationMismatch');
    const summary=byConverter[stage]={emitted:0,stagingValid:0,stagingInvalid:0,reviewCodes:dict(),diagnosticCodes:dict()};
    // Preserve converter-specific denominators (especially magic variants and templates).
    summary.counts=result.counts;
    for(const d of result.diagnostics)bump(summary.diagnosticCodes,d.code);
    const allItems=result.packs.flatMap(p=>p.items);
    const joint=stage==='a5.7'||stage==='a5.8';
    const jointResult=joint&&result.packs.length?validate({...result.packs[0],items:allItems}):null;
    for(const pack of result.packs){
      for(const item of pack.items){
        const p=item.provenance;
        let kind;
        try{kind=JSON.parse(p.entityKey)[0];}catch{bump(issues,'invalidProvenanceKey');continue;}
        const row=rows.get(coord({origin:'main',path:p.path,kind,index:p.index}));
        const valid=joint?jointResult?.ok===true:validate({...pack,items:[item]}).ok===true;
        const state=valid?'stagingValid':'stagingInvalid';
        summary.emitted++;summary[state]++;bump(canonical,item.kind);bump(canonicalValidation[item.kind]??=dict(),state);
        if(physicalIds.has(item.id))bump(issues,'duplicatePhysicalId');physicalIds.add(item.id);
        if(p.commit!==structural.commits.main||p.origin!=='5etools')bump(issues,'snapshotMismatch');
        if(item.source.status!=='needsReview'||pack.metadata?.activation!=='review-required')bump(issues,'activationMismatch');
        for(const code of item.metadata?.reviewCodes||[])bump(summary.reviewCodes,code);
        if(!row){bump(issues,'unmatchedProvenance');continue;}
        if(row.r.blob!==p.blob||sourceOf(row.r)!==p.sourceCode||(!row.scope.stages.includes(stage)))bump(issues,'provenanceOrScopeMismatch');
        // Invalid raw identity can still yield a documented normalized template or preserved lineage.
        row.outputs++;if(!valid)row.invalidOutputs++;
        row.c.emitted++;row.c[state]++;row.c.semanticReviewRequired++;
        for(const code of item.metadata?.reviewCodes||[])bump(row.c.reviewCodes,code);
      }
    }
  }
  for(const row of rows.values()){
    const {c,scope,status,outputs,invalidOutputs,r}=row;
    if(outputs){
      c[invalidOutputs?'invalidRow':'validRow']++;
      if(status==='identityInvalid')c.invalidIdentityWithOutput++;
      if(status==='structuralBlocked')c.structuralBlockedWithOutput++;
    }else if(scope.stages.length)c[r.kind==='magicvariant'?'templateNoOutput':'notEmitted']++;
  }
  const totalsByOrigin=dict();
  for(const b of bySource.values()){
    const total=totalsByOrigin[b.origin]??=counters();
    for(const c of Object.values(b.kinds)){
      if(c.observed!==c.identityInvalid+c.structuralBlocked+c.structuralResolved||
        c.observed!==c.eligible+c.outsidePilot||
        c.eligible!==c.validRow+c.invalidRow+c.notEmitted+c.templateNoOutput||
        c.emitted!==c.stagingValid+c.stagingInvalid)bump(issues,'coverageAccountingMismatch');
      for(const [key,n] of Object.entries(c))if(typeof n==='number')total[key]+=n;
      for(const [key,n] of Object.entries(c.scopeReasons))bump(total.scopeReasons,key,n);
      for(const [key,n] of Object.entries(c.reviewCodes))bump(total.reviewCodes,key,n);
    }
  }
  const sources=[...bySource.values()].sort((a,b)=>JSON.stringify([a.origin,a.source]).localeCompare(JSON.stringify([b.origin,b.source])));
  const priority=sources.filter(s=>s.priority==='bootstrap').map(s=>{
    const gaps=Object.values(s.kinds).reduce((n,c)=>n+c.notEmitted+c.templateNoOutput,0);
    const outside=Object.values(s.kinds).reduce((n,c)=>n+c.outsidePilot,0);
    return {source:s.source,gaps,outsidePilot:outside,runtimeEntries:runtime.books.filter(b=>b.source===s.source).reduce((n,b)=>n+b.total,0)};
  }).sort((a,b)=>b.gaps-a.gaps||b.outsidePilot-a.outsidePilot||a.source.localeCompare(b.source));
  return {schemaVersion:'dnd-upstream-coverage-baseline.v1',commits:structural.commits,asOf:inventory.asOf,
    sources,totalsByOrigin,canonical,canonicalValidation,byConverter,uniquePhysicalIds:physicalIds.size,issues,
    inventoryIssueCounts:inventory.diagnostics.reduce((a,d)=>(bump(a,d.code),a),dict()),structuralIssueCounts:structural.issueCounts,
    runtime,priority,activation:'review-required',scope:'resolver-scanned top-level rows; staging validation only; not mechanical equivalence or installed user catalog'};
}
function buildBaseline(main,homebrew,{asOf,runtime,validate}){
  const collection=collect(main,homebrew);
  const structural=audit(main,homebrew,collection);
  const inventory=buildInventory(main,homebrew,asOf);
  const runs=converters.map(c=>({stage:c.stage,result:require('./'+c.module).buildPilot(main)}));
  const indexed=(folder)=>new Set(Object.values(main.readJson('data/'+folder+'/index.json')).map(p=>'data/'+folder+'/'+p));
  return reconcileCoverage({collection,structural,inventory,runs,indexPaths:{spell:indexed('spells'),monster:indexed('bestiary')},runtime,validate});
}
function publicSummary(report){
  // No source names/codes from homebrew, payloads, paths, entity names or IDs.
  return {schemaVersion:report.schemaVersion,commits:report.commits,asOf:report.asOf,totalsByOrigin:report.totalsByOrigin,
    sourceCounts:{main:report.sources.filter(s=>s.origin==='main').length,homebrew:report.sources.filter(s=>s.origin==='homebrew').length},
    canonical:report.canonical,byConverter:Object.fromEntries(Object.entries(report.byConverter).map(([k,v])=>[k,{emitted:v.emitted,stagingValid:v.stagingValid,stagingInvalid:v.stagingInvalid,diagnosticCodes:v.diagnosticCodes}])),
    uniquePhysicalIds:report.uniquePhysicalIds,issues:report.issues,inventoryIssueCounts:report.inventoryIssueCounts,structuralIssueCounts:report.structuralIssueCounts,
    runtime:{catalogVersion:report.runtime.catalogVersion,sha256:report.runtime.sha256,total:report.runtime.total,unmapped:report.runtime.books.filter(b=>b.source===null).reduce((n,b)=>n+b.total,0)},
    priority:report.priority,activation:report.activation,scope:report.scope};
}
module.exports={buildBaseline,reconcileCoverage,publicSummary,runtimeProfile,readRuntimeProfile,scopeFor};
