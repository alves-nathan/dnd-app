'use strict';
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver}=require('./resolver');
const fs=require('node:fs'),path=require('node:path');
const pilot=Object.freeze({PHB:'2014',XPHB:'2024',TCE:'2014',XGE:'2014',EFA:'2024',AU:'2024',WoW:'unknown'});
const categories={O:'origin',G:'general',EB:'epicBoon',FS:'fightingStyle','FS:P':'fightingStyleReplacementPaladin','FS:R':'fightingStyleReplacementRanger',D:'dragonmark',DG:'darkGift'};
const families={EI:'eldritchInvocation',PB:'pactBoon','MV:B':'maneuver',AI:'artificerInfusion','FS:F':'fightingStyle','FS:R':'fightingStyle','FS:P':'fightingStyle','FS:B':'fightingStyle',AS:'arcaneShot',ED:'elementalDiscipline',MM:'metamagic',RP:'renownPerk',RN:'runeKnightRune',};
const abilities=new Set(['str','dex','con','int','wis','cha']);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const positive=x=>Number.isInteger(x)&&x>0;
const physicalId=(kind,source,name)=>'upstream:main:'+kind+':'+createHash('sha256').update(JSON.stringify([norm(source),norm(name)])).digest('hex');
function sourceFor(code,book){
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:pilot[code],contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
const all=children=>({op:'all',children});
const any=children=>({op:'any',children});
function reference(raw){
  if(typeof raw!=='string'||!raw.trim())return {kind:'unresolved',raw:clone(raw)};
  // Preserve display text, suffix flags, and omitted sources; do not guess a cross-edition target.
  const [name,source,display,...extra]=raw.split('|');
  return {kind:'uid',raw,name,source:source||null,...(display?{display}:{}),...(extra.length?{extra}:{})};
}
function prerequisite(raw,notes=new Set()){
  if(raw===undefined)return undefined;
  const unknown=(key,value)=>{notes.add('prerequisiteExpressionPending');return {op:'unresolved',key,raw:clone(value)};};
  function term(key,value){
    if(key==='level'){
      if(positive(value))return {op:'characterLevel',minimum:value};
      if(rec(value)&&positive(value.level)&&rec(value.class)&&typeof value.class.name==='string'&&value.class.name.trim()){
        notes.add('classLevelReferencePending');
        return {op:'classLevel',minimum:value.level,class:{name:value.class.name,source:value.class.source||null},raw:clone(value)};
      }
      return unknown(key,value);
    }
    if(key==='ability'&&Array.isArray(value)&&value.length){
      return any(value.map(group=>{
        if(!rec(group)||!Object.keys(group).length||Object.entries(group).some(([a,n])=>!abilities.has(a)||!positive(n)))return unknown(key,group);
        return all(Object.entries(group).map(([a,n])=>({op:'abilityMinimum',ability:a.toUpperCase(),minimum:n})));
      }));
    }
    if(['spellcasting','spellcasting2020','spellcastingFeature'].includes(key)&&value===true){
      notes.add('spellcastingPrerequisitePending');return {op:'spellcasting',rule:key};
    }
    if(['feat','optionalfeature','spell','feature','item','pact','race','background','proficiency','campaign','featCategory','exclusiveFeatCategory'].includes(key)){
      notes.add('prerequisiteReferencePending');
      // Array semantics vary by key; preserve as typed requirements, not an invented all/any.
      return {op:'referenceRequirement',referenceType:key,raw:clone(value),
        ...(Array.isArray(value)&&['feat','optionalfeature','spell','feature'].includes(key)?{references:value.map(reference)}:{})};
    }
    return unknown(key,value);
  }
  if(!Array.isArray(raw)||!raw.length)return unknown('prerequisite',raw);
  return any(raw.map(group=>rec(group)&&Object.keys(group).length?
    all(Object.entries(group).map(([key,value])=>term(key,value))):unknown('group',group)));
}
// Only project an exact conjunction with one ability alternative to the existing V2 shape.
// For OR or special requirements, there is no lossy flat fallback.
function flatPrerequisite(tree){
  if(!tree||tree.op!=='any'||tree.children.length!==1||tree.children[0].op!=='all')return undefined;
  const flat={},scores={};
  function visit(node){
    if(node.op==='all')return node.children.every(visit);
    if(node.op==='any')return node.children.length===1&&visit(node.children[0]);
    if(node.op==='characterLevel'){flat.level=Math.max(flat.level||0,node.minimum);return true;}
    if(node.op==='abilityMinimum'){scores[node.ability]=Math.max(scores[node.ability]||0,node.minimum);return true;}
    return false;
  }
  if(!visit(tree.children[0]))return undefined;
  if(Object.keys(scores).length)flat.abilities=scores;
  return flat;
}
function abilityPlan(raw,notes=new Set()){
  if(raw===undefined)return undefined;
  const unresolved=v=>{notes.add('abilityChoicePending');return {kind:'unresolved',raw:clone(v)};};
  if(!Array.isArray(raw)||!raw.length)return {alternatives:[unresolved(raw)]};
  return {alternatives:raw.map(group=>{
    if(!rec(group))return unresolved(group);
    const max=group.max??20;
    if(!positive(max)||max>30||Object.keys(group).some(k=>!abilities.has(k)&&!['choose','max','hidden'].includes(k)))return unresolved(group);
    const fixed=Object.entries(group).filter(([k])=>abilities.has(k)).map(([k,v])=>({ability:k.toUpperCase(),amount:v}));
    if(fixed.some(x=>!positive(x.amount)))return unresolved(group);
    if(group.choose!==undefined){
      const c=group.choose;
      if(!rec(c)||Object.keys(c).some(k=>!['from','amount','count'].includes(k))||
         !Array.isArray(c.from)||!c.from.length||!c.from.every(x=>abilities.has(x))||new Set(c.from).size!==c.from.length||
         !positive(c.amount??1)||!positive(c.count??1)||(c.count??1)>c.from.length)return unresolved(group);
      return {kind:'allocation',fixed,choice:{abilities:c.from.map(x=>x.toUpperCase()),amount:c.amount??1,count:c.count??1,distinct:true},max,hidden:group.hidden===true};
    }
    if(!fixed.length)return unresolved(group);
    return {kind:'allocation',fixed,max,hidden:group.hidden===true};
  })};
}
function simpleAbility(plan){
  if(!plan||plan.alternatives.length!==1)return undefined;
  const a=plan.alternatives[0];
  if(a.kind!=='allocation'||a.hidden)return undefined;
  if(a.choice&&a.fixed.length===0&&a.choice.count===1)return [{abilities:a.choice.abilities,amount:a.choice.amount,max:a.max}];
  if(!a.choice&&a.fixed.length===1)return [{abilities:[a.fixed[0].ability],amount:a.fixed[0].amount,max:a.max}];
  return undefined;
}
function convert(r,resolved,source,commit){
  const e=resolved.entity,kind=r.kind==='feat'?'feat':'feature';
  const notes=new Set(['effectSemanticsPending','precedencePending']);
  if(source.rulesEra==='unknown')notes.add('rulesEraPending');
  if(!Array.isArray(e.entries))fail('invalidEntries');
  const tree=prerequisite(e.prerequisite,notes),flat=flatPrerequisite(tree);
  if(tree&&!flat)notes.add('compoundPrerequisitePending');
  const plan=abilityPlan(e.ability,notes),simple=simpleAbility(plan);
  if(plan&&!simple)notes.add('abilityChoicePending');
  const mechanics={upstreamFeature:clone(e),...(tree?{prerequisiteTree:tree}:{}),...(plan?{abilityAllocationPlan:plan}:{})};
  const payload={mechanics,...(flat?{prerequisite:flat}:{})};
  if(typeof e.repeatable==='boolean')payload.repeatable=e.repeatable;
  else notes.add('repeatabilityReviewPending');
  if(e.repeatableNote||e.repeatableHidden)notes.add('repeatabilityConditionsPending');
  if(kind==='feat'){
    if(own(categories,e.category))payload.category=categories[e.category];
    else notes.add('featCategoryPending');
    if(simple)payload.abilityScoreIncrease=simple;
  }else{
    if(!Array.isArray(e.featureType)||!e.featureType.length||!e.featureType.every(x=>typeof x==='string'))fail('invalidFeatureType');
    const known=[...new Set(e.featureType.map(x=>families[x]||'optionalFeature'))];
    payload.sourceType=known.length===1?known[0]:'optionalFeature';
    mechanics.featureFamilies=e.featureType.map(code=>({code,family:families[code]||'unknown'}));
    notes.add('optionalFeatureProgressionPending');
    if(known.includes('optionalFeature'))notes.add('featureFamilyPending');
  }
  if(e.additionalSpells)notes.add('spellGrantChoicesPending');
  if(e.optionalfeatureProgression||e.featProgression)notes.add('selectionProgressionPending');
  if(e.consumes)notes.add('resourceConsumptionPending');
  if(['skillProficiencies','toolProficiencies','languageProficiencies','weaponProficiencies','armorProficiencies','expertise','savingThrowProficiencies','skillToolLanguageProficiencies'].some(k=>own(e,k)))notes.add('proficiencyChoicesPending');
  return {id:physicalId(kind,e.source,e.name),kind,name:e.name,
    source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
    identity:{canonicalKey:(kind==='feat'?'feat:':'optionalfeature:')+norm(e.name),precedenceScope:source.precedenceScope},
    precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
    provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,sourceCode:e.source,resolverVersion:'a5.5',lineage:resolved.lineage},
    payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:clone(e.reprintedAs||[])}};
}
function buildPilot(snapshot,codes=Object.keys(pilot)){
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c)))fail('invalidPilotSources');
  const books=snapshot.readJson('data/books.json').book;
  const records=[],counts=Object.create(null),diagnostics=[];
  const totals=()=>({total:0,converted:0,blocked:0});
  for(const c of codes)counts[c]={feat:totals(),optionalfeature:totals(),reviewCodes:{},blockCodes:{},families:{},flatPrerequisites:0,abilityPlans:0};
  function block(c,kind,p,i,reason){counts[c][kind].blocked++;counts[c].blockCodes[reason]=(counts[c].blockCodes[reason]||0)+1;diagnostics.push({source:c,kind,path:p,index:i,code:reason});}
  for(const [p,kind] of [['data/feats.json','feat'],['data/optionalfeatures.json','optionalfeature']]){
    const entries=snapshot.readJson(p)[kind];if(!Array.isArray(entries))fail('invalidFeatureIndex');
    for(const [i,e] of entries.entries()){
      const tracked=rec(e)&&own(counts,e.source);if(tracked)counts[e.source][kind].total++;
      try{const key=identity(kind,e);records.push({id:JSON.stringify(['main',key]),key,kind,origin:'main',path:p,index:i,blob:snapshot.files.get(p),entity:e});}
      catch(err){if(tracked)block(e.source,kind,p,i,err.code||'invalidIdentity');}
    }
  }
  const resolver=makeResolver(records),packs=[];
  for(const code of codes){
    const c=counts[code],source=sourceFor(code,books.find(b=>b.source===code)),items=[];
    for(const r of records.filter(r=>r.entity.source===code)){
      try{
        const item=convert(r,resolver.resolve(r),source,snapshot.commit);
        items.push(item);c[r.kind].converted++;
        if(item.payload.prerequisite)c.flatPrerequisites++;
        if(item.payload.mechanics.abilityAllocationPlan)c.abilityPlans++;
        for(const f of item.payload.mechanics.featureFamilies||[])c.families[f.code]=(c.families[f.code]||0)+1;
        for(const n of item.metadata.reviewCodes)c.reviewCodes[n]=(c.reviewCodes[n]||0)+1;
      }catch(err){block(code,r.kind,r.path,r.index,err.code||'conversionError');}
    }
    items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':feats-features',source,metadata:{stage:'a5.5',activation:'review-required'},items});
  }
  return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,convert,prerequisite,flatPrerequisite,abilityPlan,simpleAbility,physicalId};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);if(!root||!out)fail('usage');
    const r=buildPilot(openSnapshot(root,ref));if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.features.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,activation:r.activation}));if(r.diagnostics.length)process.exitCode=2;
  }catch(err){console.error(err.code||'featureConversionFailed');process.exitCode=1;}
}
