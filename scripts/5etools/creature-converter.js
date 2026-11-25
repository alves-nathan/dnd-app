'use strict';
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver}=require('./resolver');
const fs=require('node:fs');
const path=require('node:path');

const pilot=Object.freeze({MM:'2014',XMM:'2024',BAM:'2014',LoX:'2014',AU:'2024',WoW:'unknown'});
const repository='5etools-mirror-3/5etools-src';
const sizeNames={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
const abilityKeys=['str','dex','con','int','wis','cha'];
const skillNames=['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation','Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'];
const damageTypes=new Set('acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(' '));
const conditionTypes=new Set('blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious'.split(' '));
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=x=>JSON.parse(JSON.stringify(x));
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const physicalId=(source,name)=>'upstream:main:creature:'+createHash('sha256').update(JSON.stringify([norm(source),norm(name)])).digest('hex');
const dice=/^[1-9]\d*d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i;
const crNumber=x=>x==='1/8'?0.125:x==='1/4'?0.25:x==='1/2'?0.5:/^(?:0|[1-9]|[12]\d|30)$/.test(String(x))?Number(x):null;
const pbFromCR=n=>n<=4?2:2+Math.floor((n-1)/4);
function sourceFor(code,book) {
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:pilot[code],contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
function armor(e,notes) {
  if(!Array.isArray(e.ac)||!e.ac.length) fail('invalidAC');
  if(e.ac.length===1) {
    const a=e.ac[0];
    if(nonnegative(a)) return a;
    if(record(a)&&nonnegative(a.ac)&&!a.condition&&!a.braces) {
      return {value:a.ac,...(Array.isArray(a.from)?{from:copy(a.from)}:{})};
    }
  }
  if(!e.ac.every(x=>nonnegative(x)||record(x))) fail('invalidAC');
  notes.add('dynamicOrAlternativeAC');
  return {alternatives:copy(e.ac)};
}
function hp(e,notes) {
  if(!record(e.hp)) fail('invalidHP');
  if(nonnegative(e.hp.average)&&typeof e.hp.formula==='string'&&dice.test(e.hp.formula.trim())) {
    if(e.hp.isTemporary||e.hp.special) notes.add('dynamicHP');
    else return {average:e.hp.average,formula:e.hp.formula};
  }
  if(typeof e.hp.special!=='string'&&!nonnegative(e.hp.average)) fail('invalidHP');
  notes.add('dynamicHP');
  return copy(e.hp);
}
function speed(e,notes) {
  if(nonnegative(e.speed)) return {walk:e.speed};
  if(!record(e.speed)) fail('invalidSpeed');
  const out={};
  for(const [k,v] of Object.entries(e.speed)){
    if(!['walk','burrow','climb','fly','swim'].includes(k)){
      notes.add(k==='canHover'?'hoverPending':'specialMovementPending');continue;
    }
    if(nonnegative(v)) out[k]=v;
    else if(record(v)&&nonnegative(v.number)){
      out[k]={value:v.number,...(typeof v.condition==='string'?{condition:v.condition}:{})};
      notes.add('conditionalMovement');
    } else if(typeof v==='string'){
      out[k]={original:v};notes.add('specialMovementPending');
    } else {notes.add('specialMovementPending');}
  }
  if(!Object.keys(out).length) notes.add('movementUnresolved');
  return out;
}
function scores(e) {
  const out={};
  for(const k of abilityKeys) {
    if(!Number.isInteger(e[k])||e[k]<1||e[k]>30) fail('invalidAbilityScore');
    out[k.toUpperCase()]=e[k];
  }
  return out;
}
function modifiers(v,keys,notes,code) {
  if(v===undefined) return undefined;
  if(!record(v)) {notes.add(code);return undefined;}
  const out={};
  for(const [k,n] of Object.entries(v)) {
    const key=keys.get(k.toLowerCase());
    if(key&&(Number.isInteger(n)||typeof n==='string'&&/^[+-]?\d+$/.test(n))) out[key]=Number(n);
    else notes.add(code);
  }
  return out;
}
function plainTypes(v,allowed,notes,code) {
  if(v===undefined) return undefined;
  if(!Array.isArray(v)) {notes.add(code);return undefined;}
  const out=[];
  for(const x of v) {
    if(typeof x==='string'&&allowed.has(norm(x))) out.push(norm(x));
    else notes.add(code);
  }
  return [...new Set(out)];
}
function alignment(e,notes) {
  if(e.alignment===undefined) return undefined;
  const a=e.alignment;
  const names={L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any Alignment'};
  if(Array.isArray(a)&&a.length&&a.every(x=>typeof x==='string'&&own(names,x))) return a.map(x=>names[x]).join(' ');
  notes.add('complexAlignment');return undefined;
}
function typeOf(e,notes) {
  if(typeof e.type==='string'&&e.type.trim()) return e.type;
  if(record(e.type)&&typeof e.type.type==='string'&&e.type.type.trim()) {
    if(Object.keys(e.type).some(k=>k!=='type')) notes.add('creatureTypeQualifiers');
    return e.type.type;
  }
  fail('unsupportedCreatureType');
}
function actionList(raw,actionCost,notes,metrics) {
  if(raw===undefined) return undefined;
  if(!Array.isArray(raw)) fail('invalidActionList');
  return raw.map(a=>{
    if(!record(a)||typeof a.name!=='string'||!a.name.trim()||!Array.isArray(a.entries)) fail('invalidAction');
    const out={name:a.name,actionCost};
    metrics.actions++;
    const text=a.entries.length===1&&typeof a.entries[0]==='string'?a.entries[0]:null;
    if(/\{@recharge(?: [^}]+)?\}/.test(a.name)) notes.add('rechargePending');
    if(/^Multiattack$/i.test(a.name)) {notes.add('multiattackPending');metrics.multiattacks++;}
    // Both generations of attack tags are supported; only exact single-hit,
    // single-type, no-rider patterns yield an executable-looking damage field.
    const old=text&&/^\{@atk (mw|rw|ms|rs)\} \{@hit ([+-]?\d+)\} to hit, (reach \d+ ft\.|range \d+(?:\/\d+)? ft\.), one target\. \{@h\}\s*\d+ \(\{@damage ([^{}|]+)\}\) ([a-z]+) damage\.$/i.exec(text);
    const modern=text&&/^\{@atkr (m|r)\} \{@hit ([+-]?\d+)\}, (reach \d+ ft\.|range \d+(?:\/\d+)? ft\.) \{@h\}\s*\d+ \(\{@damage ([^{}|]+)\}\) ([a-z]+) damage\.$/i.exec(text);
    const hit=old||modern;
    if(hit&&dice.test(hit[4].trim())&&damageTypes.has(norm(hit[5]))) {
      out.type='attack';out.attackBonus=Number(hit[2]);out.damageFormula=hit[4].trim();out.damageType=norm(hit[5]);
      const [rangeKind,...rest]=hit[3].split(' ');
      out[rangeKind.toLowerCase()==='reach'?'reach':'range']=rest.join(' ');
      metrics.simpleAttacks++;
    } else if(/\{@(?:atk|atkr|damage|actSave|dc)(?: [^}]+)?\}/.test(JSON.stringify(a.entries))) notes.add('complexActionPending');
    if(/\{@(?:actSave|dc)(?: [^}]+)?\}/.test(JSON.stringify(a.entries))) notes.add('saveSemanticsPending');
    return out;
  });
}
function convertCreature(recordEntry,resolved,source,commit) {
  const e=resolved.entity,notes=new Set(['effectSemanticsPending','precedencePending','runtimeCreatureIntegrationPending']);
  const metrics={actions:0,simpleAttacks:0,multiattacks:0};
  if(source.rulesEra==='unknown') notes.add('rulesEraPending');
  if(!Array.isArray(e.size)||!e.size.length||!e.size.every(x=>own(sizeNames,x))) fail('unsupportedSize');
  const sizes=e.size.map(x=>sizeNames[x]);
  if(sizes.length>1) notes.add('multipleSizes');
  const challengeRaw=record(e.cr)?e.cr.cr:e.cr;
  const n=crNumber(challengeRaw);
  const challenge=n===null?undefined:String(challengeRaw);
  if(challenge===undefined||record(e.cr)) notes.add('challengeVariantsPending');
  if(e.pbNote!==undefined) notes.add('dynamicProficiency');
  const saves=modifiers(e.save,new Map(abilityKeys.map(k=>[k,k.toUpperCase()])),notes,'specialSavesPending');
  const skills=modifiers(e.skill,new Map(skillNames.map(k=>[k.toLowerCase(),k])),notes,'specialSkillsPending');
  const resistances=plainTypes(e.resist,damageTypes,notes,'conditionalResistancesPending');
  const vulnerabilities=plainTypes(e.vulnerable,damageTypes,notes,'conditionalVulnerabilitiesPending');
  const damageImmune=plainTypes(e.immune,damageTypes,notes,'conditionalImmunitiesPending');
  const conditionImmune=plainTypes(e.conditionImmune,conditionTypes,notes,'conditionalConditionImmunitiesPending');
  const actions=actionList(e.action,'action',notes,metrics);
  const bonusActions=actionList(e.bonus,'bonusAction',notes,metrics);
  const reactions=actionList(e.reaction,'reaction',notes,metrics);
  if(e.spellcasting) notes.add('spellcastingPending');
  if(e.legendary||e.legendaryGroup||e.legendaryActionsLair) notes.add('legendaryAndLairPending');
  if(e.mythic) notes.add('mythicPending');
  if(e.trait) notes.add('traitSemanticsPending');
  if(e.initiative) notes.add('initiativeSemanticsPending');
  if(e.summonedBySpell||e.summonedByClass) notes.add('summonScalingPending');
  const payload={
    size:sizes.length===1?sizes[0]:sizes,creatureType:typeOf(e,notes),
    armorClass:armor(e,notes),hitPoints:hp(e,notes),speed:speed(e,notes),abilityScores:scores(e),
    ...(challenge===undefined?{}:{challenge}),
    ...(n===null||e.pbNote!==undefined?{}:{proficiencyBonus:pbFromCR(n)}),
    ...(saves===undefined?{}:{savingThrows:saves}),...(skills===undefined?{}:{skills}),
    ...(resistances===undefined?{}:{resistances}),...(vulnerabilities===undefined?{}:{vulnerabilities}),
    ...(damageImmune===undefined&&conditionImmune===undefined?{}:{immunities:{...(damageImmune===undefined?{}:{damage:damageImmune}),...(conditionImmune===undefined?{}:{conditions:conditionImmune})}}),
    ...(actions===undefined?{}:{actions}),...(bonusActions===undefined?{}:{bonusActions}),...(reactions===undefined?{}:{reactions}),
    ...(Array.isArray(e.trait)&&e.trait.every(record)?{traits:copy(e.trait)}:{}),
    ...(Array.isArray(e.languages)&&e.languages.every(x=>typeof x==='string')?{languages:copy(e.languages)}:{}),
    ...(Array.isArray(e.senses)&&e.senses.every(x=>typeof x==='string')?{senses:{descriptions:copy(e.senses),...(nonnegative(e.passive)?{passivePerception:e.passive}:{})}}:
      nonnegative(e.passive)?{senses:{passivePerception:e.passive}}:{}),
    mechanics:{upstreamCreature:copy(e)}
  };
  const align=alignment(e,notes);if(align!==undefined) payload.alignment=align;
  return {item:{id:physicalId(e.source,e.name),kind:'creatureStatBlock',name:e.name,
    source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
    identity:{canonicalKey:'creature:'+norm(e.name),precedenceScope:source.precedenceScope},
    precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
    provenance:{origin:'5etools',repository,commit,blob:recordEntry.blob,path:recordEntry.path,entityKey:recordEntry.key,
      index:recordEntry.index,sourceCode:e.source,resolverVersion:'a3',lineage:resolved.lineage},
    payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:copy(e.reprintedAs??[]),sourceEditionEvidence:'explicit-pilot-policy; pending review'}},metrics};
}
function buildPilot(snapshot,codes=Object.keys(pilot)) {
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c))) fail('invalidPilotSources');
  const index=snapshot.readJson('data/bestiary/index.json');
  const books=snapshot.readJson('data/books.json').book;
  const adventures=snapshot.readJson('data/adventures.json').adventure;
  if(!record(index)||!Array.isArray(books)||!Array.isArray(adventures)) fail('invalidUpstreamIndex');
  const records=[],diagnostics=[],counts=Object.create(null);
  for(const c of codes) counts[c]={total:0,converted:0,blocked:0,actions:0,simpleAttacks:0,multiattacks:0,reviewCodes:{},blockCodes:{}};
  function blocked(code,p,i,reason){
    counts[code].blocked++;counts[code].blockCodes[reason]=(counts[code].blockCodes[reason]||0)+1;
    diagnostics.push({source:code,path:p,index:i,code:reason});
  }
  for(const file of [...new Set(Object.values(index))].sort()){
    if(typeof file!=='string'||!/^[a-z0-9_-]+\.json$/i.test(file)) fail('invalidBestiaryIndexPath');
    const p='data/bestiary/'+file,j=snapshot.readJson(p);
    if(!Array.isArray(j.monster)) fail('invalidBestiaryFile');
    for(const [i,e] of j.monster.entries()){
      const tracked=record(e)&&own(counts,e.source);
      if(tracked) counts[e.source].total++;
      try{
        const key=identity('monster',e);
        records.push({id:JSON.stringify(['main',key]),key,kind:'monster',origin:'main',path:p,index:i,blob:snapshot.files.get(p),entity:e});
      }catch(err){if(tracked)blocked(e.source,p,i,err.code||'invalidIdentity');}
    }
  }
  const resolver=makeResolver(records),packs=[];
  for(const code of codes){
    const book=[...books,...adventures].find(b=>b.source===code);
    const source=sourceFor(code,book),items=[],c=counts[code];
    for(const r of records.filter(r=>r.entity.source===code)){
      try{
        const {item,metrics}=convertCreature(r,resolver.resolve(r),source,snapshot.commit);
        items.push(item);c.converted++;
        for(const k of Object.keys(metrics))c[k]+=metrics[k];
        for(const n of item.metadata.reviewCodes)c.reviewCodes[n]=(c.reviewCodes[n]||0)+1;
      }catch(err){blocked(code,r.path,r.index,err.code||'conversionError');}
    }
    items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',
      id:'upstream:main:'+code+':creatures',source,metadata:{stage:'a5.2',activation:'review-required'},items});
  }
  return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,convertCreature,physicalId,pilot,pbFromCR};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);
    if(!root||!out)fail('usage: node creature-converter.js MAIN_DIR NEW_OUTPUT_DIR [REF]');
    const r=buildPilot(openSnapshot(root,ref));
    if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.creatures.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,activation:r.activation}));
    if(r.diagnostics.length)process.exitCode=2;
  }catch(err){console.error(err.code||'creatureConversionFailed');process.exitCode=1;}
}
