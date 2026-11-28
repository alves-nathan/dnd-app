'use strict';
// Expanded Main equipment and magic items. Historical pilots remain unchanged.
const {identity,normalizeIdentity}=require('./resolver');
const {createFunctionalResolver,retainStructuralEvidence}=require('./functional-resolver');
const {readMainPublications,projectMainSource}=require('./functional-main-source');
const eq=require('./equipment-converter'),magic=require('./magic-item-converter');
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const clone=v=>JSON.parse(JSON.stringify(v));
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const fail=code=>{throw Object.assign(Error(code),{code});};
const rarities=new Set(['common','uncommon','rare','very rare','legendary','artifact','varies','unknown','unknown (magic)']);
const mundane=e=>e.rarity==='none'||e.mundane===true&&e.rarity===undefined;
const magical=e=>rarities.has(norm(e.rarity))||e.wondrous===true&&e.rarity!=='none';
const knownEra=e=>e==='2014'||e==='2024';
const edition=e=>e==='2014'?'classic':e==='2024'?'one':undefined;
const collectionSpecs=[['data/items-base.json','baseitem'],['data/items.json','item'],['data/magicvariants.json','magicvariant']];
const selectedKey=(path,kind,index)=>JSON.stringify([path,kind,index]);
function buildFunctionalItems(snapshot,selection){
 if(!Array.isArray(selection))fail('functionalItemSelectionInvalid');
 const chosen=new Set(),sourceByCoordinate=new Map();
 for(const r of selection){
  if(!['baseitem','item','magicvariant'].includes(r.kind)||typeof r.sourceId!=='string'||!Number.isSafeInteger(r.index)||r.index<0)fail('functionalItemSelectionInvalid');
  const key=selectedKey(r.path,r.kind,r.index),source=JSON.parse(r.sourceId);
  if(chosen.has(key)||source[0]!=='main'||typeof source[1]!=='string'||!source[1])fail('functionalItemSelectionInvalid');
  chosen.add(key);sourceByCoordinate.set(key,source[1]);
 }
 const results={equipment:{commit:snapshot.commit,packs:[],counts:Object.create(null),diagnostics:[],activation:'review-required'},
  magic:{commit:snapshot.commit,packs:[],counts:Object.create(null),diagnostics:[],activation:'review-required'}};
 if(!chosen.size)return results;
 const base=snapshot.readJson('data/items-base.json'),items=snapshot.readJson('data/items.json'),variants=snapshot.readJson('data/magicvariants.json');
 const collections=[base.baseitem,items.item,variants.magicvariant];
 if(collections.some(x=>!Array.isArray(x)))fail('functionalItemIndexInvalid');
 const defs={properties:eq.definitionIndex(base.itemProperty,'abbreviation'),masteries:eq.definitionIndex(base.itemMastery,'name'),types:eq.definitionIndex(base.itemType,'abbreviation'),ammunition:eq.definitionIndex([...base.baseitem,...items.item],'name')};
 const publications=readMainPublications(snapshot),records=[],selected=[],invalid=[],seen=new Set();
 for(const [j,[path,kind]] of collectionSpecs.entries()){
  for(const [index,raw] of collections[j].entries()){
   const coordinate=selectedKey(path,kind,index),wanted=chosen.has(coordinate),e=normalizeIdentity(kind,raw);
   if(wanted){
    seen.add(coordinate);
    if(!rec(e)||e.source!==sourceByCoordinate.get(coordinate))fail('functionalItemSelectionSourceMismatch');
   }
   try{
    const key=identity(kind,e),r={id:JSON.stringify(['main',key]),key,kind,origin:'main',path,index,blob:snapshot.files.get(path),entity:e};
    records.push(r);if(wanted)selected.push(r);
   }catch(err){if(wanted)invalid.push({kind,path,index,entity:e,reason:err.code||'invalidIdentity'});}
  }
 }
 const resolver=createFunctionalResolver(snapshot,records),bases=records.filter(r=>r.kind==='baseitem'),resolvedBases=[];
 const sourceFor=(e,mode)=>projectMainSource(e.source,publications,e,(mode==='magic'?magic.pilot:eq.pilot)[e.source]);
 const mergeReview=(item,projection,extra=[])=>{
  item.metadata.sourceEditionEvidence=projection.editionEvidence;
  item.metadata.reviewCodes=[...new Set([...item.metadata.reviewCodes,...projection.notes,...extra])].sort(cmp);
  return item;
 };
 const groups={equipment:new Map(),magic:new Map()},candidates=[];
 const summary=(mode,code)=>results[mode].counts[code]??=( {inputs:0,convertedRows:0,partialRows:0,blockedRows:0,outputs:0,variantCandidates:0,variantBlocked:0,blockCodes:Object.create(null)} );
 const diagnostic=(mode,r,reason,baseRecord)=>{
  const c=summary(mode,r.entity.source);bump(c.blockCodes,reason);
  results[mode].diagnostics.push({source:r.entity.source,kind:r.kind,path:r.path,index:r.index,code:reason,...(baseRecord?{base:{path:baseRecord.path,index:baseRecord.index,blob:baseRecord.blob}}:{})});
 };
 const modeOf=r=>r.kind==='magicvariant'?'magic':magical(r.entity)?'magic':'equipment';
 for(const r of bases){
  try{resolvedBases.push({r,resolved:resolver.resolve(r)});}
  catch(err){resolvedBases.push({r,error:err.code||'baseResolutionPending'});}
 }
 for(const r of invalid){const mode=modeOf(r),c=summary(mode,r.entity.source);c.inputs++;c.blockedRows++;diagnostic(mode,r,r.reason);}
 for(const r of selected){
  let mode=modeOf(r),projected,entry={r,mode,items:[],blocked:false};
  try{
   const resolved=resolver.resolve(r),e=resolved.entity;
   if(e.source!==r.entity.source)fail('itemSourceMismatch');
   if(r.kind!=='magicvariant'){
    if(mundane(e)&&magical(e))fail('itemClassificationConflict');
    if(mundane(e))mode='equipment';
    else if(magical(e)&&r.kind==='item')mode='magic';
    else fail('itemClassificationPending');
    entry.mode=mode;
    projected=sourceFor(e,mode);
    const item=mode==='equipment'?eq.convertItem(r,resolved,projected.source,defs,snapshot.commit):magic.convert(r,e,projected.source,defs,snapshot.commit,{lineage:resolved.lineage});
    retainStructuralEvidence(item,resolved);
    entry.items.push(mergeReview(item,projected));
    if(resolved.versions?.length){entry.blocked=true;diagnostic(mode,r,'nestedVersionExpansionPending');}
   }else{
    projected=sourceFor(e,'magic');
    if(e.inherits?.source!==e.source)fail('variantSourceMismatch');
    if(!Array.isArray(e.requires)||!e.requires.length)fail('unsupportedVariantSelector');
    e.requires.forEach(magic.validateSelector);
    if(e.excludes!==undefined)magic.validateSelector(e.excludes);
    // Use explicit edition evidence only. No date-based fallback and no
    // cross-era expansion. Unknown/conflicting pairs remain review gaps.
    const templateEra=projected.source.rulesEra,t={...e};
    if(knownEra(templateEra))t.edition=edition(templateEra);
    let matched=0;
    for(const baseEntry of resolvedBases){
     const br=baseEntry.r,b=baseEntry.resolved?.entity??br.entity;
     const baseProjection=sourceFor(b,'equipment'),baseEra=baseProjection.source.rulesEra;
     // Test selectors without conflating unknown era with a false match.
     const selectorBase={...b};delete selectorBase.edition;
     const selectorTemplate={...t};delete selectorTemplate.edition;
     if(!magic.matches(selectorBase,selectorTemplate))continue;
     if(knownEra(templateEra)&&knownEra(baseEra)&&templateEra!==baseEra)continue;
     matched++;
     const c=summary('magic',r.entity.source);c.variantCandidates++;
     try{
      if(baseEntry.error)fail(baseEntry.error);
      if(!knownEra(templateEra)||!knownEra(baseEra))fail('variantEditionPending');
      if(!mundane(b))fail('variantBaseClassificationPending');
      const expanded=magic.expand(b,t);
      if(expanded.source!==e.source)fail('variantSourceMismatch');
      const item=magic.convert(r,expanded,projected.source,defs,snapshot.commit,{template:e,base:b,baseIndex:br.index,baseBlob:br.blob,lineage:resolved.lineage});
      // Preserve exact base provenance and both copy lineages. The existing
      // stable ID remains template identity + base identity.
      item.metadata.variantBase={...item.metadata.variantBase,path:br.path,blob:br.blob,index:br.index,lineage:baseEntry.resolved.lineage};
      retainStructuralEvidence(item,resolved);
      if(baseEntry.resolved.versions?.length){
       item.metadata.variantBase.versionContainer=baseEntry.resolved.versions;
       entry.blocked=true;diagnostic('magic',r,'variantBaseVersionsPending',br);
      }
      entry.items.push(mergeReview(item,projected,['variantBaseDependencyPending']));
     }catch(err){entry.blocked=true;c.variantBlocked++;diagnostic('magic',r,err.code||'variantConversionError',br);}
    }
    if(resolved.versions?.length){entry.blocked=true;diagnostic('magic',r,'nestedVersionExpansionPending');}
    if(!matched)fail('variantNoMatchingBase');
   }
  }catch(err){entry.blocked=true;diagnostic(entry.mode,r,err.code||'conversionError');}
  candidates.push(entry);
 }
 // Retain explicit disposition for selected rows outside supported root files.
 // They stay pending in the consolidated ledger, rather than invented outputs.
 const frequencies=new Map();
 for(const e of candidates)for(const i of e.items)frequencies.set(i.id,(frequencies.get(i.id)||0)+1);
 for(const e of candidates){
  const c=summary(e.mode,e.r.entity.source);c.inputs++;
  const unique=[];
  for(const item of e.items){
   if(frequencies.get(item.id)!==1){e.blocked=true;diagnostic(e.mode,e.r,'duplicatePhysicalId');if(e.r.kind==='magicvariant')c.variantBlocked++;continue;}
   unique.push(item);
  }
  if(unique.length){c[e.blocked?'partialRows':'convertedRows']++;c.outputs+=unique.length;}
  else c.blockedRows++;
  if(unique.length){
   const group=groups[e.mode].get(e.r.entity.source)||[];group.push(...unique);groups[e.mode].set(e.r.entity.source,group);
  }
 }
 for(const mode of ['equipment','magic']){
  for(const [code,items] of [...groups[mode]].sort(([a],[b])=>cmp(a,b))){
   const source=projectMainSource(code,publications,null,(mode==='magic'?magic.pilot:eq.pilot)[code]).source;
   results[mode].packs.push({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:'+code+':'+(mode==='magic'?'magicItems':'equipment'),source,metadata:{stage:mode==='magic'?'a5.4':'a5.3',activation:'review-required',conversionScope:'functionalSelectedSources'},items:items.sort((a,b)=>cmp(a.id,b.id))});
  }
  for(const c of Object.values(results[mode].counts))if(c.inputs!==c.convertedRows+c.partialRows+c.blockedRows)fail('functionalItemAccountingMismatch');
 }
 return results;
}
module.exports={buildFunctionalItems};
