'use strict';
// a8.9.4: qualified selection and grant evidence, never an acquisition or resource mutation.
const {digest}=require('./integrated-review');
const {physicalId}=require('./feature-converter');
const {identity}=require('./resolver');
const {buildFeatAllocationProjection}=require('./feat-allocation-projection');
const {proficiencyPlan}=require('./origin-chassis-projection');
const {spellGroups}=require('./origin-grant-evidence');
const {consumption}=require('./feature-resource-evidence');
const {choicesFor,scheduledCount,validateSelection}=require('./semantic-eligibility');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const era=x=>x==='2014'||x==='2024';
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const unique=x=>Array.isArray(x)&&x.every(id)&&new Set(x).size===x.length;
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const outcome=(status,reason,extra={})=>({status,reason,...extra,...flags()});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const clone=x=>JSON.parse(JSON.stringify(x));
const proficiencyFields={skill:'skillProficiencies',tool:'toolProficiencies',language:'languageProficiencies',weapon:'weaponProficiencies',armor:'armorProficiencies'};
const categoryCodes=new Set(['O','G','EB','FS','FS:P','FS:R','D','DG']);
const resourceFields=['uses','usesFormula','minimumUses','resource','resourcePool','resources','recharge','rechargeAmount','recoveryRules','consumes'];
const effectFields=['entries','resist','immune','vulnerable','conditionImmune','savingThrowProficiencies','expertise','skillToolLanguageProficiencies','grantsActions','effectTemplates','actionCost','actionTiming','engineKey'];
function qualified(i,kind,commit){
 const raw=i?.payload?.mechanics?.upstreamFeature,p=i?.provenance;
 return rec(raw)&&id(raw.name)&&id(raw.source)&&raw.name===i.name&&p?.origin==='5etools'&&p.commit===commit&&p.sourceCode===raw.source&&
  i.source?.id==='upstream:main:'+raw.source&&i.kind===(kind==='feat'?'feat':'feature')&&
  i.id===physicalId(i.kind,raw.source,raw.name)&&p.path===(kind==='feat'?'data/feats.json':'data/optionalfeatures.json')&&
  p.entityKey===identity(kind==='feat'?'feat':'optionalfeature',raw)&&/^[a-f0-9]{40}$/.test(p.blob)&&Number.isSafeInteger(p.index)&&p.index>=0&&
  (kind==='feat'||Array.isArray(raw.featureType)&&raw.featureType.every(id));
}
function featGroups(raw,owner,index,commit){
 if(raw===undefined)return [];
 if(!Array.isArray(raw))return [{status:'groupShapePending',fingerprint:digest(raw),entries:[]}];
 return raw.map((g,group)=>{
  const base={group,fingerprint:digest(g),entries:[]};
  if(!rec(g)||!Object.keys(g).length)return {...base,status:'groupShapePending'};
  const entries=Object.entries(g).map(([uid,value])=>{
   const e={fingerprint:digest([uid,value])},parts=uid.split('|');
   if(value!==true||parts.length!==2||!parts.every(id)||/[{}#\r\n]/.test(uid))return {...e,status:'selectorOrSourcePending'};
   const t=index.get(physicalId('feat',parts[1],parts[0]));
   if(!qualified(t,'feat',commit)||t.name.toLowerCase()!==parts[0].toLowerCase()||t.provenance.sourceCode.toLowerCase()!==parts[1].toLowerCase())return {...e,status:'endpointPending'};
   const binding={targetId:t.id,targetFingerprint:digest(t)};
   return {...e,...binding,status:t.id===owner.featId?'selfGrantPending':!era(owner.rulesEra)||t.source.rulesEra!==owner.rulesEra?'editionPending':'identityCandidate'};
  });
  const ids=entries.map(e=>e.targetId).filter(Boolean);
  return {...base,entries,status:entries.every(e=>e.status==='identityCandidate')&&new Set(ids).size===ids.length?'directGroupCandidate':'groupReviewPending'};
 });
}
function selectionRows(i,owner,items,commit){
 return choicesFor(i).filter(c=>c.kind!=='abilityAllocation').map((c,index)=>{
  const base={index,kind:c.kind,status:'selectorPending',sourceFingerprint:digest(c.raw),candidates:[]};
  if(c.status!=='selectorAndSchedule'||!c.selector||!unique(c.selector.codes)||!c.selector.codes.length||
   !['optionalfeatureProgression','featProgression'].includes(c.kind))return base;
  const isFeat=c.kind==='featProgression';
  if(isFeat&&!c.selector.codes.every(x=>categoryCodes.has(x)))return base;
  // Only one explicit selector code. Multiple codes and wildcard matching require policy.
  if(c.selector.codes.length!==1||!era(owner.rulesEra))return base;
  const code=c.selector.codes[0];
  const candidates=items.filter(t=>qualified(t,isFeat?'feat':'optionalfeature',commit)&&t.id!==owner.featId&&t.source.rulesEra===owner.rulesEra&&
   (isFeat?t.payload.mechanics.upstreamFeature.category===code:t.payload.mechanics.upstreamFeature.featureType.includes(code)))
   .map(t=>({targetId:t.id,targetFingerprint:digest(t)})).sort((a,b)=>a.targetId.localeCompare(b.targetId));
  return {...base,status:candidates.length?'emittedSelectorCandidate':'endpointCoveragePending',selector:c.selector,schedule:c.schedule,candidates};
 });
}
function resourceEvidence(raw,mechanics,payload){
 const declarations=[];
 for(const [scope,obj] of [['upstream',raw],['mechanics',mechanics],['payload',payload]])for(const field of resourceFields)
  if(own(obj,field))declarations.push({scope,field,fingerprint:digest(obj[field]),status:'resourceSemanticsPending'});
 const cost=consumption(raw);
 return {declarations,cost,recoveryStatus:'notEstablished',bindingStatus:'notEstablished',sharingStatus:'notEstablished'};
}
function buildFeatGrantEvidence(input,allocation){
 const actual=buildFeatAllocationProjection(input);
 if(allocation!==undefined&&digest(allocation)!==digest(actual))throw Error('featAllocationEvidenceMismatch');
 const index=new Map(input.items.map(i=>[i.id,i])),rows=[];
 const summary={items:0,proficiencies:{},complexProficiencyPending:0,choices:{},choiceEndpoints:0,featGroups:{},featEntries:{},
  spellGroups:{},spellEntries:{},spellUsage:{},resourceDeclarations:{},consumption:{},effectDeclarations:{}};
 for(const a of actual.rows){
  const i=index.get(a.featId),p=i.payload,m=p.mechanics,raw=m.upstreamFeature;
  if(digest(i)!==a.sourceFingerprint)throw Error('featGrantBindingMismatch');
  const proficiencies={};
  for(const [category,field] of Object.entries(proficiencyFields)){
   const plan=proficiencyPlan(raw[field],category);proficiencies[category]=plan;bump(summary.proficiencies[category]??={},plan.status);
  }
  const complexProficiencyPending=['expertise','skillToolLanguageProficiencies','savingThrowProficiencies'].some(k=>own(raw,k));
  if(complexProficiencyPending)summary.complexProficiencyPending++;
  const choices=selectionRows(i,a,input.items,actual.commits.main),feats=featGroups(raw.feats,a,index,actual.commits.main),spells=spellGroups(raw.additionalSpells,index,a,actual.commits.main),resources=resourceEvidence(raw,m,p);
  const effects=effectFields.filter(k=>own(raw,k)).map(field=>({field,fingerprint:digest(raw[field]),status:'effectSemanticsPending'}));
  for(const c of choices){bump(summary.choices,c.status);summary.choiceEndpoints+=c.candidates.length;}
  for(const g of feats){bump(summary.featGroups,g.status);for(const e of g.entries)bump(summary.featEntries,e.status);}
  for(const g of spells){bump(summary.spellGroups,g.status);for(const e of g.entries){bump(summary.spellEntries,e.status);if(e.usage)bump(summary.spellUsage,e.usage.status);}}
  for(const d of resources.declarations)bump(summary.resourceDeclarations,d.scope+':'+d.field);
  if(resources.cost)bump(summary.consumption,resources.cost.status);
  for(const e of effects)bump(summary.effectDeclarations,e.field);
  rows.push({featId:a.featId,sourceFingerprint:a.sourceFingerprint,rulesEra:a.rulesEra,proficiencies,complexProficiencyPending,choices,feats,spells,resources,effects,...flags()});
  summary.items++;
 }
 const body={schemaVersion:'dnd-upstream-feat-grant-evidence.v1',commits:actual.commits,evidenceFingerprint:actual.evidenceFingerprint,
  requirementFingerprint:actual.requirementFingerprint,allocationFingerprint:actual.fingerprint,summary,rows,
  scope:'isolated literal choices and source-qualified grant endpoints; resource and effect semantics pending',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function previewFeatGrant(input,request){
 if(!rec(request)||!era(request.rulesEra)||!id(request.featId)||!id(request.projectionFingerprint)||!id(request.sourceFingerprint)||
  request.contextConfirmed!==true||request.selectionPolicyConfirmed!==true)return outcome('indeterminate','explicitGrantContextRequired');
 const p=buildFeatGrantEvidence(input);
 if(p.fingerprint!==request.projectionFingerprint)return outcome('indeterminate','staleProjection');
 const r=p.rows.find(x=>x.featId===request.featId);
 if(!r||r.rulesEra!==request.rulesEra||r.sourceFingerprint!==request.sourceFingerprint)return outcome('indeterminate','featIdentityOrEditionMismatch');
 if(request.domain==='proficiency'){
  const plan=own(r.proficiencies,request.category)?r.proficiencies[request.category]:undefined;
  if(!plan||plan.status!=='literalProficiencyCandidate'||r.complexProficiencyPending||request.literalIdentityConfirmed!==true||
   request.existingInventoryComplete!==true||!unique(request.existing)||!unique(request.selected)||
   !request.existing.every(x=>x===x.toLowerCase()))return outcome('indeterminate','proficiencyContextPending');
  const c=plan.choices[0];
  if(validateSelection(c?.options??[],c?.count??0,request.selected)!=='satisfied')return outcome('notSatisfied','proficiencySelectionInvalid');
  const grants=[...plan.fixed,...request.selected];
  if(grants.some(x=>request.existing.includes(x)))return outcome('indeterminate','duplicateProficiencyPolicyPending');
  return outcome('proficiencyCandidate','literalLabelsOnly',{grants});
 }
 if(request.domain==='selection'){
  const c=r.choices.find(c=>c.index===request.index);
  if(!c||c.status!=='emittedSelectorCandidate'||request.endpointCoverageConfirmed!==true||request.endpointEligibilityConfirmed!==true||
   request.countSemanticsConfirmed!==true||request.existingInventoryComplete!==true||!unique(request.existingIds)||!unique(request.selectedIds)||
   !int(request.characterLevel,1,20))return outcome('indeterminate','selectionContextPending');
  const count=scheduledCount(c.schedule,request.characterLevel);
  if(count===undefined)return outcome('indeterminate','checkpointPending');
  if(validateSelection(c.candidates.map(x=>x.targetId),count,request.selectedIds)!=='satisfied')return outcome('notSatisfied','selectionInvalid');
  if(request.selectedIds.some(x=>request.existingIds.includes(x)))return outcome('indeterminate','repeatabilityOrReplacementPending');
  return outcome('selectionCandidate','checkpointCountNotGrant',{count,targets:clone(c.candidates.filter(x=>request.selectedIds.includes(x.targetId)))});
 }
 if(request.domain==='feat'){
  const g=r.feats.find(g=>g.group===request.group);
  if(!g||g.status!=='directGroupCandidate'||request.groupPolicyConfirmed!==true||request.endpointEligibilityConfirmed!==true||
   request.existingInventoryComplete!==true||!unique(request.existingIds))return outcome('indeterminate','featGrantContextPending');
  if(g.entries.some(e=>request.existingIds.includes(e.targetId)))return outcome('indeterminate','repeatabilityOrReplacementPending');
  return outcome('featGrantCandidate','identityOnly',{targets:clone(g.entries)});
 }
 if(request.domain==='spell'){
  const g=r.spells.find(g=>g.group===request.group);
  if(!g||g.status!=='spellGroupReviewRequired'||!g.entries.length||request.groupPolicyConfirmed!==true||!int(request.characterLevel,1,20)||
   !g.ability?.options?.includes(request.spellcastingAbility))return outcome('indeterminate','spellGrantContextPending');
  if(g.entries.some(e=>e.level===undefined||e.level<=request.characterLevel&&e.status!=='identityCandidate'))return outcome('indeterminate','spellEndpointPending');
  const entries=g.entries.filter(e=>e.level<=request.characterLevel);
  if(!entries.length)return outcome('indeterminate','noCurrentCheckpointEntries');
  return outcome('spellGrantCandidate','identityAndScheduleOnly',{entries:clone(entries),limitations:['usageRecoverySharingAndSlotPolicyPending']});
 }
 return outcome('indeterminate','unsupportedGrantDomain');
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
module.exports={buildFeatGrantEvidence,previewFeatGrant,publicSummary};
