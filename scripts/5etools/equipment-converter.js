'use strict';
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver}=require('./resolver');
const fs=require('node:fs');
const path=require('node:path');

const pilot=Object.freeze({PHB:'2014',XPHB:'2024',DMG:'2014',XDMG:'2024',AAG:'2014',EFA:'2024',AU:'2024',WoW:'unknown'});
const repo='5etools-mirror-3/5etools-src';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=x=>JSON.parse(JSON.stringify(x));
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const damageTypes={A:'acid',B:'bludgeoning',C:'cold',F:'fire',O:'force',L:'lightning',N:'necrotic',P:'piercing',I:'poison',Y:'psychic',R:'radiant',S:'slashing',T:'thunder'};
const weaponProperties={'2H':'two-handed',A:'ammunition',AF:'ammunition',BF:'burst fire',F:'finesse',H:'heavy',L:'light',LD:'loading',R:'reach',RLD:'reload',S:'special',T:'thrown',V:'versatile'};
const armorTypes={LA:'light',MA:'medium',HA:'heavy',S:'shield'};
const dice=/^(?:[1-9]\d*d(?:4|6|8|10|12|20|100)|[1-9]\d*)$/i;
const physicalId=(source,kind,name)=>'upstream:main:'+kind+':'+createHash('sha256').update(JSON.stringify([norm(source),norm(name)])).digest('hex');
function sourceFor(code,book){
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:pilot[code],contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
function uid(raw,defaultSource){
  if(typeof raw!=='string')fail('invalidItemReference');
  const p=raw.split('|');
  if(p.length>2||!p[0].trim())fail('invalidItemReference');
  return {key:p[0].trim(),source:p[1]?.trim()||defaultSource};
}
function definitionIndex(entries,key){
  const m=new Map();
  for(const e of entries||[]){
    if(!record(e)||typeof e[key]!=='string'||typeof e.source!=='string')continue;
    const id=JSON.stringify([norm(e[key]),norm(e.source)]);
    if(m.has(id))m.set(id,null);else m.set(id,e);
  }
  return m;
}
function lookup(index,u){
  return index.get(JSON.stringify([norm(u.key),norm(u.source)]))||null;
}
function classify(e){
  const raw=typeof e.type==='string'?e.type.split('|')[0]:'';
  if(['M','R'].includes(raw)||e.weapon===true)return 'weapon';
  if(own(armorTypes,raw)||e.armor===true)return 'armor';
  return 'equipment';
}
function costWeight(e,notes){
  const out={};
  if(nonnegative(e.value)){
    // 5e.tools monetary value is CP. Use exact denominations, not rounding.
    out.cost=e.value%100===0?{amount:e.value/100,unit:'GP'}:e.value%10===0?{amount:e.value/10,unit:'SP'}:{amount:e.value,unit:'CP'};
  }else notes.add(e.value===undefined?'costMissing':'costComplexPending');
  if(nonnegative(e.weight))out.weight=e.weight;
  else if(e.weight!==undefined)notes.add('weightComplexPending');
  if(e.packContents!==undefined)notes.add('packContentsPending');
  if(e.additionalEntries!==undefined)notes.add('additionalEntriesPending');
  return out;
}
function propertyRefs(e,defs,notes){
  const props=[],refs=[];
  if(e.property===undefined)return {props,refs};
  if(!Array.isArray(e.property))fail('invalidWeaponProperties');
  for(const p of e.property){
    const raw=record(p)?p.uid:p;
    const code=typeof raw==='string'?raw.split('|')[0]:'';
    // Legacy unqualified reload/burst/firearm ammunition references use DMG.
    const u=uid(raw,['AF','BF','RLD'].includes(code)?'DMG':'PHB');
    const def=lookup(defs.properties,u),name=own(weaponProperties,u.key)?weaponProperties[u.key]:undefined;
    refs.push({uid:raw,resolved:!!def,...(record(p)?{condition:copy(p)}:{})});
    if(!def||!name){notes.add('propertyReferencePending');continue;}
    if(record(p)){notes.add('conditionalWeaponProperty');continue;}
    if(!props.includes(name))props.push(name);
    if(['S','BF','RLD','AF'].includes(u.key))notes.add('specialWeaponMechanicsPending');
  }
  return {props,refs};
}
function masteries(e,defs,notes){
  if(e.mastery===undefined)return {refs:[]};
  if(!Array.isArray(e.mastery))fail('invalidMastery');
  const refs=e.mastery.map(raw=>{
    const u=uid(raw,'XPHB'),def=lookup(defs.masteries,u);
    if(!def)notes.add('masteryReferencePending');
    return {uid:raw,...(def?{name:def.name}:{})};
  });
  if(refs.length!==1){if(refs.length)notes.add('multipleMasteriesPending');return {refs};}
  if(refs[0].name)notes.add('masterySemanticsPending');
  return {refs,...(refs[0].name?{mastery:refs[0].name}:{})};
}
// Exact qualified references observed in the immutable Main item index.
// Runtime tokens are existing ammunitionRules.ts types. No default edition,
// fuzzy name, plural/bundle inference, magic ammunition or unqualified UID.
const standardAmmo=Object.freeze({
  'arrow|phb':'arrow','arrow|xphb':'arrow',
  'crossbow bolt|phb':'bolt','bolt|xphb':'bolt',
  'blowgun needle|phb':'needle','needle|xphb':'needle',
  'sling bullet|phb':'sling-bullet','sling bullet|xphb':'sling-bullet',
  'firearm bullet|xphb':'firearm-bullet'
});
function ammunitionCandidate(e,defs,props,refs,notes){
  if(e.ammoType===undefined)return {};
  // Require one unconditional, resolved standard Ammunition property.
  // Burst/reload/AF and special modes remain manual review.
  const standard=refs.filter(r=>r.resolved&&!r.condition&&typeof r.uid==='string'&&r.uid.split('|')[0]==='A');
  if(typeof e.ammoType!=='string'||!defs.ammunition||standard.length!==1||
      !props.includes('ammunition')||refs.some(r=>typeof r.uid==='string'&&['AF','BF','RLD','S'].includes(r.uid.split('|')[0]))||
      props.some(p=>['burst fire','reload','special'].includes(p))||
      e.reload!==undefined||notes.has('conditionalWeaponProperty')||notes.has('propertyReferencePending')){
    notes.add('ammunitionReferencePending');return {};
  }
  const parts=e.ammoType.split('|');
  const key=parts.length===2?parts.map(norm).join('|'):'';
  const token=own(standardAmmo,key)?standardAmmo[key]:undefined;
  const target=token?lookup(defs.ammunition,{key:parts[0],source:parts[1]}):null;
  if(!target||target.rarity!=='none'||typeof target.type!=='string'||target.type.split('|')[0]!=='A'||
      ['_copy','_versions','_mod','_preserve'].some(k=>own(target,k))){
    notes.add('ammunitionReferencePending');return {};
  }
  notes.add('ammunitionConsumptionSemanticsPending');
  return {ammunitionType:token,ammunitionReference:{uid:e.ammoType,targetName:target.name,targetSource:target.source,status:'qualifiedTypeCandidate'}};
}
function weapon(e,defs,notes){
  const type=uid(e.type,'PHB');
  if(!['M','R'].includes(type.key))fail('unsupportedWeaponType');
  if(typeof e.dmg1!=='string'||!dice.test(e.dmg1.trim()))fail('weaponDamageUnresolved');
  if(!own(damageTypes,e.dmgType))fail('weaponDamageTypeUnresolved');
  const {props,refs}=propertyRefs(e,defs,notes);
  const m=masteries(e,defs,notes);
  const category=['simple','martial'].includes(e.weaponCategory)?e.weaponCategory:'unknown';
  if(category==='unknown')notes.add('weaponCategoryPending');
  const finesse=props.includes('finesse'),thrown=props.includes('thrown');
  const ability=finesse?{kind:'choice',options:['STR','DEX']}:type.key==='R'?'DEX':'STR';
  const formulaAbility=finesse?'STR_OR_DEX':ability;
  const out={weaponCategory:category,weaponType:finesse?'finesse':thrown?'thrown':type.key==='R'?'ranged':'melee',
    actionCost:'action',attackAbility:ability,damageAbility:ability,damageFormula:e.dmg1.trim()+' + '+formulaAbility,
    damageDie:e.dmg1.trim(),damageType:damageTypes[e.dmgType],properties:props,
    ...(m.mastery?{mastery:m.mastery}:{}),...costWeight(e,notes)};
  if(e.dmg2!==undefined){
    if(typeof e.dmg2==='string'&&dice.test(e.dmg2.trim()))out.versatileDamageFormula=e.dmg2.trim()+' + '+formulaAbility;
    else notes.add('versatileDamagePending');
  }
  if(e.range!==undefined){
    const r=typeof e.range==='string'&&/^(\d+)(?:\/(\d+))?$/.exec(e.range);
    if(r&&Number(r[1])>0&&(!r[2]||Number(r[2])>=Number(r[1])))out.range={normal:Number(r[1]),...(r[2]?{long:Number(r[2])}:{}),unit:'ft'};
    else notes.add('rangePending');
  }
  const {ammunitionType,ammunitionReference}=ammunitionCandidate(e,defs,props,refs,notes);
  if(ammunitionType)out.ammunitionType=ammunitionType;
  if(e.reload!==undefined)notes.add('reloadMechanicsPending');
  if(record(e.property)||notes.has('conditionalWeaponProperty')||notes.has('propertyReferencePending'))notes.add('weaponUsageReviewRequired');
  return {...out,mechanics:{propertyReferences:refs,masteryReferences:m.refs,...(ammunitionReference?{ammunitionReference}:{}),upstreamItem:copy(e)}};
}
function armor(e,notes){
  const type=uid(e.type,'PHB');
  const category=armorTypes[type.key];
  if(!category||!nonnegative(e.ac)||e.ac===0)fail('armorACUnresolved');
  const shield=category==='shield';
  const out={armorCategory:category,baseAC:shield?0:e.ac,
    ...(shield?{acBonus:e.ac,stacksWithArmor:true}:{dexCap:category==='heavy'?0:category==='medium'?2:null,stacksWithArmor:false}),
    stealthDisadvantage:e.stealth===true,...costWeight(e,notes)};
  if(e.strength!==undefined){
    if(/^\d+$/.test(String(e.strength)))out.strengthRequirement=Number(e.strength);
    else notes.add('strengthRequirementPending');
  }
  // Keep the V2 dexCap projection unchanged; heavy armor's fixed AC
  // cannot be expressed by Math.min(DEX,0) for negative modifiers.
  if(category==='heavy')notes.add('heavyArmorNegativeDexRuntimeReview');
  return {...out,mechanics:{upstreamItem:copy(e),armorClassCandidate:{
    dexterity:shield?'additiveShield':category==='heavy'?'ignoreModifier':category==='medium'?'capAtTwo':'fullModifier',
    baseAC:out.baseAC,...(shield?{acBonus:out.acBonus}:{}),status:'review-required'
  }}};
}
function equipment(e,defs,notes){
  if(typeof e.type!=='string')fail('equipmentTypeUnresolved');
  const u=uid(e.type,'PHB'),def=lookup(defs.types,u);
  if(!def)notes.add('equipmentTypeReferencePending');
  // No promotion of bundles/containers into item grants until reference resolution.
  return {...costWeight(e,notes),equipmentCategory:def?.name||u.key,
    mechanics:{upstreamItem:copy(e),typeReference:{uid:e.type,resolved:!!def}}};
}
function convertItem(r,resolved,source,defs,commit){
  const e=resolved.entity,kind=classify(e),notes=new Set(['effectSemanticsPending','precedencePending']);
  if(source.rulesEra==='unknown')notes.add('rulesEraPending');
  const expected=e.edition==='classic'?'2014':e.edition==='one'?'2024':undefined;
  if(expected&&source.rulesEra!=='unknown'&&expected!==source.rulesEra)notes.add('editionConflictPending');
  const payload=kind==='weapon'?weapon(e,defs,notes):kind==='armor'?armor(e,notes):equipment(e,defs,notes);
  return {id:physicalId(e.source,kind,e.name),kind,name:e.name,
    source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
    identity:{canonicalKey:kind+':'+norm(e.name),precedenceScope:source.precedenceScope},
    precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
    provenance:{origin:'5etools',repository:repo,commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,
      sourceCode:e.source,resolverVersion:'a3',lineage:resolved.lineage},
    payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:copy(e.reprintedAs??[]),sourceEditionEvidence:'explicit-pilot-policy; pending review'}};
}
function buildPilot(snapshot,codes=Object.keys(pilot)){
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c)))fail('invalidPilotSources');
  const base=snapshot.readJson('data/items-base.json'),items=snapshot.readJson('data/items.json');
  const books=snapshot.readJson('data/books.json').book;
  if(!Array.isArray(base.baseitem)||!Array.isArray(items.item)||!Array.isArray(books))fail('invalidItemIndex');
  const defs={properties:definitionIndex(base.itemProperty,'abbreviation'),masteries:definitionIndex(base.itemMastery,'name'),types:definitionIndex(base.itemType,'abbreviation'),ammunition:definitionIndex([...base.baseitem,...items.item],'name')};
  const records=[],diagnostics=[],counts=Object.create(null);
  for(const c of codes)counts[c]={observed:0,eligible:0,converted:0,blocked:0,excludedMagicOrUnclassified:0,kinds:{weapon:0,armor:0,equipment:0},reviewCodes:{},blockCodes:{}};
  function blocked(code,p,i,reason){
    const c=counts[code];c.blocked++;c.blockCodes[reason]=(c.blockCodes[reason]||0)+1;
    diagnostics.push({source:code,path:p,index:i,code:reason});
  }
  for(const [p,kind,entries] of [['data/items-base.json','baseitem',base.baseitem],['data/items.json','item',items.item]]){
    for(const [i,e] of entries.entries()){
      const tracked=record(e)&&own(counts,e.source);
      const eligible=record(e)&&(e.rarity==='none'||(e.mundane===true&&e.rarity===undefined));
      if(tracked){counts[e.source].observed++;if(eligible)counts[e.source].eligible++;else counts[e.source].excludedMagicOrUnclassified++;}
      try{
        const key=identity(kind,e);
        records.push({id:JSON.stringify(['main',key]),key,kind,origin:'main',path:p,index:i,blob:snapshot.files.get(p),entity:e,eligible});
      }catch(err){if(tracked&&eligible)blocked(e.source,p,i,err.code||'invalidIdentity');}
    }
  }
  const resolver=makeResolver(records),packs=[];
  for(const code of codes){
    const c=counts[code],book=books.find(b=>b.source===code);
    const source=sourceFor(code,book),candidates=[];
    for(const r of records.filter(r=>r.entity.source===code&&r.eligible)){
      try{
        const resolved=resolver.resolve(r);
        if(resolved.entity.rarity!=='none'&&!(resolved.entity.mundane===true&&resolved.entity.rarity===undefined))fail('nonmagicalClassificationConflict');
        candidates.push({r,item:convertItem(r,resolved,source,defs,snapshot.commit)});
      }catch(err){blocked(code,r.path,r.index,err.code||'conversionError');}
    }
    const frequencies=new Map();
    for(const {item} of candidates)frequencies.set(item.id,(frequencies.get(item.id)||0)+1);
    const out=[];
    for(const {r,item} of candidates){
      if(frequencies.get(item.id)>1){blocked(code,r.path,r.index,'duplicatePhysicalId');continue;}
      out.push(item);c.converted++;c.kinds[item.kind]++;
      for(const n of item.metadata.reviewCodes)c.reviewCodes[n]=(c.reviewCodes[n]||0)+1;
    }
    out.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',
      id:'upstream:main:'+code+':equipment',source,metadata:{stage:'a5.3',activation:'review-required'},items:out});
  }
  return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,convertItem,physicalId,pilot,classify,weapon,armor,equipment,definitionIndex,costWeight};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);
    if(!root||!out)fail('usage: node equipment-converter.js MAIN_DIR NEW_OUTPUT_DIR [REF]');
    const r=buildPilot(openSnapshot(root,ref));
    if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.equipment.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,activation:r.activation}));
    if(r.diagnostics.length)process.exitCode=2;
  }catch(err){console.error(err.code||'equipmentConversionFailed');process.exitCode=1;}
}
