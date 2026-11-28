'use strict';
// Offline review only. The injected reference adapter is the app's pure
// localInventoryReferenceReview implementation; this is not attestation.
const {digest}=require('./integrated-review');
const {buildInventoryObservationReview}=require('./inventory-observation-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false});
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function deriveRuntimeBaseline(reconciliation){
 const rows=reconciliation.runtime.map(r=>({id:r.id,kind:r.kind,sourceFingerprint:r.sourceFingerprint}));
 assert(rows.every(r=>typeof r.id==='string'&&r.id.trim()&&typeof r.kind==='string'&&r.kind.trim()&&hex(r.sourceFingerprint))&&new Set(rows.map(r=>r.id)).size===rows.length,'invalidClosureRuntimeBaseline');
 return rows;
}
function buildInventoryClosureReview({input,preview,ledger,capture,observationReview,referenceInput,referenceReview,reviewReferences,proposals=[]}){
 const observed=buildInventoryObservationReview(input,preview,ledger,capture,proposals);
 assert(digest(observed)===digest(observationReview),'closureObservationReviewMismatch');
 const baseline=deriveRuntimeBaseline(input.reconciliation);
 assert(baseline.length===ledger.summary.runtimeBaseline&&baseline.length===ledger.runtime.length&&input.reconciliation.runtime.every((r,i)=>ledger.runtime[i].rowId===r.evidenceId&&ledger.runtime[i].sourceFingerprint===r.sourceFingerprint),'closureRuntimeLedgerMismatch');
 const scope=input.scope==='localSnapshot'?'observedLocal':'disposableFixture';
 assert(referenceInput.scope===scope&&digest(referenceInput.installed)===observed.bindings.installed,'closureReferenceInputMismatch');
 assert(typeof reviewReferences==='function','closureReferenceAdapterRequired');
 // Override baseline from verified reconciliation, not from caller's report.
 const recomputed=reviewReferences({...referenceInput,baselineRuntime:baseline},capture);
 assert(recomputed?.ok===true&&digest(recomputed)===digest(referenceReview),'closureReferenceReviewMismatch');
 assert(Object.entries(flags()).every(([k,v])=>recomputed[k]===v),'closureReferenceFlagsMismatch');
 const r=recomputed.review,{fingerprint,...body}=r;
 assert(r.schemaVersion==='dnd-local-inventory-reference-review.v1'&&r.scope===scope&&hex(fingerprint)&&digest(body)===fingerprint&&r.readiness==='blocked'&&r.inventoryAcceptance==='notEstablished'&&Object.entries(flags()).every(([k,v])=>r[k]===v),'closureReferenceFingerprintMismatch');
 const b=r.bindings,s=r.summary;
 const surface=k=>capture.evidence.surfaces.find(row=>row.surface===k);
 assert(b.capture===observed.bindings.capture&&b.captureEnvelope===observed.bindings.captureEnvelope&&b.installed===observed.bindings.installed&&b.baselineRuntime===digest(baseline)&&
  ['runtime','portable'].every(k=>surface(k)?.status==='observed'&&b[k]===surface(k).fingerprint),'closureReferenceBindingMismatch');
 assert(s.baselineEntries===baseline.length&&s.loadedEntries===surface('runtime').counts.entries,'closureRuntimeAccountingMismatch');
 const d=s.runtimeDispositions,allowed=['exactEntry','changedEntry','missingLoadedEntry','loadedOnly'];
 assert(Object.entries(d).every(([k,v])=>allowed.includes(k)&&integer(v))&&
  (d.exactEntry||0)+(d.changedEntry||0)+(d.missingLoadedEntry||0)===s.baselineEntries&&
  (d.exactEntry||0)+(d.changedEntry||0)+(d.loadedOnly||0)===s.loadedEntries,'closureRuntimeDispositionMismatch');
 const lanes=['characterSnapshot','characterLink','characterBuildChoice','characterInstance','presetInstance','scenarioTactical','scenarioCreatureSource','historyInstance','presetBuildReference','presetLink','scenarioCharacter','historyCharacter','historyScenario','filterEntity','filterCategory','filterBook'];
 const statuses=['present','missing','ambiguous','ownerMismatch','removed','unqualified'];
 assert(Array.isArray(s.referenceLanes)&&new Set(s.referenceLanes.map(l=>l.lane)).size===s.referenceLanes.length&&
  s.referenceLanes.every(l=>lanes.includes(l.lane)&&integer(l.total)&&Object.entries(l.statuses).every(([k,v])=>statuses.includes(k)&&integer(v))&&Object.values(l.statuses).reduce((a,v)=>a+v,0)===l.total)&&
  integer(s.referenceOccurrences)&&s.referenceLanes.reduce((a,l)=>a+l.total,0)===s.referenceOccurrences,'closurePortableAccountingMismatch');
 const criteria=['completeInstalledCompendiumAndPortableStateInventory','exactRuntimePackageAndConfigurationBinding','legacyVersionsManualMappingsAndExternalPacksInventory','explicitUnmatchedAndExcludedOccurrenceLedger'];
 assert(Array.isArray(r.obligations)&&digest(r.obligations.map(o=>o.criterion))===digest(criteria)&&r.obligations.every(o=>['partial','pending'].includes(o.status)&&Array.isArray(o.pending)&&o.pending.length>0&&o.pending.every(p=>typeof p==='string')),'closureObligationsMismatch');
 const obligations=r.obligations.map(o=>({criterion:o.criterion,status:'blocked',observedProgress:o.status,
  pending:o.pending.filter(p=>p!=='historicalLedgerJoin')}));
 const result={schemaVersion:'dnd-upstream-inventory-closure-review.v1',scope:observed.scope,commits:observed.commits,
  bindings:{...observed.bindings,observationReview:observed.fingerprint,referenceReview:r.fingerprint,persistenceReview:observed.persistenceReview.fingerprint,runtimeBaseline:b.baselineRuntime,runtime:b.runtime,portable:b.portable},
  summary:{...observed.summary,runtimeDispositions:d,loadedEntries:s.loadedEntries,referenceOccurrences:s.referenceOccurrences,referenceLanes:s.referenceLanes},
  persistenceReview:observed.persistenceReview,obligations,criteriaAccepted:0,criteriaRequired:criteria.length,
  blockers:[...new Set([...observed.blockers,'independentBackendAndOwnerInventoryPending','fullReferenceAndRuntimeGraphCoveragePending','explicitInventoryAcceptanceMissing'])],
  readiness:'blocked',inventoryAcceptance:'notEstablished',...flags()};
 return {...result,fingerprint:digest(result)};
}
module.exports={deriveRuntimeBaseline,buildInventoryClosureReview};
