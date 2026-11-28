'use strict';
// Aggregate preservation accounting, not a proof of consumer parity or migration approval.
const {digest}=require('./integrated-review');
const {KINDS}=require('./cutover-evidence');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const keys=(o,expected)=>o&&Object.keys(o).sort().join('|')===[...expected].sort().join('|');
const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
const clean=o=>o&&Object.values(o).every(count);
const eras=['2014','2024','legacyLabel','unknown'];
const fieldStates=['exact','different','legacyOnly','candidateOnly'];
const dispositions=['preserveOutsideV3','preserveIdentityPending','preserveEditionConflict','preserveEditionUnverified','preserveRuntimeOrPayloadUnavailable','preserveExactPayloadPendingConsumer','preservePayloadDifferences'];
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false};
// This is a declared scope of regression fixtures. It is not a per-occurrence test result.
const consumerScope=()=>[
 {domain:'spell',fixture:'upstream5etoolsSpellParityEvidence.test.ts',tested:'synthetic direct damage cantrip mapper/action/damage/range and no slot cost',notEstablished:'leveled spells, scaling, concentration, other effects and real records'},
 {domain:'creatureStatBlock',fixture:'upstream5etoolsCreatureCombatProjection.test.ts',tested:'synthetic isolated attack dice bounds against production calculator',notEstablished:'full tactical attack, targeting, defenses and real records'},
 {domain:'resourceAndSlotPools',fixture:'upstream5etoolsConsumerRegression.test.ts',tested:'explicit standard/pact spending, atomic rejection and rest; manual resource preservation',notEstablished:'candidate-to-runtime grant linkage, all lifecycle paths and real records'}
];
function buildMechanicalPreservationReview(fragment){
 const scope=fragment?.mechanicalScope;
 assert(scope?.schemaVersion==='dnd-upstream-mechanical-scope-review.v1'&&scope.scope==='privateLocalReview'&&scope.readiness==='blocked'&&scope.mechanicalParityEstablished===0&&scope.approvedMappings===0&&Object.entries(flags).every(([k,v])=>scope[k]===v),'invalidMechanicalScope');
 const {fingerprint,...body}=scope;
 assert(digest(body)===fingerprint&&fragment.bindings?.mechanicalScope===fingerprint&&digest(fragment.commits)===digest(scope.commits)&&fragment.reconciliationFingerprint===scope.bindings?.reconciliation,'mechanicalPreservationBindingMismatch');
 assert(keys(scope.byFamily,[...KINDS,'outsideV3'])&&keys(fragment.rows,KINDS)&&count(scope.totals.unjoinedHistoricalCoordinates),'mechanicalPreservationFamilyMismatch');
 const totals={upstream:0,historical:0,runtime:0,legacyPreservationRequired:0,unjoinedHistoricalCoordinates:scope.totals.unjoinedHistoricalCoordinates};
 const byFamily={};
 for(const kind of [...KINDS,'outsideV3']){
  const s=scope.byFamily[kind],outside=kind==='outsideV3',f=outside?fragment.outside:fragment.rows[kind];
  assert(keys(s,['upstream','historical','runtime']),'mechanicalPreservationDomainMismatch');
  const row={};
  for(const domain of ['upstream','historical','runtime']){
   const c=s[domain],expected=outside&&domain==='upstream'?0:f[domain];
   assert(count(expected)&&c.occurrences===expected&&keys(c.editions,eras)&&clean(c.editions)&&sum(c.editions)===expected&&clean(c.dispositions)&&sum(c.dispositions)===expected&&keys(c.fields,fieldStates)&&clean(c.fields)&&keys(c.mechanicsFields,fieldStates)&&clean(c.mechanicsFields),'mechanicalPreservationAccountingMismatch');
   const allowed=domain==='upstream'?['candidateOnlyNotActivated']:outside?['preserveOutsideV3']:dispositions.filter(x=>x!=='preserveOutsideV3');
   assert(Object.keys(c.dispositions).every(k=>allowed.includes(k)),'mechanicalPreservationDispositionMismatch');
   totals[domain]+=expected;
   if(domain!=='upstream')totals.legacyPreservationRequired+=expected;
   row[domain]={occurrences:expected,editions:c.editions,dispositions:c.dispositions,fields:c.fields,mechanicsFields:c.mechanicsFields};
  }
  byFamily[kind]=row;
 }
 for(const d of ['upstream','historical','runtime'])assert(totals[d]===scope.totals[d]&&totals[d]===fragment.totals[d],'mechanicalPreservationTotalMismatch');
 const report={schemaVersion:'dnd-upstream-mechanical-preservation-review.v1',commits:fragment.commits,bindings:{mechanicalScope:fingerprint,reconciliation:fragment.reconciliationFingerprint},totals,byFamily,consumerRegressionScope:consumerScope(),consumerEvidenceStatus:'declaredSyntheticScopeNotOccurrenceParity',unjoinedHistoricalDisposition:'preservePendingReview',readiness:'blocked',approvedMappings:0,mechanicalParityEstablished:0,...flags};
 return {...report,fingerprint:digest(report)};
}
module.exports={buildMechanicalPreservationReview};
