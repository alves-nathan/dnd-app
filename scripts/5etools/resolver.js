'use strict';

// Conservative, offline staging resolver. Unsupported operations never emit a partial entity.
const { openSnapshot } = require('./inventory');
const fs = require('node:fs');
const path = require('node:path');
const kinds = new Set(['class','subclass','classFeature','subclassFeature','race','subrace','background','feat','spell','monster','item','baseitem','itemGroup','magicvariant','optionalfeature','condition','disease','status','action','variantrule','legendaryGroup','reward','vehicle','trap','hazard','object','psionic','charoption','facility','itemProperty','itemType','itemMastery','language','skill','sense','table','tableGroup','deck','card','deity','cult','boon']);
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = x => JSON.parse(JSON.stringify(x));
const norm = x => typeof x === 'string' ? x.trim().toLowerCase() : '';
const bad = new Set(['__proto__','prototype','constructor']);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function fail(code, detail) { const e = new Error(detail); e.code = code; throw e; }
function identity(kind, e) {
  const name = norm(e.name ?? e.abbreviation);
  const source = norm(e.source);
  if (!name || !source) fail('invalidIdentity', kind + ': missing name or source');
  const parts = [kind, name, source];
  if (['subclass','classFeature','subclassFeature'].includes(kind)) parts.push(norm(e.className),norm(e.classSource));
  if (kind === 'subclass') parts.push(norm(e.shortName ?? e.name));
  if (kind === 'subclassFeature') parts.push(norm(e.subclassShortName),norm(e.subclassSource));
  if (['classFeature','subclassFeature'].includes(kind)) {
    if (!Number.isInteger(Number(e.level)) || Number(e.level) < 1) fail('invalidIdentity',kind + ': invalid level');
    parts.push(String(e.level));
  }
  if (kind === 'subrace') parts.push(norm(e.raceName),norm(e.raceSource));
  if (parts.some(x => !x)) fail('invalidIdentity',kind + ': missing owner discriminator');
  return JSON.stringify(parts);
}
function mainEntityFile(p) {
  return /^data\/[^/]+\.json$/.test(p) && !/(?:^|\/)(?:fluff-|foundry-)/.test(p) ||
    /^data\/(?:class\/class-|spells\/spells-|bestiary\/bestiary-)[^/]+\.json$/.test(p) ||
    p === 'data/bestiary/legendarygroups.json';
}
function collect(main, homebrew) {
  const diagnostics = [], records = [];
  const brewIndex = homebrew.readJson('_generated/index-sources.json');
  if (!isRecord(brewIndex)) fail('invalidIndex','homebrew source index');
  const paths = { main: [...main.files.keys()].filter(mainEntityFile),
    homebrew: [...new Set(Object.values(brewIndex))] };
  for (const [origin,snapshot] of Object.entries({main,homebrew})) {
    for (const p of paths[origin].sort()) {
      let json;
      try { json = snapshot.readJson(p); } catch (e) {
        diagnostics.push({code:'unreadableFile',origin,path:p,detail:e.message}); continue;
      }
      if (!isRecord(json)) continue;
      for (const [kind, entries] of Object.entries(json)) {
        if (!kinds.has(kind) || !Array.isArray(entries)) continue;
        for (const [index,entity] of entries.entries()) {
          try {
            if (!isRecord(entity)) fail('invalidEntity','Expected object');
            const key = identity(kind,entity);
            records.push({id:JSON.stringify([origin,key]),key,kind,origin,path:p,index,blob:snapshot.files.get(p),entity});
          } catch (e) { diagnostics.push({code:e.code || 'invalidEntity',origin,path:p,kind,index,detail:e.message}); }
        }
      }
    }
  }
  return {records,diagnostics};
}
const preserveBase = new Set('page otherSources referenceSources srd srd52 basicRules basicRules2024 reprintedAs hasFluff hasFluffImages hasToken tokenCredit tokenCustom foundryTokenScale altArt _versions'.split(' '));
const preserveByKind = {monster:new Set('legendaryGroup environment soundClip altArt variant dragonCastingColor familiar'.split(' ')),
  item:new Set(['lootTables','tier']),itemGroup:new Set(['lootTables','tier']),baseitem:new Set(['lootTables','tier']),magicvariant:new Set(['lootTables','tier'])};
