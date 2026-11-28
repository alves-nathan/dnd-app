'use strict';
// Expand spell/monster conversion without changing historical pilot baselines.
const {identity,makeResolver}=require('./resolver');
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
function buildFunctionalIndexed(snapshot,kind,codes){
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
 const resolver=makeResolver(records),bySource=new Map();
 for(const r of records)if(Object.hasOwn(counts,r.entity.source)){
  const list=bySource.get(r.entity.source)||[];list.push(r);bySource.set(r.entity.source,list);
 }
 for(const code of [...codes].sort(cmp)){
  const items=[],pilotEra=kind==='spell'?spell.pilot[code]?.era:creature.pilot[code];
  const packSource=projectMainSource(code,publications,null,pilotEra).source;
  for(const r of bySource.get(code)||[]){
   try{
    const resolved=resolver.resolve(r),e=resolved.entity;
    if(e.source!==code)throw Object.assign(Error('sourceMismatch'),{code:'sourceMismatch'});
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
    item.metadata.sourceEditionEvidence=editionEvidence;
    item.metadata.reviewCodes=[...new Set([...item.metadata.reviewCodes,...notes])].sort(cmp);
    items.push(item);counts[code].converted++;
   }catch(err){block(code,r.path,r.index,err.code||'conversionError');}
  }
  items.sort((a,b)=>cmp(a.id,b.id));
  if(items.length)packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':'+spec.suffix,source:packSource,metadata:{stage:spec.stage,activation:'review-required',conversionScope:'functionalSelectedSources'},items});
  if(counts[code].total!==counts[code].converted+counts[code].blocked)throw Error('functionalIndexedAccountingMismatch');
 }
 return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildFunctionalIndexed,allExplicitAccess};
