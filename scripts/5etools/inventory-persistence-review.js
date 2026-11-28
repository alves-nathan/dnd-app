'use strict';
// Consolidates aggregate capture evidence. No authentication, native proof,
// or reconstruction of private persisted bytes from a reported digest.
const {digest}=require('./integrated-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const keys=(o,expected)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>expected.includes(k));
const aux=['trust','updateSessions','restoreSessions','distribution','publication','transparency','rolloutHealth','rolloutAggregation','operationalAudit','operationalAuthorization','operationalFederation'];
const portable=['characters','scenarios','presets','history','catalog'];
const statuses=['match','mismatch','unavailable','invalid','notVerified','notInspected'];
const codes={
 unavailable:['persistedStateAbsent','backendReadFailed'],
 invalid:['unsupportedEnvelope','persistedProjectionMismatch','invalidPersistedState','invalidEnvelope','invalidCatalogPreferences','invalidCharacterProjection','invalidCollectionProjection'],
 notVerified:['hydratedStateUnavailable']
};
const compare=(a,b)=>a<b?-1:a>b?1:0;
function installedFingerprint(snapshot){
 return digest({sources:[...snapshot.sources].sort((a,b)=>compare(a.id,b.id)),packs:[...snapshot.packs].sort((a,b)=>compare(a.id,b.id)),items:[...snapshot.items].sort((a,b)=>compare(a.id,b.id)),enabledSourceIds:[...snapshot.enabledSourceIds].sort(compare)});
}
function reviewGroup(report,lanes,key,surfaces){
 if(report===undefined)return lanes.map(lane=>({lane,status:'notInspected',binding:'coveragePending'}));
 assert(keys(report,['rows','summary','fingerprint','writeAuthorized','executable'])&&report.writeAuthorized===false&&report.executable===false&&Array.isArray(report.rows)&&report.rows.length===lanes.length&&hex(report.fingerprint)&&digest(report.rows)===report.fingerprint,'persistenceGroupFingerprintMismatch');
 const summary={required:lanes.length,match:0,mismatch:0,unavailable:0,invalid:0,notVerified:0};
 const seen=new Set();
 const rows=report.rows.map(r=>{
  assert(keys(r,[key,'status','fingerprint','code',...(key==='lane'?['timestampComparison']:[])])&&lanes.includes(r[key])&&!seen.has(r[key])&&statuses.slice(0,5).includes(r.status),'persistenceGroupRowInvalid');
  const lane=r[key];seen.add(lane);summary[r.status]++;
  const observed=['match','mismatch','notVerified'].includes(r.status);
  assert(observed?hex(r.fingerprint):r.fingerprint===undefined,'persistenceGroupRowFingerprintInvalid');
  assert(codes[r.status]?codes[r.status].includes(r.code):r.code===undefined,'persistenceGroupRowCodeInvalid');
  const expectedSurface=key==='surface'?lane:'portable';
  const s=surfaces.get(expectedSurface);
  if(r.status==='match'||r.status==='mismatch'){
   assert(s?.status==='observed','persistenceHydratedSurfaceMissing');
   if(key==='lane'&&lane==='characters')assert(surfaces.get('characterReconciliation')?.status==='observed','persistenceReconciliationMissing');
   if(key==='lane'&&lane==='catalog')assert(surfaces.get('runtime')?.status==='observed','persistenceRuntimeMissing');
  }
  if(r.timestampComparison!==undefined)assert(key==='lane'&&lane==='catalog'&&['matched','mismatch','notObserved'].includes(r.timestampComparison)&&['match','mismatch'].includes(r.status)&&!(r.status==='match'&&r.timestampComparison==='mismatch'),'persistenceTimestampInvalid');
  if(key==='lane'&&lane==='catalog'&&['match','mismatch'].includes(r.status))assert(r.timestampComparison!==undefined,'persistenceTimestampMissing');
  // Aux projection digest is the same domain as hydrated surface digest.
  // Portable rows bind persisted envelopes, not the hydrated projection;
  // equality cannot independently be reconstructed without the input bytes.
  if(key==='surface'&&['match','mismatch'].includes(r.status))assert((s.fingerprint===r.fingerprint)===(r.status==='match'),'persistenceAuxiliaryBindingMismatch');
  return {lane,status:r.status,binding:r.status==='match'?(key==='surface'?'projectionFingerprintBound':'reportedProjectionMatch'):r.status==='mismatch'?'divergenceReported':'coveragePending',...(r.fingerprint?{fingerprint:r.fingerprint}:{}),...(r.timestampComparison?{timestampComparison:r.timestampComparison}:{})};
 });
 assert(digest(summary)===digest(report.summary),'persistenceGroupAccountingMismatch');
 return rows;
}
function buildInventoryPersistenceReview(capture,installed){
 const surfaces=new Map(capture.evidence.surfaces.map(s=>[s.surface,s])),c=capture.coherence;
 const independent=c.independentPersistence;
 let active={lane:'activeCompendium',status:'notInspected',binding:'coveragePending'};
 if(independent){
  const expected={sources:installed.sources.length,packs:installed.packs.length,items:installed.items.length,enabledSources:installed.enabledSourceIds.length};
  if(independent.status==='observed'){
   assert(keys(independent,['status','backend','counts','snapshotFingerprint','rawFingerprint'])&&keys(independent.counts,Object.keys(expected))&&Object.keys(expected).every(k=>integer(independent.counts[k]))&&hex(independent.rawFingerprint)&&hex(independent.snapshotFingerprint),'persistenceActiveShapeInvalid');
   const equal=installedFingerprint(installed)===independent.snapshotFingerprint;
   if(c.activePersistence==='mismatch')assert(!equal,'persistenceActiveBindingMismatch');
   else if(c.activePersistence!=='notVerified')assert(equal&&digest(independent.counts)===digest(expected),'persistenceActiveBindingMismatch');
   active={lane:'activeCompendium',status:c.activePersistence==='notVerified'?'notVerified':equal?'match':'mismatch',binding:c.activePersistence==='notVerified'?'coveragePending':equal?'snapshotFingerprintBound':'divergenceReported',backend:independent.backend};
  }else{
   assert(keys(independent,['status','backend','code'])&&['unavailable','invalid'].includes(independent.status),'persistenceActiveShapeInvalid');
   active={lane:'activeCompendium',status:independent.status,binding:'coveragePending',backend:independent.backend};
  }
 }else if(c.activePersistence==='mismatch')active={lane:'activeCompendium',status:'mismatch',binding:'divergenceReported'};
 // Old legacy comparison without independent port remains not inspected.
 const auxiliary=reviewGroup(c.auxiliaryPersistence,aux,'surface',surfaces),portableRows=reviewGroup(c.portablePersistence,portable,'lane',surfaces);
 const rows=[active,...auxiliary,...portableRows];
 const summary={required:rows.length,...Object.fromEntries(statuses.map(s=>[s,0]))};
 for(const row of rows)summary[row.status]++;
 const gaps=['nativeAndBrowserExecutionPending','crossStoreAtomicityAndDurabilityPending','externalOwnerInventoryPending','downloadCacheBytesAndTrustPending','aggregationSecretValueNotCompared','portableEnvelopeMatchNotIndependentlyReconstructed'];
 if(summary.mismatch)gaps.push('persistedProjectionDivergence');
 if(summary.match!==summary.required)gaps.push('persistedProjectionCoverageIncomplete');
 if(portableRows.find(r=>r.lane==='catalog')?.timestampComparison!=='matched')gaps.push('catalogSavedAtNotBound');
 const body={schemaVersion:'dnd-upstream-inventory-persistence-review.v1',scope:capture.evidence.scope,
  bindings:{capture:capture.evidence.fingerprint,captureEnvelope:digest(capture),installed:surfaces.get('compendium').fingerprint},
  summary,rows,gaps,inventoryAcceptance:'notEstablished',readiness:'blocked',writeAuthorized:false,executable:false};
 return {...body,fingerprint:digest(body)};
}
module.exports={buildInventoryPersistenceReview};
