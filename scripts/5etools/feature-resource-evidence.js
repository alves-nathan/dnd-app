'use strict';
// Evidence only. Numeric columns are observations, never resource definitions.
const {digest}=require('./integrated-review');
const {ownerAndLevelGraph}=require('./class-progression-evidence');
const {choicesFor,scheduledCount}=require('./semantic-eligibility');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const coordinate=x=>JSON.stringify([x.path,x.index]);
const scope=i=>i.kind==='feature'?(['classFeature','subclassFeature'].includes(i.payload?.sourceType)?i.payload.sourceType:'optionalFeature'):i.kind;
const rawFor=i=>i.payload?.mechanics?.[scope(i)==='optionalFeature'?'upstreamFeature':'upstreamClassRecord'];
const selectedKinds=new Set(['class','subclass','feature']);
const columnKinds={
 'Rages':'capacityLabelCandidate','Second Wind':'capacityLabelCandidate','Sorcery Points':'capacityLabelCandidate',
 'Ki Points':'capacityLabelCandidate','Focus Points':'capacityLabelCandidate',
 'Weapon Mastery':'selectionLabelCandidate','Infused Items':'concurrentLimitLabelCandidate',
 'Plans Known':'selectionLabelCandidate','Magic Items':'concurrentLimitLabelCandidate',
 'Spell Slots':'spellcastingColumn','Slot Level':'spellcastingColumn'
};
function cell(v){
 if(int(v))return {kind:'integer',value:v};
 if(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&int(Number(v)))return {kind:'integerText',value:Number(v)};
 if(v==='—'||v==='–'||v==='-')return {kind:'dashPending'};
 if(v==='Unlimited')return {kind:'unlimitedCandidate'};
 return {kind:'nonNumericPending'};
}
function tableColumns(raw){
 const out=[];
 for(const field of ['classTableGroups','subclassTableGroups']){
  if(raw[field]===undefined)continue;
  if(!Array.isArray(raw[field])){out.push({field,status:'tableShapePending'});continue;}
  for(const [tableIndex,t] of raw[field].entries()){
   if(!rec(t)||!Array.isArray(t.colLabels)||!t.colLabels.length){out.push({field,tableIndex,status:'tableShapePending'});continue;}
   if(own(t,'rowsSpellProgression')){out.push({field,tableIndex,status:'spellTableExcluded'});continue;}
   if(!Array.isArray(t.rows)||t.rows.length!==20||!t.rows.every(r=>Array.isArray(r)&&r.length===t.colLabels.length)){
    out.push({field,tableIndex,status:'tableShapePending'});continue;
   }
   for(const [columnIndex,label] of t.colLabels.entries()){
    const kind=typeof label==='string'&&own(columnKinds,label)?columnKinds[label]:'unclassifiedLabel';
    const values=t.rows.map(r=>cell(r[columnIndex]));
    const status=kind==='spellcastingColumn'?'spellColumnExcluded':
     values.every(v=>['integer','integerText'].includes(v.kind))?'completeNumericColumnCandidate':'mixedColumnPending';
    out.push({field,tableIndex,columnIndex,labelKind:kind,status,values,cellCounts:values.reduce((a,v)=>(bump(a,v.kind),a),{}),
     recovery:'notEstablished',resourceBinding:'notEstablished'});
   }
  }
 }
 return out;
}
function consumption(raw){
 if(!own(raw,'consumes'))return null;
 const c=raw.consumes;
 if(!rec(c)||!text(c.name)||Object.keys(c).some(k=>!['name','amount'].includes(k)))return {status:'consumptionShapePending'};
 if(!own(c,'amount'))return {status:'amountNotExplicit',resourceNameFingerprint:digest(c.name)};
 return {status:int(c.amount)&&c.amount>0?'explicitAmountCandidate':'amountPending',
  ...(int(c.amount)&&c.amount>0?{amount:c.amount}:{}),resourceNameFingerprint:digest(c.name)};
}
function scheduleRows(i){
 return choicesFor(i).filter(c=>['optionalfeatureProgression','featProgression','itemMasteriesProgression'].includes(c.kind)).map(c=>({
  kind:c.kind,path:c.path,status:c.status,rawFingerprint:digest(c.raw),
  ...(c.selector?{selector:c.selector}:{}),...(c.schedule?{schedule:c.schedule}:{}),
  semantics:'countOnlyNotGrantOrReplacement',...flags()
 }));
}
const fields=['resource','resources','consumes','grantsActions','effectTemplates','actionCost','actionTiming','choices','prerequisite','requiresConcentration','oncePerTurnKey','engineKey','mechanics'];
function buildFeatureResourceEvidence({reconciliation:r,rawHistorical,items}){
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&
 r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&
 Object.keys(r.summary.issues).length===0&&['application','main','homebrew'].every(k=>sha(r.commits[k])),'invalidReconciliation');
 const graph=ownerAndLevelGraph(items,r.commits.main),rows=[],byScope={},historical={class:{},subclass:{},feature:{}};
 for(const i of items.filter(i=>selectedKinds.has(i.kind))){
  const family=scope(i),raw=rawFor(i),s=byScope[family]??={items:0,columns:{},columnKinds:{},cells:{},consumption:{},choices:{},grants:{},recovery:{}};
  assert(rec(raw)&&raw.source===i.provenance.sourceCode&&raw.name===i.name,'featureResourceSourceMismatch');
  s.items++;
  const columns=tableColumns(raw),cost=consumption(raw),choices=scheduleRows(i);
  for(const c of columns){bump(s.columns,c.status);if(c.labelKind)bump(s.columnKinds,c.labelKind);for(const [k,n] of Object.entries(c.cellCounts||{}))bump(s.cells,k,n);}
  if(cost)bump(s.consumption,cost.status);
  for(const c of choices)bump(s.choices,c.kind+':'+c.status);
  const grants=(i.kind==='class'||i.kind==='subclass')?i.payload.mechanics.featureGrantReferences.map((g,index)=>({
   index,targetId:g.featureId,level:g.level,status:typeof g.raw==='string'?'directContextCandidate':'grantOptionsPending',
   annotationFingerprint:digest(g.raw),...flags()})):[];
  for(const g of grants)bump(s.grants,g.status);
  const recoveryFields=['recharge','rechargeAmount','recoveryRules'].filter(k=>own(raw,k));
  for(const k of recoveryFields)bump(s.recovery,k);
  rows.push({itemId:i.id,family,sourceFingerprint:digest(i),rulesEra:i.source.rulesEra,columns,cost,choices,grants,
   recoveryFields,recoveryStatus:'notEstablished',replacementStatus:'notEstablished',...flags()});
 }
 const raw=new Map();
 for(const x of rawHistorical){assert(!raw.has(coordinate(x)),'duplicateHistoricalCoordinate');raw.set(coordinate(x),x.item);}
 const seen=new Set(),historicalRows=[];
 for(const h of r.historical.filter(h=>selectedKinds.has(h.kind))){
  const a=raw.get(coordinate(h)),s=historical[h.kind];
  assert(a&&a.id===h.id&&a.kind===h.kind&&digest(a)===h.sourceFingerprint&&!seen.has(coordinate(h))&&
    h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed','historicalBindingMismatch');
  seen.add(coordinate(h));bump(s,'occurrences');
  if(h.status!=='identityCandidate'){bump(s,'identityPending');continue;}
  const t=graph.index.get(h.targetId);
  assert(t&&t.kind===h.kind&&digest(t)===h.targetFingerprint,'targetBindingMismatch');
  bump(s,'identityCandidates');if(h.eraStatus!=='sameKnownEra')bump(s,'eraPending');
  const comparison={};
  for(const k of fields){
   const x=a.payload?.[k],y=t.payload?.[k];
   const status=x===undefined?y===undefined?'absentBoth':'addedCandidate':y===undefined?'missingCandidate':digest(x)===digest(y)?'exactValue':'differentValue';
   comparison[k]=status;bump((s.fields??={})[k]??={},status);
  }
  historicalRows.push({evidenceId:h.evidenceId,kind:h.kind,sourceFingerprint:h.sourceFingerprint,targetFingerprint:h.targetFingerprint,
   comparison,...flags()});
 }
 assert(seen.size===rawHistorical.filter(x=>selectedKinds.has(x.item.kind)).length,'historicalCoverageMismatch');
 const body={schemaVersion:'dnd-upstream-feature-resource-evidence.v1',commits:r.commits,byScope,historical,rows,historicalRows,
  approvedMappings:0,mechanicalParityEstablished:0,executable:false,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,historicalRows,...summary}=r;return summary;}
// Exact schedule checkpoint only. Sparse schedules and context-wide
// schedules are not extrapolated. The difference is not a grant count.
function compareChoiceCheckpoints(row,before,after){
 if(row?.status!=='selectorAndSchedule'||row.schedule?.scope!=='level'||!Number.isInteger(before)||!Number.isInteger(after)||before<1||after>20||after<=before)
  return {...flags(),status:'indeterminate',reason:'explicitLevelCheckpointsRequired'};
 const a=scheduledCount(row.schedule,before),b=scheduledCount(row.schedule,after);
 if(a===undefined||b===undefined)return {...flags(),status:'indeterminate',reason:'checkpointNotPresent'};
 return {...flags(),status:'countDifferenceCandidate',before:a,after:b,difference:b-a,semantics:'notGrantOrReplacement'};
}
module.exports={tableColumns,consumption,scheduleRows,compareChoiceCheckpoints,buildFeatureResourceEvidence,publicSummary};
