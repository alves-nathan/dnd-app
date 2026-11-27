'use strict';
// Review-only cast requirements: no action, slot, inventory or effect write.
const {digest}=require('./integrated-review');
const {buildSpellParityEvidence}=require('./spell-parity-evidence');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const int=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>int(x)&&x>0;
const keys=(o,allowed)=>rec(o)&&Object.keys(o).every(k=>allowed.includes(k));
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const denied=reason=>({...flags(),status:'notSatisfied',reason});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
function timing(raw,ritual){
 if(!Array.isArray(raw)||!raw.length||typeof ritual!=='boolean')return {status:'timingPending'};
 const alternatives=raw.map((t,index)=>{
  const base={index,fingerprint:digest(t)};
  if(!keys(t,['number','unit','condition'])||!positive(t.number)||typeof t.unit!=='string'||(own(t,'condition')&&!id(t.condition)))return {...base,status:'timingPending'};
  const actionCosts={action:'action',bonus:'bonusAction',reaction:'reaction'};
  const actionCost=own(actionCosts,t.unit)?actionCosts[t.unit]:undefined;
  const triggerRequired=own(t,'condition')||t.unit==='reaction';
  if(t.unit==='reaction'&&!own(t,'condition'))return {...base,status:'timingPending'};
  if(actionCost&&t.number===1)return {...base,status:'actionCandidate',actionCost,triggerRequired};
  if(['minute','hour','day'].includes(t.unit)&&!triggerRequired)return {...base,status:'durationCandidate',amount:t.number,unit:t.unit,triggerRequired:false};
  return {...base,status:'timingPending'};
 });
 return {status:alternatives.every(t=>t.status!=='timingPending')?'timingCandidates':'timingAlternativesPending',alternatives,ritual};
}
function range(raw){
 if(!keys(raw,['type','distance']))return {status:'rangePending'};
 const d=raw.distance;
 if(raw.type==='special'&&!own(raw,'distance'))return {status:'specialRangePending'};
 if(!keys(d,['type','amount']))return {status:'rangePending'};
 if(['feet','miles'].includes(d.type)&&positive(d.amount)){
  const feet=d.amount*(d.type==='miles'?5280:1);
  if(!positive(feet))return {status:'rangePending'};
  if(raw.type==='point')return {status:'pointDistanceCandidate',feet};
  if(['radius','sphere','hemisphere','line','cone','cube','emanation','cylinder'].includes(raw.type))
   return {status:'selfAreaCandidate',shape:raw.type,extentFeet:feet,geometryPending:true};
 }
 if(raw.type==='point'&&!own(d,'amount')&&['self','touch','sight','unlimited','plane'].includes(d.type))return {status:'pointContextCandidate',kind:d.type};
 return {status:'rangePending'};
}
function components(raw){
 if(!keys(raw,['v','s','m'])||['v','s'].some(k=>own(raw,k)&&typeof raw[k]!=='boolean'))return {status:'componentsPending'};
 const m=raw.m,base={verbal:raw.v===true,somatic:raw.s===true,material:m!==undefined&&m!==false};
 if(!base.material)return {...base,status:'componentCandidate',materialRequirement:null};
 if(m===true||id(m))return {...base,status:'componentCandidate',materialRequirement:{fingerprint:digest(m),costStatus:'notDeclared',consumption:'notDeclared'}};
 if(!keys(m,['text','cost','consume'])||!id(m.text)|| (own(m,'cost')&&!positive(m.cost))||
  (own(m,'consume')&&![true,false,'optional'].includes(m.consume)))return {...base,status:'componentsPending'};
 return {...base,status:'componentCandidate',materialRequirement:{fingerprint:digest(m),costStatus:own(m,'cost')?'explicitCopperCandidate':'notDeclared',
  ...(own(m,'cost')?{costCopper:m.cost}:{}),consumption:m.consume===true?'required':m.consume===false?'explicitFalse':m.consume==='optional'?'optionalPending':'notDeclared'}};
}
function buildSpellCastingProjection(input,evidence){
 const actual=buildSpellParityEvidence(input);
 if(evidence!==undefined&&(evidence.fingerprint!==actual.fingerprint||digest(evidence)!==digest(actual)))throw Error('spellEvidenceMismatch');
 const byId=new Map(actual.upstreamRows.map(r=>[r.itemId,r])),rows=[],summary={items:0,timing:{},timeAlternatives:{},range:{},components:{},materials:{},consumption:{}};
 for(const i of input.items.filter(i=>i.kind==='spell')){
  const e=byId.get(i.id),p=i.payload,r=p.mechanics.upstreamSpell;
  if(!e||e.sourceFingerprint!==digest(i))throw Error('spellProjectionBindingMismatch');
  const t=timing(r.time,p.ritual),a=range(r.range),c=components(r.components);
  const row={itemId:i.id,sourceFingerprint:e.sourceFingerprint,rulesEra:i.source.rulesEra,spellLevel:p.level,
   timing:t,range:a,components:c,areaReviewRequired:a.status==='selfAreaCandidate'||p.area!==undefined||Boolean(r.areaTags?.length),
   targetingStatus:'explicitContextRequired',...flags()};
  rows.push(row);summary.items++;
  bump(summary.timing,t.status);for(const v of t.alternatives||[])bump(summary.timeAlternatives,v.status);
  bump(summary.range,a.status);bump(summary.components,c.status);
  if(c.materialRequirement){bump(summary.materials,c.materialRequirement.costStatus);bump(summary.consumption,c.materialRequirement.consumption);}
 }
 const body={schemaVersion:'dnd-upstream-spell-casting-projection.v1',commits:actual.commits,evidenceFingerprint:actual.fingerprint,summary,rows,
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
function previewCastingRequirements(input,request){
 try{
  if(!rec(request)||request.contextComplete!==true||!id(request.casterId)||!['2014','2024'].includes(request.rulesEra))return pending('explicitCastContextRequired');
  const report=buildSpellCastingProjection(input);
  if(request.projectionFingerprint!==report.fingerprint)return pending('projectionFingerprintMismatch');
  const r=report.rows.find(x=>x.itemId===request.spellId);
  if(!r||r.rulesEra!==request.rulesEra)return pending('spellIdentityOrEditionPending');
  if(!int(request.timeAlternativeIndex))return pending('explicitTimingAlternativeRequired');
  const t=r.timing.alternatives?.find(x=>x.index===request.timeAlternativeIndex);
  if(!t||t.status==='timingPending')return pending('timingAlternativePending');
  if(typeof request.ritual!=='boolean'||request.timingAvailableConfirmed!==true)return pending('timingContextRequired');
  if(t.triggerRequired&&request.triggerConfirmed!==true)return pending('castingTriggerPending');
  if(request.ritual){
   if(!r.timing.ritual)return denied('ritualNotDeclared');
   if(request.ritualPolicyConfirmed!==true)return pending('ritualTimingAndAccessPending');
  }
  const a=request.anchor,q=r.range;
  if(!rec(a)||!id(a.id)||!['caster','creature','object','point'].includes(a.kind)||request.anchorEligibilityConfirmed!==true)return pending('anchorContextRequired');
  if(q.status==='pointDistanceCandidate'){
   if(!Number.isFinite(a.distanceFeet)||a.distanceFeet<0)return pending('anchorDistanceRequired');
   if(a.distanceFeet>q.feet)return denied('anchorOutOfRange');
  }else if(q.status==='selfAreaCandidate'||(q.status==='pointContextCandidate'&&q.kind==='self')){
   if(a.kind!=='caster'||a.id!==request.casterId)return denied('selfOriginRequired');
  }else if(q.status==='pointContextCandidate'){
   if(q.kind==='touch'&&a.touchConfirmed!==true)return pending('touchContextRequired');
   if(q.kind==='sight'&&a.visibleConfirmed!==true)return pending('sightContextRequired');
   if(q.kind==='plane'&&a.samePlaneConfirmed!==true)return pending('planeContextRequired');
   // Unlimited is not proof of absence of other targeting restrictions.
  }else return pending('rangeSemanticsPending');
  const target=request.targeting;
  if(!rec(target)||target.policyConfirmed!==true||target.membershipComplete!==true||target.eligibilityConfirmed!==true||
    !int(target.min)||!int(target.max)||target.min>target.max||!Array.isArray(target.ids)||!target.ids.every(id)||new Set(target.ids).size!==target.ids.length)
   return pending('targetPolicyAndMembershipRequired');
  if(target.ids.length<target.min||target.ids.length>target.max)return denied('targetCountOutsideConfirmedPolicy');
  if(r.areaReviewRequired&&target.geometryConfirmed!==true)return pending('areaGeometryPending');
  const c=r.components;
  if(c.status!=='componentCandidate')return pending('componentShapePending');
  const v=request.components;
  if(!rec(v))return pending('componentContextRequired');
  if(c.verbal&&v.verbalAvailableConfirmed!==true)return pending('verbalAvailabilityPending');
  if(c.somatic&&v.somaticAvailableConfirmed!==true)return pending('somaticAvailabilityPending');
  let material=null;
  if(c.material){
   const m=c.materialRequirement,f=v.material;
   if(!rec(f)||f.requirementFingerprint!==m.fingerprint||f.accessibleConfirmed!==true)return pending('materialBindingOrAccessPending');
   if(m.consumption==='optionalPending')return pending('optionalConsumptionSemanticsPending');
   if(f.kind==='focus'){
    if(m.costStatus==='explicitCopperCandidate'||m.consumption==='required')return denied('specificMaterialRequired');
    if(f.substitutionPolicyConfirmed!==true||!id(f.focusId))return pending('focusSubstitutionPolicyPending');
    material={kind:'focus',focusId:f.focusId};
   }else if(f.kind==='specific'){
    if(!id(f.inventoryItemId)||f.identityConfirmed!==true)return pending('specificMaterialIdentityPending');
    if(m.costStatus==='explicitCopperCandidate'){
     if(f.valuationConfirmed!==true||!int(f.valueCopper))return pending('materialValuationPending');
     if(f.valueCopper<m.costCopper)return denied('materialValueInsufficient');
    }
    if(m.consumption==='required'&&f.consumptionAvailabilityConfirmed!==true)return pending('materialConsumptionAvailabilityPending');
    material={kind:'specific',inventoryItemId:f.inventoryItemId,consumption:m.consumption,...(own(m,'costCopper')?{requiredValueCopper:m.costCopper}:{})};
   }else return pending('materialFulfillmentPending');
  }
  return {...flags(),status:'castingRequirementsCandidate',spellId:r.itemId,projectionFingerprint:report.fingerprint,
   timing:{...t,ritual:request.ritual,...(request.ritual?{additionalMinutesCandidate:10}:{})},
   range:q,anchorId:a.id,targetCount:target.ids.length,material,
   limitations:['targetPolicyAndGeometryExternallyConfirmed','componentAvailabilityExternallyConfirmed','castingAccessSlotAndEffectsPending','noInventoryOrActionMutation']};
 }catch{return pending('castingProjectionFailed');}
}
module.exports={timing,range,components,buildSpellCastingProjection,publicSummary,previewCastingRequirements};
