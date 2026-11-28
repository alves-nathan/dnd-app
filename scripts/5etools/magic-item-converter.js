'use strict';
const {createHash}=require('node:crypto');
const {openSnapshot}=require('./inventory');
const {identity,makeResolver}=require('./resolver');
const {classify,weapon,armor,definitionIndex,costWeight}=require('./equipment-converter');
const fs=require('node:fs'),path=require('node:path');
const pilot=Object.freeze({DMG:'2014',XDMG:'2024',AU:'2024',EFA:'2024',FTD:'2014',EGW:'2014',WoW:'unknown'});
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const hash=parts=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const rarities=new Set(['common','uncommon','rare','very rare','legendary','artifact','varies','unknown','unknown (magic)']);
const safeKey=k=>!['__proto__','constructor','prototype'].includes(k);
function sourceFor(code,book){
  const date=book?.published;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('missingPublication');
  return {id:'upstream:main:'+code,book:book.name,status:'needsReview',confidence:'importedNeedsReview',rulesEra:pilot[code],
    contentType:'official',precedenceScope:'official-dnd',publication:{precision:'day',date,year:Number(date.slice(0,4)),evidence:'5etools:publicationIndex'}};
}
// Upstream requires = OR of AND groups; excludes = OR of properties.
// Deliberately support only scalar/flat-array selectors in this pilot.
function validateSelector(o){
  if(!rec(o)||!Object.keys(o).length||Object.entries(o).some(([k,v])=>!safeKey(k)||
    !(typeof v==='string'||typeof v==='boolean'||typeof v==='number'||Array.isArray(v)&&v.length&&v.every(x=>['string','boolean','number'].includes(typeof x)))))fail('unsupportedVariantSelector');
}
function matchGroup(base,selector,every){
  validateSelector(selector);
  const matches=Object.entries(selector).map(([k,v])=>{
    const left=Array.isArray(base[k])?base[k]:[base[k]];
    const right=Array.isArray(v)?v:[v];
    return left.some(x=>right.includes(x));
  });
  return every?matches.every(Boolean):matches.some(Boolean);
}
function matches(base,t){
  if(!Array.isArray(t.requires)||!t.requires.length)fail('unsupportedVariantSelector');
  t.requires.forEach(validateSelector);
  if(t.excludes!==undefined)validateSelector(t.excludes);
  if(base.packContents)return false;
  // Conservative edition selection: never mix explicit classic and one.
  const b=base.edition,v=t.edition;
  if(![undefined,null,'classic','one'].includes(b)||![undefined,null,'classic','one'].includes(v))fail('unsupportedVariantEdition');
  if(b==='classic'&&v!=='classic'||b==='one'&&v==='classic')return false;
  return t.requires.some(r=>matchGroup(base,r,true))&&!(t.excludes&&matchGroup(base,t.excludes,false));
}
function expand(base,t){
  const h=t.inherits;
  if(!rec(h)||typeof h.source!=='string')fail('missingVariantInheritance');
  // Expressions, multiplier and special merges are not simulated.
  if(Object.keys(h).some(k=>!safeKey(k)||['valueExpression','weightExpression','valueMult','weightMult','barding','resist','immune','vulnerable','conditionImmune'].includes(k)))fail('unsupportedVariantTransform');
  const out=clone(base);
  for(const k of ['value','srd','srd52','basicRules','basicRules2024','page','reprintedAs','referenceSources','hasFluff','hasFluffImages','additionalSources','otherSources','entries','additionalEntries'])delete out[k];
  if(h.nameRemove!==undefined&&typeof h.nameRemove!=='string')fail('invalidVariantName');
  if(h.namePrefix!==undefined&&typeof h.namePrefix!=='string'||h.nameSuffix!==undefined&&typeof h.nameSuffix!=='string')fail('invalidVariantName');
  out.name=(h.namePrefix||'')+(h.nameRemove?base.name.split(h.nameRemove).join(''):base.name)+(h.nameSuffix||'');
  for(const [k,v] of Object.entries(h)){
    if(['nameRemove','namePrefix','nameSuffix','propertyAdd','propertyRemove','entries'].includes(k))continue;
    out[k]=clone(v);
  }
  if(h.propertyAdd!==undefined||h.propertyRemove!==undefined){
    if(h.propertyAdd!==undefined&&!Array.isArray(h.propertyAdd)||h.propertyRemove!==undefined&&!Array.isArray(h.propertyRemove))fail('unsupportedVariantPropertyTransform');
    const key=x=>rec(x)?x.uid:x;
    let props=Array.isArray(base.property)?clone(base.property):[];
    props=props.filter(p=>!(h.propertyRemove||[]).includes(key(p)));
    for(const p of h.propertyAdd||[])if(!props.some(x=>key(x)===key(p)))props.push(clone(p));
    out.property=props;
  }
  // Keep source text, rather than executing upstream substitutions.
  out.entries=clone(h.entries||[]);
  out.baseItem=base.name+'|'+base.source;
  return out;
}
function numericBonus(x){
  if(typeof x==='number'&&Number.isFinite(x)&&Number.isInteger(x))return x;
  if(typeof x==='string'&&/^[+-]?\d+$/.test(x))return Number(x);
  return undefined;
}
function convert(r,e,source,defs,commit,extra={}){
  const notes=new Set(['effectSemanticsPending','precedencePending','magicRuntimeIntegrationPending']);
  if(source.rulesEra==='unknown')notes.add('rulesEraPending');
  const payload={...costWeight(e,notes),equipmentCategory:'Magic Item',
    mechanics:{upstreamItem:clone(e)}};
  if(typeof e.rarity==='string'&&rarities.has(norm(e.rarity)))payload.rarity=norm(e.rarity);
  else notes.add('rarityPending');
  if(e.reqAttune===true||typeof e.reqAttune==='string'&&e.reqAttune.trim())payload.attunement=true;
  else if(e.reqAttune===undefined||e.reqAttune===false)payload.attunement=false;
  else notes.add('attunementPending');
  if(typeof e.reqAttune==='string'||e.reqAttuneTags)notes.add('attunementRequirementsPending');
  const b=numericBonus(e.bonusWeapon);
  if(b!==undefined&&e.bonusWeaponAttack===undefined&&e.bonusWeaponDamage===undefined)payload.magicBonus=b;
  else if(e.bonusWeapon!==undefined||e.bonusWeaponAttack!==undefined||e.bonusWeaponDamage!==undefined)notes.add('separateWeaponBonusesPending');
  const ac=numericBonus(e.bonusAc);
  if(ac!==undefined)payload.mechanics.armorClassBonus=ac;
  else if(e.bonusAc!==undefined)notes.add('armorBonusPending');
  if(e.charges!==undefined||e.recharge!==undefined||e.rechargeAmount!==undefined)notes.add('chargeAndRechargePending');
  if(e.attachedSpells||e.classFeatures)notes.add('grantedReferencesPending');
  if(e.property?.some?.(p=>String(rec(p)?p.uid:p).startsWith('Evo|'))||/slumbering|stirring|wakened|ascendant|awakened|exalted/i.test(e.name))notes.add('evolvingItemPending');
  const k=classify(e);
  if(k==='weapon'||k==='armor'){
    try{payload.mechanics.baseEquipment=k==='weapon'?weapon(e,defs,notes):armor(e,notes);}
    catch(err){notes.add('baseEquipmentPending');}
  }
  if(e.baseItem)notes.add('baseItemLinkPending');
  if(extra.template){
    notes.add('variantTextInterpolationPending');
    payload.mechanics.variantTemplate=clone(extra.template);
    payload.mechanics.baseItem=clone(extra.base);
  }
  const id='upstream:main:magicItem:'+hash(extra.template?
    ['variant',r.key,identity('baseitem',extra.base)]:['item',r.key]);
  return {id,kind:'magicItem',name:e.name,source:{...source,...(e.page===undefined?{}:{page:String(e.page)})},
    identity:{canonicalKey:'magicItem:'+norm(e.name),precedenceScope:source.precedenceScope},
    precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'upstreamPendingGlobalResolution'},
    provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit,blob:r.blob,path:r.path,entityKey:r.key,index:r.index,sourceCode:e.source,resolverVersion:'a5.4',lineage:extra.lineage||[]},
    payload,metadata:{reviewCodes:[...notes].sort(),upstreamReprintedAs:clone(e.reprintedAs||[]),
      ...(extra.template?{variantBase:{name:extra.base.name,source:extra.base.source,blob:extra.baseBlob,path:'data/items-base.json',index:extra.baseIndex},variantTemplateKey:r.key}:{})}};
}
function buildPilot(snapshot,codes=Object.keys(pilot)){
  if(!Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(c=>!own(pilot,c)))fail('invalidPilotSources');
  const b=snapshot.readJson('data/items-base.json'),i=snapshot.readJson('data/items.json'),v=snapshot.readJson('data/magicvariants.json');
  const books=snapshot.readJson('data/books.json').book;
  if(!Array.isArray(b.baseitem)||!Array.isArray(i.item)||!Array.isArray(v.magicvariant)||!Array.isArray(books))fail('invalidItemIndex');
  const defs={properties:definitionIndex(b.itemProperty,'abbreviation'),masteries:definitionIndex(b.itemMastery,'name'),types:definitionIndex(b.itemType,'abbreviation')};
  const counts=Object.create(null),records=[],diagnostics=[];
  for(const code of codes)counts[code]={concrete:0,concreteConverted:0,concreteBlocked:0,templates:0,templatesResolved:0,templatesBlocked:0,templatesWithoutMatch:0,variantCandidates:0,variantsConverted:0,variantsBlocked:0,unclassified:0,blockCodes:{}};
  function block(c,r,reason,field){c[field]++;c.blockCodes[reason]=(c.blockCodes[reason]||0)+1;diagnostics.push({source:r.entity.source,path:r.path,index:r.index,code:reason});}
  for(const [p,kind,entries] of [['data/items.json','item',i.item],['data/magicvariants.json','magicvariant',v.magicvariant]]){
    for(const [index,raw] of entries.entries()){
      if(!rec(raw))continue;
      const e=clone(raw);
      if(kind==='magicvariant'&&!e.source)e.source=e.inherits?.source;
      const c=counts[e.source],eligible=kind==='magicvariant'||rarities.has(norm(e.rarity))||e.wondrous===true&&e.rarity!=='none';
      if(c){
        if(kind==='magicvariant')c.templates++;
        else if(eligible)c.concrete++;
        else if(e.rarity!=='none'&&e.mundane!==true)c.unclassified++;
      }
      const r={kind,origin:'main',path:p,index,blob:snapshot.files.get(p),entity:e,eligible};
      try{r.key=identity(kind,e);r.id=JSON.stringify(['main',r.key]);records.push(r);}
      catch(err){if(c&&eligible)block(c,r,err.code||'invalidIdentity',kind==='magicvariant'?'templatesBlocked':'concreteBlocked');}
    }
  }
  const resolver=makeResolver(records),packs=[];
  for(const code of codes){
    const c=counts[code],source=sourceFor(code,books.find(x=>x.source===code)),items=[];
    for(const r of records.filter(x=>x.entity.source===code&&x.eligible)){
      let resolved;
      try{
        resolved=resolver.resolve(r);
        if(r.kind==='magicvariant'&&resolved.entity.inherits?.source!==code)fail('variantSourceMismatch');
        if(r.kind==='item'){
          items.push(convert(r,resolved.entity,source,defs,snapshot.commit,{lineage:resolved.lineage}));c.concreteConverted++;continue;
        }
        const t=resolved.entity;
        if(!Array.isArray(t.requires)||!t.requires.length)fail('unsupportedVariantSelector');
        t.requires.forEach(validateSelector);if(t.excludes!==undefined)validateSelector(t.excludes);
        const candidates=b.baseitem.map((base,index)=>({base,index})).filter(x=>matches(x.base,t));
        c.templatesResolved++;
        if(!candidates.length)c.templatesWithoutMatch++;
        for(const {base,index} of candidates){
          c.variantCandidates++;
          try{items.push(convert(r,expand(base,t),source,defs,snapshot.commit,{template:t,base,baseIndex:index,baseBlob:snapshot.files.get('data/items-base.json'),lineage:resolved.lineage}));c.variantsConverted++;}
          catch(err){block(c,r,err.code||'variantConversionError','variantsBlocked');}
        }
      }catch(err){block(c,r,err.code||'conversionError',r.kind==='item'?'concreteBlocked':'templatesBlocked');}
    }
    // Reject duplicate physical IDs; don't silently select an edition or template.
    const freq=new Map();for(const it of items)freq.set(it.id,(freq.get(it.id)||0)+1);
    const unique=items.filter(it=>{
      if(freq.get(it.id)===1)return true;
      const variant=!!it.metadata.variantTemplateKey;
      c[variant?'variantsConverted':'concreteConverted']--;
      c[variant?'variantsBlocked':'concreteBlocked']++;
      c.blockCodes.duplicatePhysicalId=(c.blockCodes.duplicatePhysicalId||0)+1;return false;
    });
    unique.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':magicItems',source,metadata:{stage:'a5.4',activation:'review-required'},items:unique});
  }
  return {commit:snapshot.commit,counts,packs,diagnostics,activation:'review-required'};
}
module.exports={buildPilot,matches,expand,pilot,convert,validateSelector};
if(require.main===module){
  try{
    const [root,out,ref]=process.argv.slice(2);if(!root||!out)fail('usage');
    const r=buildPilot(openSnapshot(root,ref));if(fs.existsSync(out))fail('outputDirectoryExists');
    fs.mkdirSync(out,{recursive:true});
    for(const p of r.packs)fs.writeFileSync(path.join(out,p.source.id.split(':').at(-1)+'.magic.v3.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({commit:r.commit,counts:r.counts,diagnostics:r.diagnostics,activation:r.activation},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({commit:r.commit,counts:r.counts,activation:r.activation}));
    if(Object.values(r.counts).some(c=>c.concreteBlocked||c.templatesBlocked||c.variantsBlocked))process.exitCode=2;
  }catch(err){console.error(err.code||'magicConversionFailed');process.exitCode=1;}
}