function merge(kind,base,child) {
  const out = copy(child), meta = out._copy;
  for (const [k,v] of Object.entries(base)) {
    if (bad.has(k)) fail('unsafeProperty',k);
    if (own(out,k) && out[k] === null) { delete out[k]; continue; }
    if (own(out,k)) continue;
    if ((preserveBase.has(k) || preserveByKind[kind]?.has(k)) && !(meta._preserve?.['*'] || meta._preserve?.[k])) continue;
    out[k] = copy(v);
  }
  delete out._copy;
  return out;
}
function applyMods(entity, mods) {
  if (!isRecord(mods)) fail('unsupportedMod','Expected modification object');
  for (const [prop, ops] of Object.entries(mods)) {
    if (bad.has(prop) || prop === '*' || prop === '_' || prop.includes('.')) fail('unsupportedModPath',prop);
    for (const m of Array.isArray(ops) ? ops : [ops]) {
      if (!isRecord(m) || typeof m.mode !== 'string') fail('unsupportedMod',prop);
      // Dynamic text, regex and other modifier families require a dedicated implementation.
      if (JSON.stringify(m).includes('<$')) fail('unsupportedDynamicMod',prop);
      const arr = entity[prop];
      const items = own(m,'items') ? (Array.isArray(m.items) ? copy(m.items) : [copy(m.items)]) : null;
      const name = x => isRecord(x) ? x.name : x;
      if (m.mode === 'appendArr' || m.mode === 'prependArr') {
        if (!items || (arr !== undefined && !Array.isArray(arr))) fail('invalidModTarget',prop);
        entity[prop] = m.mode === 'appendArr' ? [...(arr || []),...items] : [...items,...(arr || [])];
      } else if (m.mode === 'insertArr') {
        if (!items || !Array.isArray(arr) || !Number.isInteger(m.index) || m.index < -1 || m.index > arr.length) fail('invalidModTarget',prop);
        arr.splice(m.index === -1 ? arr.length : m.index,0,...items);
      } else if (m.mode === 'replaceArr' || m.mode === 'replaceOrAppendArr') {
        if (!items || (!Array.isArray(arr) && !(arr === undefined && m.mode === 'replaceOrAppendArr'))) fail('invalidModTarget',prop);
        if (!(typeof m.replace === 'string' || (isRecord(m.replace) && Number.isInteger(m.replace.index) && !own(m.replace,'regex')))) fail('unsupportedModSelector',prop);
        const index = typeof m.replace === 'string' ? (arr || []).findIndex(x => name(x) === m.replace) : m.replace.index;
        if (index >= 0 && index < (arr || []).length) arr.splice(index,1,...items);
        else if (m.mode === 'replaceOrAppendArr') entity[prop] = [...(arr || []),...items];
        else fail('missingModTarget',prop);
      } else fail('unsupportedModMode',m.mode + ':' + prop);
    }
  }
  return entity;
}
function makeResolver(records) {
  const index = new Map(), memo = new Map();
  for (const r of records) {
    const matches = index.get(r.id) || []; matches.push(r); index.set(r.id,matches);
  }
  function lookup(origin,kind,target) {
    const key = identity(kind,target);
    const local = index.get(JSON.stringify([origin,key])) || [];
    const matches = local.length || origin === 'main' ? local : index.get(JSON.stringify(['main',key])) || [];
    if (matches.length !== 1) fail(matches.length ? 'ambiguousReference' : 'missingReference',key);
    return matches[0];
  }
  function resolve(r, stack = new Set()) {
    if ((index.get(r.id) || []).length !== 1) fail('ambiguousIdentity',r.id);
    if (stack.has(r.id)) fail('copyCycle',r.id);
    if (stack.size >= 100) fail('copyDepthExceeded',r.id);
    if (memo.has(r.id)) return copy(memo.get(r.id));
    let entity = copy(r.entity), lineage = [];
    if (entity._copy) {
      const meta = entity._copy;
      if (!isRecord(meta)) fail('invalidCopy',r.id);
      if (Object.keys(meta).some(k => !['name','source','className','classSource','shortName','subclassShortName','subclassSource','raceName','raceSource','level','_preserve','_mod'].includes(k))) fail('unsupportedCopyMetadata',r.id);
      const base = lookup(r.origin,r.kind,meta);
      const parent = resolve(base,new Set([...stack,r.id]));
      entity = merge(r.kind,parent.entity,entity);
      if (meta._mod) applyMods(entity,meta._mod);
      lineage = [base.id,...parent.lineage];
    }
    if (entity._mod || entity._templates || entity._versions) fail('unsupportedVariantOrTemplate',r.id);
    const value = {entity,lineage};
    memo.set(r.id,copy(value));
    return value;
  }
  function featureTarget(kind, uid) {
    if (typeof uid !== 'string') fail('invalidFeatureUid',kind);
    const p = uid.split('|');
    if (kind === 'classFeature' && p.length >= 4 && p.length <= 5) return {name:p[0],className:p[1],classSource:p[2] || 'PHB',level:Number(p[3]),source:p[4] || p[2] || 'PHB'};
    if (kind === 'subclassFeature' && p.length >= 6 && p.length <= 7) return {name:p[0],className:p[1],classSource:p[2] || 'PHB',subclassShortName:p[3],subclassSource:p[4] || p[2] || 'PHB',level:Number(p[5]),source:p[6] || p[4] || p[2] || 'PHB'};
    fail('invalidFeatureUid',uid);
  }
  function references(r, entity) {
    const result = [];
    if (r.kind === 'subclass') result.push({relation:'classOwner',target:lookup(r.origin,'class',{name:entity.className,source:entity.classSource}).id});
    for (const [field,kind] of [['classFeatures','classFeature'],['subclassFeatures','subclassFeature']]) {
      if (entity[field] === undefined) continue;
      if (!Array.isArray(entity[field])) fail('invalidFeatureList',field);
      for (const ref of entity[field]) {
        const uid = typeof ref === 'string' ? ref : ref?.[kind];
        const target = lookup(r.origin,kind,featureTarget(kind,uid));
        result.push({relation:kind,target:target.id});
      }
    }
    return result;
  }
  return {resolve,lookup,references};
}
function audit(main,homebrew) {
  const {records,diagnostics} = collect(main,homebrew);
  const resolver = makeResolver(records);
  const counts = {}, entities = [];
  for (const r of records) {
    const key = r.origin + ':' + r.kind;
    const c = counts[key] ||= {total:0,resolvedSubset:0,blocked:0};
    c.total++;
    try {
      const resolved = resolver.resolve(r);
      const refs = resolver.references(r,resolved.entity);
      c.resolvedSubset++;
      entities.push({id:r.id,kind:r.kind,origin:r.origin,path:r.path,index:r.index,blob:r.blob,
        source:r.entity.source,lineage:resolved.lineage,references:refs,status:'review-required'});
    } catch(e) {
      c.blocked++;
      diagnostics.push({code:e.code || 'resolutionError',id:r.id,origin:r.origin,path:r.path,index:r.index,detail:e.message});
    }
  }
  return {schemaVersion:'dnd-upstream-resolution-audit.v1',commits:{main:main.commit,homebrew:homebrew.commit},counts,entities,diagnostics,activation:'review-required'};
}
module.exports = {identity,collect,makeResolver,applyMods,audit};
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3 && args.length !== 5) throw new Error('Usage: node resolver.js MAIN_DIR BREW_DIR OUT_JSON [MAIN_REF BREW_REF]');
    const [main,brew,out,mref,bref] = args;
    const result = audit(openSnapshot(main,mref),openSnapshot(brew,bref));
    fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
    fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({out,counts:result.counts,diagnostics:result.diagnostics.length}));
    if(result.diagnostics.length) process.exitCode = 2;
  } catch(e) { console.error(e.message); process.exitCode = 1; }
}
