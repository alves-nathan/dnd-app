'use strict';
// a8.11.2: exact full-bundle preservation, not a runtime update gate.
const {digest}=require('./integrated-review');
const {buildRuntimeContractEvidence}=require('./runtime-contract-evidence');
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function compareRuntimeContractPreservation(input,evidence,current,after){
 const actual=buildRuntimeContractEvidence(input);
 if(digest(evidence)!==digest(actual))throw Error('runtimePreservationEvidenceMismatch');
 const baseline=input.runtimeBundle,codes=[],changedSections=[];
 if(!rec(current)||!rec(after))return {...flags(),status:'preservationBlocked',codes:['invalidRuntimeSnapshot'],changedSections};
 if(digest(current)!==actual.bundleFingerprint)codes.push('baseSnapshotMismatch');
 // Compare every top-level section, including unknown future fields and array
 // occurrence ordering. No projection of aliases or member lists into maps.
 for(const k of new Set([...Object.keys(baseline),...Object.keys(after)])){
  if(own(baseline,k)!==own(after,k)||digest({value:baseline[k]})!==digest({value:after[k]}))changedSections.push(k);
 }
 if(changedSections.length)codes.push('runtimeContractChanged');
 const body={schemaVersion:'dnd-upstream-runtime-contract-preservation.v1',commits:actual.commits,evidenceFingerprint:actual.fingerprint,
  baselineFingerprint:actual.bundleFingerprint,currentFingerprint:digest(current),afterFingerprint:digest(after),
  status:codes.length?'preservationBlocked':'runtimeContractPreservationCandidate',codes,changedSections:changedSections.sort(),
  preservedCounts:{entries:actual.summary.entries,registry:actual.summary.registry,dependencies:actual.summary.dependencies.total,
   aliases:actual.summary.aliases.total,categories:actual.summary.categories.total,policies:actual.summary.policies},
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={compareRuntimeContractPreservation};
