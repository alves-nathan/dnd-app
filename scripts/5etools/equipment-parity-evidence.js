'use strict';
// a8.5.1 — scoped field evidence; never an approval or runtime projection.
const {digest}=require('./integrated-review');
const fields=Object.freeze({
  weapon:['weaponCategory','weaponType','actionCost','attackAbility','damageAbility','damageFormula','damageDie','damageType','properties','mastery','range','versatileDamageFormula','magicBonus','attacksCount','ammunitionType','consumes','cost','weight'],
  armor:['armorCategory','baseAC','dexCap','acBonus','stacksWithArmor','strengthRequirement','stealthDisadvantage','cost','weight']
});
const required={weapon:new Set(['weaponType','damageFormula','damageType','attackAbility','damageAbility']),armor:new Set(['armorCategory','baseAC','stacksWithArmor'])};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
const validNumber=x=>typeof x==='number'&&Number.isFinite(x);
function normalize(field,value){
  // Only explicitly safe representational transforms, never infer omitted
  // defaults, convert edition, parse arbitrary expressions or resolve aliases.
  if(field==='properties'&&Array.isArray(value)&&value.every(v=>typeof v==='string'&&v.trim())){
    const values=value.map(v=>v.trim().toLowerCase());
    if(new Set(values).size!==values.length)return undefined;
    return [...values].sort();
  }
  if(field==='cost'&&rec(value)&&Object.keys(value).length===2&&validNumber(value.amount)&&value.amount>=0&&own({CP:1,SP:10,GP:100,PP:1000,EP:50},value.unit)){
    const cp=value.amount*({CP:1,SP:10,GP:100,PP:1000,EP:50}[value.unit]);
    if(Number.isSafeInteger(cp))return cp;
  }
  return undefined;
}
function compareFields(kind,old,next){
  requireThat(own(fields,kind)&&rec(old)&&rec(next),'invalidFieldComparison');
  return fields[kind].map(field=>{
    const a=own(old,field)&&old[field]!==undefined,b=own(next,field)&&next[field]!==undefined;
    let status;
    if(!a&&!b)status=required[kind].has(field)?'requiredAbsentBoth':'absentBoth';
    else if(!a)status='addedCandidate';
    else if(!b)status='missingCandidate';
    else if(digest(old[field])===digest(next[field]))status='exactValue';
    else {
      const x=normalize(field,old[field]),y=normalize(field,next[field]);
      status=x!==undefined&&y!==undefined&&digest(x)===digest(y)?'representationOnlyCandidate':'differentValue';
    }
    return {field,status};
  });
}
function buildEquipmentParityEvidence({reconciliation,rawHistorical,items}){
  requireThat(reconciliation.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&reconciliation.activation==='review-required'&&
    reconciliation.summary.approvedMappings===0&&reconciliation.summary.mechanicalParityEstablished===0&&
    reconciliation.summary.retirementAuthorized===false&&Object.keys(reconciliation.summary.issues).length===0,'invalidReconciliation');
  const commits=reconciliation.commits;
  requireThat(['application','main','homebrew'].every(k=>sha(commits[k])),'invalidCommits');
  const raw=new Map(),targets=new Map();
  for(const r of rawHistorical){const key=JSON.stringify([r.path,r.index]);requireThat(!raw.has(key),'duplicateHistoricalCoordinate');raw.set(key,r.item);}
  for(const i of items){requireThat(!targets.has(i.id),'duplicateTarget');targets.set(i.id,i);}
  const seen=new Set(),rows=[],byKind=Object.fromEntries(Object.keys(fields).map(k=>[k,{occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,byStatus:{},byField:{},unassessedFields:0}]));
  for(const h of reconciliation.historical.filter(h=>own(fields,h.kind))){
    const key=JSON.stringify([h.path,h.index]),old=raw.get(key),summary=byKind[h.kind];
    requireThat(!seen.has(key)&&old&&old.id===h.id&&old.kind===h.kind&&digest(old)===h.sourceFingerprint&&
      h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed','historicalBindingMismatch');
    seen.add(key);summary.occurrences++;
    const row={kind:h.kind,evidenceId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,
      mechanicalParity:'notEstablished',writeAuthorized:false,retirementAuthorized:false,fields:[]};
    if(h.status!=='identityCandidate'){summary.identityPending++;bump(summary.byStatus,h.status);rows.push(row);continue;}
    const target=targets.get(h.targetId);
    requireThat(target&&target.kind===h.kind&&target.provenance?.origin==='5etools'&&target.provenance.commit===commits.main&&
      target.source?.status==='needsReview'&&digest(target)===h.targetFingerprint,'targetBindingMismatch');
    summary.identityCandidates++;
    if(h.eraStatus!=='sameKnownEra')summary.eraPending++;
    row.targetFingerprint=h.targetFingerprint;row.eraStatus=h.eraStatus;
    if(!rec(old.payload)||!rec(target.payload)){bump(summary.byStatus,'payloadNotAvailable');rows.push(row);continue;}
    row.fields=compareFields(h.kind,old.payload,target.payload);
    row.unassessedFieldCount=new Set([...Object.keys(old.payload),...Object.keys(target.payload)].filter(k=>!fields[h.kind].includes(k))).size;
    summary.unassessedFields+=row.unassessedFieldCount;
    for(const f of row.fields)bump(summary.byField[f.field]??={},f.status);
    bump(summary.byStatus,row.fields.some(f=>['differentValue','missingCandidate','addedCandidate','requiredAbsentBoth'].includes(f.status))?'fieldReviewRequired':'selectedFieldsCompatibleCandidate');
    rows.push(row);
  }
  const body={schemaVersion:'dnd-upstream-equipment-parity-evidence.v1',commits,rows,byKind,
    scope:'historical occurrences; selected equipment fields only; raw payload comparison, not runtime parity',
    mechanicalParityEstablished:0,approvedMappings:0,activation:'review-required',executable:false,retirementAuthorized:false};
  return {...body,fingerprint:digest(body)};
}
function publicSummary(report){
  const {rows,...aggregate}=report;
  return aggregate;
}
module.exports={compareFields,buildEquipmentParityEvidence,publicSummary};
