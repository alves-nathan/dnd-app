'use strict';
// a8.8.3: origin grant evidence, not automatic character-builder grants.
const {createHash}=require('node:crypto');
const {digest}=require('./integrated-review');
const {identity}=require('./resolver');
const {buildOriginParityEvidence}=require('./origin-parity-evidence');
const {buildOriginChassisProjection}=require('./origin-chassis-projection');
const {physicalId:spellId}=require('./spell-converter');
const {physicalId:featId}=require('./feature-converter');
const {physicalId:equipmentId}=require('./equipment-converter');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const literal=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const norm=x=>x.trim().toLowerCase();
const pos=x=>Number.isSafeInteger(x)&&x>0;
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const era=x=>['2014','2024'].includes(x);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const clone=x=>JSON.parse(JSON.stringify(x));
function qualifiedUid(raw,cantripSuffix=false){
 if(!literal(raw)||raw.includes('{@'))return {status:'selectorOrExpressionPending'};
 const marked=cantripSuffix&&raw.endsWith('#c'),value=marked?raw.slice(0,-2):raw;
 if(value.includes('#'))return {status:'selectorOrExpressionPending'};
 const p=value.split('|');
 if(p.length===1)return {status:'explicitSourcePending'};
 if(p.length!==2||!p.every(literal))return {status:'selectorOrExpressionPending'};
 return {name:p[0],source:p[1],cantripMarked:marked};
}
function endpoint(index,kind,raw,owner,commit){
 const u=qualifiedUid(raw,kind==='spell');
 if(u.status)return u;
 const kinds=kind==='equipment'?['equipment','weapon','armor']:[kind];
 const matches=kinds.map(k=>index.get(k==='spell'?spellId(u.source,u.name):k==='feat'?featId(k,u.source,u.name):equipmentId(u.source,k,u.name))).filter(Boolean);
 if(matches.length!==1)return {status:matches.length?'ambiguousEndpoint':'endpointPending'};
 const t=matches[0],p=t.provenance;
 const rawKind=kind==='equipment'?(p?.path==='data/items-base.json'?'baseitem':'item'):kind;
 if(!kinds.includes(t.kind)||t.metadata?.variantTemplateKey||p?.entityKey!==identity(rawKind,{name:u.name,source:u.source})||p?.origin!=='5etools'||p.repository!=='5etools-mirror-3/5etools-src'||p.commit!==commit||
   !/^[a-f0-9]{40}$/.test(p.blob)||t.source?.status!=='needsReview'||!literal(p.sourceCode)||norm(p.sourceCode)!==norm(u.source)||
   t.source.id!=='upstream:main:'+p.sourceCode||norm(t.name)!==norm(u.name)||
   (kind==='spell'?!/^data\/spells\/[^/]+\.json$/.test(p.path):kind==='feat'?p.path!=='data/feats.json':!['data/items-base.json','data/items.json'].includes(p.path)))
  return {status:'endpointBindingPending'};
 const base={targetId:t.id,targetFingerprint:digest(t)};
 if(!era(owner.rulesEra)||t.source.rulesEra!==owner.rulesEra)return {...base,status:'editionPending'};
 if(kind==='spell'&&(!nat(t.payload?.level)||t.payload.level>9||(u.cantripMarked&&t.payload.level!==0)))return {...base,status:'spellLevelPending'};
 return {...base,status:'identityCandidate',...(kind==='spell'?{spellLevel:t.payload.level,cantripMarked:u.cantripMarked}:{}),...(kind==='feat'?{category:t.payload?.category}:{} )};
}
function traitEvidence(item,index){
 const m=item.payload.mechanics,r=m.upstreamOrigin,sub=item.metadata.upstreamKind==='subrace';
 const entries=Array.isArray(r.entries)?r.entries:[];
 const named=entries.filter(e=>rec(e)&&literal(e.name));
 const names=named.map(e=>norm(e.name)),duplicates=new Set(names.filter((n,i)=>names.indexOf(n)!==i));
 const base=Array.isArray(m.baseRecord?.entries)?m.baseRecord.entries:[],child=Array.isArray(m.subraceRecord?.entries)?m.subraceRecord.entries:[];
 const rows=entries.map((e,entryIndex)=>{
  const fingerprint=digest(e),row={entryIndex,fingerprint};
  if(!rec(e)||!literal(e.name))return {...row,status:'unnamedEntryPending'};
  if(duplicates.has(norm(e.name)))return {...row,status:'duplicateTraitNamePending'};
  if(!sub)return {...row,status:'localTraitReviewRequired'};
  const b=base.filter(x=>digest(x)===fingerprint),c=child.filter(x=>digest(x)===fingerprint);
  if(b.length===1&&c.length===0)return {...row,status:'inheritedTraitReviewRequired'};
  if(b.length===0&&c.length===1){
   const replacement=c[0].data?.overwrite;
   if(replacement!==undefined){
    if(!literal(replacement)||base.filter(x=>rec(x)&&literal(x.name)&&norm(x.name)===norm(replacement)).length!==1)return {...row,status:'traitReplacementTargetPending'};
    return {...row,status:'replacementTraitReviewRequired',replacedFingerprint:digest(base.find(x=>rec(x)&&literal(x.name)&&norm(x.name)===norm(replacement)))};
   }
   return {...row,status:'addedTraitReviewRequired'};
  }
  return {...row,status:'traitLineagePending'};
 });
 let parent={status:'notSubrace'};
 if(sub){
  const key=m.parent.key,parentId='upstream:main:species:'+createHash('sha256').update(key).digest('hex'),p=index.get(parentId);
  parent={status:'parentEndpointPending'};
  if(p?.kind==='species'&&p.provenance?.entityKey===key&&p.provenance.commit===item.provenance.commit&&
    p.provenance.blob===m.parent.blob&&p.provenance.index===m.parent.index&&p.provenance.path===m.parent.path&&
    digest(p.payload.mechanics.upstreamOrigin)===digest(m.baseRecord))
   parent={status:era(item.source.rulesEra)&&p.source.rulesEra===item.source.rulesEra?'parentIdentityCandidate':'parentEditionPending',parentId,parentFingerprint:digest(p)};
 }
 const versions=Array.isArray(m.versions)?m.versions.map((v,index)=>({index,fingerprint:digest(v),status:'versionTemplatePending'})):m.versions!==undefined?[{fingerprint:digest(m.versions),status:'versionTemplatePending'}]:[];
 const omittedParentEntries=sub?base.map((e,index)=>({index,fingerprint:digest(e)})).filter(e=>!rows.some(r=>r.fingerprint===e.fingerprint))
  .map(e=>({...e,status:rows.some(r=>r.replacedFingerprint===e.fingerprint)?'parentTraitReplacementObserved':'parentTraitOmissionPending'})):[];
 return {rows,parent,versions,omittedParentEntries,entriesStatus:Array.isArray(r.entries)?'entriesObserved':'entriesPending'};
}
function spellGroups(raw,index,owner,commit){
 if(raw===undefined)return [];
 if(!Array.isArray(raw))return [{status:'spellGroupShapePending',fingerprint:digest(raw),entries:[]}];
 return raw.map((g,group)=>{
  const base={group,fingerprint:digest(g),entries:[]};
  if(!rec(g))return {...base,status:'spellGroupShapePending'};
  const ability=g.ability,validAbility=x=>['str','dex','con','int','wis','cha'].includes(x);
  const a=validAbility(ability)?{status:'fixedAbilityCandidate',options:[ability.toUpperCase()]}:
   rec(ability)&&Object.keys(ability).length===1&&Array.isArray(ability.choose)&&ability.choose.length&&ability.choose.every(validAbility)&&new Set(ability.choose).size===ability.choose.length?
   {status:'abilityChoiceCandidate',options:ability.choose.map(x=>x.toUpperCase())}:{status:'abilityPending'};
  const out={...base,status:'spellGroupReviewRequired',ability:a,namedAlternative:literal(g.name)};
  if(Object.keys(g).some(k=>!['name','ability','known','innate','prepared','expanded'].includes(k)))out.status='spellGroupShapePending';
  const push=(mode,level,values,usage)=>{
   if(!Array.isArray(values)||!values.length){out.entries.push({mode,level,usage,status:'spellSelectorPending',fingerprint:digest(values)});return;}
   for(const v of values){
    const e=endpoint(index,'spell',v,owner,commit);
    out.entries.push({mode,level,usage,fingerprint:digest(v),...e});
   }
  };
  for(const mode of ['known','innate','prepared','expanded']){
   if(!own(g,mode))continue;
   if(!rec(g[mode])){out.entries.push({mode,status:'spellLevelSchedulePending',fingerprint:digest(g[mode])});continue;}
   for(const [key,value] of Object.entries(g[mode])){
    if(!/^(?:[1-9]|1[0-9]|20)$/.test(key)){out.entries.push({mode,status:'spellLevelSchedulePending',fingerprint:digest(value)});continue;}
    const level=Number(key);
    if(Array.isArray(value)){push(mode,level,value,{status:'usageNotDeclared'});continue;}
    if(!rec(value)){out.entries.push({mode,level,status:'spellUsageShapePending',fingerprint:digest(value)});continue;}
    for(const [frequency,entries] of Object.entries(value)){
     if(frequency==='daily'&&rec(entries)){
      for(const [count,spells] of Object.entries(entries)){
       const usage=/^[1-9][0-9]*$/.test(count)&&pos(Number(count))?{status:'dailyCountCandidate',count:Number(count),recovery:'pending',sharing:'pending'}:{status:'usageFormulaOrSharingPending',fingerprint:digest(count)};
       push(mode,level,spells,usage);
      }
     }else if(frequency==='_'&&Array.isArray(entries))push(mode,level,entries,{status:'usageNotDeclared'});
     else out.entries.push({mode,level,status:'spellUsageShapePending',fingerprint:digest(entries)});
    }
   }
  }
  return out;
 });
}
function equipmentGroups(raw,index,owner,commit){
 if(raw===undefined)return [];
 if(!Array.isArray(raw))return [{status:'equipmentGroupPending',fingerprint:digest(raw),options:[]}];
 return raw.map((g,group)=>{
  const base={group,fingerprint:digest(g),options:[]};
  if(!rec(g)||!Object.keys(g).length||own(g,'_')&&Object.keys(g).length!==1)return {...base,status:'equipmentGroupPending'};
  const options=Object.entries(g).map(([key,list])=>{
   const option={key,fingerprint:digest(list),entries:[]};
   if(!literal(key)||!Array.isArray(list)||!list.length)return {...option,status:'equipmentOptionPending'};
   for(const v of list){
    const fp={fingerprint:digest(v)};
    if(rec(v)&&Object.keys(v).length===1&&nat(v.value)){option.entries.push({...fp,status:'copperValueCandidate',copper:v.value});continue;}
    if(typeof v==='string'||rec(v)&&literal(v.item)&&Object.keys(v).every(k=>['item','quantity'].includes(k))&&(!own(v,'quantity')||pos(v.quantity))){
     const e=endpoint(index,'equipment',typeof v==='string'?v:v.item,owner,commit);
     option.entries.push({...fp,...e,quantity:typeof v==='string'?1:v.quantity??1});continue;
    }
    option.entries.push({...fp,status:'equipmentSelectorOrModifierPending'});
   }
   return {...option,status:option.entries.every(e=>['identityCandidate','copperValueCandidate'].includes(e.status))?'equipmentOptionCandidate':'equipmentOptionPending'};
  });
  return {...base,status:'equipmentGroupReviewRequired',mandatory:own(g,'_'),options};
 });
}
function buildOriginGrantEvidence(input,chassis){
 const parity=buildOriginParityEvidence(input),actual=buildOriginChassisProjection(input,parity);
 if(chassis!==undefined&&digest(chassis)!==digest(actual))throw Error('originChassisEvidenceMismatch');
 const index=new Map(input.items.map(i=>[i.id,i])),byId=new Map(parity.upstreamRows.map(r=>[r.itemId,r]));
 const rows=[],summary={species:0,background:0,traits:{},parents:{},omittedParentTraits:{},versions:0,featEdges:{},spellGroups:0,spellEntries:{},spellUsage:{},equipmentGroups:0,equipmentOptions:{},equipmentEntries:{}};
 for(const c of actual.rows){
  const i=index.get(c.itemId),p=byId.get(c.itemId);
  if(!i||!p||p.sourceFingerprint!==c.sourceFingerprint||digest(i)!==c.sourceFingerprint)throw Error('originGrantBindingMismatch');
  const raw=i.payload.mechanics.upstreamOrigin,traits=traitEvidence(i,index),spells=spellGroups(raw.additionalSpells,index,c,actual.commits.main),equipment=equipmentGroups(raw.startingEquipment,index,c,actual.commits.main);
  summary[c.kind]++;for(const t of traits.rows)bump(summary.traits,t.status);bump(summary.parents,traits.parent.status);summary.versions+=traits.versions.length;for(const e of traits.omittedParentEntries)bump(summary.omittedParentTraits,e.status);
  for(const f of p.featEdges)bump(summary.featEdges,f.status);
  summary.spellGroups+=spells.length;for(const g of spells)for(const e of g.entries){bump(summary.spellEntries,e.status);if(e.usage)bump(summary.spellUsage,e.usage.status);}
  summary.equipmentGroups+=equipment.length;for(const g of equipment)for(const o of g.options){bump(summary.equipmentOptions,o.status);for(const e of o.entries)bump(summary.equipmentEntries,e.status);}
  rows.push({itemId:c.itemId,kind:c.kind,rulesEra:c.rulesEra,sourceFingerprint:c.sourceFingerprint,variantReviewRequired:c.variantReviewRequired,
   traits,featEdges:p.featEdges,featGroupCount:Array.isArray(raw.feats)?raw.feats.length:0,spells,equipment,...flags()});
 }
 const body={schemaVersion:'dnd-upstream-origin-grant-evidence.v1',commits:actual.commits,parityFingerprint:parity.fingerprint,chassisFingerprint:actual.fingerprint,summary,rows,
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
// Isolated choice review; no item, currency, feat or spell is granted.
function previewOriginGrantSelection(input,request){
 try{
  if(!rec(request)||request.contextComplete!==true||request.originPolicyConfirmed!==true||!era(request.rulesEra))return pending('explicitGrantContextRequired');
  const r=buildOriginGrantEvidence(input);
  if(request.projectionFingerprint!==r.fingerprint)return pending('projectionFingerprintMismatch');
  const row=r.rows.find(x=>x.itemId===request.originId);
  if(!row||row.rulesEra!==request.rulesEra||row.sourceFingerprint!==request.sourceFingerprint)return pending('originIdentityOrEditionPending');
  if(row.variantReviewRequired&&request.variantPolicyConfirmed!==true)return pending('variantPolicyPending');
  if(request.domain==='feat'){
   if(!nat(request.group)||request.group>=row.featGroupCount||request.groupPolicyConfirmed!==true||request.featEligibilityConfirmed!==true||request.existingFeatInventoryComplete!==true||
     !Array.isArray(request.existingFeatIds)||!request.existingFeatIds.every(literal)||new Set(request.existingFeatIds).size!==request.existingFeatIds.length)return pending('featSelectionContextPending');
   const edges=row.featEdges.filter(e=>e.group===request.group);
   if(!edges.length||edges.some(e=>e.status!=='featIdentityCandidate'))return pending('featGrantPending');
   const ids=edges.map(e=>e.targetId);
   if(new Set(ids).size!==ids.length||ids.some(id=>request.existingFeatIds.includes(id)))return pending('featRepeatabilityPending');
   return {...flags(),status:'originFeatReviewCandidate',targetIds:ids,limitations:['featPrerequisiteAndApplicationNotEstablished']};
  }
  if(request.domain==='spell'){
   if(!nat(request.group)||!pos(request.characterLevel)||request.characterLevel>20||request.groupPolicyConfirmed!==true)return pending('spellSelectionContextPending');
   const g=row.spells.find(g=>g.group===request.group);
   if(!g||g.status!=='spellGroupReviewRequired'||!g.entries.length||g.ability?.status==='abilityPending'||!g.ability?.options.includes(request.spellcastingAbility))return pending('spellGroupOrAbilityPending');
   if(g.entries.some(e=>e.level===undefined||e.level<=request.characterLevel&&e.status!=='identityCandidate'))return pending('spellGrantPending');
   const entries=g.entries.filter(e=>e.level<=request.characterLevel);
   return {...flags(),status:'originSpellReviewCandidate',spellcastingAbility:request.spellcastingAbility,entries:clone(entries),
    limitations:['knownPreparedInnateAndExpandedRemainDistinct','slotAccessUsageRecoveryAndSharingPending','noSpellOrResourceGrant']};
  }
  if(request.domain==='equipment'){
   if(!Array.isArray(request.selections)||request.equipmentPolicyConfirmed!==true||request.existingInventoryComplete!==true)return pending('equipmentSelectionContextPending');
   const selected=new Map();
   for(const s of request.selections){if(!rec(s)||!nat(s.group)||!literal(s.key)||selected.has(s.group))return pending('equipmentSelectionPending');selected.set(s.group,s.key);}
   if(!row.equipment.length||selected.size!==row.equipment.length)return pending('equipmentSelectionPending');
   const entries=[];
   for(const g of row.equipment){
    const o=g.options.find(o=>o.key===selected.get(g.group));
    if(g.status!=='equipmentGroupReviewRequired'||!o||o.status!=='equipmentOptionCandidate')return pending('equipmentOptionPending');
    entries.push(...o.entries);
   }
   return {...flags(),status:'originEquipmentReviewCandidate',entries:clone(entries),limitations:['noInventoryCurrencyOrPurchaseMutation']};
  }
  return pending('unsupportedGrantDomain');
 }catch{return pending('originGrantReviewFailed');}
}
module.exports={traitEvidence,spellGroups,equipmentGroups,buildOriginGrantEvidence,publicSummary,previewOriginGrantSelection};
