'use strict';
// a8.7.4: duration and lifecycle review. Cast groups own recipient membership;
// neither a confirmed context nor a preview grants permission to write.
const {digest}=require('./integrated-review');
const {buildSpellParityEvidence}=require('./spell-parity-evidence');
const {compileDuration}=require('./effect-damage-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const era=x=>['2014','2024'].includes(x);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
function buildSpellLifecycleProjection(input,evidence){
 const actual=buildSpellParityEvidence(input);
 if(evidence!==undefined&&digest(evidence)!==digest(actual))throw Error('spellEvidenceMismatch');
 const byId=new Map(actual.upstreamRows.map(r=>[r.itemId,r])),rows=[],summary={items:0,duration:{},concentration:{}};
 for(const i of input.items.filter(i=>i.kind==='spell')){
  const e=byId.get(i.id);
  if(!e||e.sourceFingerprint!==digest(i))throw Error('spellLifecycleBindingMismatch');
  const d=compileDuration(i);
  const duration=d.status==='durationCandidate'?{status:d.status,unit:d.unit,maximum:d.maximum,concentration:d.concentration,upTo:d.upTo}:
   {status:d.status};
  const concentration=d.status==='durationCandidate'&&i.payload.concentration===d.concentration?d.concentration?'required':'notRequired':
   d.status==='instantaneous'&&i.payload.concentration===false?'notRequired':'pending';
  rows.push({itemId:i.id,sourceFingerprint:e.sourceFingerprint,rulesEra:i.source.rulesEra,duration,concentration,...flags()});
  summary.items++;bump(summary.duration,d.status);bump(summary.concentration,concentration);
 }
 const body={schemaVersion:'dnd-upstream-spell-lifecycle-projection.v1',commits:actual.commits,evidenceFingerprint:actual.fingerprint,summary,rows,
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
function concentrationDC(rulesEra,damage){
 if(!era(rulesEra)||!nat(damage))return pending('damageOrEditionPending');
 if(damage===0)return {...flags(),status:'noCheckRequired'};
 const dc=Math.max(10,Math.floor(damage/2));
 return {...flags(),status:'checkRequired',ability:'CON',dc:rulesEra==='2024'?Math.min(30,dc):dc};
}
// Only finite, source-bound spell durations are modeled. An external
// confirmation supplies actual clock advancement, cast completion, stacking,
// dependencies, and exception review. No rest-to-time conversion or turn defaults.
function previewSpellLifecycle(input,request){
 try{
  if(!rec(request)||request.inventoryComplete!==true||request.baseRulesConfirmed!==true||
   request.dependenciesComplete!==true||!Array.isArray(request.groups)||!rec(request.event)||request.event.confirmed!==true)
    return pending('explicitLifecycleContextRequired');
  const report=buildSpellLifecycleProjection(input);
  if(request.projectionFingerprint!==report.fingerprint)return pending('projectionFingerprintMismatch');
  const defs=new Map(report.rows.map(r=>[r.itemId,r])),groupIds=new Set(),effectIds=new Set(),activeConcentration=new Map();
  function validGroup(g){
   if(!rec(g)||!id(g.castId)||groupIds.has(g.castId)||!id(g.casterId)||!era(g.rulesEra)||
     !['active','ended','expired'].includes(g.status)||!Array.isArray(g.recipients)||!g.recipients.length)return false;
   const d=defs.get(g.spellId);
   if(!d||d.sourceFingerprint!==g.sourceFingerprint||d.rulesEra!==g.rulesEra||d.duration.status!=='durationCandidate'||
     d.concentration==='pending'||g.concentration!==(d.concentration==='required')||g.unit!==d.duration.unit||
     !nat(g.remaining)||g.remaining>d.duration.maximum||(g.status==='active'&&g.remaining===0))return false;
   const recipients=new Set();
   for(const r of g.recipients){
    if(!rec(r)||!id(r.effectId)||effectIds.has(r.effectId)||!id(r.recipientId)||recipients.has(r.recipientId))return false;
    recipients.add(r.recipientId);effectIds.add(r.effectId);
   }
   groupIds.add(g.castId);
   if(g.status==='active'&&g.concentration){
    if(activeConcentration.has(g.casterId))return false;
    activeConcentration.set(g.casterId,g);
   }
   return true;
  }
  if(!request.groups.every(validGroup))return pending('castInventoryBindingPending');
  const groups=JSON.parse(JSON.stringify(request.groups)),event=request.event,changes=[];
  const finish=(g,status,reason)=>{
   g.status=status;if(status==='expired')g.remaining=0;
   changes.push({castId:g.castId,status,reason,effectIds:g.recipients.map(r=>r.effectId)});
  };
  const result=extra=>({...flags(),status:'lifecycleCandidate',groups,changes,...extra});
  if(event.kind==='start'){
   if(event.castCompletedConfirmed!==true||event.stackingConfirmed!==true||event.recipientMembershipConfirmed!==true||
      event.casterCanMaintainConfirmed!==true)return pending('activationContextPending');
   const d=defs.get(event.spellId);
   if(!d||!era(event.rulesEra)||d.rulesEra!==event.rulesEra||d.sourceFingerprint!==event.sourceFingerprint||
    d.duration.status!=='durationCandidate'||d.concentration==='pending')return pending('finiteDurationDefinitionRequired');
   const prior=activeConcentration.get(event.casterId),concentration=d.concentration==='required';
   if(prior&&concentration&&(prior.rulesEra!==event.rulesEra||event.replacementBoundaryConfirmed!==true))
    return pending('concentrationReplacementBoundaryPending');
   // Validate new group separately; preserve prior membership and IDs.
   const g={castId:event.castId,casterId:event.casterId,spellId:event.spellId,sourceFingerprint:event.sourceFingerprint,
    rulesEra:event.rulesEra,status:'active',concentration,unit:d.duration.unit,remaining:d.duration.maximum,recipients:event.recipients};
   if(prior&&concentration)activeConcentration.delete(event.casterId);
   if(!validGroup(g))return pending('newCastBindingPending');
   if(prior&&concentration)finish(groups.find(x=>x.castId===prior.castId),'ended','concentrationReplaced');
   groups.push(JSON.parse(JSON.stringify(g)));
   changes.push({castId:g.castId,status:'active',reason:'castStarted',effectIds:g.recipients.map(r=>r.effectId)});
   return result({});
  }
  if(event.kind==='elapsed'){
   const g=groups.find(x=>x.castId===event.castId&&x.status==='active');
   if(!g||event.clockConfirmed!==true||event.unit!==g.unit||!nat(event.amount)||event.amount===0)return pending('explicitClockPending');
   g.remaining=Math.max(0,g.remaining-event.amount);
   if(g.remaining===0)finish(g,'expired','durationElapsed');
   else changes.push({castId:g.castId,status:'active',reason:'durationAdvanced',effectIds:[]});
   return result({});
  }
  if(event.kind==='end'){
   const g=groups.find(x=>x.castId===event.castId&&x.status==='active');
   if(!g||event.terminationPolicyConfirmed!==true)return pending('terminationPolicyPending');
   finish(g,'ended','confirmedTermination');return result({});
  }
  if(!['damage','incapacitated','death','dropConcentration','externalSave'].includes(event.kind)||!id(event.casterId)||!era(event.rulesEra))
   return pending('unsupportedLifecycleEvent');
  const old=activeConcentration.get(event.casterId);
  if(!old)return result({concentrationStatus:'noActiveConcentration'});
  if(old.rulesEra!==event.rulesEra)return pending('concentrationEditionPending');
  const g=groups.find(x=>x.castId===old.castId);
  if(['incapacitated','death','dropConcentration'].includes(event.kind)){
   finish(g,'ended',event.kind);return result({concentrationStatus:'ended'});
  }
  let check;
  if(event.kind==='damage'){
   if(event.damageTakenConfirmed!==true||event.singleDamageEventConfirmed!==true)return pending('damageEventPending');
   check=concentrationDC(event.rulesEra,event.damage);
  }else{
   if(event.externalDCConfirmed!==true||!nat(event.dc)||event.dc===0)return pending('externalSavePolicyPending');
   check={...flags(),status:'checkRequired',ability:'CON',dc:event.dc};
  }
  if(check.status==='indeterminate')return check;
  if(check.status==='noCheckRequired')return result({concentrationStatus:'maintained',check});
  if(event.saveTotal===undefined)return {...flags(),status:'concentrationSaveRequired',castId:g.castId,check};
  if(event.saveTotalConfirmed!==true||!Number.isSafeInteger(event.saveTotal))return pending('saveOutcomePending');
  if(event.saveTotal<check.dc){finish(g,'ended','concentrationSaveFailed');return result({concentrationStatus:'ended',check});}
  return result({concentrationStatus:'maintained',check});
 }catch{return pending('lifecycleProjectionFailed');}
}
module.exports={buildSpellLifecycleProjection,publicSummary,concentrationDC,previewSpellLifecycle};
