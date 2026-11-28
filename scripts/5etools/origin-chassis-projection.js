'use strict';
// a8.8.2: isolated origin chassis and selection candidates. No grants or writes.
const {digest}=require('./integrated-review');
const {buildOriginParityEvidence}=require('./origin-parity-evidence');
const {backgroundAbility}=require('./origin-converter');
const {abilityPlan}=require('./feature-converter');
const {validateSelection,evaluateAllocation,evaluateBackgroundAllocation}=require('./semantic-eligibility');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const pos=x=>nat(x)&&x>0;
const literal=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const unique=a=>Array.isArray(a)&&a.every(literal)&&new Set(a).size===a.length;
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const denied=reason=>({...flags(),status:'notSatisfied',reason});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const abilities=['STR','DEX','CON','INT','WIS','CHA'];
const skills=new Set('acrobatics|animal handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight of hand|stealth|survival'.split('|'));
const sizes={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
const types=new Set('aberration beast celestial construct dragon elemental fey fiend giant humanoid monstrosity ooze plant undead'.split(' '));
function literalName(value,category){
 if(!literal(value)||!/^[a-zA-Z][a-zA-Z '\-]*$/.test(value))return undefined;
 const n=value.toLowerCase();
 if(category==='skill')return skills.has(n)?n:undefined;
 if(['any','other','choose','special','none','all'].includes(n)||/^any\b|^any[A-Z]/.test(value))return undefined;
 return n;
}
function proficiencyPlan(raw,category){
 if(raw===undefined)return {status:'notDeclared'};
 if(!['skill','tool','language','weapon','armor'].includes(category)||!Array.isArray(raw)||raw.length!==1||!rec(raw[0]))return {status:'shapePending'};
 const fixed=[],choices=[];
 for(const [k,v] of Object.entries(raw[0])){
  if(k==='choose'){
   if(!rec(v)||Object.keys(v).some(k=>!['from','count'].includes(k))||!Array.isArray(v.from)||!v.from.length)return {status:'selectorPending'};
   const options=v.from.map(x=>literalName(x,category));
   const count=v.count??1;
   if(options.some(x=>!x)||new Set(options).size!==options.length||!pos(count)||count>options.length)return {status:'selectorPending'};
   choices.push({options,count});
  }else{
   const name=literalName(k,category);
   if(v!==true||!name)return {status:'selectorPending'};
   fixed.push(name);
  }
 }
 if(!fixed.length&&!choices.length)return {status:'shapePending'};
 if(new Set(fixed).size!==fixed.length||choices.length>1||choices.some(c=>c.options.some(x=>fixed.includes(x))))return {status:'overlapPending'};
 return {status:'literalProficiencyCandidate',fixed,choices};
}
function chassis(raw){
 const s=Array.isArray(raw.size)?raw.size:typeof raw.size==='string'?[raw.size]:[];
 const size=unique(s)&&s.length&&s.every(x=>own(sizes,x))?{status:'sizeCandidate',options:s.map(x=>sizes[x])}:{status:'sizePending'};
 const t=raw.creatureTypes;
 const creatureType=Array.isArray(t)&&t.length===1&&types.has(t[0])?{status:'typeCandidate',value:t[0]}:{status:'typePending'};
 let movement={status:'movementPending'};
 if(nat(raw.speed))movement={status:'movementCandidate',feet:{walk:raw.speed}};
 else if(rec(raw.speed)&&own(raw.speed,'walk')&&Object.keys(raw.speed).every(k=>['walk','fly','swim','climb','burrow'].includes(k))&&Object.values(raw.speed).every(nat))
  movement={status:'movementCandidate',feet:{...raw.speed}};
 const senses={};
 for(const key of ['darkvision','blindsight'])senses[key]=raw[key]===undefined?{status:'notDeclared'}:nat(raw[key])?{status:'senseCandidate',feet:raw[key]}:{status:'sensePending'};
 return {size,creatureType,movement,senses};
}
function originAbility(i){
 const raw=i.payload.mechanics.upstreamOrigin,era=i.source.rulesEra;
 if(i.kind==='background'&&era==='2024'){
  const b=backgroundAbility(raw.ability);
  return b?{status:'backgroundAllocationCandidate',options:b.abilityScoreOptions,patterns:[[1,2],[1,1,1]],max:20}:{status:'abilityPending'};
 }
 if(i.kind==='species'&&era==='2014'&&raw.ability!==undefined){
  const p=abilityPlan(raw.ability);
  // Never interpret a merged subrace or variant as an automatically valid allocation.
  return p?.alternatives?.length&&p.alternatives.every(a=>a.kind==='allocation'&&!a.hidden&&
    (!a.choice||!a.fixed.some(f=>a.choice.abilities.includes(f.ability))))?
   {status:'legacyAllocationCandidate',alternatives:p.alternatives}:{status:'abilityPending'};
 }
 return {status:raw.ability===undefined?'notDeclared':'editionPolicyPending'};
}
function buildOriginChassisProjection(input,evidence){
 const actual=buildOriginParityEvidence(input);
 if(evidence!==undefined&&digest(evidence)!==digest(actual))throw Error('originEvidenceMismatch');
 const byId=new Map(actual.upstreamRows.map(r=>[r.itemId,r])),rows=[],summary={species:0,background:0,ability:{},size:{},creatureType:{},movement:{},senses:{},proficiencies:{}};
 for(const i of input.items.filter(x=>['species','background'].includes(x.kind))){
  const e=byId.get(i.id);
  if(!e||e.sourceFingerprint!==digest(i))throw Error('originProjectionBindingMismatch');
  const m=i.payload.mechanics,r=m.upstreamOrigin,a=originAbility(i),proficiencies={};
  for(const [field,category] of [['skillProficiencies','skill'],['toolProficiencies','tool'],['languageProficiencies','language'],['weaponProficiencies','weapon'],['armorProficiencies','armor']]){
   const p=proficiencyPlan(r[field],category);proficiencies[category]=p;bump(summary.proficiencies[category]??={},p.status);
  }
  const c=i.kind==='species'?chassis(r):null;
  summary[i.kind]++;bump(summary.ability,a.status);
  if(c){bump(summary.size,c.size.status);bump(summary.creatureType,c.creatureType.status);bump(summary.movement,c.movement.status);
   for(const [k,v] of Object.entries(c.senses))bump(summary.senses[k]??={},v.status);}
  rows.push({itemId:i.id,kind:i.kind,rulesEra:i.source.rulesEra,sourceFingerprint:e.sourceFingerprint,ability:a,chassis:c,proficiencies,
   variantReviewRequired:i.metadata.upstreamKind==='subrace'||m.versions!==undefined||r.lineage!==undefined,
   complexProficiencyPending:r.skillToolLanguageProficiencies!==undefined||r.expertise!==undefined,...flags()});
 }
 const body={schemaVersion:'dnd-upstream-origin-chassis-projection.v1',commits:actual.commits,evidenceFingerprint:actual.fingerprint,summary,rows,
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
function previewOriginSelection(input,request){
 try{
  if(!rec(request)||!['2014','2024'].includes(request.rulesEra)||request.contextComplete!==true||request.originPolicyConfirmed!==true)return pending('explicitOriginContextRequired');
  const report=buildOriginChassisProjection(input);
  if(request.projectionFingerprint!==report.fingerprint)return pending('projectionFingerprintMismatch');
  const row=report.rows.find(r=>r.itemId===request.originId);
  if(!row||row.rulesEra!==request.rulesEra||row.sourceFingerprint!==request.sourceFingerprint)return pending('originIdentityOrEditionPending');
  if(row.variantReviewRequired&&request.variantPolicyConfirmed!==true)return pending('variantPolicyPending');
  if(request.domain==='ability'){
   if(request.baseScoresConfirmed!==true||request.originIncreasesNotAppliedConfirmed!==true||!rec(request.scores)||
    Object.keys(request.scores).length!==6||!abilities.every(k=>pos(request.scores[k])&&request.scores[k]<=30))return pending('baseAbilityContextPending');
   const a=row.ability;let increases={};
   if(a.status==='backgroundAllocationCandidate'){
    if(evaluateBackgroundAllocation(a,request.increases,request.scores)!=='satisfied')return denied('allocationInvalid');
    increases={...request.increases};
   }else if(a.status==='legacyAllocationCandidate'){
    if(request.legacySpeciesPolicyConfirmed!==true||!nat(request.alternativeIndex)||!Array.isArray(request.selectedAbilities))return pending('legacyAllocationPolicyPending');
    const plan=a.alternatives[request.alternativeIndex];
    if(!plan)return denied('allocationAlternativeInvalid');
    if(evaluateAllocation(plan,request.selectedAbilities,request.scores)!=='satisfied')return denied('allocationInvalid');
    for(const f of plan.fixed)increases[f.ability]=(increases[f.ability]||0)+f.amount;
    for(const k of request.selectedAbilities)increases[k]=(increases[k]||0)+plan.choice.amount;
   }else return pending('abilityPolicyPending');
   return {...flags(),status:'originAbilityCandidate',increases,scores:Object.fromEntries(abilities.map(k=>[k,request.scores[k]+(increases[k]||0)]))};
  }
  if(request.domain==='chassis'){
   const c=row.chassis;
   if(!c||c.size.status!=='sizeCandidate'||c.movement.status!=='movementCandidate'||c.creatureType.status!=='typeCandidate')return pending('chassisFieldsPending');
   if(!c.size.options.includes(request.selectedSize))return denied('sizeSelectionInvalid');
   if(request.baseMovementAndSensePolicyConfirmed!==true)return pending('chassisPolicyPending');
   return {...flags(),status:'originChassisCandidate',size:request.selectedSize,creatureType:c.creatureType.value,movement:c.movement.feet,senses:c.senses,
    limitations:['undeclaredSensesNotInferred','traitAndConditionModifiersPending']};
  }
  if(request.domain==='proficiency'){
   const p=row.proficiencies[request.category];
   if(!p||p.status!=='literalProficiencyCandidate'||row.complexProficiencyPending)return pending('proficiencyPolicyPending');
   if(request.literalIdentityConfirmed!==true||request.existingInventoryComplete!==true||!unique(request.existing)||!unique(request.selected))return pending('proficiencyContextPending');
   if([...request.existing,...request.selected].some(x=>literalName(x,request.category)!==x))return pending('literalIdentityPending');
   const choice=p.choices[0];
   if(validateSelection(choice?.options??[],choice?.count??0,request.selected)!=='satisfied')return denied('proficiencySelectionInvalid');
   const grants=[...p.fixed,...request.selected];
   if(grants.some(x=>request.existing.includes(x)))return pending('duplicateProficiencyPolicyPending');
   return {...flags(),status:'originProficiencyCandidate',grants,combined:[...request.existing,...grants],limitations:['literalLabelsExternallyQualified','noExpertiseOrReplacementInference']};
  }
  return pending('unsupportedOriginDomain');
 }catch{return pending('originProjectionFailed');}
}
module.exports={proficiencyPlan,chassis,buildOriginChassisProjection,publicSummary,previewOriginSelection};
