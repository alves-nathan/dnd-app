'use strict';
// Scoped source-bound resource recovery and selection previews. No import,
// feature grant, character transaction or automatic recovery authorization.
const {digest}=require('./integrated-review');
const {physicalId}=require('./class-converter');
const {ownerAndLevelGraph}=require('./class-progression-evidence');
const {buildFeatureResourceEvidence}=require('./feature-resource-evidence');
const {resourcePool,resourceCost}=require('./resource-spellcasting-preview');
const {scheduledCount,validateSelection}=require('./semantic-eligibility');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const level=x=>int(x)&&x>=1&&x<=20;
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const denied=reason=>({...flags(),status:'notSatisfied',reason});
const reviewedCommit='2512db75eb48ef06f6190b086a82430887906dca';
// Exact reviewed entries and column hashes; no rule text copied. Recovery is
// limited to the base feature, not all other class features or effects.
const definitions=[
 {source:'XPHB',className:'Fighter',featureName:'Second Wind',label:'Second Wind',min:1,entry:'9328bf5879047dba4b93747c225c9b1bd1270c0ac63882c147babbf3d91b6d6c',column:'8a1df3c3eb0d2d856b9ade7ec42b6b52694cf7bf69b19b11cc8231494171713c',short:1,long:'all',ownUse:1},
 {source:'XPHB',className:'Barbarian',featureName:'Rage',label:'Rages',min:1,entry:'cdf18429f13c785713b517cf74732990072c7754053226ef9f7333e0155cb174',column:'9f3f0d8b94b284df6a7951141f2805341fb42b7b12e2ce000dc79fa268d26be2',short:1,long:'all',ownUse:1},
 {source:'PHB',className:'Barbarian',featureName:'Rage',label:'Rages',min:1,entry:'72f050609f3636484cf5c9e0b56b05a75986f1fcb9e215e0d89e6ce4f4b8042d',column:'8e7e058a3719f32b2e9f5394525045321f0e82e0ca46273a44677c18133e07f0',short:0,long:'all',ownUse:1},
 {source:'XPHB',className:'Monk',featureName:"Monk's Focus",label:'Focus Points',min:2,entry:'8d69236270cee9a627bfec6d48cae702fcaa99beaf29d38f8c8a87acecde5f07',column:'5d748d17782979b20b1f9a3119095a81b2baded139d2a5498a8395d4f8eb54d4',short:'all',long:'all',consumeName:'Focus Point'},
 {source:'PHB',className:'Monk',featureName:'Ki',label:'Ki Points',min:2,entry:'01b5125928d8de77873bc10c5e077725635e3db9588a0f4c938b6172dda6eac2',column:'5d748d17782979b20b1f9a3119095a81b2baded139d2a5498a8395d4f8eb54d4',short:'all',long:'all',meditation:true,consumeName:'Ki'}
];
function sourceBound(i,kind,d,commit){
 const p=i?.provenance,r=i?.payload?.mechanics?.upstreamClassRecord;
 return rec(r)&&i.kind===(kind==='class'?'class':'feature')&&r.source===d.source&&r.name===i.name&&
 p?.origin==='5etools'&&p.repository==='5etools-mirror-3/5etools-src'&&p.commit===commit&&
 typeof p.blob==='string'&&/^[a-f0-9]{40}$/.test(p.blob)&&p.sourceCode===d.source&&
 i.source?.id==='upstream:main:'+d.source&&i.source.status==='needsReview'&&
 i.source.rulesEra===(d.source==='PHB'?'2014':'2024')&&physicalId(kind,r)===i.id;
}
function buildResourceProjection(input){
 const evidence=buildFeatureResourceEvidence(input),commit=input.reconciliation.commits.main;
 const graph=ownerAndLevelGraph(input.items,commit),byId=new Map(evidence.rows.map(r=>[r.itemId,r]));
 const rows=definitions.map(d=>{
  const classId=physicalId('class',{name:d.className,source:d.source});
  const featureId=physicalId('classFeature',{name:d.featureName,source:d.source,className:d.className,classSource:d.source,level:d.min});
  const base={classId,featureId,rulesEra:d.source==='PHB'?'2014':'2024',...flags()};
  const cl=graph.index.get(classId),f=graph.index.get(featureId);
  if(commit!==reviewedCommit||!sourceBound(cl,'class',d,commit)||!sourceBound(f,'classFeature',d,commit)||
   f.payload.classId!==classId||f.payload.levelGained!==d.min)return {...base,status:'identityOrSnapshotPending'};
  const raw=cl.payload.mechanics.upstreamClassRecord,feature=f.payload.mechanics.upstreamClassRecord;
  const links=cl.payload.mechanics.featureGrantReferences.filter(g=>g.featureId===featureId);
  if(links.length!==1||typeof links[0].raw!=='string'||links[0].level!==d.min||digest(feature.entries)!==d.entry)
   return {...base,status:'grantOrDefinitionPending'};
  const tables=Array.isArray(raw.classTableGroups)?raw.classTableGroups:[];
  const matches=tables.flatMap((t,tableIndex)=>Array.isArray(t.colLabels)?t.colLabels.flatMap((v,columnIndex)=>v===d.label?[{t,tableIndex,columnIndex}]:[]):[]);
  if(matches.length!==1)return {...base,status:'columnPending'};
  const {t,tableIndex,columnIndex}=matches[0],column=byId.get(classId)?.columns.find(c=>c.field==='classTableGroups'&&c.tableIndex===tableIndex&&c.columnIndex===columnIndex);
  if(!column||column.labelKind!=='capacityLabelCandidate'||!Array.isArray(column.values)||!Array.isArray(t.rows)||
    digest(t.rows.map(r=>r[columnIndex]))!==d.column)return {...base,status:'columnPending'};
  return {...base,status:'baseResourceCandidate',name:d.label,minimumLevel:d.min,capacity:column.values,
   sourceFingerprint:digest(cl),featureFingerprint:digest(f),recovery:{short:d.short,long:d.long,meditationRequired:d.meditation===true},
   ...(d.ownUse?{ownUse:d.ownUse}:{}),...(d.consumeName?{consumeNameFingerprint:digest(d.consumeName)}:{}),
   limitations:['otherFeatureModifiersPending','activationAndTimingPending','noAutomaticRecovery']};
 });
 const counts={};for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
 const body={schemaVersion:'dnd-upstream-base-resource-projection.v1',commits:evidence.commits,evidenceFingerprint:evidence.fingerprint,counts,rows,
  approvedMappings:0,mechanicalParityEstablished:0,executable:false,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(report){const {rows,...summary}=report;return summary;}
function previewResourceEvent(input,request){
 try{
  if(!rec(request)||request.contextConfirmed!==true||request.baseFeatureOnlyConfirmed!==true||!text(request.classInstanceId)||
    !text(request.resourceId)||!level(request.level)||!int(request.current))return pending('explicitResourceContextRequired');
  const projection=buildResourceProjection(input);
  if(request.projectionFingerprint!==projection.fingerprint)return pending('projectionFingerprintMismatch');
  const r=projection.rows.find(x=>x.classId===request.classId&&x.featureId===request.featureId);
  if(!r||r.status!=='baseResourceCandidate'||r.rulesEra!==request.rulesEra)return pending('resourceIdentityPending');
  if(request.level<r.minimumLevel)return denied('featureLevelNotAttained');
  const cell=r.capacity[request.level-1];
  if(!cell||!['integer','integerText'].includes(cell.kind))return pending('finiteCapacityPending');
  const max=cell.value;
  if(request.current>max)return pending('currentExceedsBaseCapacity');
  const event=request.event;
  if(!rec(event)||event.confirmed!==true)return pending('confirmedEventRequired');
  let recoveryRules=[],cost;
  if(event.kind==='shortRest'||event.kind==='longRest'){
   if(r.recovery.meditationRequired&&typeof event.meditationConfirmed!=='boolean')return pending('meditationContextRequired');
   const amount=r.recovery.meditationRequired&&!event.meditationConfirmed?0:event.kind==='shortRest'?r.recovery.short:r.recovery.long;
   recoveryRules=[{trigger:event.kind,amount}];
  }else if(event.kind==='spend'){
   let amount;
   if(event.consumerFeatureId===r.featureId&&r.ownUse)amount=r.ownUse;
   else{
    if(event.consumerBindingConfirmed!==true)return pending('explicitConsumerBindingRequired');
    const f=input.items.find(i=>i.id===event.consumerFeatureId),m=f?.payload?.mechanics?.upstreamClassRecord;
    const owner=f?.payload?.classId;
    if(!f||f.kind!=='feature'||f.payload.sourceType!=='classFeature'||owner!==r.classId||
     f.source?.rulesEra!==r.rulesEra||f.provenance?.commit!==projection.commits.main||
     !level(f.payload.levelGained)||f.payload.levelGained>request.level||!rec(m?.consumes)||!r.consumeNameFingerprint||
     digest(m.consumes.name)!==r.consumeNameFingerprint||Object.keys(m.consumes).some(k=>!['name','amount'].includes(k))||
     !int(m.consumes.amount)||m.consumes.amount<1)return pending('consumerAmountOrOwnerPending');
    const cl=input.items.find(i=>i.id===r.classId);
    if(!cl.payload.mechanics.featureGrantReferences.some(g=>g.featureId===f.id&&typeof g.raw==='string'&&g.level===f.payload.levelGained))
      return pending('consumerGrantPending');
    amount=m.consumes.amount;
   }
   if(amount>request.current)return denied('insufficientResource');
   const c=resourceCost({resourceId:request.resourceId,amount});if(c.status!=='costCandidate')return pending('costPending');
   cost=c.cost;
  }else return pending('unsupportedEvent');
  // Event-scoped pool, manual outside this one confirmed event; never a
  // durable pool with implicit recovery. No runtime writes in this script.
  const p=resourcePool({id:request.resourceId,name:r.name,max,current:request.current,recharge:'manual',recoveryRules});
  if(p.status!=='poolCandidate')return pending('poolPending');
  return {...flags(),status:'resourceEventCandidate',event:event.kind,pool:p.pool,...(cost?{cost}:{}),classInstanceId:request.classInstanceId,
    projectionFingerprint:projection.fingerprint,limitations:r.limitations};
 }catch{return pending('resourceProjectionFailed');}
}
// A count schedule cannot establish grant/replacement policy. The caller
// must explicitly attest that the count is a total distinct-selection limit,
// allowed candidates and dependency/eligibility checks are complete, and
// the particular replacement is allowed. No eligibility by name.
function previewSelectionChange(input,request){
 try{
  if(!rec(request)||request.inventoryComplete!==true||request.totalDistinctLimitConfirmed!==true||
   request.eligibilityConfirmed!==true||request.dependenciesConfirmed!==true||!level(request.beforeLevel)||!level(request.afterLevel)||
   request.afterLevel<request.beforeLevel||!Array.isArray(request.beforeIds)||!Array.isArray(request.afterIds)||
   !Array.isArray(request.eligibleIds)||!request.eligibleIds.every(text)||new Set(request.eligibleIds).size!==request.eligibleIds.length)
   return pending('explicitSelectionContextRequired');
  const evidence=buildFeatureResourceEvidence(input);
  if(request.evidenceFingerprint!==evidence.fingerprint)return pending('evidenceFingerprintMismatch');
  const owner=evidence.rows.find(r=>r.itemId===request.ownerId);
  const choice=owner?.choices.find(c=>c.path===request.choicePath);
  if(!owner||!['class','subclass'].includes(owner.family)||owner.rulesEra!==request.rulesEra||!choice||
    choice.kind!=='optionalfeatureProgression'||choice.status!=='selectorAndSchedule'||choice.schedule?.scope!=='level')return pending('selectionScopePending');
  const a=scheduledCount(choice.schedule,request.beforeLevel),b=scheduledCount(choice.schedule,request.afterLevel);
  if(a===undefined||b===undefined)return pending('checkpointNotPresent');
  const items=new Map(input.items.map(i=>[i.id,i]));
  // Only exact optional-feature families and same-edition entries; the
  // caller's eligible set is an explicit reviewed subset, not generated here.
  if(request.eligibleIds.some(id=>{
   const i=items.get(id),row=evidence.rows.find(r=>r.itemId===id),families=i?.payload?.mechanics?.featureFamilies;
   return row?.family!=='optionalFeature'||i.source?.rulesEra!==owner.rulesEra||!Array.isArray(families)||
     !families.some(f=>choice.selector?.codes.includes(f.code));
  }))return pending('selectionFamilyOrEditionPending');
  if(validateSelection(request.eligibleIds,a,request.beforeIds)!=='satisfied'||
    validateSelection(request.eligibleIds,b,request.afterIds)!=='satisfied')return denied('selectionCountOrMembershipInvalid');
  const removed=request.beforeIds.filter(id=>!request.afterIds.includes(id)),added=request.afterIds.filter(id=>!request.beforeIds.includes(id));
  if(removed.length){
   if(request.replacementConfirmed!==true||!int(request.maxReplacements))return pending('replacementPolicyRequired');
   if(removed.length>request.maxReplacements)return denied('replacementLimitExceeded');
  }
  return {...flags(),status:'selectionChangeCandidate',beforeCount:a,afterCount:b,removed,added,
    semantics:'hypotheticalSelectionOnly',evidenceFingerprint:evidence.fingerprint};
 }catch{return pending('selectionProjectionFailed');}
}
module.exports={buildResourceProjection,publicSummary,previewResourceEvent,previewSelectionChange};
