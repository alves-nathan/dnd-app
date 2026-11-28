'use strict';
// a8.9.3: isolated ability and instance previews; never modify a character.
const {digest}=require('./integrated-review');
const {abilityPlan,simpleAbility}=require('./feature-converter');
const {evaluateAllocation}=require('./semantic-eligibility');
const {buildFeatRequirementProjection}=require('./feat-requirement-projection');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const era=x=>x==='2014'||x==='2024';
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const abilities=['STR','DEX','CON','INT','WIS','CHA'];
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const outcome=(status,reason,extra={})=>({status,reason,...extra,...flags()});
function sameOptional(a,b){return a===undefined||b===undefined?a===b:digest(a)===digest(b);}
function allocationRows(raw,plan){
 if(plan===undefined)return [];
 return plan.alternatives.map((a,index)=>{
  const group=Array.isArray(raw)?raw[index]:undefined;
  // Do not infer hidden options, weighted selectors or overlap between fixed and chosen increases.
  const valid=rec(group)&&(!own(group,'hidden')||group.hidden===false)&&a.kind==='allocation'&&a.hidden===false&&
   int(a.max,1,30)&&Array.isArray(a.fixed)&&a.fixed.every(f=>abilities.includes(f.ability)&&int(f.amount,1,30))&&
   new Set(a.fixed.map(f=>f.ability)).size===a.fixed.length&&
   (a.choice===undefined?a.fixed.length>0:rec(a.choice)&&a.choice.distinct===true&&Array.isArray(a.choice.abilities)&&
    a.choice.abilities.length>0&&a.choice.abilities.every(x=>abilities.includes(x)&&!a.fixed.some(f=>f.ability===x))&&
    new Set(a.choice.abilities).size===a.choice.abilities.length&&int(a.choice.count,1,a.choice.abilities.length)&&int(a.choice.amount,1,30));
  return {index,status:valid?'allocationCandidate':'allocationPending',sourceFingerprint:digest(a),...(valid?{allocation:a}:{}),...flags()};
 });
}
function repeatabilityFor(raw,p){
 if(!sameOptional(typeof raw.repeatable==='boolean'?raw.repeatable:undefined,p.repeatable))throw Error('featRepeatabilityBindingMismatch');
 if(own(raw,'repeatableNote')||own(raw,'repeatableHidden')||own(p.mechanics,'repeatableRequiresDifferentSpellList')||own(p.mechanics,'repeatableRequiresDifferentDamageType'))return 'conditionalPending';
 if(!own(raw,'repeatable'))return 'notDeclared';
 return typeof raw.repeatable!=='boolean'?'shapePending':raw.repeatable?'explicitTrueCandidate':'explicitFalseCandidate';
}
function buildFeatAllocationProjection(input,requirements){
 const actual=buildFeatRequirementProjection(input);
 if(requirements!==undefined&&digest(requirements)!==digest(actual))throw Error('featRequirementEvidenceMismatch');
 const byId=new Map(input.items.map(i=>[i.id,i])),rows=[];
 const summary={items:0,ability:{},alternatives:{},repeatability:{},legacyAsiFallbacks:0};
 for(const q of actual.rows){
  const i=byId.get(q.featId),p=i.payload,m=p.mechanics,raw=m.upstreamFeature,plan=abilityPlan(raw.ability);
  if(!sameOptional(plan,m.abilityAllocationPlan)||!sameOptional(simpleAbility(plan),p.abilityScoreIncrease))throw Error('featAllocationBindingMismatch');
  const alternatives=allocationRows(raw.ability,plan),legacyAsiFallback=i.name.trim().toLowerCase()==='ability score improvement'||Array.isArray(m.abilityScoreOptions);
  const abilityStatus=plan===undefined?legacyAsiFallback?'legacyFallbackPending':'notDeclared':
   alternatives.some(a=>a.status==='allocationCandidate')?'allocationCandidates':'allocationPending';
  const repeatability=repeatabilityFor(raw,p);
  summary.items++;bump(summary.ability,abilityStatus);bump(summary.repeatability,repeatability);
  if(legacyAsiFallback)summary.legacyAsiFallbacks++;
  for(const a of alternatives)bump(summary.alternatives,a.status);
  rows.push({featId:q.featId,sourceFingerprint:q.sourceFingerprint,rulesEra:q.rulesEra,abilityStatus,alternatives,legacyAsiFallback,repeatability,...flags()});
 }
 const body={schemaVersion:'dnd-upstream-feat-allocation-projection.v1',commits:actual.commits,evidenceFingerprint:actual.evidenceFingerprint,
  requirementFingerprint:actual.fingerprint,summary,rows,scope:'explicit ability alternatives and physical feat instance boundaries; no character or acquisition approval',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function bound(input,request){
 if(!rec(request)||!era(request.rulesEra)||!id(request.featId)||!id(request.projectionFingerprint)||!id(request.sourceFingerprint))
  return {error:'explicitContextRequired'};
 const p=buildFeatAllocationProjection(input);
 if(p.fingerprint!==request.projectionFingerprint)return {error:'staleProjection'};
 const row=p.rows.find(r=>r.featId===request.featId);
 if(!row||row.sourceFingerprint!==request.sourceFingerprint||row.rulesEra!==request.rulesEra)return {error:'featIdentityOrEditionMismatch'};
 return {row,p};
}
function previewFeatAllocation(input,request){
 const b=bound(input,request);
 if(b.error)return outcome('indeterminate',b.error);
 const {row}=b;
 if(request.scoreContextConfirmed!==true||request.allocationPolicyConfirmed!==true||!rec(request.scores)||
  Object.keys(request.scores).length!==abilities.length||!abilities.every(a=>own(request.scores,a)&&int(request.scores[a],1,30))||
  !Array.isArray(request.selected)||!request.selected.every(a=>abilities.includes(a)))return outcome('indeterminate','explicitAllocationContextRequired');
 if(row.abilityStatus==='notDeclared')return request.alternativeIndex===undefined&&request.selected.length===0?
  outcome('noDeclaredAllocation','absenceIsNotEffectApproval'):outcome('notSatisfied','noDeclaredAlternative');
 if(!int(request.alternativeIndex,0,row.alternatives.length-1))return outcome('indeterminate','explicitAlternativeRequired');
 const a=row.alternatives[request.alternativeIndex];
 if(a.status!=='allocationCandidate')return outcome('indeterminate','allocationSemanticsPending');
 const result=evaluateAllocation(a.allocation,request.selected,request.scores);
 if(result!=='satisfied')return outcome(result,'allocationOrMaximum');
 const increases={};
 for(const f of a.allocation.fixed)increases[f.ability]=f.amount;
 for(const s of request.selected)increases[s]=a.allocation.choice.amount;
 const after={...request.scores};
 for(const [k,n] of Object.entries(increases))after[k]+=n;
 return outcome('allocationCandidate','isolatedAbilityDeltaOnly',{alternativeIndex:a.index,increases,after,maximum:a.allocation.max});
}
function previewFeatInstance(input,request){
 const b=bound(input,request);
 if(b.error)return outcome('indeterminate',b.error);
 const {row,p}=b;
 if(request.inventoryCompleteConfirmed!==true||request.physicalIdentityScopeConfirmed!==true||request.retainedHistoryCollisionExcludedConfirmed!==true||
  !Array.isArray(request.instances)||!id(request.newInstanceId)||!int(request.newInstanceIndex,0,Number.MAX_SAFE_INTEGER))
  return outcome('indeterminate','explicitInstanceContextRequired');
 const index=new Map(p.rows.map(r=>[r.featId,r])),ids=new Set(),slots=new Set();
 for(const x of request.instances){
  const r=rec(x)?index.get(x.featId):undefined;
  if(!r||r.rulesEra!==request.rulesEra||r.sourceFingerprint!==x.sourceFingerprint||!id(x.instanceId)||
   !int(x.instanceIndex,0,Number.MAX_SAFE_INTEGER)||ids.has(x.instanceId))return outcome('indeterminate','unqualifiedOrDuplicateInstance');
  const k=JSON.stringify([x.featId,x.instanceIndex]);
  if(slots.has(k))return outcome('indeterminate','duplicateInstanceSlot');
  ids.add(x.instanceId);slots.add(k);
 }
 if(ids.has(request.newInstanceId)||slots.has(JSON.stringify([row.featId,request.newInstanceIndex])))return outcome('notSatisfied','instanceAlreadyExists');
 const previous=request.instances.filter(x=>x.featId===row.featId);
 // Existing indices may have gaps after removal. Never renumber or reuse a lower index.
 const maxIndex=previous.reduce((max,x)=>Math.max(max,x.instanceIndex),-1);
 if(maxIndex===Number.MAX_SAFE_INTEGER||request.newInstanceIndex!==maxIndex+1)return outcome('notSatisfied','nextInstanceIndexRequired');
 if(previous.length&&row.repeatability==='explicitFalseCandidate')return outcome('notSatisfied','explicitNonRepeatable');
 if(previous.length&&(row.repeatability!=='explicitTrueCandidate'||request.repeatabilityConditionsExcludedConfirmed!==true))
  return outcome('indeterminate','repeatabilityPolicyPending');
 return outcome('instanceCandidate','physicalInstanceBoundaryOnly',{priorCount:previous.length,newInstanceIndex:request.newInstanceIndex});
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
module.exports={buildFeatAllocationProjection,previewFeatAllocation,previewFeatInstance,publicSummary};
