'use strict';

// Conservative, offline staging resolver. Unsupported operations never emit a partial entity.
const { openSnapshot } = require('./inventory');
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');
const kinds = new Set(['class','subclass','classFeature','subclassFeature','race','subrace','background','feat','spell','monster','item','baseitem','itemGroup','magicvariant','optionalfeature','condition','disease','status','action','variantrule','legendaryGroup','reward','vehicle','trap','hazard','object','psionic','charoption','facility','itemProperty','itemType','itemMastery','language','skill','sense','table','tableGroup','deck','card','deity','cult','boon']);
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = x => JSON.parse(JSON.stringify(x));
const norm = x => typeof x === 'string' ? x.trim().toLowerCase() : '';
const bad = new Set(['__proto__','prototype','constructor']);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function fail(code, detail) { const e = new Error(detail); e.code = code; throw e; }
// A source nested in a magic template is its publication identity, not an alias.
function normalizeIdentity(kind, entity) {
  if (kind !== 'magicvariant' || !isRecord(entity) || own(entity,'source')) return entity;
  if (!isRecord(entity.inherits) || !norm(entity.inherits.source)) return entity;
  return {...entity,source:entity.inherits.source};
}
function identity(kind, e) {
  e = normalizeIdentity(kind,e);
  const name = norm(kind === 'subclass' ? (e.shortName ?? e.name) : (e.name ?? e.abbreviation));
  const source = norm(e.source);
  if (!name || !source) fail('invalidIdentity', kind + ': missing name or source');
  const parts = [kind, name, source];
  if (['subclass','classFeature','subclassFeature'].includes(kind)) parts.push(norm(e.className),norm(e.classSource));
  if (kind === 'subclassFeature') parts.push(norm(e.subclassShortName),norm(e.subclassSource));
  if (['classFeature','subclassFeature'].includes(kind)) {
    if (!Number.isInteger(Number(e.level)) || Number(e.level) < 1 || Number(e.level) > 20) fail('invalidIdentity',kind + ': invalid level');
    parts.push(String(Number(e.level)));
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
  const diagnostics = [], records = [], invalidRecords = [];
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
        for (const [index,raw] of entries.entries()) {
          const entity=normalizeIdentity(kind,raw);
          try {
            if (!isRecord(entity)) fail('invalidEntity','Expected object');
            const key = identity(kind,entity);
            records.push({id:JSON.stringify([origin,key]),key,kind,origin,path:p,index,blob:snapshot.files.get(p),entity,
              metaKeys:Object.keys(json._meta || {})});
          } catch (e) { diagnostics.push({code:e.code || 'invalidEntity',origin,path:p,kind,index,detail:e.message}); invalidRecords.push({kind,origin,path:p,index,blob:snapshot.files.get(p),entity}); }
        }
      }
    }
  }
  return {records,diagnostics,invalidRecords};
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
function safePath(value) {
  if (typeof value !== 'string') fail('unsupportedModPath',String(value));
  const parts = value.split('.');
  if (parts.some(p => !p || bad.has(p) || p === '*' || p === '_' || /^\d+$/.test(p))) fail('unsupportedModPath',value);
  return parts;
}
function getParent(root, parts, create) {
  let parent = root;
  for (const p of parts.slice(0,-1)) {
    if (!own(parent,p)) {
      if (!create) return null;
      parent[p] = {};
    }
    if (!isRecord(parent[p])) fail('invalidModTarget',parts.join('.'));
    parent = parent[p];
  }
  return parent;
}
const copyEntryProps = ['action','bonus','reaction','trait','legendary','mythic','variant','spellcasting','actionHeader','bonusHeader','reactionHeader','legendaryHeader','mythicHeader'];
// Literal, bounded pattern only: no arbitrary regex, replacement expansion or tag rewriting.
function literalReplacement(m) {
  if (typeof m.replace !== 'string' || !m.replace.trim() || m.replace.length > 160 ||
      /[\\^$.*+?()[\]{}|]/.test(m.replace) || typeof m.with !== 'string' || m.with.length > 512 ||
      /[$<>]/.test(m.with) || m.with.includes('{@') ||
      ![undefined,'','i'].includes(m.flags) || (m.tagInsensitive !== undefined && m.tagInsensitive !== false) ||
      Object.keys(m).some(k=>!['mode','replace','with','flags','tagInsensitive'].includes(k)))
    fail('unsupportedTextReplacement','Nonliteral or unsupported replaceTxt');
  const re = new RegExp(m.replace,m.flags === 'i' ? 'gi' : 'g');
  // Preserve complete inline tags, including nested tags. Fail closed on unbalanced tags.
  return text => {
    let result='', start=0, i=0;
    while(i<text.length){
      if(!text.startsWith('{@',i)){i++;continue;}
      result+=text.slice(start,i).replace(re,()=>m.with);
      let depth=1,j=i+2;
      for(;j<text.length&&depth;j++){
        if(text[j]==='{')depth++;
        else if(text[j]==='}')depth--;
      }
      if(depth)fail('unsupportedTextStructure','Unbalanced inline tag');
      result+=text.slice(i,j);start=j;i=j;
    }
    return result+text.slice(start).replace(re,()=>m.with);
  };
}
function replaceText(entity, parts, m) {
  const replace=literalReplacement(m);
  const parent=getParent(entity,parts,false),key=parts.at(-1);
  if(!parent||!own(parent,key))return;
  if(!Array.isArray(parent[key]))fail('invalidModTarget',parts.join('.'));
  function walk(v){
    if(typeof v==='string')return replace(v);
    if(Array.isArray(v))return v.map(walk);
    // Do not guess the upstream walker semantics on structured nested entries.
    if(isRecord(v)){
      function changes(x){
        if(typeof x==='string')return replace(x)!==x;
        if(Array.isArray(x))return x.some(changes);
        return isRecord(x)&&Object.values(x).some(changes);
      }
      if(changes(v))fail('unsupportedTextStructure','Nested entry requires walker semantics');
    }
    return v;
  }
  parent[key]=parent[key].map(v=>{
    if(typeof v==='string')return replace(v);
    if(!isRecord(v))fail('unsupportedTextStructure','Unsupported entry');
    const out=copy(v);
    for(const field of ['entries','headerEntries','footerEntries'])if(own(out,field)){
      if(!Array.isArray(out[field]))fail('unsupportedTextStructure','Expected entry array');
      out[field]=walk(out[field]);
    }
    return out;
  });
}
function applyMods(entity, mods) {
  if (!isRecord(mods)) fail('unsupportedMod','Expected modification object');
  // Upstream applies named paths first, then root operations, then entry wildcard.
  const rank = p => p === '*' ? 2 : p === '_' ? 1 : 0;
  for (const [prop, ops] of Object.entries(mods).sort(([a],[b])=>rank(a)-rank(b))) {
    const parts = prop === '_' || prop === '*' ? null : safePath(prop);
    for (const m of Array.isArray(ops) ? ops : [ops]) {
      if (m === 'remove') {
        if (!parts) fail('unsupportedModPath',prop);
        const parent = getParent(entity,parts,false);
        if (parent) delete parent[parts.at(-1)];
        continue;
      }
      if (!isRecord(m) || typeof m.mode !== 'string') fail('unsupportedMod',prop);
      if (JSON.stringify(m).includes('<$')) fail('unsupportedDynamicMod',prop);
      if(prop==='*'){
        if(m.mode!=='replaceTxt')fail('unsupportedModPath',prop);
        // Validate even if no entry properties exist.
        literalReplacement(m);
        for(const field of copyEntryProps)replaceText(entity,[field],m);
        continue;
      }
      if(prop==='_'&&(m.mode!=='setProp'||typeof m.prop!=='string'))fail('unsupportedModPath',prop);
      if(m.mode==='replaceTxt'){replaceText(entity,parts,m);continue;}
      const fullPath = m.mode === 'setProp' && m.prop !== undefined ? [...(parts||[]),...safePath(m.prop)] : parts;
      const parent = getParent(entity,fullPath,['appendArr','prependArr','appendIfNotExistsArr','setProp','replaceOrAppendArr','appendStr'].includes(m.mode));
      if (!parent) fail('invalidModTarget',prop);
      const key = fullPath.at(-1);
      if (m.mode === 'setProp') {
        if (!own(m,'value')) fail('invalidModTarget',prop);
        parent[key] = copy(m.value);
        continue;
      }
      if(m.mode==='appendStr'){
        const current=own(parent,key)?parent[key]:undefined;
        if(typeof m.str!=='string'||(m.joiner!==undefined&&typeof m.joiner!=='string')||
          (current!==undefined&&typeof current!=='string')||Object.keys(m).some(k=>!['mode','str','joiner'].includes(k)))fail('invalidModTarget',prop);
        parent[key]=current?current+(m.joiner||'')+m.str:m.str;continue;
      }
      if(m.mode==='scalarAddProp'||m.mode==='scalarMultProp'){
        const target=own(parent,key)?parent[key]:undefined;
        if(!isRecord(target)||!Number.isSafeInteger(m.scalar)||
          (m.floor!==undefined&&typeof m.floor!=='boolean')||Object.keys(m).some(k=>!['mode','prop','scalar','floor'].includes(k)))fail('invalidModTarget',prop);
        if(typeof m.prop!=='string'||(m.prop!=='*'&&safePath(m.prop).length!==1))fail('unsupportedModSelector',prop);
        const keys=m.prop==='*'?Object.keys(target):[m.prop],updates=[];
        for(const k of keys){
          if(bad.has(k)||!own(target,k))fail('invalidModTarget',prop);
          const v=target[k],n=typeof v==='string'&&/^[+-]?\d+$/.test(v)?Number(v):v;
          if(!Number.isSafeInteger(n))fail('invalidModTarget',prop);
          const out=m.mode==='scalarAddProp'?n+m.scalar:n*m.scalar;
          if(!Number.isSafeInteger(out))fail('invalidModTarget',prop);
          updates.push([k,typeof v==='string'?(out>=0?'+':'')+out:out]);
        }
        for(const [k,v] of updates)target[k]=v;
        continue;
      }
      const arr = own(parent,key) ? parent[key] : undefined;
      const items = own(m,'items') ? (Array.isArray(m.items) ? copy(m.items) : [copy(m.items)]) : null;
      const name = x => isRecord(x) ? x.name : x;
      if (['appendArr','prependArr','appendIfNotExistsArr'].includes(m.mode)) {
        if (!items || (arr !== undefined && !Array.isArray(arr))) fail('invalidModTarget',prop);
        const old = arr || [];
        parent[key] = m.mode === 'prependArr' ? [...items,...old] :
          [...old,...(m.mode === 'appendIfNotExistsArr' ? items.filter(it => !old.some(x => isDeepStrictEqual(it,x))) : items)];
      } else if (m.mode === 'insertArr') {
        if (!items || !Array.isArray(arr) || !Number.isInteger(m.index) || m.index < -1 || m.index > arr.length) fail('invalidModTarget',prop);
        arr.splice(m.index === -1 ? arr.length : m.index,0,...items);
      } else if (m.mode === 'replaceArr' || m.mode === 'replaceOrAppendArr') {
        if (!items || (!Array.isArray(arr) && !(arr === undefined && m.mode === 'replaceOrAppendArr'))) fail('invalidModTarget',prop);
        if (!(typeof m.replace === 'string' || (isRecord(m.replace) && Number.isInteger(m.replace.index) && !own(m.replace,'regex')))) fail('unsupportedModSelector',prop);
        const index = typeof m.replace === 'string' ? (arr || []).findIndex(x => name(x) === m.replace) : m.replace.index;
        if (index >= 0 && index < (arr || []).length) arr.splice(index,1,...items);
        else if (m.mode === 'replaceOrAppendArr') parent[key] = [...(arr || []),...items];
        else fail('missingModTarget',prop);
      } else if (m.mode === 'removeArr') {
        if (!Array.isArray(arr) || (own(m,'names') === own(m,'items'))) fail('invalidModTarget',prop);
        const byName = own(m,'names');
        const targets = byName ? (Array.isArray(m.names) ? m.names : [m.names]) : items;
        for (const target of targets) {
          if (typeof target !== 'string' && (byName || typeof target !== 'number')) fail('unsupportedModSelector',prop);
          const index = arr.findIndex(x => byName ? isRecord(x) && x.name === target : x === target);
          if (index >= 0) arr.splice(index,1);
          else if (!(byName && m.force === true)) fail('missingModTarget',prop);
        }
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
    let entity = copy(normalizeIdentity(r.kind,r.entity)), lineage = [];
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
    if (r.kind==='magicvariant' && norm(entity.inherits?.source) && norm(entity.source)!==norm(entity.inherits.source)) fail('variantSourceMismatch',r.id);
    if (identity(r.kind,entity) !== r.key) fail('identityChangedByMod',r.id);
    const value = {entity,lineage};
    memo.set(r.id,copy(value));
    return value;
  }
  function featureTarget(kind, uid) {
    if (typeof uid !== 'string') fail('invalidFeatureUid',kind);
    const p = uid.split('|').map(x => x.trim());
    if (kind === 'classFeature' && p.length >= 4 && p.length <= 6) return {name:p[0],className:p[1],classSource:p[2] || 'PHB',level:Number(p[3]),source:p[4] || p[2] || 'PHB'};
    if (kind === 'subclassFeature' && p.length >= 6 && p.length <= 8) return {name:p[0],className:p[1],classSource:p[2] || 'PHB',subclassShortName:p[3],subclassSource:p[4] || 'PHB',level:Number(p[5]),source:p[6] || p[4] || 'PHB'};
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
  return {resolve,lookup,references,featureTarget};
}
function audit(main,homebrew,collection=collect(main,homebrew)) {
  const {records} = collection, diagnostics = [...collection.diagnostics];
  const resolver = makeResolver(records);
  const counts = Object.create(null), bySource = Object.create(null), entities = [];
  const issues = Object.create(null);
  const totals = () => ({total:0,resolvedSubset:0,blocked:0});
  const bump = (obj,key) => obj[key] = (obj[key] || 0) + 1;
  const sourceFor = r => {
    const key = r.origin + ':' + r.entity.source;
    return bySource[key] ||= { ...totals(), kinds:Object.create(null), editions:Object.create(null), variants:0, reprints:0, inlineTags:Object.create(null), deferredMeta:Object.create(null) };
  };
  const valid = new Map(), blocked = new Set();
  const addBlocked = (r,code,detail) => {
    blocked.add(r.id);
    diagnostics.push({code,id:r.id,origin:r.origin,path:r.path,index:r.index,detail});
  };
  const observed = e => ({
    edition: typeof e.edition === 'string' ? e.edition : 'unspecified',
    variants: Array.isArray(e._versions) ? e._versions.length : 0,
    reprints: Array.isArray(e.reprintedAs) ? e.reprintedAs.length : 0
  });
  for (const r of records) {
    const c = sourceFor(r);
    const o = observed(r.entity);
    c.variants += o.variants; c.reprints += o.reprints;
    bump(c.editions,o.edition);
    for (const key of r.metaKeys || []) if (key !== 'internalCopies') bump(c.deferredMeta,key);
    try {
      const resolved = resolver.resolve(r);
      const refs = resolver.references(r,resolved.entity);
      // Tags are inventoried, not treated as resolved references.
      for (const m of JSON.stringify(resolved.entity).matchAll(/\{@([A-Za-z][A-Za-z0-9]*)\s/g)) bump(c.inlineTags,m[1]);
      valid.set(r.id,{r,resolved,refs});
    } catch(e) { addBlocked(r,e.code || 'resolutionError',e.message); }
  }
  // A resolved structure cannot depend on a structurally blocked record.
  // Propagate using reverse adjacency, including copy lineage.
  const reverse = new Map();
  for (const [id,{resolved,refs}] of valid) {
    for (const dep of new Set([...resolved.lineage,...refs.map(x => x.target)])) {
      const consumers = reverse.get(dep) || []; consumers.push(id); reverse.set(dep,consumers);
    }
  }
  const queue = [...blocked];
  for (let i=0;i<queue.length;i++) {
    const dep = queue[i];
    for (const id of reverse.get(dep) || []) {
      if (blocked.has(id)) continue;
      addBlocked(valid.get(id).r,'blockedDependency',dep); queue.push(id);
    }
  }
  for (const r of records) {
    const c = counts[r.origin + ':' + r.kind] ||= totals();
    const b = sourceFor(r), k = b.kinds[r.kind] ||= totals();
    for (const counter of [c,b,k]) {
      counter.total++;
      counter[blocked.has(r.id) ? 'blocked' : 'resolvedSubset']++;
    }
    if (blocked.has(r.id)) continue;
    const {resolved,refs} = valid.get(r.id);
    entities.push({id:r.id,kind:r.kind,origin:r.origin,path:r.path,index:r.index,blob:r.blob,
      source:r.entity.source,lineage:resolved.lineage,references:refs,status:'review-required'});
  }
  for (const d of diagnostics) bump(issues,d.code);
  return {schemaVersion:'dnd-upstream-resolution-audit.v2',commits:{main:main.commit,homebrew:homebrew.commit},
    counts,bySource,issueCounts:issues,entities,diagnostics,activation:'review-required',
    scope:'structural-subset-only; variants, inline tags, external metadata and mechanical mapping not validated'};
}
module.exports = {identity,normalizeIdentity,collect,makeResolver,applyMods,audit};
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
