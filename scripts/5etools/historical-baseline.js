'use strict';
// a7.1: immutable historical baseline. No name matching, equivalence, writes or migration.
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {collect}=require('./resolver');
const {buildInventory}=require('./inventory');
const {converters}=require('./pilot-coverage');
const {digest}=require('./integrated-review');
const {runtimeProfile}=require('./coverage-baseline');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const sha=b=>createHash('sha256').update(b).digest('hex');
const push=(m,k,v)=>{const a=m.get(k)||[];a.push(v);m.set(k,a);};
const V1='dnd-combat-import.v1',V2='dnd-combat-import.v2',V3='dnd-combat-import.v3';
const runtimePath='assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json';
// Evidence: bundledCompendium.ts, runtime-integration-report.json,
// docs/5ETOOLS_LEGACY_CUTOVER.md. Book-level only; not item mapping.
const publicationMap=Object.freeze({
  'phb':['XPHB'],'phb-2024':['XPHB'],'phb-2014':['PHB'],
  'mm-2024':['XMM'],'mm-2025':['XMM'],'dmg-2024':['XDMG'],
  'forge-artificer-2025':['EFA'],'spelljammer-2022':['AAG','BAM','LoX'],'tcoe-2020':['TCE']
});
const expectedBootstrap=Object.freeze({
  'phb-2024-full-consolidated-import-pack-v5-complete-invocations':1284,
  'mm-2024-runtime-dependency-delta-v1':2,
  'forge-artificer-2025-full-consolidated-import-pack-v1':200,
  'spelljammer-2022-full-consolidated-import-pack-v1':182,
  'tcoe-2020-2024-compatible-import-pack-v2':273,
  'phb-2014-2024-compatible-delta-v1':56
});
const trackedPath=p=>/^(?:assets\/compendium\/|artifacts\/compendium\/).+\.json$/.test(p);
function openHistoricalSnapshot(root,ref='HEAD'){
  if(typeof ref!=='string'||!ref||ref.startsWith('-'))throw Error('invalidHistoricalRef');
  const git=(args)=>execFileSync('git',['-C',root,...args],{maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
  const commit=git(['rev-parse','--verify',ref+'^{commit}']).toString('utf8').trim(),files=new Map();
  for(const entry of git(['ls-tree','-r','-z',commit]).toString('utf8').split('\0').filter(Boolean)){
    const tab=entry.indexOf('\t'),[mode,type,blob]=entry.slice(0,tab).split(' '),path=entry.slice(tab+1);
    if(type==='blob'&&mode!=='120000'&&(trackedPath(path)||path===runtimePath||path.endsWith('.sha256')&&trackedPath(path.slice(0,-7))||path===runtimePath+'.sha256'))files.set(path,blob);
  }
  return {commit,files,read(path){if(!files.has(path))throw Error('untrackedHistoricalPath');return git(['show',commit+':'+path]);}};
}
function artifact(snapshot,path){
  const bytes=snapshot.read(path),hash=sha(bytes);
  const checksumPath=path+'.sha256';
  let checksum='notDeclared';
  if(snapshot.files.has(checksumPath)){
    const expected=snapshot.read(checksumPath).toString('utf8').trim().split(/\s+/)[0];
    checksum=expected===hash?'verified':'mismatch';
  }
  return {path,blob:snapshot.files.get(path),sha256:hash,checksum,bytes:bytes.length,value:JSON.parse(bytes.toString('utf8'))};
}
function envelopeVersion(v){
  if(!rec(v)||!text(v.id)||!Array.isArray(v.items)||!rec(v.source))return null;
  if([V1,V2,V3].includes(v.templateVersion))return v.templateVersion;
  return typeof v.templateVersion==='string'?'unknown':'legacy-unversioned';
}
function summarizeRows(rows){
  const byKind=dict(),bySource=dict(),byEra=dict(),byStatus=dict(),fields=dict();
  for(const r of rows){
    bump(byKind,r.kind);bump(bySource,r.sourceId||'(unknown)');bump(byEra,r.rulesEra||'unknown');bump(byStatus,r.sourceStatus||'unknown');
    for(const f of r.payloadFields)bump(fields[r.kind]??=dict(),f);
  }
  return {count:rows.length,byKind,bySource,byEra,byStatus,payloadFields:fields};
}
function itemRow(i,path,index){
  if(!rec(i)||!text(i.id)||!text(i.kind)||!text(i.name)||!rec(i.source)||!rec(i.payload))return null;
  return {path,index,id:i.id,kind:i.kind,sourceId:text(i.source.id)?i.source.id:null,rulesEra:i.source.rulesEra||null,sourceStatus:i.source.status||null,
    itemHash:digest(i),payloadHash:digest(i.payload),payloadFields:Object.keys(i.payload).sort(),metadataFields:Object.keys(i.metadata||{}).sort(),
    // Keep exact ids/fingerprints and field names only; do not duplicate historical text.
    migrationState:'preservePending',activation:'review-required'};
}
function inspectPacks(snapshot,{bundled,parse,detect}){
  if(!Array.isArray(bundled)||typeof parse!=='function'||typeof detect!=='function')throw Error('historicalAdaptersRequired');
  const definitions=new Map(),issues=dict(),files=[],rows=[],byPath=new Map(),bootIds=new Map(),versions=dict(),groups=new Map(),nonPacks=0;
  for(const b of bundled){
    const path='assets/compendium/'+b.fileName;
    if(definitions.has(path))bump(issues,'duplicateBootstrapPath');
    definitions.set(path,{id:b.id,sourceId:b.sourceId,importFormat:b.importFormat,predecessorPackIds:b.predecessorPackIds||[]});
  }
  for(const path of [...snapshot.files.keys()].filter(trackedPath).sort()){
    let a;try{a=artifact(snapshot,path);}catch{bump(issues,'unreadableHistoricalJson');continue;}
    const version=envelopeVersion(a.value),b=definitions.get(path);
    if(!version){nonPacks++;if(b)bump(issues,'bootstrapEnvelopeMissing');continue;}
    if(a.checksum==='mismatch')bump(issues,'historicalChecksumMismatch');
    const v=a.value,detected=detect(v);
    const rawRows=v.items.map((i,n)=>itemRow(i,path,n)),validRows=rawRows.filter(Boolean),ids=new Set(validRows.map(i=>i.id));
    const parsed=parse(v,{validateSemantics:false});
    const normalized=Array.isArray(parsed.data?.items)?parsed.data.items:[];
    const normalizedIds=new Set(normalized.map(i=>i.id)),rawById=new Map(),normalizedById=new Map(),normalizationChanges=dict();
    for(const row of validRows)push(rawById,row.id,row);
    for(const i of normalized)push(normalizedById,i.id,i);
    for(const row of validRows){
      const matches=normalizedById.get(row.id)||[];
      if(rawById.get(row.id).length!==1||matches.length>1){row.normalizationState='ambiguousIdentity';}
      else if(!matches.length){row.normalizationState='notNormalized';}
      else{
        const i=matches[0];row.normalizedItemHash=digest(i);row.normalizedPayloadHash=digest(i.payload);
        row.normalizedPayloadFields=Object.keys(i.payload||{}).sort();
        row.normalizationState=row.normalizedItemHash===row.itemHash?'unchanged':row.normalizedPayloadHash===row.payloadHash?'envelopeOrSourceChanged':'payloadChanged';
      }
      bump(normalizationChanges,row.normalizationState);
    }
    const rawIdsLost=[...ids].filter(id=>!normalizedIds.has(id)),normalizedIdsAdded=[...normalizedIds].filter(id=>!ids.has(id));
    const normalizationCodes=dict();for(const issue of parsed.issues||[])bump(normalizationCodes,issue.severity+':'+issue.code);
    const formatAgreement=version===V3?detected==='unknown':detected===version;
    if(!formatAgreement)bump(issues,'detectorDisagreement');
    const f={path,blob:a.blob,sha256:a.sha256,checksum:a.checksum,bytes:a.bytes,packId:v.id,version,detected,bootstrap:!!b,sourceId:v.source.id||null,
      predecessorPackIds:b?.predecessorPackIds||[],rawCount:v.items.length,invalidRows:rawRows.length-validRows.length,uniqueIds:ids.size,
      duplicateIds:validRows.length-ids.size,parserValid:parsed.ok===true,normalizedCount:normalized.length,normalizedIdsLost:rawIdsLost,
      normalizedIdsAdded,normalizationCodes,normalizationChanges,summary:summarizeRows(validRows),migrationState:'preservePending'};
    if(b){
      if(v.id!==b.id||version!==V2||b.importFormat!=='v2'||v.source.id!==b.sourceId)bump(issues,'bootstrapManifestMismatch');
      if(own(expectedBootstrap,b.id)&&expectedBootstrap[b.id]!==v.items.length)bump(issues,'bootstrapCountDrift');
      if(f.invalidRows||f.duplicateIds||!f.parserValid||rawIdsLost.length||normalizedIdsAdded.length||normalized.length!==v.items.length)bump(issues,'bootstrapParserOrIdentityMismatch');
      for(const row of validRows){
        if(bootIds.has(row.id))bump(issues,'duplicateBootstrapEntityId');else bootIds.set(row.id,row);
      }
    }
    files.push(f);byPath.set(path,f);bump(versions,version);rows.push(...validRows);
    push(groups,v.id,f);
  }
  for(const p of definitions.keys())if(!byPath.has(p))bump(issues,'missingBootstrapFile');
  const packGroups=[...groups].map(([packId,fs])=>({packId,paths:fs.map(f=>f.path),byteVariants:new Set(fs.map(f=>f.sha256)).size,
    versions:[...new Set(fs.map(f=>f.version))],bootstrap:fs.some(f=>f.bootstrap)}));
  const byId=new Map();for(const row of rows)push(byId,row.id,row);
  const overlap={historicalOccurrences:rows.length,uniqueHistoricalIds:byId.size,duplicateOccurrences:rows.length-byId.size,
    multiPayloadIds:[...byId.values()].filter(a=>new Set(a.map(x=>x.payloadHash)).size>1).length,
    historicalIdsOutsideBootstrap:[...byId.keys()].filter(id=>!bootIds.has(id)).length};
  return {files,rows,packGroups,bootstrapRows:[...bootIds.values()],summary:{files:files.length,nonPackJson:nonPacks,versions,
    bootstrapPacks:files.filter(f=>f.bootstrap).length,bootstrap:summarizeRows([...bootIds.values()]),historical:summarizeRows(rows),overlap,
    packIdGroups:groups.size,byteIdenticalCopies:files.length-new Set(files.map(f=>f.sha256)).size,
    parserInvalidFiles:files.filter(f=>!f.parserValid).length,normalizationChanges:files.reduce((a,f)=>{for(const [k,n] of Object.entries(f.normalizationChanges))bump(a,k,n);return a;},dict()),checksumCounts:files.reduce((a,f)=>(bump(a,f.checksum),a),dict()),issues}};
}
function inspectRuntime(bundleArtifact,loadRuntime){
  if(typeof loadRuntime!=='function')throw Error('runtimeValidatorRequired');
  const b=bundleArtifact.value,issues=dict();
  if(bundleArtifact.checksum!=='verified')bump(issues,'runtimeChecksumMismatch');
  const profile=runtimeProfile(b,bundleArtifact.sha256);
  const loaded=loadRuntime(b);
  if(loaded?.validation?.status!=='passed')bump(issues,'runtimeLoaderInvalid');
  const entries=b.runtimeIndex.entries,registry=b.entityRegistry.entries,dependencies=b.dependencyGraph.edges,aliases=b.aliases.entities,categories=b.contentCategories.entities;
  const registryById=new Map(registry.map(i=>[i.entityId,i])),entryIds=new Set(entries.map(i=>i.entityId)),relationCounts=dict(),aliasCounts=dict(),statusCounts=dict(),runtimeKinds=dict(),categoryCounts=dict();
  for(const e of entries){
    bump(runtimeKinds,e.kind);bump(statusCounts,e.status);
    const r=registryById.get(e.entityId);
    if(!r||r.kind!==e.kind||r.sourceBookId!==e.sourceBookId)bump(issues,'runtimeRegistryMetadataMismatch');
  }
  for(const e of dependencies)bump(relationCounts,JSON.stringify([e.relation,e.strength,e.status,e.resolutionPolicy]));
  for(const a of aliases)bump(aliasCounts,JSON.stringify([a.kind,a.relation,a.status,a.resolutionPolicy]));
  for(const c of categories)bump(categoryCounts,c.status);
  if(entryIds.size!==entries.length||registryById.size!==registry.length||entryIds.size!==registryById.size)bump(issues,'runtimeIdentityMismatch');
  return {profile,entries:entries.map(e=>({id:e.entityId,kind:e.kind,book:e.sourceBookId,categoryIds:e.categoryIds,status:e.status,defaultEnabled:e.defaultEnabled,
    manualReviewRequired:e.manualReviewRequired,fingerprint:digest(e),registryFingerprint:digest(registryById.get(e.entityId)??null),migrationState:'preservePending'})),
    dependencies:dependencies.map(e=>({id:e.id,fromId:e.fromId,toId:e.toId,relation:e.relation,strength:e.strength,status:e.status,resolutionPolicy:e.resolutionPolicy,crossBook:e.crossBook,fingerprint:digest(e)})),
    aliases:aliases.map(a=>({id:a.id,from:a.from,to:a.to,kind:a.kind,relation:a.relation,resolutionPolicy:a.resolutionPolicy,status:a.status,fingerprint:digest(a)})),
    categories:categories.map(c=>({id:c.id,book:c.sourceBookId,memberIds:c.memberEntityIds,fingerprint:digest(c)})),
    summary:{version:b.catalogVersion,sha256:bundleArtifact.sha256,entries:entries.length,registry:registry.length,dependencies:dependencies.length,aliases:aliases.length,categories:categories.length,
      byKind:runtimeKinds,byStatus:statusCounts,byBook:profile.books,relationCounts,aliasCounts,categoryCounts,loaderValid:loaded?.validation?.status==='passed',issues}};
}
function publicationBaseline({historical,runtime,inventory,records,items}){
  const mainCodes=new Set(inventory.sources.filter(s=>s.origin==='main').map(s=>s.code)),brewCodes=new Set(inventory.sources.filter(s=>s.origin==='homebrew').map(s=>s.code));
  for(const r of records)if(r.origin==='main'&&text(r.entity?.source))mainCodes.add(r.entity.source);
  const upstreamByCode=new Map(),bySource=new Map();
  for(const i of items){const c=i.provenance.sourceCode;if(!upstreamByCode.has(c))upstreamByCode.set(c,{count:0,kinds:dict()});const g=upstreamByCode.get(c);g.count++;bump(g.kinds,i.kind);}
  function register(domain,id,kind){
    const key=JSON.stringify([domain,id]),g=bySource.get(key)||{domain,sourceId:id,count:0,kinds:dict()};
    g.count++;bump(g.kinds,kind);bySource.set(key,g);
  }
  for(const r of historical.rows)register('historicalOccurrences',r.sourceId,r.kind);
  for(const r of historical.bootstrapRows)register('bootstrap',r.sourceId,r.kind);
  for(const r of runtime.entries)register('runtime',r.book,r.kind);
  const sources=[...bySource.values()].map(g=>{
    // Runtime uses only the documented runtime book ids; source id PHB is not interchangeable.
    const allowed=g.domain==='runtime'?['phb-2024','dmg-2024','mm-2025'].includes(g.sourceId):own(publicationMap,g.sourceId);
    const codes=allowed?publicationMap[g.sourceId]:[];
    return {...g,codes,status:!codes.length?'sourceMappingPending':codes.every(c=>mainCodes.has(c))?'mainPublicationCandidate':'publicationNotObserved',
      upstream:codes.map(code=>({code,mainObserved:mainCodes.has(code),homebrewCodeObserved:brewCodes.has(code),emitted:upstreamByCode.get(code)?.count||0,kinds:upstreamByCode.get(code)?.kinds||{}})),
      equivalence:'notEstablished',migrationState:'preservePending'};
  });
  const sourceStatus=dict();for(const s of sources)bump(sourceStatus[s.domain]??=dict(),s.status,s.count);
  const bootstrapIds=new Set(historical.bootstrapRows.map(r=>r.id)),runtimeIds=new Set(runtime.entries.map(e=>e.id)),upstreamIds=new Set(items.map(i=>i.id));
  const intersection=(a,b)=>[...a].filter(id=>b.has(id)).length;
  return {sources,summary:{sourceStatus,upstreamItems:items.length,bootstrapRuntimeExactIdOverlap:intersection(bootstrapIds,runtimeIds),
    bootstrapUpstreamExactIdOverlap:intersection(bootstrapIds,upstreamIds),runtimeUpstreamExactIdOverlap:intersection(runtimeIds,upstreamIds),
    sourceRows:sources.length,identityMappingsApproved:0,equivalenceEstablished:0,retirementAuthorized:false}};
}
function buildHistoricalBaseline(main,homebrew,historicalSnapshot,{bundled,parse,detect,loadRuntime,asOf=new Date().toISOString().slice(0,10)}={}){
  const historical=inspectPacks(historicalSnapshot,{bundled,parse,detect});
  const runtime=inspectRuntime(artifact(historicalSnapshot,runtimePath),loadRuntime);
  const inventory=buildInventory(main,homebrew,asOf),{records}=collect(main,homebrew);
  const items=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const comparison=publicationBaseline({historical,runtime,inventory,records,items});
  const issues=dict();
  for(const [domain,s] of [['historical',historical.summary],['runtime',runtime.summary]])for(const [k,n] of Object.entries(s.issues))bump(issues,domain+':'+k,n);
  return {schemaVersion:'dnd-upstream-historical-baseline.v1',commits:{application:historicalSnapshot.commit,main:main.commit,homebrew:homebrew.commit},
    summary:{historical:historical.summary,runtime:runtime.summary,comparison:comparison.summary,issues,localInstallations:'notInspected',externalHistoricalArtifacts:'notInspected',retirementAuthorized:false},
    historical,runtime,comparison,activation:'review-required',scope:'tracked application packs and bundled runtime index; publication candidates and exact ID counts only; no mappings or retirement'};
}
function publicSummary(r){
  // No raw ids, text, source titles, external data or dynamic field names in CI.
  const h=r.summary.historical,rt=r.summary.runtime;
  const compact=s=>({count:s.count,byKind:s.byKind,byEra:s.byEra,byStatus:s.byStatus});
  return {schemaVersion:r.schemaVersion,commits:r.commits,summary:{historical:{files:h.files,nonPackJson:h.nonPackJson,versions:h.versions,bootstrapPacks:h.bootstrapPacks,
    bootstrap:compact(h.bootstrap),historical:compact(h.historical),overlap:h.overlap,packIdGroups:h.packIdGroups,byteIdenticalCopies:h.byteIdenticalCopies,
    parserInvalidFiles:h.parserInvalidFiles,normalizationChanges:h.normalizationChanges,checksumCounts:h.checksumCounts,issues:h.issues},
    runtime:{version:rt.version,sha256:rt.sha256,entries:rt.entries,registry:rt.registry,dependencies:rt.dependencies,aliases:rt.aliases,categories:rt.categories,
      byKind:rt.byKind,byStatus:rt.byStatus,loaderValid:rt.loaderValid,issues:rt.issues},
    comparison:r.summary.comparison,issues:r.summary.issues,localInstallations:r.summary.localInstallations,externalHistoricalArtifacts:r.summary.externalHistoricalArtifacts,
    retirementAuthorized:false},activation:r.activation,scope:r.scope};
}
module.exports={publicationMap,runtimePath,openHistoricalSnapshot,artifact,envelopeVersion,inspectPacks,inspectRuntime,publicationBaseline,buildHistoricalBaseline,publicSummary};
