'use strict';
// Private-use mechanical scope: byte/field evidence is never consumer parity.
const {digest}=require('./integrated-review');
const {KINDS}=require('./cutover-evidence');
const {comparePayload}=require('./historical-reconciliation');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length>0;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const family=k=>['classFeature','subclassFeature'].includes(k)?'feature':KINDS.includes(k)?k:'outsideV3';
const era=x=>x==='2014'?'2014':x==='2024'?'2024':x==='legacy'?'legacyLabel':'unknown';
const tally=(o,k,n=1)=>{o[k]=(o[k]||0)+n;};
const counts=()=>({occurrences:0,editions:{'2014':0,'2024':0,legacyLabel:0,unknown:0},dispositions:{},fields:{exact:0,different:0,legacyOnly:0,candidateOnly:0},mechanicsFields:{exact:0,different:0,legacyOnly:0,candidateOnly:0}});
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false});
const coordinate=(path,index)=>JSON.stringify([path,index]);
function compareFields(a,b){
 const rows=[];
 for(const field of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
  const left=own(a,field),right=own(b,field);
  rows.push({field,status:!left?'candidateOnly':!right?'legacyOnly':digest(a[field])===digest(b[field])?'exact':'different',
   before:left?digest(a[field]):null,after:right?digest(b[field]):null});
 }
 return rows;
}
function buildMechanicalScopeReview({reconciliation:r,rawHistorical,items,runtimeBundle}){
 assert(r?.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0,'mechanicalReconciliationInvalid');
 assert(Array.isArray(rawHistorical)&&Array.isArray(items)&&Array.isArray(runtimeBundle?.runtimeIndex?.entries),'mechanicalInputsInvalid');
 const targetMap=new Map(),historyMap=new Map(),runtimeMap=new Map(),seen=new Set(),rows=[];
 const byFamily=Object.fromEntries([...KINDS,'outsideV3'].map(k=>[k,{upstream:counts(),historical:counts(),runtime:counts()}]));
 for(const item of items){
  assert(text(item.id)&&!targetMap.has(item.id)&&KINDS.includes(item.kind)&&item.provenance?.origin==='5etools'&&item.provenance.commit===r.commits.main,'mechanicalTargetInvalid');
  targetMap.set(item.id,item);
  const c=byFamily[item.kind].upstream;c.occurrences++;c.editions[era(item.source?.rulesEra)]++;
  tally(c.dispositions,'candidateOnlyNotActivated');
 }
 for(const row of rawHistorical){
  const key=coordinate(row.path,row.index);assert(!historyMap.has(key),'mechanicalDuplicateHistoricalCoordinate');historyMap.set(key,row.item);
 }
 for(const item of runtimeBundle.runtimeIndex.entries){
  assert(text(item.entityId)&&!runtimeMap.has(item.entityId),'mechanicalDuplicateRuntimeCoordinate');runtimeMap.set(item.entityId,item);
 }
 for(const [domain,occurrences] of [['historical',r.historical],['runtime',r.runtime]]){
  for(const h of occurrences){
   assert(h.domain===domain&&text(h.evidenceId)&&!seen.has(h.evidenceId)&&h.decision==='unreviewed'&&h.preservation==='required'&&h.activation==='review-required'&&hex(h.sourceFingerprint),'mechanicalOccurrenceInvalid');
   seen.add(h.evidenceId);
   const raw=domain==='historical'?historyMap.get(coordinate(h.path,h.index)):runtimeMap.get(h.id);
   assert(raw&&digest(raw)===h.sourceFingerprint,'mechanicalSourceBindingMismatch');
   const kind=family(h.kind),oldEra=era(domain==='historical'?raw.source?.rulesEra:raw.rulesEra),c=byFamily[kind][domain];c.occurrences++;c.editions[oldEra]++;
   let disposition=kind==='outsideV3'?'preserveOutsideV3':'preserveIdentityPending',fieldRows=[],mechanicsRows=[],targetEra='unknown';
   if(h.status==='identityCandidate'){
    const t=targetMap.get(h.targetId);
    assert(kind!=='outsideV3'&&t?.kind===kind&&digest(t)===h.targetFingerprint,'mechanicalTargetBindingMismatch');
    targetEra=era(t.source?.rulesEra);
    const bothKnown=['2014','2024'].includes(oldEra)&&['2014','2024'].includes(targetEra);
    const exactEra=bothKnown&&oldEra===targetEra&&h.eraStatus==='sameKnownEra';
    if(domain==='historical'){
     assert(digest(comparePayload(raw.payload,t.payload))===digest(h.comparison),'mechanicalPayloadComparisonMismatch');
     if(rec(raw.payload)&&rec(t.payload)){
      fieldRows=compareFields(raw.payload,t.payload);
      mechanicsRows=compareFields(rec(raw.payload.mechanics)?raw.payload.mechanics:{},rec(t.payload.mechanics)?t.payload.mechanics:{});
     }
    }
    disposition=bothKnown&&oldEra!==targetEra?'preserveEditionConflict':!exactEra?'preserveEditionUnverified':
     domain==='runtime'||!rec(raw.payload)||!rec(t.payload)?'preserveRuntimeOrPayloadUnavailable':
     fieldRows.every(f=>f.status==='exact')?'preserveExactPayloadPendingConsumer':'preservePayloadDifferences';
   }else if(h.status==='eraMismatch')disposition='preserveEditionConflict';
   tally(c.dispositions,disposition);
   for(const f of fieldRows)c.fields[f.status]++;
   for(const f of mechanicsRows)c.mechanicsFields[f.status]++;
   rows.push({domain,evidenceFingerprint:digest(h.evidenceId),kind,oldEra,targetEra,disposition,sourceFingerprint:h.sourceFingerprint,targetFingerprint:h.targetFingerprint??null,fieldsFingerprint:digest(fieldRows),mechanicsFingerprint:digest(mechanicsRows)});
  }
 }
 assert(r.summary.historicalOccurrences===r.historical.length&&r.summary.runtime===r.runtime.length&&runtimeMap.size===r.runtime.length,'mechanicalDenominatorMismatch');
 const body={schemaVersion:'dnd-upstream-mechanical-scope-review.v1',scope:'privateLocalReview',commits:r.commits,bindings:{reconciliation:digest(r),targets:digest(items),rawHistorical:digest(rawHistorical),runtime:digest(runtimeBundle.runtimeIndex.entries)},
  totals:{upstream:items.length,historical:r.historical.length,runtime:r.runtime.length,unjoinedHistoricalCoordinates:rawHistorical.length-r.historical.length},
  byFamily,occurrenceFingerprint:digest(rows),policy:{edition2014:'separate',edition2024:'separate',legacyLabel:'unverified',unknown:'preserve',crossEditionReplacement:'notAuthorized',legacyAndRuntimeOnly:'preserve',homebrew:'separateReview'},
  mechanicalParityEstablished:0,approvedMappings:0,readiness:'blocked',...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildMechanicalScopeReview};
