'use strict';
// a8.6.1: compare exact occurrence-bound owners and progression, not grants
// or equivalence. No historical payload or identity is emitted publicly.
const {digest}=require('./integrated-review');
const kinds=['class','subclass','feature'];
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const str=x=>typeof x==='string'&&x.trim().length>0;
const level=x=>Number.isInteger(x)&&x>=1&&x<=20;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const coord=x=>JSON.stringify([x.path,x.index]);
const flags=()=>({activation:'review-required',mechanicalParity:'notEstablished',writeAuthorized:false,retirementAuthorized:false});
const family=i=>i.kind==='feature'?(i.payload?.sourceType==='classFeature'?'classFeature':i.payload?.sourceType==='subclassFeature'?'subclassFeature':'otherFeature'):i.kind;
const fieldNames={
 class:['hitDie','primaryAbilities','savingThrowProficiencies','armorTraining','weaponProficiencies','skillChoiceCount','skillProficienciesChoice','spellcasting','multiclassing','startingEquipment','resources'],
 subclass:['spellcasting','resources','additionalSpells','prerequisite'],
 feature:['sourceType','levelGained','actions','effects','resources','prerequisite','choices','additionalSpells','grants']
};
function fields(kind,a,b){
 return fieldNames[kind].map(field=>{
  const x=own(a,field)&&a[field]!==undefined,y=own(b,field)&&b[field]!==undefined;
  return {field,status:!x&&!y?'absentBoth':!x?'addedCandidate':!y?'missingCandidate':digest(a[field])===digest(b[field])?'exactValue':'differentValue'};
 });
}
function ownerAndLevelGraph(items,mainCommit){
 const index=new Map();
 for(const i of items){assert(str(i.id)&&!index.has(i.id),'duplicateTarget');index.set(i.id,i);}
 const byFamily={},grantRefs=new Map();
 const target=(id,kind)=>{
  const i=index.get(id);
  assert(i&&i.kind===kind&&i.provenance?.origin==='5etools'&&i.provenance.commit===mainCommit&&i.source?.status==='needsReview','targetOwnerBindingMismatch');
  return i;
 };
 for(const i of items.filter(i=>kinds.includes(i.kind))){
  target(i.id,i.kind);
  const f=family(i),p=i.payload;
  assert(rec(p),'invalidTargetPayload');
  const s=byFamily[f]??={items:0,owners:0,uniqueGrants:0,grantOccurrences:0,duplicateGrants:0,annotatedGrants:0,unlistedFeatures:0};
  s.items++;
  if(f==='otherFeature')continue; // optional features are not native class grants
  if(f!=='class'){
   target(p.classId,'class');
   if(f==='subclassFeature'){
    const sub=target(p.subclassId,'subclass');
    assert(sub.payload.classId===p.classId,'targetSubclassOwnerMismatch');
   }
  }
  if(f==='classFeature'||f==='subclassFeature'){
   assert(level(p.levelGained)&&(f!=='classFeature'||p.subclassId===undefined),'targetFeatureLevelOrOwnerMismatch');
   continue;
  }
  s.owners++;
  assert(Array.isArray(p.featureIds)&&new Set(p.featureIds).size===p.featureIds.length&&Array.isArray(p.progression)&&Array.isArray(p.mechanics?.featureGrantReferences),'targetProgressionMissing');
  const expected=new Map(),occurrences=p.mechanics.featureGrantReferences;
  for(const ref of occurrences){
   assert(rec(ref)&&str(ref.uid)&&level(ref.level),'invalidTargetGrant');
   const t=target(ref.featureId,'feature');
   assert(family(t)===(f==='class'?'classFeature':'subclassFeature')&&t.payload.classId===(f==='class'?i.id:p.classId)&&
    (f!=='subclass'||t.payload.subclassId===i.id)&&t.payload.levelGained===ref.level,'targetGrantOwnerOrLevelMismatch');
   if(!expected.has(t.id))expected.set(t.id,ref.level);
   if(rec(ref.raw))s.annotatedGrants++;
  }
  assert(digest([...expected.keys()])===digest(p.featureIds),'targetGrantProjectionMismatch');
  const byLevel=new Map();
  for(const [id,l] of expected){const a=byLevel.get(l)||[];a.push(id);byLevel.set(l,a);}
  const expectedSteps=[...byLevel].sort((a,b)=>a[0]-b[0]).map(([level,featureIds])=>({level,featureIds}));
  assert(digest(expectedSteps)===digest(p.progression),'targetProgressionProjectionMismatch');
  s.uniqueGrants+=expected.size;s.grantOccurrences+=occurrences.length;s.duplicateGrants+=occurrences.length-expected.size;
  grantRefs.set(i.id,expected);
 }
 for(const i of items){
  const f=family(i);
  if(f!=='classFeature'&&f!=='subclassFeature')continue;
  const owner=f==='classFeature'?i.payload.classId:i.payload.subclassId;
  if(!grantRefs.get(owner)?.has(i.id))byFamily[f].unlistedFeatures++;
 }
 return {index,byFamily,grantRefs};
}
function compareProgression(old,next,resolve){
 const rows=[];
 function compare(field,a,b,withLevel){
  if(a===undefined){rows.push({field,status:b===undefined?'absentBoth':'historicalFieldAbsent'});return;}
  if(!Array.isArray(a)){rows.push({field,status:'historicalShapePending'});return;}
  if(!Array.isArray(b)){rows.push({field,status:'candidateFieldMissing'});return;}
  let flat=[];
  if(withLevel){
   if(!a.every(x=>rec(x)&&level(x.level)&&Array.isArray(x.featureIds)&&x.featureIds.every(str))){rows.push({field,status:'historicalShapePending'});return;}
   flat=a.flatMap(x=>x.featureIds.map(id=>({id,level:x.level})));
  }else{
   if(!a.every(str)){rows.push({field,status:'historicalShapePending'});return;}
   flat=a.map(id=>({id}));
  }
  const targetList=withLevel?b.flatMap(x=>x.featureIds.map(id=>({id,level:x.level}))):b.map(id=>({id}));
  let unresolved=0,eraPending=0,missing=0,levelMismatch=0;
  const mapped=[];
  for(const x of flat){
   const m=resolve(x.id,'feature');
   if(!m){unresolved++;continue;}
   if(m.eraPending)eraPending++;
   const v={...x,id:m.target.id};
   mapped.push(v);
   if(!targetList.some(y=>y.id===v.id))missing++;
   else if(withLevel&&!targetList.some(y=>y.id===v.id&&y.level===v.level))levelMismatch++;
  }
  const mappedKeys=new Set(mapped.map(x=>digest(x))),targetKeys=new Set(targetList.map(x=>digest(x)));
  const added=[...targetKeys].filter(x=>!mappedKeys.has(x)).length;
  const duplicateHistorical=flat.length-new Set(flat.map(x=>digest(x))).size;
  const duplicateMapped=mapped.length-mappedKeys.size;
  const status=unresolved?'endpointMappingPending':eraPending?'endpointEditionPending':
   missing||levelMismatch||added||duplicateHistorical||duplicateMapped?'grantDifferences':
   digest(mapped)===digest(targetList)?'orderedGrantCandidate':'orderReviewPending';
  rows.push({field,status,historicalLinks:flat.length,candidateLinks:targetList.length,unresolved,eraPending,missing,levelMismatch,added,duplicateHistorical,duplicateMapped});
 }
 compare('featureIds',old.featureIds,next.featureIds,false);
 compare('progression',old.progression,next.progression,true);
 return rows;
}
function buildClassProgressionEvidence({reconciliation,rawHistorical,items}){
 const r=reconciliation,c=r.commits;
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&
  r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&
  Object.keys(r.summary.issues).length===0&&['application','main','homebrew'].every(k=>sha(c[k])),'invalidReconciliation');
 const graph=ownerAndLevelGraph(items,c.main),raw=new Map(),groups=new Map(),seen=new Set();
 for(const x of rawHistorical){assert(!raw.has(coord(x)),'duplicateHistoricalCoordinate');raw.set(coord(x),x.item);}
 for(const h of r.historical.filter(h=>kinds.includes(h.kind))){
  const old=raw.get(coord(h));
  assert(old&&old.id===h.id&&old.kind===h.kind&&digest(old)===h.sourceFingerprint&&!seen.has(coord(h))&&
    h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed','historicalBindingMismatch');
  seen.add(coord(h));const a=groups.get(h.id)||[];a.push(h);groups.set(h.id,a);
  if(h.status==='identityCandidate'){
   const t=graph.index.get(h.targetId);
   assert(t&&t.kind===h.kind&&digest(t)===h.targetFingerprint,'targetBindingMismatch');
  }
 }
 assert(seen.size===rawHistorical.filter(x=>kinds.includes(x.item.kind)).length,'historicalCoverageMismatch');
 const resolve=(id,kind)=>{
  const g=groups.get(id);
  if(!g||!g.every(x=>x.kind===kind&&x.status==='identityCandidate'&&x.targetId===g[0].targetId))return undefined;
  return {target:graph.index.get(g[0].targetId),eraPending:g.some(x=>x.eraStatus!=='sameKnownEra')};
 };
 const byKind=Object.fromEntries(kinds.map(k=>[k,{occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,identityStatus:{},ownerStatus:{},progressionStatus:{},fieldStatus:{},runtimeStatus:{},unassessedFields:0}]));
 const rows=[];
 for(const h of r.historical.filter(h=>kinds.includes(h.kind))){
  const s=byKind[h.kind],old=raw.get(coord(h)),row={kind:h.kind,evidenceId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,...flags()};
  s.occurrences++;bump(s.identityStatus,h.status);
  if(h.status!=='identityCandidate'){s.identityPending++;rows.push(row);continue;}
  s.identityCandidates++;
  if(h.eraStatus!=='sameKnownEra')s.eraPending++;
  const t=graph.index.get(h.targetId),a=old.payload,b=t.payload;
  row.targetFingerprint=h.targetFingerprint;row.eraStatus=h.eraStatus;row.family=family(t);
  if(!rec(a)||!rec(b)){bump(s.ownerStatus,'payloadNotAvailable');rows.push(row);continue;}
  const owner=[];
  for(const [field,kind] of [['classId','class'],['subclassId','subclass']]){
   const x=a[field],y=b[field];
   if(x===undefined&&y===undefined)continue;
   let status;
   if(x===undefined)status='historicalOwnerAbsent';
   else if(y===undefined)status='candidateOwnerAbsent';
   else if(!str(x))status='historicalOwnerShapePending';
   else {const m=resolve(x,kind);status=!m?'ownerMappingPending':m.target.id!==y?'ownerMismatch':m.eraPending?'ownerEditionPending':'ownerIdentityCandidate';}
   owner.push({field,status});bump(s.ownerStatus,status);
  }
  row.owner=owner;
  row.fields=fields(h.kind,a,b);
  for(const f of row.fields)bump(s.fieldStatus[f.field]??={},f.status);
  row.unassessedFields=new Set([...Object.keys(a),...Object.keys(b)].filter(k=>!fieldNames[h.kind].includes(k)&&!['classId','subclassId','featureIds','progression'].includes(k))).size;
  s.unassessedFields+=row.unassessedFields;
  if(h.kind==='class'||h.kind==='subclass'){
   row.progression=compareProgression(a,b,resolve);
   for(const p of row.progression)bump(s.progressionStatus[p.field]??={},p.status);
  }
  rows.push(row);
 }
 for(const x of r.runtime){
  const k=['classFeature','subclassFeature'].includes(x.kind)?'feature':x.kind;
  if(!kinds.includes(k))continue;
  assert(x.preservation==='required'&&x.decision==='unreviewed'&&x.activation==='review-required','runtimeBindingMismatch');
  bump(byKind[k].runtimeStatus,x.status);
 }
 const body={schemaVersion:'dnd-upstream-class-progression-evidence.v1',commits:c,byKind,graph:graph.byFamily,rows,
  scope:'historical occurrences and emitted Main class grant projection; runtime status only; no parity approval',
  approvedMappings:0,mechanicalParityEstablished:0,activation:'review-required',executable:false,retirementAuthorized:false};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(report){const {rows,...summary}=report;return summary;}
module.exports={ownerAndLevelGraph,compareProgression,buildClassProgressionEvidence,publicSummary};
