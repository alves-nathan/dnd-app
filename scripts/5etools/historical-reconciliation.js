'use strict';
// a7.2: identity candidates and preservation obligations, not replacement decisions.
const {collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {digest}=require('./integrated-review');
const {artifact,inspectPacks,inspectRuntime,runtimePath,publicationMap}=require('./historical-baseline');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const norm=x=>text(x)?x.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase():'';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const push=(m,k,v)=>{const a=m.get(k)||[];a.push(v);m.set(k,a);};
const simple=new Set(['class','species','background','feat','weapon','armor','equipment','magicItem','spell','condition','creatureStatBlock']);
const rawKinds={class:['class'],species:['race','subrace'],background:['background'],feat:['feat'],feature:['classFeature','subclassFeature','optionalfeature'],subclass:['subclass'],spell:['spell'],condition:['condition'],creatureStatBlock:['monster'],weapon:['item','baseitem'],armor:['item','baseitem'],equipment:['item','baseitem'],magicItem:['item','magicvariant']};
const key=(kind,source,name)=>JSON.stringify([kind,source,norm(name)]);
const knownEra=x=>['2014','2024'].includes(x);
const codesFor=(id,runtime=false)=>runtime&&!['phb-2024','dmg-2024','mm-2025'].includes(id)?[]:own(publicationMap,id)?publicationMap[id]:[];
function buildIndex(items,records){
  const emitted=new Map(),raw=new Map(),byId=new Map();
  for(const i of items){
    if(i.provenance?.origin!=='5etools')continue;
    if(byId.has(i.id))throw Error('duplicateUpstreamId');
    byId.set(i.id,i);push(emitted,key(i.kind,i.provenance.sourceCode,i.name),i);
  }
  for(const r of records)if(r.origin==='main'&&text(r.entity?.name)&&text(r.entity?.source))push(raw,key(r.kind,r.entity.source,r.entity.name),r);
  return {emitted,raw,byId};
}
function comparePayload(a,b){
  if(!rec(a)||!rec(b))return {status:'payloadNotAvailable'};
  const old=Object.keys(a).sort(),next=Object.keys(b).sort(),same=[],changed=[],missing=[],added=[];
  for(const k of old)if(!own(b,k))missing.push(k);else if(digest(a[k])===digest(b[k]))same.push(k);else changed.push(k);
  for(const k of next)if(!own(a,k))added.push(k);
  return {status:digest(a)===digest(b)?'exactPayloadFingerprint':'payloadDifferences',same,changed,missing,added,
    historicalFingerprint:digest(a),upstreamFingerprint:digest(b)};
}
// No slug, fuzzy, translated-name, edition fallback or reprint selection.
function matchIdentity(row,index,{runtime=false,ownerTargets}={}){
  const codes=codesFor(row.sourceId,runtime);
  const kind=runtime&&['classFeature','subclassFeature'].includes(row.kind)?'feature':row.kind;
  if(!codes.length)return {status:'sourceMappingPending'};
  if(!simple.has(kind)&&!['feature','subclass'].includes(kind))return {status:'runtimeContractOutsideV3'};
  if(!norm(row.name))return {status:'nameMissing'};
  const candidates=codes.flatMap(c=>index.emitted.get(key(kind,c,row.name))||[]);
  let matches=candidates;
  if(kind==='subclass'||kind==='feature'){
    if(runtime)return {status:'runtimeOwnerContextPending',candidateIds:candidates.map(i=>i.id)};
    const p=row.payload||{};
    // Features without explicit owner and level cannot be distinguished by name.
    if(!text(p.classId)||!ownerTargets?.has(p.classId))return {status:'ownerMappingPending',candidateIds:candidates.map(i=>i.id)};
    const classId=ownerTargets.get(p.classId);
    if(kind==='subclass')matches=candidates.filter(i=>i.payload.classId===classId);
    else{
      if(!Number.isInteger(p.levelGained)||p.levelGained<1||p.levelGained>20)return {status:'featureLevelPending',candidateIds:candidates.map(i=>i.id)};
      if(p.subclassId!==undefined&&!ownerTargets.has(p.subclassId))return {status:'ownerMappingPending',candidateIds:candidates.map(i=>i.id)};
      const subclassId=p.subclassId===undefined?undefined:ownerTargets.get(p.subclassId);
      matches=candidates.filter(i=>i.payload.classId===classId&&i.payload.subclassId===subclassId&&i.payload.levelGained===p.levelGained);
    }
    if(candidates.length&&!matches.length)return {status:'ownerOrLevelMismatch',candidateIds:candidates.map(i=>i.id)};
  }
  if(!matches.length){
    const raw=codes.flatMap(c=>(rawKinds[kind]||[]).flatMap(k=>index.raw.get(key(k,c,row.name))||[]));
    return {status:raw.length?'rawNameCandidateNotEmitted':'noQualifiedNameCandidate',rawCandidateCount:raw.length};
  }
  if(matches.length!==1)return {status:'ambiguousIdentity',candidateIds:matches.map(i=>i.id).sort()};
  const t=matches[0];
  if(knownEra(row.rulesEra)&&knownEra(t.source.rulesEra)&&row.rulesEra!==t.source.rulesEra)return {status:'eraMismatch',candidateIds:[t.id]};
  return {status:'identityCandidate',targetId:t.id,targetFingerprint:digest(t),eraStatus:knownEra(row.rulesEra)&&knownEra(t.source.rulesEra)?'sameKnownEra':'editionReviewRequired',
    comparison:comparePayload(row.payload,t.payload)};
}
function reconcile({historical,runtime,rawHistorical,rawRuntime,items,records,commits}){
  const index=buildIndex(items,records),issues=dict(),rows=[],runtimeRows=[],ownerTargets=new Map(),ownerChoices=new Map();
  const rawAt=new Map(rawHistorical.map(x=>[JSON.stringify([x.path,x.index]),x.item]));
  const sourceRows=historical.rows.map(r=>{
    const i=rawAt.get(JSON.stringify([r.path,r.index]));
    if(!i||digest(i)!==r.itemHash){bump(issues,'historicalFingerprintMismatch');return {...r,name:null};}
    return {...r,name:i.name,payload:i.payload};
  });
  // Resolve owners from all occurrences, requiring agreement across variants.
  for(const kind of ['class','subclass']){
    const groups=new Map();for(const row of sourceRows.filter(r=>r.kind===kind))push(groups,row.id,matchIdentity(row,index,{ownerTargets}));
    for(const [id,results] of groups){
      const ids=new Set(results.map(x=>x.targetId));
      if(ids.size===1&&!ids.has(undefined)&&results.every(x=>x.status==='identityCandidate'))ownerTargets.set(id,results[0].targetId);
      ownerChoices.set(id,results.length);
    }
  }
  const add=(domain,row,m)=>{
    const fingerprint=digest({domain,commits,origin:row.path===undefined?row.id:[row.path,row.index],sourceFingerprint:row.itemHash||row.fingerprint,...m});
    return {domain,id:row.id,kind:row.kind,sourceId:row.sourceId??row.book??null,...(row.path!==undefined?{path:row.path,index:row.index}:{}),sourceFingerprint:row.itemHash||row.fingerprint,
      ...m,evidenceId:'migration:'+fingerprint,fingerprint,decision:'unreviewed',preservation:'required',activation:'review-required'};
  };
  for(const r of sourceRows)rows.push(add('historical',r,matchIdentity(r,index,{ownerTargets})));
  const actualRuntime=new Map(rawRuntime.map(i=>[i.entityId,i]));
  for(const r of runtime.entries){
    const i=actualRuntime.get(r.id);
    if(!i||digest(i)!==r.fingerprint)bump(issues,'runtimeFingerprintMismatch');
    const m=matchIdentity({...r,name:i?.displayName,sourceId:r.book},index,{runtime:true});
    runtimeRows.push({...add('runtime',r,m),registryFingerprint:r.registryFingerprint});
  }
  // Repeated historical IDs may carry different payloads; never select one.
  const byHistoricalId=new Map();for(const row of rows)push(byHistoricalId,row.id,row);
  const groups=[...byHistoricalId].map(([id,rs])=>{
    const targets=[...new Set(rs.map(r=>r.targetId).filter(Boolean))].sort();
    return {id,occurrences:rs.length,targetIds:targets,status:targets.length===1&&rs.every(r=>r.targetId===targets[0])?'consistentIdentityCandidate':'preserveIdentityVariants',preservation:'required'};
  });
  const mappedRuntime=new Map(runtimeRows.filter(r=>r.status==='identityCandidate').map(r=>[r.id,r.targetId]));
  // The existence of two mapped endpoints is not evidence that the old relation survives.
  const deps=runtime.dependencies.map(e=>({...e,statusOriginal:e.status,mappingStatus:mappedRuntime.has(e.fromId)&&mappedRuntime.has(e.toId)?'bothEndpointsCandidate':'endpointMappingPending',
    fromCandidate:mappedRuntime.get(e.fromId),toCandidate:mappedRuntime.get(e.toId),preservation:'required'}));
  const aliases=runtime.aliases.map(a=>({...a,statusOriginal:a.status,mappingStatus:mappedRuntime.has(a.from)&&mappedRuntime.has(a.to)?'bothEndpointsCandidate':'endpointOrAliasSemanticsPending',
    fromCandidate:mappedRuntime.get(a.from),toCandidate:mappedRuntime.get(a.to),preservation:'required'}));
  const categories=runtime.categories.map(c=>({...c,mappedMembers:(c.memberIds||[]).filter(id=>mappedRuntime.has(id)).length,preservation:'required'}));
  // Also inventory known physical reference fields in legacy payloads. Not recursive
  // arbitrary strings: selectors and grants with richer schemas remain pending.
  const legacyLinks=[];
  for(const r of sourceRows){
    const p=r.payload||{};
    for(const k of ['classId','subclassId','speciesId'])if(text(p[k]))legacyLinks.push({fromId:r.id,path:r.path,index:r.index,field:k,toId:p[k],status:byHistoricalId.has(p[k])?'historicalEndpointObserved':'historicalEndpointPending',preservation:'required'});
    for(const k of ['classIds','featureIds','featIds'])if(Array.isArray(p[k]))for(const id of p[k])if(text(id))legacyLinks.push({fromId:r.id,path:r.path,index:r.index,field:k,toId:id,status:byHistoricalId.has(id)?'historicalEndpointObserved':'historicalEndpointPending',preservation:'required'});
    if(Array.isArray(p.progression))for(const step of p.progression)if(Array.isArray(step?.featureIds))for(const id of step.featureIds)if(text(id))legacyLinks.push({fromId:r.id,path:r.path,index:r.index,field:'progression.featureIds',toId:id,status:byHistoricalId.has(id)?'historicalEndpointObserved':'historicalEndpointPending',preservation:'required'});
  }
  const bootstrapKeys=new Set(historical.bootstrapRows.map(r=>JSON.stringify([r.path,r.index])));
  const count=(rs,k='status')=>rs.reduce((a,r)=>(bump(a,r[k]||'unknown'),a),dict());
  const boot=rows.filter(r=>bootstrapKeys.has(JSON.stringify([r.path,r.index])));
  const fieldCounts=dict();for(const r of rows)if(r.comparison)for(const k of ['same','changed','missing','added'])bump(fieldCounts,k,r.comparison[k]?.length||0);
  if(rows.length!==historical.rows.length||runtimeRows.length!==runtime.entries.length||boot.length!==historical.bootstrapRows.length)bump(issues,'rowAccountingMismatch');
  if(new Set([...rows,...runtimeRows].map(r=>r.evidenceId)).size!==rows.length+runtimeRows.length)bump(issues,'duplicateEvidenceId');
  return {schemaVersion:'dnd-upstream-historical-reconciliation.v1',commits,summary:{historicalOccurrences:rows.length,historicalIds:groups.length,bootstrap:boot.length,runtime:runtimeRows.length,
    historicalStatus:count(rows),bootstrapStatus:count(boot),runtimeStatus:count(runtimeRows),historicalIdStatus:count(groups),payloadComparison:count(rows.filter(r=>r.comparison).map(r=>r.comparison)),fieldCounts,
    runtimeDependencies:deps.length,dependencyStatus:count(deps,'mappingStatus'),runtimeAliases:aliases.length,aliasStatus:count(aliases,'mappingStatus'),runtimeCategories:categories.length,
    legacyLinks:legacyLinks.length,legacyLinkStatus:count(legacyLinks),ownerCandidates:ownerTargets.size,issues,approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false},
    historical:rows,runtime:runtimeRows,historicalGroups:groups,dependencies:deps,aliases,categories,legacyLinks,activation:'review-required',
    scope:'identity candidates only; preserve all historical occurrences, runtime contracts, edges and aliases; no mechanical equivalence or retirement'};
}
function buildReconciliation(main,homebrew,snapshot,{bundled,parse,detect,loadRuntime,onEvidenceInputs}){
  const historical=inspectPacks(snapshot,{bundled,parse,detect}),a=artifact(snapshot,runtimePath),runtime=inspectRuntime(a,loadRuntime);
  const rawHistorical=historical.files.flatMap(f=>artifact(snapshot,f.path).value.items.map((item,index)=>({path:f.path,index,item})));
  const records=collect(main,homebrew).records,items=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const out=reconcile({historical,runtime,rawHistorical,rawRuntime:a.value.runtimeIndex.entries,items,records,commits:{application:snapshot.commit,main:main.commit,homebrew:homebrew.commit}});
  for(const [domain,s] of [['historical',historical.summary],['runtime',runtime.summary]])for(const [k,n] of Object.entries(s.issues))bump(out.summary.issues,domain+':'+k,n);
  if(onEvidenceInputs)onEvidenceInputs({reconciliation:out,rawHistorical,items,runtimeBundle:a.value});
  return out;
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={buildIndex,comparePayload,matchIdentity,reconcile,buildReconciliation,publicSummary};
