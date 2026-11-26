'use strict';
// Descriptive conditions only. No effects, durations or runtime condition aliases.
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver}=require('./resolver');
const fs=require('node:fs'),path=require('node:path');
const pilot=Object.freeze({PHB:'2014',XPHB:'2024'});
const officialNames=new Set(['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious']);
const kinds=['condition','status','disease'];
const inputPath='data/conditionsdiseases.json';
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const physicalId=e=>'upstream:main:condition:'+createHash('sha256').update(identity('condition',e)).digest('hex');
const stagingConditionId=e=>'upstream:main:condition:'+norm(e.source)+':'+norm(e.name);
function sourceFor(code,book){
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:pilot[code],contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
function buildPilot(snapshot,codes=Object.keys(pilot)){
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c)))fail('invalidPilotSources');
  const data=snapshot.readJson(inputPath),books=snapshot.readJson('data/books.json').book;
  if(!rec(data))fail('invalidConditionIndex');
  const records=[],diagnostics=[],counts=Object.create(null),inventory=Object.fromEntries(kinds.map(k=>[k,{total:0,pilot:0,deferred:0,bySource:Object.create(null)}]));
  const bump=(o,k)=>o[k]=(o[k]||0)+1;
  for(const code of codes)counts[code]={total:0,converted:0,blocked:0,reviewCodes:{},blockCodes:{}};
  function block(code,index,reason){
    counts[code].blocked++;bump(counts[code].blockCodes,reason);
    diagnostics.push({source:code,kind:'condition',path:inputPath,index,code:reason});
  }
  for(const kind of kinds){
    const entries=data[kind];
    if(!Array.isArray(entries))fail('invalidConditionCollection');
    const inv=inventory[kind];
    for(const [index,e] of entries.entries()){
      inv.total++;
      const code=rec(e)&&typeof e.source==='string'&&e.source.trim()?e.source:'unknown';
      bump(inv.bySource,code);
      if(kind!=='condition'||!own(counts,code)){inv.deferred++;continue;}
      inv.pilot++;counts[code].total++;
      try{
        const key=identity(kind,e);
        records.push({id:JSON.stringify(['main',key]),key,kind,origin:'main',path:inputPath,index,blob:snapshot.files.get(inputPath),entity:e});
      }catch(err){block(code,index,err.code||'invalidIdentity');}
    }
  }
  // All status/disease rows are counted but never relabelled as conditions.
  const resolver=makeResolver(records),packs=[];
  for(const code of codes){
    const source=sourceFor(code,books.find(b=>b.source===code)),items=[],c=counts[code];
    for(const r of records.filter(r=>r.entity.source===code)){
      try{
        const resolved=resolver.resolve(r),e=resolved.entity,name=norm(e.name);
        if(!officialNames.has(name)||e.name.trim()!==e.name)fail('conditionClassificationPending');
        if(!Array.isArray(e.entries)||!e.entries.length)fail('invalidConditionEntries');
        const notes=['conditionEffectsPending','conditionEndRulesPending','conditionRuntimeAliasPending','precedencePending'];
        if(name==='exhaustion')notes.push('stackedConditionEditionPolicyPending');
        const item={id:physicalId(e),kind:'condition',name:e.name,
          source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
          identity:{canonicalKey:'condition:'+name,precedenceScope:source.precedenceScope},
          precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
          provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit:snapshot.commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,sourceCode:e.source,resolverVersion:'a5.8',lineage:resolved.lineage},
          payload:{conditionId:stagingConditionId(e),officialCondition:true,mechanics:{upstreamCondition:clone(e),runtimeConditionCandidate:name}},
          metadata:{reviewCodes:notes.sort(),upstreamReprintedAs:clone(e.reprintedAs||[])}};
        items.push(item);c.converted++;for(const n of notes)bump(c.reviewCodes,n);
      }catch(err){block(code,r.index,err.code||'conversionError');}
    }
    items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':conditions',source,metadata:{stage:'a5.8',activation:'review-required'},items});
  }
  return {commit:snapshot.commit,packs,counts,inventory,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,physicalId,stagingConditionId,pilot};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);if(!root||!out)fail('usage');
    const r=buildPilot(openSnapshot(root,ref));if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.conditions.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,inventory:r.inventory,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,inventory:r.inventory,activation:r.activation}));if(r.diagnostics.length)process.exitCode=2;
  }catch(err){console.error(err.code||'conditionConversionFailed');process.exitCode=1;}
}
