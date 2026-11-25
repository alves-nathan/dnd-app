'use strict';
const { createHash } = require('node:crypto');
const { openSnapshot } = require('./inventory');
const { identity, makeResolver } = require('./resolver');
const fs = require('node:fs');
const path = require('node:path');
const repository = '5etools-mirror-3/5etools-src';
const pilot = Object.freeze({
  PHB:{era:'2014',classSources:['PHB','TCE']},
  XPHB:{era:'2024',classSources:['XPHB','EFA']},
  AU:{era:'2024',classSources:['XPHB','EFA']},
  WoW:{era:'unknown',classSources:['WoW','XPHB']}
});
const schools = {A:'Abjuration',C:'Conjuration',D:'Divination',E:'Enchantment',V:'Evocation',I:'Illusion',N:'Necromancy',T:'Transmutation'};
const abilities = {strength:'STR',dexterity:'DEX',constitution:'CON',intelligence:'INT',wisdom:'WIS',charisma:'CHA'};
const damages = new Set('acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(' '));
const rec = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const clone = x => JSON.parse(JSON.stringify(x));
const norm = x => typeof x === 'string' ? x.trim().toLowerCase() : '';
const fail = code => { const e = Error(code); e.code = code; throw e; };
const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const scalarDice = /^[1-9]\d*d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i;
const physicalId = (source,name) => 'upstream:main:spell:' + createHash('sha256').update(JSON.stringify([norm(source),norm(name)])).digest('hex');
const canonicalKey = name => 'spell:' + norm(name);
const array = x => Array.isArray(x) ? x : [];
function castingTime(e,notes) {
  if (!Array.isArray(e.time) || !e.time.length || e.time.some(t => !rec(t) || !positive(t.number) || typeof t.unit !== 'string')) fail('invalidCastingTime');
  const t = e.time[0], ritualAlternative = e.meta?.ritual === true;
  if (e.time.length > 1) {
    notes.add('multipleCastingTimes');
    return {kind:'special',label:e.time.map(x => x.number+' '+x.unit).join(' / '),ritualAlternative};
  }
  const actionCost = {action:'action',bonus:'bonusAction',reaction:'reaction'}[t.unit];
  if (actionCost && t.number === 1) return {kind:'action',actionCost,ritualAlternative,...(typeof t.condition === 'string'?{trigger:t.condition}:{})};
  if (['minute','hour','day'].includes(t.unit)) return {kind:'duration',amount:t.number,unit:t.unit,ritualAlternative};
  notes.add('specialCastingTime');
  return {kind:'special',label:t.number+' '+t.unit,ritualAlternative};
}
function rangeOf(e,notes) {
  const r=e.range;
  if (!rec(r) || typeof r.type !== 'string') fail('invalidRange');
  const d=r.distance;
  if (r.type === 'special') {notes.add('specialRange');return {range:'Special'};}
  if (!rec(d) || typeof d.type !== 'string') fail('invalidRange');
  const u={feet:'ft',miles:'mi'}[d.type];
  if (u) {
    if (!positive(d.amount)) fail('invalidRange');
    if (r.type === 'point') return {range:d.amount+' '+u};
    if (!['radius','sphere','hemisphere','line','cone','cube','emanation','cylinder'].includes(r.type)) notes.add('unknownAreaShape');
    return {range:'Self ('+d.amount+' '+u+' '+r.type+')',area:{shape:r.type,distance:d.amount,unit:u,origin:'self',sourceRangeType:r.type}};
  }
  if (r.type !== 'point') notes.add('specialRange');
  const label={self:'Self',touch:'Touch',sight:'Sight',unlimited:'Unlimited',plane:'Same plane'}[d.type];
  if (!label) notes.add('specialRange');
  return {range:label || d.type};
}
function durationOf(e,notes) {
  if (!Array.isArray(e.duration) || !e.duration.length || e.duration.some(d => !rec(d) || typeof d.type !== 'string')) fail('invalidDuration');
  if (e.duration.length > 1) notes.add('multipleDurations');
  const labels=e.duration.map(d => {
    if(d.type==='instant') return 'Instantaneous';
    if(d.type==='timed' && rec(d.duration) && positive(d.duration.amount) && typeof d.duration.type==='string')
      return (d.concentration?'Concentration, up to ':d.duration.upTo?'Up to ':'')+d.duration.amount+' '+d.duration.type+(d.duration.amount===1?'':'s');
    if(d.type==='permanent') return Array.isArray(d.ends) && d.ends.length?'Until '+d.ends.join(' or '):'Permanent';
    notes.add('specialDuration'); return 'Special';
  });
  return {duration:labels.join(' / '),...(e.duration.length===1?{concentration:e.duration[0].concentration===true}:{})};
}
function componentsOf(e,notes) {
  if (!rec(e.components)) fail('invalidComponents');
  const c=e.components,m=c.m;
  if (Object.keys(c).some(k=>!['v','s','m'].includes(k))) notes.add('specialComponents');
  if (m !== undefined && m !== true && m !== false && typeof m !== 'string' && !rec(m)) fail('invalidMaterial');
  if (rec(m) && (m.cost !== undefined || m.consume !== undefined)) notes.add('materialCostOrConsumption');
  return {verbal:c.v===true,somatic:c.s===true,material:!!m,
    ...(typeof m==='string'?{materialDescription:m}:rec(m)&&typeof m.text==='string'?{materialDescription:m.text}:{})};
}
// Tags are observations, not executable effects. Base damage is promoted only for a
// narrow single-target, single-attack pattern with no conflicting damage tags.
// All other formulas, healing, area saves and scaling await dedicated conversion.
function inspectDamage(e,notes) {
  const entries=JSON.stringify(e.entries ?? []);
  const tags=[...entries.matchAll(/\{@damage ([^{}|]+)(?:\|[^{}]*)?\}/g)].map(m=>m[1].trim());
  const types=array(e.damageInflict).filter(x=>damages.has(x));
  const output={};
  const direct=Array.isArray(e.entries)&&e.entries.length===1&&typeof e.entries[0]==='string'&&
    /^Make a (?:melee|ranged) spell attack(?: against the target)?\. On a hit, the target takes \{@damage ([^{}|]+)\} ([A-Za-z]+) damage\.$/i.exec(e.entries[0]);
  const attacks=array(e.spellAttack);
  if (direct && tags.length===1 && types.length===1 && types[0]===norm(direct[2]) &&
      scalarDice.test(direct[1]) && attacks.length===1 && attacks[0]===(/melee/i.test(e.entries[0])?'M':'R') &&
      e.duration.length===1 && e.duration[0].type==='instant' && !array(e.savingThrow).length) {
    output.damageFormula=direct[1].trim(); output.damageType=types[0];
  } else if(tags.length||types.length) notes.add('damageSemanticsPending');
  if (e.entriesHigherLevel || e.scalingLevelDice) notes.add('scalingSemanticsPending');
  return {output,tags,types};
}
function classAccess(e,lookup,policy,notes) {
  const entry=lookup[norm(e.source)]?.[norm(e.name)];
  if (!rec(entry) || !rec(entry.class)) fail('missingClassAccess');
  const direct=[];
  for (const source of policy.classSources) {
    const group=entry.class[source];
    if (!rec(group)) continue;
    for (const [name,details] of Object.entries(group)) {
      if (!name.trim() || !(details===true||rec(details))) continue;
      direct.push({name,source,details:clone(details)});
    }
  }
  if (!direct.length) fail('missingEligibleClassAccess');
  notes.add('classIdsPending');
  if (Object.keys(entry).some(k=>k!=='class')) notes.add('additionalAccessPending');
  return {classes:[...new Set(direct.map(c=>c.name))].sort(),direct,all:clone(entry)};
}
function makeSource(code,book,policy) {
  const date=book?.published;
  if (typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',
    rulesEra:policy.era,contentType:'official',precedenceScope:'official-dnd',
    publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:data/books.json'}};
}
function convertSpell(record,resolved,lookup,source,policy,commit) {
  const e=resolved.entity;
  const notes=new Set(['effectSemanticsPending','precedencePending']);
  if(source.rulesEra==='unknown') notes.add('rulesEraPending');
  if(!Number.isInteger(e.level)||e.level<0||e.level>9) fail('invalidSpellLevel');
  if(!own(schools,e.school)) fail('unknownSchool');
  if(!Array.isArray(e.entries)) fail('invalidEntries');
  const access=classAccess(e,lookup,policy,notes);
  const damage=inspectDamage(e,notes);
  const saves=array(e.savingThrow);
  const attacks=array(e.spellAttack);
  if(saves.length>1||saves.some(s=>!own(abilities,s))) notes.add('multipleOrUnknownSaves');
  if(attacks.some(a=>!['M','R'].includes(a))||attacks.length>1) notes.add('multipleOrUnknownAttackModes');
  const payload={
    level:e.level,school:schools[e.school],classes:access.classes,castingTime:castingTime(e,notes),
    ...rangeOf(e,notes),...durationOf(e,notes),components:componentsOf(e,notes),ritual:e.meta?.ritual===true,
    ...(saves.length===1&&own(abilities,saves[0])?{saveAbility:abilities[saves[0]]}:{}),
    ...(attacks.length===1&&['M','R'].includes(attacks[0])?{requiresAttackRoll:true}:{}),
    ...damage.output,
    mechanics:{upstreamSpell:{
      access:access.all,selectedClassAccess:access.direct,time:clone(e.time),range:clone(e.range),duration:clone(e.duration),
      components:clone(e.components),entries:clone(e.entries),entriesHigherLevel:clone(e.entriesHigherLevel??[]),
      scalingLevelDice:clone(e.scalingLevelDice??null),damageTags:damage.tags,damageTypes:damage.types,
      savingThrow:saves,spellAttack:attacks,conditionInflict:array(e.conditionInflict),miscTags:array(e.miscTags),
      damageResist:array(e.damageResist),damageImmune:array(e.damageImmune),damageVulnerable:array(e.damageVulnerable),
      abilityCheck:array(e.abilityCheck),conditionImmune:array(e.conditionImmune),areaTags:array(e.areaTags)
    }}
  };
  return {id:physicalId(e.source,e.name),kind:'spell',name:e.name,
    source:{...source,...(e.page!==undefined?{page:String(e.page)}:{})},
    identity:{canonicalKey:canonicalKey(e.name),precedenceScope:source.precedenceScope},
    precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
    provenance:{origin:'5etools',repository,commit,blob:record.blob,path:record.path,
      entityKey:record.key,index:record.index,sourceCode:e.source,resolverVersion:'a3',lineage:resolved.lineage},
    payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:clone(e.reprintedAs??[]),
      sourceEditionEvidence:'explicit-pilot-policy; pending review'}};
}
function buildPilot(snapshot,codes=Object.keys(pilot)) {
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c))) fail('invalidPilotSources');
  const index=snapshot.readJson('data/spells/index.json');
  const lookup=snapshot.readJson('data/generated/gendata-spell-source-lookup.json');
  const books=snapshot.readJson('data/books.json').book;
  if(!rec(index)||!rec(lookup)||!Array.isArray(books)) fail('invalidUpstreamIndex');
  // Index every spell file so cross-source copies can resolve; emit only configured pilot sources.
  const records=[],diagnostics=[],counts=Object.create(null);
  for(const code of codes) counts[code]={total:0,converted:0,blocked:0,baseDamageMapped:0,reviewCodes:{}};
  const paths=[...new Set(Object.values(index))].sort();
  for(const file of paths) {
    const p='data/spells/'+file;
    const json=snapshot.readJson(p);
    if(!Array.isArray(json.spell)) fail('invalidSpellFile');
    for(const [i,e] of json.spell.entries()) {
      const tracked=rec(e)&&own(counts,e.source);
      if(tracked) counts[e.source].total++;
      try {
        const key=identity('spell',e);
        records.push({id:JSON.stringify(['main',key]),key,kind:'spell',origin:'main',path:p,index:i,blob:snapshot.files.get(p),entity:e});
      } catch(err) {
        if(tracked) {counts[e.source].blocked++;diagnostics.push({source:e.source,path:p,index:i,code:err.code||'invalidIdentity'});}
      }
    }
  }
  const resolver=makeResolver(records);
  const packs=[];
  for(const code of codes) {
    const book=books.find(b=>b.source===code);
    const source=makeSource(code,book,pilot[code]);
    const items=[];
    for(const record of records.filter(r=>r.entity.source===code)) {
      try {
        const item=convertSpell(record,resolver.resolve(record),lookup,source,pilot[code],snapshot.commit);
        items.push(item);counts[code].converted++;
        if(item.payload.damageFormula) counts[code].baseDamageMapped++;
        for(const n of item.metadata.reviewCodes) counts[code].reviewCodes[n]=(counts[code].reviewCodes[n]||0)+1;
      } catch(err) {
        counts[code].blocked++;diagnostics.push({source:code,path:record.path,index:record.index,code:err.code||'conversionError'});
      }
    }
    items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',
      id:'upstream:main:'+code+':spells',source,metadata:{stage:'a5.1',activation:'review-required'},items});
  }
  return {commit:snapshot.commit,packs,counts,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,convertSpell,physicalId,pilot};
if(require.main===module) {
  try {
    const [root,out,ref]=process.argv.slice(2);
    if(!root||!out) fail('usage: node spell-converter.js MAIN_DIR NEW_OUTPUT_DIR [REF]');
    const result=buildPilot(openSnapshot(root,ref));
    if(fs.existsSync(out)) fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const pack of result.packs) fs.writeFileSync(path.join(out,pack.source.id.split(':').at(-1)+'.spells.v3.json'),JSON.stringify(pack,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:result.commit,counts:result.counts,diagnostics:result.diagnostics,activation:result.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:result.commit,counts:result.counts,activation:result.activation}));
    if(result.diagnostics.length) process.exitCode=2;
  } catch(err) { console.error(err.code||'spellConversionFailed');process.exitCode=1; }
}
