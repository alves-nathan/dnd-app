'use strict';
// Offline, conservative class graph staging. Never activate or synthesize mechanical effects.
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver,mainEntityFile}=require('./resolver');
const {readMainPublications,projectMainSource}=require('./functional-main-source');
const fs=require('node:fs'),path=require('node:path');
const pilot=Object.freeze({PHB:'2014',XPHB:'2024',TCE:'2014',XGE:'2014',EFA:'2024'});
const kinds=['class','subclass','classFeature','subclassFeature'];
const abilities=new Set(['str','dex','con','int','wis','cha']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const integer=x=>Number.isInteger(x)&&x>=0;
const uniqueStrings=x=>Array.isArray(x)&&x.length>0&&x.every(v=>typeof v==='string'&&v.trim()===v&&v.length)&&new Set(x).size===x.length;
const outputKind=k=>k.endsWith('Feature')?'feature':k;
const physicalId=(kind,e)=>'upstream:main:'+outputKind(kind)+':'+createHash('sha256').update(identity(kind,e)).digest('hex');
function canonicalKey(kind,e){
  const parts=[kind,norm(kind==='subclass'?e.shortName??e.name:e.name)];
  if(kind!=='class')parts.push(norm(e.className));
  if(kind==='subclassFeature')parts.push(norm(e.subclassShortName));
  if(kind.endsWith('Feature'))parts.push(String(Number(e.level)));
  return JSON.stringify(parts);
}
function sourceFor(code,book){
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:pilot[code],contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
function projectSpellcasting(e,notes){
  const has=e.spellcastingAbility!==undefined||e.casterProgression!==undefined||
    ['cantripProgression','spellsKnownProgression','preparedSpellsProgression','preparedSpells'].some(k=>own(e,k));
  if(!has)return undefined;
  const p={};
  if(abilities.has(e.spellcastingAbility))p.ability=e.spellcastingAbility.toUpperCase();
  else notes.add('spellcastingAbilityPending');
  // Keep caster progression codes raw until the engine's rounding policy is reconciled.
  notes.add('casterProgressionPolicyPending');
  for(const [raw,key] of [['cantripProgression','cantripsKnownByLevel'],['spellsKnownProgression','spellsKnownByLevel'],['preparedSpellsProgression','preparedSpellsByLevel']]){
    if(!own(e,raw))continue;
    if(Array.isArray(e[raw])&&e[raw].length===20&&e[raw].every(integer))p[key]=clone(e[raw]);
    else notes.add('spellcastingLevelTablePending');
  }
  if(e.preparedSpells!==undefined||e.preparedSpellsChange!==undefined||e.spellsKnownProgressionFixedByLevel!==undefined)notes.add('spellPreparationPolicyPending');
  const tables=Array.isArray(e.classTableGroups)?e.classTableGroups:[];
  if(e.casterProgression==='pact'){
    const candidates=tables.filter(t=>Array.isArray(t.colLabels)&&t.colLabels.includes('Spell Slots')&&t.colLabels.includes('Slot Level'));
    if(candidates.length===1){
      const t=candidates[0],a=t.colLabels.indexOf('Spell Slots'),b=t.colLabels.indexOf('Slot Level');
      const slotLevel=v=>{
        if(Number.isInteger(v)&&v>=1&&v<=9)return v;
        if(typeof v==='string'){
          const m=v.match(/^\{@filter [1-9](?:st|nd|rd|th)?\|spells\|level=([1-9])(?:\|[^{}]+)?\}$/);
          if(m)return Number(m[1]);
        }
        return undefined;
      };
      if(t.colLabels.filter(l=>l==='Spell Slots').length===1&&t.colLabels.filter(l=>l==='Slot Level').length===1&&
        Array.isArray(t.rows)&&t.rows.length===20&&t.rows.every(row=>Array.isArray(row)&&row.length===t.colLabels.length&&integer(row[a])&&slotLevel(row[b])!==undefined)){
        p.pactSlotsByLevel=t.rows.map(row=>row[a]);p.pactSlotLevelByLevel=t.rows.map(row=>slotLevel(row[b]));
      }
    }
    if(!p.pactSlotsByLevel)notes.add('pactSlotTablePending');
  }else{
    const candidates=tables.filter(t=>own(t,'rowsSpellProgression'));
    if(candidates.length===1){
      const t=candidates[0],labels=t.colLabels;
      const levels=Array.isArray(labels)?labels.map(l=>typeof l==='string'?Number(l.match(/^\{@filter [1-9](?:st|nd|rd|th)?\|spells\|level=([1-9])(?:\|[^{}]+)?\}$/)?.[1]):NaN):[];
      if(levels.length>0&&levels.length<=9&&levels.every((n,i)=>n===i+1)&&Array.isArray(t.rowsSpellProgression)&&
        t.rowsSpellProgression.length===20&&t.rowsSpellProgression.every(row=>Array.isArray(row)&&row.length===levels.length&&row.every(integer))){
        p.slotsByLevel=Object.fromEntries(t.rowsSpellProgression.map((row,i)=>[String(i+1),Object.fromEntries(row.map((n,j)=>[String(levels[j]),n]))]));
      }
    }
    if(!p.slotsByLevel)notes.add('spellSlotTablePending');
  }
  return Object.keys(p).length?p:undefined;
}
function projectClass(e,notes){
  const p={};
  if(e.hd?.number===1&&Number.isInteger(e.hd.faces)&&e.hd.faces>0)p.hitDie=e.hd.faces;
  else notes.add('hitDiePending');
  if(uniqueStrings(e.proficiency)&&e.proficiency.every(a=>abilities.has(a)))p.savingThrowProficiencies=e.proficiency.map(a=>a.toUpperCase());
  else notes.add('savingThrowProficiencyPending');
  if(Array.isArray(e.primaryAbility)&&e.primaryAbility.length===1&&rec(e.primaryAbility[0])&&Object.keys(e.primaryAbility[0]).length&&
    Object.entries(e.primaryAbility[0]).every(([k,v])=>abilities.has(k)&&v===true))p.primaryAbilities=Object.keys(e.primaryAbility[0]).map(a=>a.toUpperCase());
  else if(e.primaryAbility!==undefined)notes.add('primaryAbilityAlternativesPending');
  const prof=e.startingProficiencies;
  if(rec(prof)){
    for(const [k,target] of [['armor','armorTraining'],['weapons','weaponProficiencies']]){
      if(!own(prof,k))continue;
      if(uniqueStrings(prof[k])&&prof[k].every(v=>!/[{}|]/.test(v)))p[target]=clone(prof[k]);
      else notes.add('startingProficiencyChoicesPending');
    }
    const s=prof.skills;
    const c=Array.isArray(s)&&s.length===1&&rec(s[0])&&Object.keys(s[0]).length===1?s[0].choose:undefined;
    if(rec(c)&&Object.keys(c).every(k=>['from','count'].includes(k))&&uniqueStrings(c.from)&&integer(c.count)&&c.count>0&&c.count<=c.from.length){
      p.skillChoiceCount=c.count;p.skillProficienciesChoice={count:c.count,options:clone(c.from),from:'skills'};
    }else if(s!==undefined)notes.add('startingProficiencyChoicesPending');
    if(prof.tools||prof.toolProficiencies)notes.add('toolProficiencyPending');
  }
  const spellcasting=projectSpellcasting(e,notes);if(spellcasting)p.spellcasting=spellcasting;
  return p;
}
const coordinate=(p,k,i)=>JSON.stringify([p,k,i]);
function buildFunctionalClasses(snapshot,selection){
  if(!Array.isArray(selection))fail('functionalClassSelectionInvalid');
  const selected=new Map();
  for(const r of selection){
    if(!kinds.includes(r.kind)||typeof r.path!=='string'||!mainEntityFile(r.path)||!Number.isSafeInteger(r.index)||r.index<0)fail('functionalClassSelectionInvalid');
    const source=JSON.parse(r.sourceId),key=coordinate(r.path,r.kind,r.index);
    if(!Array.isArray(source)||source.length!==2||source[0]!=='main'||typeof source[1]!=='string'||!source[1].trim()||selected.has(key))fail('functionalClassSelectionInvalid');
    selected.set(key,source[1]);
  }
  return buildClassGraph(snapshot,[...new Set(selected.values())].sort(),selected);
}
function buildPilot(snapshot,codes=Object.keys(pilot)){
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c)))fail('invalidPilotSources');
  return buildClassGraph(snapshot,codes,null);
}
function buildClassGraph(snapshot,codes,selected){
  const functional=selected!==null;
  if(!codes.length)return {commit:snapshot.commit,packs:[],counts:{},diagnostics:[],activation:'review-required'};
  const books=functional?null:snapshot.readJson('data/books.json').book;
  const publications=functional?readMainPublications(snapshot):null;
  const records=[],diagnostics=[],counts=Object.create(null),sources=new Map(),seenCoordinates=new Set();
  const totals=()=>({total:0,converted:0,blocked:0});
  for(const code of codes){
    counts[code]={...Object.fromEntries(kinds.map(k=>[k,totals()])),reviewCodes:{},blockCodes:{},progressionOwners:0,progressionLinks:0,spellTables:0,pactTables:0};
    sources.set(code,functional?projectMainSource(code,publications,null,pilot[code]).source:sourceFor(code,books.find(b=>b.source===code)));
  }
  const bump=(obj,k)=>obj[k]=(obj[k]||0)+1;
  function block(source,kind,p,index,code){
    counts[source][kind].blocked++;bump(counts[source].blockCodes,code);
    diagnostics.push({source,kind,path:p,index,code});
  }
  const paths=[...snapshot.files.keys()].filter(p=>/^data\/class\/class-[^/]+\.json$/.test(p)||functional&&mainEntityFile(p)&&/^data\/[^/]+\.json$/.test(p)).sort();
  if(!paths.length)fail('missingClassFiles');
  for(const p of paths){
    const json=snapshot.readJson(p);
    for(const kind of kinds){
      if(!own(json,kind))continue;
      if(!Array.isArray(json[kind]))fail('invalidClassCollection');
      for(const [index,e] of json[kind].entries()){
        const coord=coordinate(p,kind,index);
        const tracked=functional?selected.has(coord):rec(e)&&own(counts,e.source);
        if(functional&&tracked){
          if(!rec(e)||e.source!==selected.get(coord))fail('functionalClassSelectionSourceMismatch');
          seenCoordinates.add(coord);
        }
        if(tracked)counts[e.source][kind].total++;
        try{
          const key=identity(kind,e);records.push({id:JSON.stringify(['main',key]),key,kind,origin:'main',path:p,index,blob:snapshot.files.get(p),entity:e});
        }catch(err){if(tracked)block(e.source,kind,p,index,err.code||'invalidIdentity');}
      }
    }
  }
  if(functional&&seenCoordinates.size!==selected.size)fail('functionalClassSelectionCoordinateMissing');
  const resolver=makeResolver(records),nodes=new Map(),selectedIds=new Set(records.filter(r=>functional?selected.has(coordinate(r.path,r.kind,r.index)):own(counts,r.entity.source)).map(r=>r.id));
  function classOwner(e){return resolver.lookup('main','class',{name:e.className,source:e.classSource});}
  function subclassOwner(e){return resolver.lookup('main','subclass',{shortName:e.subclassShortName,source:e.subclassSource,className:e.className,classSource:e.classSource});}
  function convert(r){
    const resolved=resolver.resolve(r),e=resolved.entity,kind=outputKind(r.kind);
    if(functional&&e.source!==r.entity.source)fail('functionalClassResolvedSourceMismatch');
    const projection=functional?projectMainSource(e.source,publications,e,pilot[e.source]):null;
    const source=projection?projection.source:sources.get(e.source);
    if(typeof e.name!=='string'||!e.name.trim()||e.name.trim()!==e.name)fail('invalidName');
    const notes=new Set(['effectSemanticsPending','classRuntimeIntegrationPending','precedencePending',...(projection?.notes||[])]);
    const deps=new Set(),links=[],mechanics={upstreamClassRecord:clone(e)};
    let payload={mechanics};
    const dep=target=>{
      if(functional&&!selectedIds.has(target.id))fail('dependencySourceNotSelected');
      deps.add(target.id);
      return physicalId(target.kind,target.entity);
    };
    let owner,subOwner;
    if(r.kind!=='class'){
      owner=classOwner(e);payload.classId=dep(owner);
      if(r.kind==='subclassFeature'){subOwner=subclassOwner(e);payload.subclassId=dep(subOwner);}
      if(norm(e.classSource)!==norm(e.source))notes.add('crossPublicationOwnerReviewPending');
    }
    if(r.kind.endsWith('Feature')){
      if(!Array.isArray(e.entries))fail('invalidFeatureEntries');
      if(functional&&(!Number.isInteger(Number(e.level))||Number(e.level)<1||Number(e.level)>20))fail('featureLevelOutOfRange');
      payload.sourceType=r.kind;payload.levelGained=Number(e.level);
      notes.add('featureGrantSemanticsPending');
    }else{
      if(r.kind==='class')Object.assign(payload,projectClass(e,notes));
      const field=r.kind==='class'?'classFeatures':'subclassFeatures',targetKind=r.kind==='class'?'classFeature':'subclassFeature';
      if(!Array.isArray(e[field]))fail('invalidFeatureList');
      const byLevel=new Map(),seen=new Set();
      for(const raw of e[field]){
        const uid=typeof raw==='string'?raw:raw?.[targetKind];
        const target=resolver.lookup('main',targetKind,resolver.featureTarget(targetKind,uid));
        const te=target.entity;
        // Legacy compatibility copies may refer to another class/subclass owner.
        // Do not relabel a feature or manufacture a revised grant.
        if(classOwner(te).id!==(r.kind==='class'?r.id:owner.id)||
          (r.kind==='subclass'&&subclassOwner(te).id!==r.id))fail('crossOwnerFeatureReference');
        const level=Number(te.level),id=dep(target);
        if(functional&&(!Number.isInteger(level)||level<1||level>20))fail('featureLevelOutOfRange');
        links.push({uid,featureId:id,level,raw:clone(raw)});
        if(!seen.has(id)){
          seen.add(id);if(!byLevel.has(level))byLevel.set(level,[]);byLevel.get(level).push(id);
        }else notes.add('duplicateFeatureGrantReviewPending');
        if(rec(raw))notes.add('featureGrantOptionsPending');
      }
      payload.featureIds=[...seen];
      payload.progression=[...byLevel].sort((a,b)=>a[0]-b[0]).map(([level,featureIds])=>({level,featureIds}));
      mechanics.featureGrantReferences=links;
      if(e.startingEquipment)notes.add('startingEquipmentResolutionPending');
      if(e.multiclassing)notes.add('multiclassPolicyPending');
      if(e.classTableGroups||e.subclassTableGroups)notes.add('resourceTableSemanticsPending');
      if(e.optionalfeatureProgression||e.featProgression||e.itemMasteriesProgression||e.itemMasteries)notes.add('selectionProgressionPending');
      if(e.includeSubclassesFrom||e.reskinOf)notes.add('classAliasPolicyPending');
      if(r.kind==='subclass'&&(e.casterProgression||e.spellcastingAbility||e.subclassTableGroups))notes.add('subclassSpellcastingPending');
    }
    if(e.additionalSpells)notes.add('spellGrantChoicesPending');
    return {r,deps,item:{id:physicalId(r.kind,e),kind,name:e.name,
      source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
      identity:{canonicalKey:canonicalKey(r.kind,e),precedenceScope:source.precedenceScope},
      precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
      provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit:snapshot.commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,sourceCode:e.source,resolverVersion:'a5.7',lineage:resolved.lineage},
      payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:clone(e.reprintedAs||[]),...(projection?{sourceEditionEvidence:projection.editionEvidence}:{})}}};
  }
  for(const r of records){
    const code=r.entity.source;if(functional?!selected.has(coordinate(r.path,r.kind,r.index)):!own(counts,code))continue;
    try{nodes.set(r.id,convert(r));}
    catch(err){block(code,r.kind,r.path,r.index,err.code||'conversionError');}
  }
  // Keep only a closed graph of emitted class/subclass/feature records.
  // Cycles of owner -> feature -> owner are valid; a missing/blocked node propagates.
  // Reverse dependency traversal: each blocked node propagates once.
  const reverse=new Map(),queue=[];
  for(const [id,node] of nodes){
    for(const dep of node.deps){
      const dependents=reverse.get(dep)||[];dependents.push(id);reverse.set(dep,dependents);
    }
    if([...node.deps].some(d=>!nodes.has(d)))queue.push(id);
  }
  for(let i=0;i<queue.length;i++){
    const id=queue[i],node=nodes.get(id);if(!node)continue;
    const r=node.r;nodes.delete(id);block(r.entity.source,r.kind,r.path,r.index,'dependencyNotEmitted');
    for(const dependent of reverse.get(id)||[])if(nodes.has(dependent))queue.push(dependent);
  }
  const packs=[];
  for(const code of codes){
    const c=counts[code],source=sources.get(code),items=[];
    for(const {r,item} of nodes.values()){
      if(r.entity.source!==code)continue;
      items.push(item);c[r.kind].converted++;
      for(const n of item.metadata.reviewCodes)bump(c.reviewCodes,n);
      if(item.payload.progression){c.progressionOwners++;c.progressionLinks+=item.payload.featureIds.length;}
      if(item.payload.spellcasting?.slotsByLevel)c.spellTables++;
      if(item.payload.spellcasting?.pactSlotsByLevel)c.pactTables++;
    }
    items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':classes',source,metadata:{stage:'a5.7',activation:'review-required',...(functional?{conversionScope:'functionalSelectedSources'}:{})},items});
  }
  if(functional)for(const c of Object.values(counts))for(const k of kinds)if(c[k].total!==c[k].converted+c[k].blocked)fail('functionalClassAccountingMismatch');
  return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,buildFunctionalClasses,physicalId,projectSpellcasting,projectClass};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);if(!root||!out)fail('usage');
    const r=buildPilot(openSnapshot(root,ref));if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.classes.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,activation:r.activation}));if(r.diagnostics.length)process.exitCode=2;
  }catch(err){console.error(err.code||'classConversionFailed');process.exitCode=1;}
}
