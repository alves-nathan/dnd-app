'use strict';
// Expand spell/monster conversion without changing historical pilot baselines.
const {identity}=require('./resolver');
const {createFunctionalResolver,expandFunctionalVersions}=require('./functional-resolver');
const {readMainPublications,projectMainSource}=require('./functional-main-source');
const spell=require('./spell-converter'),creature=require('./creature-converter');
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const clone=v=>JSON.parse(JSON.stringify(v));
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const specs={spell:{folder:'spells',prefix:'spells-',stage:'a5.1',suffix:'spells'},monster:{folder:'bestiary',prefix:'bestiary-',stage:'a5.2',suffix:'creatures'}};
function allExplicitAccess(e,lookup){
 const entry=lookup[norm(e.source)]?.[norm(e.name)];
 if(!rec(entry)||!rec(entry.class))throw Object.assign(Error('missingClassAccess'),{code:'missingClassAccess'});
 const direct=[];
 for(const source of Object.keys(entry.class).sort(cmp)){
  const group=entry.class[source];if(!rec(group)||!source.trim())continue;
  for(const name of Object.keys(group).sort(cmp)){
   const details=group[name];
   if(name.trim()&&(details===true||rec(details)))direct.push({name,source,details:clone(details)});
  }
 }
 if(!direct.length)throw Object.assign(Error('missingEligibleClassAccess'),{code:'missingEligibleClassAccess'});
 return {classes:[...new Set(direct.map(x=>x.name))].sort(cmp),direct,all:clone(entry)};
}
function buildFunctionalIndexed(snapshot,kind,codes,authorizeVersion){
 const spec=specs[kind];
 if(!spec||!Array.isArray(codes)||new Set(codes).size!==codes.length||codes.some(c=>typeof c!=='string'||!c.trim()))throw Error('functionalIndexedSelectionInvalid');
 const counts=Object.create(null),diagnostics=[],records=[],packs=[];
 if(!codes.length)return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
 const prefix='data/'+spec.folder+'/',index=snapshot.readJson(prefix+'index.json');
 if(!rec(index))throw Error('functionalIndexedIndexInvalid');
 const paths=new Set();
 for(const f of Object.values(index)){
  if(typeof f!=='string'||! /^[A-Za-z0-9_-]+\.json$/.test(f)||!snapshot.files.has(prefix+f))throw Error('functionalIndexedPathInvalid');
  paths.add(prefix+f);
 }
 for(const p of snapshot.files.keys())if(p.startsWith(prefix+spec.prefix)&&/^[^/]+\.json$/.test(p.slice(prefix.length)))paths.add(p);
 const publications=readMainPublications(snapshot);
 const lookup=kind==='spell'?snapshot.readJson('data/generated/gendata-spell-source-lookup.json'):null;
 if(kind==='spell'&&!rec(lookup))throw Error('functionalSpellLookupInvalid');
 for(const code of codes)counts[code]={total:0,converted:0,blocked:0,blockCodes:Object.create(null)};
 const block=(code,path,index,reason)=>{counts[code].blocked++;bump(counts[code].blockCodes,reason);diagnostics.push({source:code,kind,path,index,code:reason});};
 for(const path of [...paths].sort(cmp)){
  const data=snapshot.readJson(path);
  if(!Array.isArray(data?.[kind]))throw Error('functionalIndexedCollectionInvalid');
  for(const [index,e] of data[kind].entries()){
   const selected=rec(e)&&Object.hasOwn(counts,e.source);
   if(selected)counts[e.source].total++;
   try{
    const key=identity(kind,e);
    records.push({id:JSON.stringify(['main',key]),key,kind,origin:'main',path,index,blob:snapshot.files.get(path),entity:e});
   }catch(err){if(selected)block(e.source,path,index,err.code||'invalidIdentity');}
  }
 }
 const resolver=createFunctionalResolver(snapshot,records),bySource=new Map(),existingKeys=new Set(records.map(r=>r.id));
 for(const r of records)if(Object.hasOwn(counts,r.entity.source)){
  const list=bySource.get(r.entity.source)||[];list.push(r);bySource.set(r.entity.source,list);
 }
 const groups=new Map(),variants=[];
 const group=code=>{if(!groups.has(code))groups.set(code,[]);return groups.get(code);};
 {
  const convert=(r,resolved,version)=>{
   const e=resolved.entity;
   const code=e.source,pilotEra=kind==='spell'?spell.pilot[code]?.era:creature.pilot[code];
   if(!version&&e.source!==r.entity.source)throw Object.assign(Error('sourceMismatch'),{code:'sourceMismatch'});
   const {source,notes,editionEvidence}=projectMainSource(code,publications,e,pilotEra);
   let item;
   if(kind==='spell'){
    const policy=spell.pilot[code];
    const usePilot=policy&&policy.era!=='unknown'&&source.rulesEra===policy.era;
    const access=usePilot?undefined:allExplicitAccess(e,lookup);
    item=spell.convertSpell(r,resolved,lookup,source,policy??{era:source.rulesEra,classSources:[]},snapshot.commit,access);
    if(access)notes.push('classIdsPending','classAccessEditionPending',...(Object.keys(access.all).some(k=>k!=='class')?['additionalAccessPending']:[]));
    item.payload.mechanics.upstreamSpellRecord=clone(e);
   }else item=creature.convertCreature(r,resolved,source,snapshot.commit).item;
   if(resolved.templateLineage?.length){
    item.metadata.externalTemplateLineage=clone(resolved.templateLineage);
    notes.push('externalTemplateSemanticsPending');
   }
   if(resolved.versions?.length){
    item.payload.mechanics.upstreamVersionContainer=clone(resolved.versions);
    notes.push('versionContainerReviewPending');
   }
   if(version){
    item.metadata.versionOrigin={parentKey:r.key,versionKey:version.key,containerIndex:version.containerIndex,implementation:version.implementation,specFingerprint:version.specFingerprint};
    notes.push('versionSemanticsPending');
   }
   item.metadata.sourceEditionEvidence=editionEvidence;
   item.metadata.reviewCodes=[...new Set([...item.metadata.reviewCodes,...notes])].sort(cmp);
   return item;
  };
  const versionBlock=(r,v,reason)=>{
   const code=r.entity.source,c=counts[code];
   c.versionsBlocked++;bump(c.blockCodes,reason);
   diagnostics.push({source:code,kind,path:r.path,index:r.index,code:reason,version:{containerIndex:v.containerIndex,implementation:v.implementation}});
  };
  for(const code of [...codes].sort(cmp)){
   const c=counts[code];c.versionCandidates=0;c.versionsConverted=0;c.versionsBlocked=0;
   for(const r of bySource.get(code)||[]){
   let resolved;
   try{
    resolved=resolver.resolve(r);
    const item=convert(r,resolved);
    group(code).push(item);c.converted++;
   }catch(err){block(code,r.path,r.index,err.code||'conversionError');continue;}
   const expanded=expandFunctionalVersions(r,resolved,existingKeys,authorizeVersion);
   for(const d of expanded.diagnostics){c.versionCandidates++;versionBlock(r,d,d.code);}
   for(const v of expanded.candidates){
    c.versionCandidates++;
    variants.push({r,v,resolved});
   }
  }
  }
  // Reject every colliding version, not only the second one. Physical IDs
  // remain the existing source/name hashes; provenance remains the raw parent.
  const frequencies=new Map();
  for(const {v} of variants)frequencies.set(v.id,(frequencies.get(v.id)||0)+1);
  for(const {r,v,resolved} of variants){
   try{
    if(frequencies.get(v.id)!==1)throw Object.assign(Error('versionIdentityCollision'),{code:'versionIdentityCollision'});
    const item=convert(r,{entity:v.entity,lineage:[r.id,...resolved.lineage],templateLineage:resolved.templateLineage},v);
    group(v.entity.source).push(item);counts[r.entity.source].versionsConverted++;
   }catch(err){versionBlock(r,v,err.code||'versionConversionError');}
  }
  for(const c of Object.values(counts)){
   if(c.versionCandidates!==c.versionsConverted+c.versionsBlocked)throw Error('functionalVersionAccountingMismatch');
   if(c.total!==c.converted+c.blocked)throw Error('functionalIndexedAccountingMismatch');
  }
  for(const [code,items] of [...groups].sort(([a],[b])=>cmp(a,b))){
   const pilotEra=kind==='spell'?spell.pilot[code]?.era:creature.pilot[code];
   const packSource=projectMainSource(code,publications,null,pilotEra).source;
   items.sort((a,b)=>cmp(a.id,b.id));
   if(items.length)packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':'+spec.suffix,source:packSource,metadata:{stage:spec.stage,activation:'review-required',conversionScope:'functionalSelectedSources'},items});
  }
 }
 return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildFunctionalIndexed,allExplicitAccess};
