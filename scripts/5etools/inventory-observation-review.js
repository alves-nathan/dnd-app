'use strict';
// a8.13.6: offline join of aggregate local observation and disposition ledger.
// A consistent digest is not authentication or a complete installed inventory.
const {digest}=require('./integrated-review');
const {buildInventoryDispositionLedger}=require('./inventory-disposition-ledger');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sources={
 compendium:'activeCompendiumRepository',legacyCompendium:'legacyCompendiumStorage',portable:'portableDataCheckpoint',
 characterReconciliation:'characterStore',runtime:'catalogStore',packageIndex:'catalogPackageRepository',packageContents:'catalogPackageRepository',
 trust:'catalogTrustStore',updateSessions:'catalogUpdateSessionStore',restoreSessions:'portableRestoreSessionStore',
 distribution:'catalogDistributionStore',downloadCache:'catalogDownloadCacheRepository',publication:'catalogPublicationStore',
 transparency:'catalogTransparencyStore',rolloutHealth:'catalogRolloutHealthStore',rolloutAggregation:'catalogRolloutAggregationStore',
 operationalAudit:'catalogOperationalAuditStore',operationalAuthorization:'catalogOperationalAuthorizationStore',operationalFederation:'catalogOperationalFederationStore',externalPacksAndBackups:'ownerInventory'
};
const statuses=['observed','notInspected','unavailable','busy','invalid','stale'];
const flags=()=>({activation:'review-required',writeAuthorized:false,runtimeEligible:false,retirementAuthorized:false,distributionAuthorized:false,executable:false});
function checkCapture(capture,scope){
 assert(capture?.captureStatus==='stableObservation'&&capture.writeAuthorized===false&&capture.executable===false,'stableInventoryCaptureRequired');
 const e=capture.evidence;
 assert(e?.schemaVersion==='dnd-local-inventory-evidence.v1'&&e.scope===(scope==='bundledFixture'?'disposableFixture':'observedLocal')&&hex(e.captureFingerprint)&&hex(e.fingerprint),'inventoryCaptureScopeMismatch');
 const {fingerprint,...body}=e;
 assert(digest(body)===fingerprint&&e.readiness==='blocked'&&e.inventoryAcceptance==='notEstablished'&&Object.entries(flags()).every(([k,v])=>e[k]===v),'inventoryCaptureFingerprintMismatch');
 assert(Array.isArray(e.codes)&&e.codes.length===0&&Array.isArray(e.surfaces)&&e.surfaces.length===Object.keys(sources).length,'inventoryCaptureInvalid');
 const rows=new Map(),summary={required:Object.keys(sources).length,...Object.fromEntries(statuses.map(s=>[s,0]))};
 for(const row of e.surfaces){
  assert(row&&Object.prototype.hasOwnProperty.call(sources,row.surface)&&sources[row.surface]===row.source&&!rows.has(row.surface)&&statuses.includes(row.status)&&Array.isArray(row.codes),'inventorySurfaceInvalid');
  assert(row.status==='observed'?hex(row.fingerprint)&&row.codes.length===0:row.fingerprint===undefined,'inventorySurfaceFingerprintInvalid');
  rows.set(row.surface,row);summary[row.status]++;
 }
 assert(digest(summary)===digest(e.summary),'inventorySurfaceAccountingMismatch');
 const c=capture.coherence;
 assert(c&&['notVerified','storedPackageMatch','bundledRefOnly','mismatch'].includes(c.runtimePackage)&&
  ['notVerified','legacySnapshotMatch','sqliteSnapshotMatch','webSnapshotMatch','mismatch'].includes(c.activePersistence),'inventoryCoherenceInvalid');
 const independent=c.independentPersistence;
 if(independent!==undefined){
  assert(independent&&['sqlite','web','legacy'].includes(independent.backend)&&['observed','unavailable','invalid'].includes(independent.status),'independentPersistenceInvalid');
  if(independent.status==='observed')assert(hex(independent.snapshotFingerprint)&&hex(independent.rawFingerprint)&&independent.counts&&['sources','packs','items','enabledSources'].every(k=>Number.isSafeInteger(independent.counts[k])&&independent.counts[k]>=0),'independentPersistenceInvalid');
  else assert(typeof independent.code==='string'&&c.activePersistence==='notVerified','independentPersistenceInvalid');
  const matches={sqlite:'sqliteSnapshotMatch',web:'webSnapshotMatch',legacy:'legacySnapshotMatch'};
  assert(['notVerified','mismatch',matches[independent.backend]].includes(c.activePersistence),'independentPersistenceMismatch');
 }else assert(!['sqliteSnapshotMatch','webSnapshotMatch'].includes(c.activePersistence),'independentPersistenceRequired');
 return rows;
}
function buildInventoryObservationReview(input,preview,ledger,capture,proposals=[]){
 const actual=buildInventoryDispositionLedger(input,preview,proposals);
 assert(digest(actual)===digest(ledger),'inventoryLedgerBindingMismatch');
 const rows=checkCapture(capture,actual.scope),compendium=rows.get('compendium');
 assert(compendium.status==='observed'&&compendium.fingerprint===actual.bindings.installed,'installedObservationBindingMismatch');
 const installed=input.installedSnapshot,counts=compendium.counts;
 assert(counts&&counts.items===installed.items.length&&counts.sources===installed.sources.length&&
  counts.packs===installed.packs.length&&counts.enabledSources===installed.enabledSourceIds.length&&counts.items===actual.summary.installed,'installedObservationAccountingMismatch');
 // All other observations are point-in-time status evidence only; runtime
 // count equality does not bind entry identities or portable references.
 const surfaceReview=[...rows.values()].map(row=>({surface:row.surface,status:row.status,
  disposition:row.surface==='compendium'?'snapshotFingerprintBound':row.status==='observed'?'observedNotJoined':'coveragePending'}));
 const runtime=rows.get('runtime'),portable=rows.get('portable');
 const runtimeCountComparison=runtime.status!=='observed'||!Number.isSafeInteger(runtime.counts?.entries)?'notVerified':
  runtime.counts.entries===actual.summary.runtimeBaseline?'equalCountsOnly':'differentCounts';
 const c=capture.coherence;
 const blockers=[...new Set([...actual.blockers,...capture.evidence.blockers,
  'runtimeEntryAndPortableReferenceDispositionPending','ownerExclusionDecisionsPending',
  ...(c.activePersistence==='mismatch'||c.runtimePackage==='mismatch'?['observedCoherenceMismatch']:[]),
  ...(actual.scope==='bundledFixture'?['disposableFixtureNotInstalledEvidence']:[])])];
 const body={schemaVersion:'dnd-upstream-inventory-observation-review.v1',scope:actual.scope,commits:actual.commits,
  bindings:{ledger:actual.fingerprint,preview:actual.bindings.preview,installed:actual.bindings.installed,
   reconciliation:actual.bindings.reconciliation,capture:capture.evidence.fingerprint,captureEnvelope:digest(capture)},
  summary:{installedRows:actual.summary.installed,historicalOccurrences:actual.summary.historical,missingBaseline:actual.summary.missingBaseline,
   runtimeBaseline:actual.summary.runtimeBaseline,installedIdentity:actual.summary.installedIdentity,historicalIdentity:actual.summary.historicalIdentity,
   installedDisposition:actual.summary.installedDisposition,manualReviewMarkers:actual.summary.manualReviewMarkers,
   duplicateCanonicalRows:actual.summary.duplicateCanonicalRows,inconsistentRawOwner:actual.summary.inconsistentRawOwner,
   exclusionProposals:actual.summary.exclusionProposals,approvedExclusions:0,approvedMappings:0,writes:0,deletes:0},
  surfaceReview,runtimeCountComparison,portableCoverage:portable.status==='observed'?'observedNotJoined':'coveragePending',
  coherence:{runtimePackage:c.runtimePackage,activePersistence:c.activePersistence,...(c.independentPersistence?{independentPersistence:c.independentPersistence}:{} )},
  readiness:'blocked',inventoryAcceptance:'notEstablished',blockers,...flags()};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildInventoryObservationReview};
