'use strict';
// a8.7.5: exact list membership and hypothetical cast/slot contract.
// No inferred preparation mode, additional grants, or character writes.
const {digest}=require('./integrated-review');
const {buildSpellParityEvidence}=require('./spell-parity-evidence');
const {buildClassProjection,previewClassBuild}=require('./class-projection-preview');
const {pilot}=require('./spell-converter');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const era=x=>['2014','2024'].includes(x);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const denied=reason=>({...flags(),status:'notSatisfied',reason});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const unique=a=>Array.isArray(a)&&a.every(id)&&new Set(a).size===a.length;
function buildSpellAccessProjection(input,evidence,classes){
 const actual=buildSpellParityEvidence(input),cp=buildClassProjection(input.items,actual.commits.main);
 if(evidence!==undefined&&digest(evidence)!==digest(actual))throw Error('spellEvidenceMismatch');
 if(classes!==undefined&&digest(classes)!==digest(cp))throw Error('classEvidenceMismatch');
 const items=new Map(input.items.map(i=>[i.id,i])),spells=new Map(actual.upstreamRows.map(r=>[r.itemId,r]));
 const classesByKey=new Map();
 for(const c of cp.rows.filter(r=>r.kind==='class')){
  const i=items.get(c.itemId),key=JSON.stringify([c.sourceCode,i.name]);
  if(classesByKey.has(key))throw Error('ambiguousClassIdentity');
  classesByKey.set(key,c);
 }
 const summary={items:0,directEdges:0,edgeStatus:{},additionalAccess:{}},rows=[];
 for(const i of input.items.filter(i=>i.kind==='spell')){
  const s=spells.get(i.id),r=i.payload.mechanics.upstreamSpell,selected=r.selectedClassAccess;
  if(!s||s.sourceFingerprint!==digest(i)||!Array.isArray(selected)||!rec(r.access?.class))throw Error('spellAccessBindingMismatch');
  const seen=new Set(),edges=[];
  for(const c of selected){
   if(!rec(c)||!id(c.name)||!id(c.source)||!pilot[i.provenance.sourceCode].classSources.includes(c.source)||
    !rec(r.access.class[c.source])||!own(r.access.class[c.source],c.name)||digest(r.access.class[c.source][c.name])!==digest(c.details))throw Error('selectedAccessBindingMismatch');
   const key=JSON.stringify([c.source,c.name]);
   if(seen.has(key))throw Error('duplicateAccessEdge');seen.add(key);
   const cl=classesByKey.get(key);
   const status=!cl?'classEndpointPending':!era(s.rulesEra)||s.rulesEra!==cl.rulesEra?'editionPending':c.details!==true?'conditionalAccessPending':'directListCandidate';
   edges.push({status,sourceCode:c.source,className:c.name,...(cl?{classId:cl.itemId,classFingerprint:cl.sourceFingerprint}:{}),detailsFingerprint:digest(c.details)});
   summary.directEdges++;bump(summary.edgeStatus,status);
  }
  const additional=Object.keys(r.access).filter(k=>k!=='class').sort();
  for(const k of additional)bump(summary.additionalAccess,k);
  rows.push({spellId:i.id,sourceFingerprint:s.sourceFingerprint,rulesEra:s.rulesEra,level:i.payload.level,ritual:i.payload.ritual,
   edges,additionalAccessPending:additional.length>0,...flags()});summary.items++;
 }
 const body={schemaVersion:'dnd-upstream-spell-access-projection.v1',commits:actual.commits,spellFingerprint:actual.fingerprint,classFingerprint:cp.fingerprint,
  summary,rows,approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
function previewSpellAccessAndSlot(input,request){
 try{
  if(!rec(request)||!era(request.rulesEra)||request.assignmentInventoryComplete!==true||request.accessPolicyConfirmed!==true||
    request.castingRequirementsConfirmed!==true||!id(request.classInstanceId)||!Array.isArray(request.assignments)||
    !rec(request.build)||!rec(request.cast))return pending('explicitSpellAccessContextRequired');
  const report=buildSpellAccessProjection(input);
  if(request.projectionFingerprint!==report.fingerprint)return pending('projectionFingerprintMismatch');
  if(request.build.rulesEra!==request.rulesEra||request.build.projectionFingerprint!==report.classFingerprint)return pending('classProjectionBindingMismatch');
  const build=previewClassBuild(input.items,report.commits.main,request.build);
  if(build.status!=='buildProjectionCandidate')return pending('classBuildPending');
  const binding=request.build.classes.find(b=>b.classInstanceId===request.classInstanceId);
  const profile=build.profiles.find(b=>b.classInstanceId===request.classInstanceId);
  if(!binding||profile?.status!=='levelProjectionCandidate')return pending('castingProfilePending');
  const bySpell=new Map(report.rows.map(r=>[r.spellId,r]));
  const assignments=new Map(),counts={cantrip:0,known:0,prepared:0};
  const maxLevel=Math.max(0,...Object.entries(profile.slots).filter(([,v])=>v>0).map(([k])=>Number(k)));
  for(const a of request.assignments){
   if(!rec(a)||!id(a.assignmentId)||assignments.has(a.assignmentId)||!id(a.spellId)||!id(a.classInstanceId)||
    !['cantrip','known','prepared','granted'].includes(a.mode))return pending('assignmentBindingPending');
   assignments.set(a.assignmentId,a);
   // Preserve other class and external assignments without interpreting them.
   if(a.classInstanceId!==request.classInstanceId)continue;
   const s=bySpell.get(a.spellId);
   if(!s||s.sourceFingerprint!==a.sourceFingerprint||s.rulesEra!==request.rulesEra)return pending('assignmentSpellIdentityPending');
   if(a.mode==='granted'){
    if(a.grantConfirmed!==true||!id(a.grantId)||a.grantEligibilityConfirmed!==true)return pending('specialGrantPending');
    continue;
   }
   if(a.mode==='cantrip'?s.level!==0:s.level===0||s.level>maxLevel)return denied('assignmentLevelOutsideClassProfile');
   const ownerId=profile.sourceItemId===binding.classId?binding.classId:a.listOwnerClassId;
   if(profile.sourceItemId!==binding.classId&&(a.borrowedListConfirmed!==true||a.subclassId!==profile.sourceItemId||!id(ownerId)))return pending('subclassListPolicyPending');
   if(!s.edges.some(e=>e.status==='directListCandidate'&&e.classId===ownerId))return pending('qualifiedListAccessPending');
   counts[a.mode]++;
  }
  const scoped=request.assignments.filter(a=>a.classInstanceId===request.classInstanceId&&a.mode!=='granted');
  if(new Set(scoped.map(a=>a.mode+'|'+a.spellId)).size!==scoped.length)return denied('duplicateSpellAssignment');
  // Counts are independent; table absence is not zero or permission.
  const limits=profile.limits;
  for(const [mode,key] of [['cantrip','cantripsKnownByLevel'],['known','spellsKnownByLevel'],['prepared','preparedSpellsByLevel']]){
   if(counts[mode]&&!own(limits,key))return pending('preparationLimitPending');
   if(own(limits,key)&&counts[mode]>limits[key])return denied('preparationLimitExceeded');
  }
  const a=assignments.get(request.cast.assignmentId),s=a&&bySpell.get(a.spellId);
  if(!a||a.classInstanceId!==request.classInstanceId||!s||a.castAvailableConfirmed!==true)return pending('castAssignmentAvailabilityPending');
  const cast=request.cast;
  // Explicit availability attestation is required even with a known list
  // entry or prepared assignment. Formula and spellbook semantics not inferred.
  if(!['normal','ritual','free'].includes(cast.mode))return pending('castModePending');
  if(cast.mode==='ritual'){
   if(!s.ritual||s.level===0)return denied('ritualNotDeclared');
   if(cast.ritualEligibilityConfirmed!==true||cast.ritualTimingConfirmed!==true||cast.poolId!==undefined)return pending('ritualPolicyPending');
  }else if(cast.mode==='free'){
   if(a.mode!=='granted'||cast.freeCastPolicyConfirmed!==true||cast.poolId!==undefined)return pending('freeCastGrantPending');
   // Free use may spend a different resource; never assert it is free of all costs.
   return pending('freeCastResourceTransactionPending');
  }
  if(!Array.isArray(request.pools)||request.poolInventoryComplete!==true)return pending('slotInventoryPending');
  const expected=new Map(build.pools.map(p=>[p.id,p])),seen=new Set();
  for(const p of request.pools){
   const e=expected.get(p?.id);
   if(!e||seen.has(p.id)||p.level!==e.level||p.max!==e.max||p.poolKind!==e.poolKind||p.sourceClassId!==e.sourceClassId||
    p.recharge!==e.recharge||!nat(p.current)||p.current>p.max)return pending('slotPoolBindingPending');
   seen.add(p.id);
  }
  if(seen.size!==expected.size)return pending('slotInventoryPending');
  const pools=JSON.parse(JSON.stringify(request.pools)),costs=[];
  if(cast.mode==='normal'&&s.level>0){
   const p=pools.find(p=>p.id===cast.poolId);
   if(!p||cast.poolEligibilityConfirmed!==true)return pending('explicitSlotPoolRequired');
   if(p.level<s.level)return denied('slotTooLow');
   if(p.current<1)return denied('slotUnavailable');
   p.current--;
   costs.push({spellId:s.spellId,slotLevel:p.level,minimumSlotLevel:s.level,amount:1,poolKind:p.poolKind,
    ...(p.sourceClassId?{sourceClassId:p.sourceClassId}:{})});
  }else if(cast.poolId!==undefined)return denied('unexpectedSlotCost');
  return {...flags(),status:'spellSlotTransactionCandidate',counts,limits,slotCosts:costs,pools,
   assignments:JSON.parse(JSON.stringify(request.assignments)),limitations:['externallyConfirmedAccessAndAvailability','noPreparationOrReplacementMutation','noFreeGrantResourceTransaction','noActualCastOrSlotWrite']};
 }catch{return pending('spellAccessProjectionFailed');}
}
module.exports={buildSpellAccessProjection,publicSummary,previewSpellAccessAndSlot};
