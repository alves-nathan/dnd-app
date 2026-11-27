'use strict';
// a8.9.1: occurrence-level feat evidence, never an eligibility or grant decision.
const {digest}=require('./integrated-review');
const {physicalId}=require('./feature-converter');
const {buildIndex,matchIdentity}=require('./historical-reconciliation');
const {choicesFor}=require('./semantic-eligibility');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const text=x=>typeof x==='string'&&!!x.trim();
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const coord=x=>JSON.stringify([x.path,x.index]);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const fields=['category','prerequisite','repeatable','abilityScoreIncrease','effects','grants','resources','resource','grantsActions','effectTemplates','actionCost','actionTiming','engineKey','choices','spellIds','featureIds','proficiencies','skillProficiencies','toolProficiencies','languageProficiencies','weaponProficiencies','armorProficiencies'];
const mechanicsFields=['prerequisiteTree','abilityAllocationPlan','abilityScoreOptions','proficiencyChoice','toolProficiencyChoice','skillProficiencyChoice','skillUpgradeChoice','expertiseChoice','languageProficiencyChoice','languageChoice','languageChoices','spellListChoice','spellChoices','spellChoice','allowCombinedSpellLists','spellcastingAbility','spellcastingAbilityChoice','invocationSpellcastingAbilityChoice','cantripChoices','level1SpellChoices','level1SpellChoice','alwaysPrepared','ritualSpellsPrepared','damageTypeChoice','energyResistanceChoice','masteryPropertyChoice','fightingStyleChoice','invocationChoice','metamagicChoice','maneuverChoice','uses','resources','resource','consumes','grantsActions','effectTemplates'];
const rawFields=['additionalSpells','optionalfeatureProgression','featProgression','feats','skillProficiencies','toolProficiencies','languageProficiencies','weaponProficiencies','armorProficiencies','expertise','savingThrowProficiencies','skillToolLanguageProficiencies','resist','immune','vulnerable','conditionImmune','itemMasteriesProgression','consumes','uses'];
function compareFeatFields(a,b){
 const compare=(x,y,keys,prefix)=>keys.map(k=>{
  const left=own(x,k),right=own(y,k);
  return {field:prefix+k,status:!left&&!right?'absentBoth':!left?'addedCandidate':!right?'missingCandidate':digest(x[k])===digest(y[k])?'exactValue':'differentValue'};
 });
 return [...compare(a,b,fields,'/payload/'),...compare(rec(a.mechanics)?a.mechanics:{},rec(b.mechanics)?b.mechanics:{},mechanicsFields,'/payload/mechanics/')];
}
function bindFeat(i,commit){
 const raw=i.payload?.mechanics?.upstreamFeature,p=i.provenance;
 assert(i.kind==='feat'&&rec(raw)&&text(raw.name)&&text(raw.source)&&raw.name===i.name&&p?.sourceCode===raw.source&&
  p.origin==='5etools'&&p.commit===commit&&i.id===physicalId('feat',raw.source,raw.name)&&
  i.source?.id==='upstream:main:'+raw.source&&['2014','2024','unknown'].includes(i.source.rulesEra),'featSourceMismatch');
 return raw;
}
function featContractEvidence(i,commit){
 const raw=bindFeat(i,commit),p=i.payload,m=p.mechanics,codes=new Set(['featApplicationNotEstablished','effectSemanticsNotEstablished','selectionAndRemovalPreservationPending']);
 const add=x=>codes.add(x);
 if(i.source.rulesEra==='unknown')add('editionPending');
 const category=raw.category===undefined?'notDeclared':typeof p.category==='string'?'mappedCategoryCandidate':'categoryPending';
 if(category!=='mappedCategoryCandidate')add('categoryPolicyPending');
 const repeatability=own(raw,'repeatableNote')||own(raw,'repeatableHidden')?'conditionalPending':
  !own(raw,'repeatable')?'notDeclared':typeof raw.repeatable!=='boolean'||p.repeatable!==raw.repeatable?'shapePending':raw.repeatable?'explicitTrueCandidate':'explicitFalseCandidate';
 add('repeatabilityAndInstancePolicyPending');
 const prerequisite=!own(raw,'prerequisite')?'notDeclared':!rec(m.prerequisiteTree)?'expressionPending':
  rec(p.prerequisite)?'flatShapeCandidate':'compoundOrReferencePending';
 if(prerequisite!=='notDeclared')add('prerequisiteEvaluationPending');
 const allocations=choicesFor(i).filter(x=>x.kind==='abilityAllocation').map(x=>x.status);
 const asi=!own(raw,'ability')?'notDeclared':!allocations.length?'allocationPending':
  allocations.some(x=>x!=='allocationEvaluable')?'allocationPending':
  Array.isArray(p.abilityScoreIncrease)&&p.abilityScoreIncrease.length===1?'simpleShapeCandidate':'complexAllocationCandidate';
 if(asi!=='notDeclared')add('abilityAllocationApplicationPending');
 // The existing reader recognizes ASI by name and reads only the first simple increase.
 // This is a runtime observation, never a grant or a qualified ASI definition.
 if(i.name.trim().toLowerCase()==='ability score improvement'||Array.isArray(m.abilityScoreOptions))add('legacyAsiNameOrOptionsFallbackReview');
 const declarations=rawFields.filter(k=>own(raw,k)).map(field=>({field,status:'semanticsPending',fingerprint:digest(raw[field])}));
 for(const d of declarations)add('declared:'+d.field);
 const selections=choicesFor(i).filter(x=>x.kind!=='abilityAllocation').map(x=>({kind:x.kind,status:x.status}));
 if(declarations.length||selections.length)add('choiceOrGrantProjectionPending');
 return {category,repeatability,prerequisite,asi,allocations,declarations,selections,codes:[...codes].sort()};
}
function buildFeatParityEvidence({reconciliation:r,rawHistorical,items}){
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&
  r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0&&
  ['application','main','homebrew'].every(k=>sha(r.commits[k])),'invalidReconciliation');
 const raw=new Map(),targets=new Map(),seen=new Set(),runtimeSeen=new Set(),evidenceIds=new Set(),rows=[],upstreamRows=[],runtimeRows=[];
 for(const x of rawHistorical){assert(!raw.has(coord(x)),'duplicateHistoricalCoordinate');raw.set(coord(x),x.item);}
 for(const i of items){assert(text(i.id)&&!targets.has(i.id),'duplicateTarget');targets.set(i.id,i);}
 const index=buildIndex(items,[]);
 const upstream={items:0,bySource:{},byEra:{},category:{},repeatability:{},prerequisite:{},asi:{},allocations:{},declarations:{},selections:{},contractCodes:{}};
 for(const i of items.filter(x=>x.kind==='feat')){
  const c=featContractEvidence(i,r.commits.main);
  upstream.items++;bump(upstream.bySource,i.provenance.sourceCode);bump(upstream.byEra,i.source.rulesEra);
  for(const k of ['category','repeatability','prerequisite','asi'])bump(upstream[k],c[k]);
  for(const x of c.allocations)bump(upstream.allocations,x);
  for(const d of c.declarations)bump(upstream.declarations,d.field);
  for(const s of c.selections)bump(upstream.selections,s.kind+':'+s.status);
  for(const k of c.codes)bump(upstream.contractCodes,k);
  upstreamRows.push({itemId:i.id,sourceFingerprint:digest(i),sourceCode:i.provenance.sourceCode,rulesEra:i.source.rulesEra,...c,...flags()});
 }
 const historical={occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,byIdentityStatus:{},byField:{},byStatus:{},unassessedFields:0};
 const runtime={occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,byStatus:{}};
 function preserve(h,domain){
  assert(h.domain===domain&&text(h.evidenceId)&&!evidenceIds.has(h.evidenceId)&&h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed','preservationBindingMismatch');
  evidenceIds.add(h.evidenceId);
 }
 for(const h of r.historical.filter(x=>x.kind==='feat')){
  preserve(h,'historical');
  const a=raw.get(coord(h));
  assert(a&&a.id===h.id&&a.kind==='feat'&&a.source?.id===h.sourceId&&digest(a)===h.sourceFingerprint&&!seen.has(coord(h)),'historicalBindingMismatch');
  seen.add(coord(h));historical.occurrences++;bump(historical.byIdentityStatus,h.status);
  const row={evidenceId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,fields:[],preservation:'required',...flags()};
  if(h.status!=='identityCandidate'){historical.identityPending++;rows.push(row);continue;}
  const t=targets.get(h.targetId),candidate=matchIdentity({kind:'feat',name:a.name,sourceId:a.source.id,rulesEra:a.source.rulesEra,payload:a.payload},index);
  assert(t?.kind==='feat'&&digest(t)===h.targetFingerprint&&candidate.status==='identityCandidate'&&candidate.targetId===h.targetId&&candidate.eraStatus===h.eraStatus,'targetBindingMismatch');
  historical.identityCandidates++;if(h.eraStatus!=='sameKnownEra')historical.eraPending++;
  row.targetId=t.id;row.targetFingerprint=h.targetFingerprint;row.eraStatus=h.eraStatus;
  if(!rec(a.payload)||!rec(t.payload)){bump(historical.byStatus,'payloadNotAvailable');rows.push(row);continue;}
  row.fields=compareFeatFields(a.payload,t.payload);
  const unassessed=(x,y,known)=>new Set([...Object.keys(x),...Object.keys(y)].filter(k=>!known.includes(k))).size;
  row.unassessedFieldCount=unassessed(a.payload,t.payload,[...fields,'mechanics'])+
   unassessed(rec(a.payload.mechanics)?a.payload.mechanics:{},rec(t.payload.mechanics)?t.payload.mechanics:{},mechanicsFields);
  historical.unassessedFields+=row.unassessedFieldCount;
  for(const f of row.fields)bump(historical.byField[f.field]??={},f.status);
  bump(historical.byStatus,row.fields.some(f=>['differentValue','missingCandidate','addedCandidate'].includes(f.status))?'fieldReviewRequired':'selectedFieldsCompatibleCandidate');
  rows.push(row);
 }
 assert(seen.size===rawHistorical.filter(x=>x.item.kind==='feat').length,'historicalCoverageMismatch');
 for(const h of r.runtime.filter(x=>x.kind==='feat')){
  preserve(h,'runtime');assert(text(h.id)&&!runtimeSeen.has(h.id),'duplicateRuntimeFeat');runtimeSeen.add(h.id);
  runtime.occurrences++;bump(runtime.byStatus,h.status);
  const row={evidenceId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,preservation:'required',...flags()};
  if(h.status==='identityCandidate'){
   const t=targets.get(h.targetId);
   assert(t?.kind==='feat'&&digest(t)===h.targetFingerprint,'runtimeTargetBindingMismatch');
   runtime.identityCandidates++;if(h.eraStatus!=='sameKnownEra')runtime.eraPending++;
   Object.assign(row,{targetId:t.id,targetFingerprint:h.targetFingerprint,eraStatus:h.eraStatus});
  }else runtime.identityPending++;
  runtimeRows.push(row);
 }
 const body={schemaVersion:'dnd-upstream-feat-parity-evidence.v1',commits:r.commits,historical,upstream,runtime,rows,upstreamRows,runtimeRows,
  scope:'selected feat payload and runtime contract observations; no eligibility, effect, grant, migration or retirement approval',
  approvedMappings:0,mechanicalParityEstablished:0,executable:false,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,upstreamRows,runtimeRows,...summary}=r;return summary;}
module.exports={compareFeatFields,featContractEvidence,buildFeatParityEvidence,publicSummary};
