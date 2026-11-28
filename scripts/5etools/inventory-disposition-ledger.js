'use strict';
// a8.13.5: occurrence-level disposition ledger. All dispositions preserve.
const {digest}=require('./integrated-review');
const {buildMigrationPreview,checkPreviewBinding}=require('./migration-preview');
const text=x=>typeof x==='string'&&x.trim().length>0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const push=(m,k,v)=>{const a=m.get(k)||[];a.push(v);m.set(k,a);};
const key=(id,kind,source)=>JSON.stringify([id,kind,source]);
const count=(rs,field)=>Object.fromEntries([...rs.reduce((m,r)=>m.set(r[field],(m.get(r[field])||0)+1),new Map())].sort(([a],[b])=>a.localeCompare(b)));
const flags=()=>({activation:'review-required',writeAuthorized:false,runtimeEligible:false,retirementAuthorized:false,distributionAuthorized:false,executable:false});
const exclusionReasons=new Set(['outsideProposedScope','duplicateOccurrenceReview','unsupportedLegacyContract','sourceRightsPending']);
function buildInventoryDispositionLedger(input,preview,proposals=[]){
 const actual=buildMigrationPreview(input);
 assert(checkPreviewBinding(actual,input.installedSnapshot).ok&&digest(actual)===digest(preview),'inventoryPreviewBindingMismatch');
 assert(Object.keys(actual.summary.issues).length===0,'inventoryPreviewIntegrityIssues');
 const r=input.reconciliation,installed=input.installedSnapshot,baseline=input.baselineSnapshot;
 assert(r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false,'inventoryReconciliationPromoted');
 const byKey=new Map(),byId=new Map(),installedByKey=new Map(),installedById=new Map(),historicalIds=new Set(),coords=new Set();
 for(const h of r.historical){
  assert(text(h.id)&&text(h.kind)&&text(h.sourceId)&&text(h.path)&&Number.isSafeInteger(h.index)&&h.index>=0&&hex(h.sourceFingerprint)&&text(h.evidenceId)&&h.decision==='unreviewed'&&h.preservation==='required','invalidHistoricalOccurrence');
  const coord=JSON.stringify([h.path,h.index]);
  assert(!coords.has(coord)&&!historicalIds.has(h.evidenceId),'duplicateHistoricalOccurrence');
  coords.add(coord);historicalIds.add(h.evidenceId);
  push(byKey,key(h.id,h.kind,h.sourceId),h);push(byId,h.id,h);
 }
 const baselineById=new Map(baseline.items.map(i=>[i.id,i]));
 const previewById=new Map(actual.storageRows.map(i=>[i.storageId,i]));
 const packById=new Map(installed.packs.map(p=>[p.id,p]));
 const sourceById=new Map(installed.sources.map(s=>[s.id,s]));
 for(const i of installed.items){
  assert(text(i.type)&&text(i.importItemId)&&text(i.sourceId)&&i.rawJson&&i.normalizedJson,'invalidInstalledOccurrence');
  push(installedByKey,key(i.importItemId,i.type,i.sourceId),i);push(installedById,i.importItemId,i);
 }
 const storage=installed.items.map(i=>{
  const p=previewById.get(i.id),original=baselineById.get(i.id);
  assert(p&&p.fingerprint===digest(i)&&p.writeAuthorized===false,'inventoryStorageBindingMismatch');
  const qualified=byKey.get(key(i.importItemId,i.type,i.sourceId))||[],sameId=byId.get(i.importItemId)||[];
  const rawFingerprint=digest(i.rawJson),exact=qualified.filter(h=>h.sourceFingerprint===rawFingerprint);
  const identityStatus=qualified.length===0?(sameId.length?'qualifiedIdentityMismatch':'noHistoricalIdObserved'):
   exact.length===0?'qualifiedIdentityPayloadDiffers':exact.length===1?'singleExactRawOccurrence':'multipleExactRawOccurrences';
  const manualReviewMarkers=i.reviewNotes!==undefined||i.reviewedBy!==undefined||i.reviewedAt!==undefined||i.reviewDecision==='rejected'||i.reviewDecision==='approved';
  const duplicateStorageCanonical=(installedById.get(i.importItemId)||[]).length>1;
  const pack=packById.get(i.packId),source=sourceById.get(i.sourceId);
  const rawOwnerConsistent=i.rawJson.id===i.importItemId&&i.rawJson.kind===i.type&&i.rawJson.source?.id===i.sourceId;
  const body={lane:'installed',rowId:i.id,sourceFingerprint:digest(i),rawFingerprint,normalizedFingerprint:digest(i.normalizedJson),
   packFingerprint:digest(pack),sourceDefinitionFingerprint:digest(source),enabled:installed.enabledSourceIds.includes(i.sourceId),
   identityStatus,qualifiedOccurrences:qualified.length,exactOccurrences:exact.length,sameIdOccurrences:sameId.length,
   historicalEvidenceIds:qualified.map(h=>h.evidenceId).sort(),exactEvidenceIds:exact.map(h=>h.evidenceId).sort(),
   baselineStatus:!original?'notInBaseline':digest(original)===digest(i)?'unchanged':'changed',
   manualReviewMarkers,duplicateStorageCanonical,rawOwnerConsistent,disposition:p.disposition,
   review:'unreviewed',preservation:'required',...flags()};
  return {...body,rowFingerprint:digest(body)};
 });
 const historical=r.historical.map(h=>{
  const q=installedByKey.get(key(h.id,h.kind,h.sourceId))||[],sameId=installedById.get(h.id)||[],exact=q.filter(i=>digest(i.rawJson)===h.sourceFingerprint);
  const body={lane:'historical',rowId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,
   identityStatus:q.length===0?(sameId.length?'qualifiedIdentityMismatch':'notObservedInstalled'):exact.length===0?'qualifiedIdentityPayloadDiffers':exact.length===1?'singleExactRawOccurrence':'multipleExactRawOccurrences',
   qualifiedInstalled:q.length,exactInstalled:exact.length,sameIdInstalled:sameId.length,
   installedStorageIds:q.map(i=>i.id).sort(),exactStorageIds:exact.map(i=>i.id).sort(),upstreamIdentityStatus:h.status,
   disposition:'preserveHistoricalOccurrence',review:'unreviewed',preservation:'required',...flags()};
  return {...body,rowFingerprint:digest(body)};
 });
 const missingBaseline=actual.missingBaseline.map(p=>{
  const body={lane:'missingBaseline',rowId:p.storageId,sourceFingerprint:digest(baselineById.get(p.storageId)),
   disposition:'respectLocalAbsence',review:'unreviewed',preservation:'required',...flags()};
  return {...body,rowFingerprint:digest(body)};
 });
 const runtime=actual.runtimeRows.map(p=>{
  const body={lane:'runtimeBaseline',rowId:p.evidenceId,sourceFingerprint:p.sourceFingerprint,disposition:p.disposition,
   review:'unreviewed',preservation:'required',...flags()};
  return {...body,rowFingerprint:digest(body)};
 });
 const rows=[...storage,...historical,...missingBaseline,...runtime];
 const byFingerprint=new Map(rows.map(row=>[row.rowFingerprint,row]));
 assert(byFingerprint.size===rows.length,'duplicateLedgerRow');
 const proposed=new Set(),exclusions=[];
 assert(Array.isArray(proposals)&&proposals.length<=rows.length,'invalidExclusionProposals');
 for(const p of proposals){
  assert(p&&Object.keys(p).length===2&&hex(p.rowFingerprint)&&byFingerprint.has(p.rowFingerprint)&&exclusionReasons.has(p.reason)&&!proposed.has(p.rowFingerprint),'invalidExclusionProposal');
  proposed.add(p.rowFingerprint);
  exclusions.push({rowFingerprint:p.rowFingerprint,reason:p.reason,status:'proposedNotApproved',preservation:'required',...flags()});
 }
 const body={schemaVersion:'dnd-upstream-inventory-disposition-ledger.v1',scope:actual.scope,commits:actual.commits,
  bindings:{preview:actual.planFingerprint,installed:actual.checkpoint.snapshotFingerprint,baseline:actual.checkpoint.baselineFingerprint,reconciliation:actual.checkpoint.reconciliationFingerprint},
  summary:{installed:storage.length,historical:historical.length,missingBaseline:missingBaseline.length,runtimeBaseline:runtime.length,
   installedIdentity:count(storage,'identityStatus'),historicalIdentity:count(historical,'identityStatus'),installedDisposition:count(storage,'disposition'),
   manualReviewMarkers:storage.filter(s=>s.manualReviewMarkers).length,duplicateCanonicalRows:storage.filter(s=>s.duplicateStorageCanonical).length,
   inconsistentRawOwner:storage.filter(s=>!s.rawOwnerConsistent).length,exclusionProposals:exclusions.length,approvedExclusions:0,approvedMappings:0,writes:0,deletes:0},
  storage,historical,missingBaseline,runtime,exclusions,blockers:[...actual.summary.blockers,'actualRuntimeAndPortableInventoryNotJoined','externalAndIndependentBackendCoveragePending','exclusionAndIdentityDecisionsNotApproved'],
  readiness:'blocked',...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,scope:r.scope,commits:r.commits,bindings:r.bindings,summary:r.summary,blockers:r.blockers,readiness:r.readiness,...flags(),fingerprint:r.fingerprint};}
module.exports={buildInventoryDispositionLedger,publicSummary};
