'use strict';
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver}=require('./resolver');
const {abilityPlan,prerequisite,physicalId:featureId}=require('./feature-converter');
const fs=require('node:fs'),path=require('node:path');
const pilot=Object.freeze({PHB:'2014',XPHB:'2024',AAG:'2014',MPMM:'2014',EFA:'2024',AU:'2024',WoW:'unknown',ERLW:'2014',VRGR:'2014',FTD:'2014',SCAG:'2014',TCE:'2014',VGM:'2014',MTF:'2014'});
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const abilities=new Set(['str','dex','con','int','wis','cha']);
const skills=new Set('acrobatics|animal handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight of hand|stealth|survival'.split('|'));
const sizes={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
const damages=new Set('acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(' '));
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const positive=x=>Number.isInteger(x)&&x>0;
const physicalId=(kind,key)=>'upstream:main:'+kind+':'+createHash('sha256').update(key).digest('hex');
function sourceFor(code,book){
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:pilot[code],contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
// Only the explicitly encoded standard 2024 background allocation is promoted.
// Different weighted options, partial alternatives and fixed increases remain raw.
function backgroundAbility(raw){
  if(!Array.isArray(raw)||raw.length!==2)return undefined;
  const options=raw.map(g=>{
    if(!rec(g)||Object.keys(g).length!==1||!rec(g.choose)||Object.keys(g.choose).length!==1||!rec(g.choose.weighted))return null;
    const w=g.choose.weighted;
    if(Object.keys(w).some(k=>!['from','weights'].includes(k))||!Array.isArray(w.from)||w.from.length!==3||
      new Set(w.from).size!==3||!w.from.every(a=>abilities.has(a))||!Array.isArray(w.weights))return null;
    return {from:w.from,weights:[...w.weights].sort((a,b)=>a-b)};
  });
  if(options.some(o=>!o))return undefined;
  const [a,b]=options;
  if(a.from.some(x=>!b.from.includes(x)))return undefined;
  const patterns=[a,b].map(o=>JSON.stringify(o.weights)).sort();
  if(JSON.stringify(patterns)!==JSON.stringify(['[1,1,1]','[1,2]']))return undefined;
  return {abilityScoreOptions:a.from.map(x=>x.toUpperCase()),abilityScoreIncreaseRule:{
    chooseOnePlus2AndDifferentOnePlus1:true,orIncreaseAllBy1:true,maximumScoreAfterIncrease:20}};
}
function proficiency(raw,category,notes){
  if(raw===undefined)return {};
  if(!Array.isArray(raw)||raw.length!==1||!rec(raw[0])){notes.add(category+'AlternativesPending');return {};}
  const g=raw[0],fixed=[],choices=[];
  const title=s=>s.split(' ').map(x=>x[0].toUpperCase()+x.slice(1)).join(' ');
  const validName=s=>typeof s==='string'&&s.trim()&&s.trim()===s&&(category!=='skill'||skills.has(norm(s)));
  for(const [k,v] of Object.entries(g)){
    if(k==='choose'&&rec(v)&&Object.keys(v).every(x=>['from','count'].includes(x))&&Array.isArray(v.from)&&v.from.length&&v.from.every(validName)&&new Set(v.from).size===v.from.length&&positive(v.count??1)&&(v.count??1)<=v.from.length){
      choices.push({count:v.count??1,options:v.from.map(x=>category==='skill'?title(x):x),from:category==='skill'?'skills':category==='tool'?'tools':'languages'});
    }else if(k==='any'&&positive(v)&&['skill','tool','language'].includes(category)){
      choices.push({count:v,from:category==='skill'?'skills':category==='tool'?'tools':'languages'});
    }else if(v===true&&validName(k)&&!['other','any','anyStandard','anyExotic','anyArtisansTool','anyMusicalInstrument','choose'].includes(k)){
      fixed.push(category==='skill'?title(k):k);
    }else notes.add(category+'ProficiencyPending');
  }
  const result={};
  if(fixed.length)result[category+'Proficiencies']=fixed;
  if(choices.length===1)result[category+'ProficiencyChoice']=choices[0];
  if(choices.length>1)notes.add(category+'MultipleChoicesPending');
  return result;
}
function speedOf(raw,notes){
  if(nonnegative(raw))return raw;
  if(!rec(raw)){notes.add('speedPending');return undefined;}
  const out={};
  for(const [k,v] of Object.entries(raw)){
    if(!['walk','fly','swim','climb','burrow'].includes(k)){notes.add('specialMovementPending');continue;}
    if(nonnegative(v))out[k]=v;
    else if(v===true&&nonnegative(raw.walk)){out[k]=raw.walk;notes.add('movementEqualsWalkPending');}
    else notes.add('specialMovementPending');
  }
  return Object.keys(out).length?out:undefined;
}
// Conservative subset of the upstream merge. Preserve both originals and never
// combine alternatives by cross product or sum fixed scores.
function mergeSubrace(parent,child,notes){
  const out=clone(parent);
  for(const k of ['srd','srd52','basicRules','basicRules2024','page','reprintedAs','referenceSources','hasFluff','hasFluffImages','otherSources','additionalSources','_versions','subraces'])delete out[k];
  const special=new Set(['ability','entries','traitTags','languageProficiencies','skillProficiencies']);
  for(const [k,v] of Object.entries(child)){
    if(['name','source','raceName','raceSource','overwrite','_versions'].includes(k)||special.has(k))continue;
    if(['__proto__','constructor','prototype'].includes(k))fail('unsafeSubraceProperty');
    if(v===null)delete out[k];else out[k]=clone(v);
  }
  out.name=parent.name+' ('+child.name+')';out.source=child.source;
  for(const key of special){
    if(!own(child,key))continue;
    const v=child[key],p=parent[key];
    if(v===null){delete out[key];continue;}
    if(!Array.isArray(v)||p!==undefined&&!Array.isArray(p))fail('unsupportedSubraceMerge');
    if(child.overwrite?.[key]===true||p===undefined){out[key]=clone(v);continue;}
    if(key==='ability'){
      if(p.length!==v.length||p.some((g,i)=>!rec(g)||!rec(v[i])||own(g,'choose')&&own(v[i],'choose')))fail('unsupportedSubraceAbilityMerge');
      out[key]=p.map((g,i)=>({...clone(g),...clone(v[i])}));
    }else if(key==='entries'){
      const list=clone(p);
      for(const ent of v){
        const target=rec(ent)?ent.data?.overwrite:undefined;
        if(target!==undefined&&typeof target!=='string')fail('unsupportedTraitOverwrite');
        const ix=target===undefined?-1:list.findIndex(x=>rec(x)&&norm(x.name)===norm(target));
        if(ix<0)list.push(clone(ent));else list[ix]=clone(ent);
      }
      out[key]=list;
    }else if(key==='skillProficiencies'){
      if(p.length!==1||v.length!==1||!rec(p[0])||!rec(v[0])||own(p[0],'choose')&&own(v[0],'choose'))fail('unsupportedSubraceSkillMerge');
      out[key]=[{...clone(p[0]),...clone(v[0])}];
    }else{out[key]=[...clone(p),...clone(v)];if(key==='languageProficiencies')notes.add('mergedLanguageAlternativesPending');}
  }
  if(child.overwrite&&Object.keys(child.overwrite).some(k=>!special.has(k)))notes.add('subraceOverwriteReviewPending');
  notes.add('subraceMergeReviewPending');
  return out;
}
function featReferences(raw,featIndex,notes){
  if(raw===undefined)return [];
  notes.add('featGrantsPending');
  if(!Array.isArray(raw))return [];
  const refs=[];
  for(const [group,g] of raw.entries()){
    if(!rec(g))continue;
    for(const [uid,value] of Object.entries(g)){
      if(value!==true||!uid.includes('|'))continue;
      const [name,source,...rest]=uid.split('|');
      if(!name||!source||rest.length)continue;
      const exact=featIndex.get(JSON.stringify([norm(name),norm(source)]));
      // Matching the source record is not proof it is convertible or available at runtime.
      refs.push({group,uid,matched:!!exact,...(exact?{candidateId:featureId('feat',exact.source,exact.name)}:{})});
    }
  }
  return refs;
}
function equipmentPlan(raw,notes){
  if(raw===undefined)return undefined;
  notes.add('startingEquipmentResolutionPending');
  if(!Array.isArray(raw))return {raw:clone(raw),groups:[]};
  return {groups:raw.map((group,index)=>({index,options:rec(group)?Object.entries(group).map(([key,items])=>({
    key,kind:key==='_'?'mandatory':'alternative',entries:clone(items)})):[],raw:clone(group)}))};
}
function convert(r,resolved,source,commit,ctx){
  const kind=r.kind==='background'?'background':'species',notes=new Set(['effectSemanticsPending','precedencePending','originRuntimeIntegrationPending']);
  if(source.rulesEra==='unknown')notes.add('rulesEraPending');
  let e=resolved.entity,parent=null,rawParent=null,lineage=resolved.lineage;
  if(r.kind==='subrace'){
    const p=ctx.resolver.lookup('main','race',{name:e.raceName,source:e.raceSource});
    const pr=ctx.resolver.resolve(p);
    rawParent=pr.entity;parent={name:p.entity.name,source:p.entity.source,key:p.key,path:p.path,index:p.index,blob:p.blob};
    e=mergeSubrace(pr.entity,e,notes);lineage=[...new Set([...lineage,p.id,...pr.lineage])];
    if(ctx.originals.get(p.id)?._versions)notes.add('parentVersionsPending');
  }
  const original=ctx.originals.get(r.id);
  const mechanics={upstreamOrigin:clone(e),...(parent?{parent,baseRecord:clone(rawParent),subraceRecord:clone(resolved.entity)}:{}),
    ...(original?._versions?{versions:clone(original._versions)}:{})};
  if(original?._versions)notes.add('lineageVersionsPending');
  const payload={mechanics};
  for(const [field,category] of [['skillProficiencies','skill'],['toolProficiencies','tool'],['languageProficiencies','language']]){
    Object.assign(payload,proficiency(e[field],category,notes));
  }
  if(e.additionalSpells)notes.add('originSpellGrantsPending');
  if(e.skillToolLanguageProficiencies||e.weaponProficiencies||e.armorProficiencies||e.expertise)notes.add('complexProficiencyPending');
  if(e.prerequisite){mechanics.prerequisiteTree=prerequisite(e.prerequisite,notes);notes.add('originPrerequisitesPending');}
  if(e.feats){mechanics.featReferences=featReferences(e.feats,ctx.featIndex,notes);}
  if(kind==='background'){
    const standard=source.rulesEra==='2024'?backgroundAbility(e.ability):undefined;
    if(standard)Object.assign(payload,standard);
    else if(e.ability!==undefined||source.rulesEra==='2024')notes.add('backgroundAbilityPending');
    if(e.startingEquipment!==undefined)mechanics.startingEquipmentPlan=equipmentPlan(e.startingEquipment,notes);
    if(e.fromFeature)notes.add('inheritedBackgroundFeaturePending');
  }else{
    const size=Array.isArray(e.size)?e.size:typeof e.size==='string'?[e.size]:[];
    if(size.length&&size.every(s=>own(sizes,s)))payload.size=size.length===1?sizes[size[0]]:size.map(s=>sizes[s]);
    else notes.add('sizePending');
    const speed=speedOf(e.speed,notes);if(speed!==undefined)payload.speed=speed;
    if(Array.isArray(e.creatureTypes)&&e.creatureTypes.length===1&&typeof e.creatureTypes[0]==='string')payload.creatureType=e.creatureTypes[0];
    else notes.add('creatureTypePending');
    if(nonnegative(e.darkvision))payload.darkvisionFt=e.darkvision;
    if(nonnegative(e.blindsight))payload.blindsightFt=e.blindsight;
    for(const [raw,field] of [['resist','resistances'],['immune','damageImmunities'],['vulnerable','vulnerabilities']]){
      if(!Array.isArray(e[raw]))continue;
      const simple=e[raw].filter(x=>typeof x==='string'&&damages.has(norm(x))).map(norm);
      if(simple.length)payload[field]=[...new Set(simple)];
      if(simple.length!==e[raw].length)notes.add('conditionalDamageTypesPending');
    }
    if(e.conditionImmune)notes.add('conditionImmunitiesPending');
    if(e.ability!==undefined){
      mechanics.legacyAbilityAllocation=abilityPlan(e.ability,notes);
      notes.add('speciesAbilityPolicyPending');
    }
    if(e.lineage)notes.add('lineageDefaultsPending');
    if(ctx.parentKeys.has(r.key))notes.add('subraceSelectionPending');
    if(!Array.isArray(e.entries))notes.add('traitEntriesPending');
    else mechanics.namedTraits=e.entries.filter(x=>rec(x)&&typeof x.name==='string').map(x=>({name:x.name,entry:clone(x)}));
    notes.add('speciesTraitEffectsPending');
  }
  const canonical=kind+':'+(parent?norm(parent.name)+':'+norm(resolved.entity.name):norm(e.name));
  return {id:physicalId(kind,r.key),kind,name:e.name,source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
    identity:{canonicalKey:canonical,precedenceScope:source.precedenceScope},
    precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
    provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,sourceCode:e.source,resolverVersion:'a5.6',lineage},
    payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:clone(e.reprintedAs||[]),upstreamKind:r.kind}};
}
function buildPilot(snapshot,codes=Object.keys(pilot)){
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c)))fail('invalidPilotSources');
  const books=snapshot.readJson('data/books.json').book,races=snapshot.readJson('data/races.json'),bgs=snapshot.readJson('data/backgrounds.json'),feats=snapshot.readJson('data/feats.json').feat;
  if(!Array.isArray(books)||!Array.isArray(feats))fail('invalidOriginIndex');
  const records=[],originals=new Map(),parentKeys=new Set(),featIndex=new Map(),counts=Object.create(null),diagnostics=[];
  const totals=()=>({total:0,converted:0,blocked:0});
  for(const code of codes)counts[code]={race:totals(),subrace:totals(),background:totals(),versionContainers:0,standardBackgroundASI:0,matchedFeatReferences:0,reviewCodes:{},blockCodes:{}};
  function block(code,kind,p,index,reason){const c=counts[code];c[kind].blocked++;c.blockCodes[reason]=(c.blockCodes[reason]||0)+1;diagnostics.push({source:code,kind,path:p,index,code:reason});}
  for(const e of feats){
    if(!rec(e)||typeof e.name!=='string'||typeof e.source!=='string')continue;
    const k=JSON.stringify([norm(e.name),norm(e.source)]);
    featIndex.set(k,featIndex.has(k)?null:e);
  }
  for(const [p,kind,entries] of [['data/races.json','race',races.race],['data/races.json','subrace',races.subrace],['data/backgrounds.json','background',bgs.background]]){
    if(!Array.isArray(entries))fail('invalidOriginFile');
    for(const [index,e] of entries.entries()){
      const tracked=rec(e)&&own(counts,e.source);
      if(tracked){counts[e.source][kind].total++;if(Array.isArray(e._versions)&&e._versions.length)counts[e.source].versionContainers++;}
      if(kind==='subrace'&&rec(e)){
        try{parentKeys.add(identity('race',{name:e.raceName,source:e.raceSource}));}catch{}
      }
      try{
        const key=identity(kind,e),id=JSON.stringify(['main',key]),entity=clone(e);
        // Preserve lineage templates separately, never silently resolve them.
        // Other unresolved templates remain subject to the resolver's blockers.
        if(kind==='race'||kind==='subrace')delete entity._versions;
        originals.set(id,e);
        records.push({id,key,kind,origin:'main',path:p,index,blob:snapshot.files.get(p),entity});
      }catch(err){if(tracked)block(e.source,kind,p,index,err.code||'invalidIdentity');}
    }
  }
  const resolver=makeResolver(records),packs=[];
  for(const code of codes){
    const c=counts[code],source=sourceFor(code,books.find(x=>x.source===code)),items=[];
    for(const r of records.filter(x=>x.entity.source===code)){
      try{
        const item=convert(r,resolver.resolve(r),source,snapshot.commit,{resolver,originals,parentKeys,featIndex});
        items.push(item);c[r.kind].converted++;
        if(item.payload.abilityScoreIncreaseRule)c.standardBackgroundASI++;
        c.matchedFeatReferences+=(item.payload.mechanics.featReferences||[]).filter(x=>x.matched).length;
        for(const n of item.metadata.reviewCodes)c.reviewCodes[n]=(c.reviewCodes[n]||0)+1;
      }catch(err){block(code,r.kind,r.path,r.index,err.code||'conversionError');}
    }
    items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':origins',source,metadata:{stage:'a5.6',activation:'review-required'},items});
  }
  return {commit:snapshot.commit,counts,packs,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,backgroundAbility,mergeSubrace,speedOf,proficiency};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);if(!root||!out)fail('usage');
    const r=buildPilot(openSnapshot(root,ref));if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.origins.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,activation:r.activation}));if(r.diagnostics.length)process.exitCode=2;
  }catch(err){console.error(err.code||'originConversionFailed');process.exitCode=1;}
}
