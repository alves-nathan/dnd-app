'use strict';
// Aggregate milestone review, not acceptance or attestation. The optional
// owner manifest is a declaration bound to the same observed capture.
const {digest}=require('./integrated-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const exactKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
const areas=['externalPacks','characterBackups','catalogBackups','historicalArtifacts'];
const areaStatuses=['declared','unavailable','notInspected'];
const formats=['v1','v2','v3','portableBackup','catalogBundle','other','unknown'];
function reviewOwnerInventory(capture,manifest){
 const surface=capture.evidence.surfaces.find(s=>s.surface==='externalPacksAndBackups');
 assert(surface,'ownerInventorySurfaceMissing');
 const blank=()=>areas.map(area=>({area,status:'notInspected',occurrences:0}));
 if(manifest===undefined)return {surfaceStatus:surface.status,binding:'notVerified',areas:blank(),declaredOccurrences:0,distinctContent:0,duplicateContentOccurrences:0,completeness:'notEstablished'};
 assert(exactKeys(manifest,['schemaVersion','scope','captureFingerprint','areas'])&&manifest.schemaVersion==='dnd-owner-inventory-declaration.v1'&&manifest.scope===capture.evidence.scope&&manifest.captureFingerprint===capture.evidence.captureFingerprint,'ownerInventoryContextMismatch');
 assert(surface.status==='observed'&&hex(surface.fingerprint)&&digest(manifest)===surface.fingerprint,'ownerInventoryBindingMismatch');
 assert(Array.isArray(manifest.areas)&&manifest.areas.length===areas.length,'ownerInventoryAreasInvalid');
 const seen=new Set(),hashes=new Set(),rows=[];let total=0;
 for(const a of manifest.areas){
  assert(exactKeys(a,['area','status','files'])&&areas.includes(a.area)&&!seen.has(a.area)&&areaStatuses.includes(a.status)&&Array.isArray(a.files)&&a.files.length<=10000,'ownerInventoryAreaInvalid');
  seen.add(a.area);
  assert(a.status==='declared'||a.files.length===0,'ownerInventoryUnavailableFiles');
  for(const f of a.files){
   assert(exactKeys(f,['sha256','byteLength','format'])&&hex(f.sha256)&&integer(f.byteLength)&&formats.includes(f.format),'ownerInventoryFileInvalid');
   hashes.add(f.sha256);total++;
  }
  rows.push({area:a.area,status:a.status,occurrences:a.files.length});
 }
 return {surfaceStatus:surface.status,binding:'declarationFingerprintBound',manifestFingerprint:surface.fingerprint,areas:rows,declaredOccurrences:total,distinctContent:hashes.size,duplicateContentOccurrences:total-hashes.size,completeness:'notEstablished'};
}
function buildInventoryMilestone({capture,observed,reference,ledger,installed,runtimeGraph,ownerManifest}){
 const owner=reviewOwnerInventory(capture,ownerManifest);
 const versions={v1:0,v2:0,v3:0,other:0};
 for(const p of installed.packs){
  const version={'dnd-combat-import.v1':'v1','dnd-combat-import.v2':'v2','dnd-combat-import.v3':'v3'}[p.schemaVersion]||'other';
  versions[version]++;
 }
 const references={present:0,missing:0,ambiguous:0,ownerMismatch:0,removed:0,unqualified:0};
 for(const l of reference.summary.referenceLanes)for(const [k,v] of Object.entries(l.statuses)){
  assert(Object.prototype.hasOwnProperty.call(references,k)&&integer(v),'milestoneReferenceStatusInvalid');references[k]+=v;
 }
 assert(Object.values(references).reduce((a,b)=>a+b,0)===reference.summary.referenceOccurrences,'milestoneReferenceAccountingMismatch');
 const graphDivergence=['dependencies','aliases','categories'].some(k=>Object.entries(runtimeGraph[k].statuses).some(([status,n])=>status!=='exact'&&n>0))||
  runtimeGraph.registry.coverage!=='completeBaseline'||Object.entries(runtimeGraph.registry.statuses).some(([status,n])=>status!=='exact'&&n>0)||
  runtimeGraph.memberships.missing>0||runtimeGraph.memberships.loadedOnly>0||!runtimeGraph.indexAgreement||Object.values(runtimeGraph.issues).some(n=>n>0);
 const packageBinding=observed.coherence.runtimePackage;
 const criteria=[
  {criterion:'completeInstalledCompendiumAndPortableStateInventory',evidence:['installedLedger','portableReferenceOccurrences','persistenceProjectionReview'],pending:['independentInstallationEvidence','atomicCrossStoreCapture','providerAndOpaqueHistorySemantics',...(observed.persistenceReview.summary.match!==observed.persistenceReview.summary.required?['persistenceCoverageIncomplete']:[]),...(references.missing||references.ambiguous||references.ownerMismatch||references.unqualified?['referenceDispositionsPending']:[])]},
  {criterion:'exactRuntimePackageAndConfigurationBinding',evidence:['runtimeEntryReview','loadedGraphOccurrences','configurationHistoryReferences'],pending:['rawRuntimePackageBytesAndTrust','configurationHistorySourceAndRestoreBinding',...(packageBinding!=='storedPackageMatch'?['storedPackageBindingNotEstablished']:[]),...(graphDivergence?['runtimeGraphDispositionsPending']:[])]},
  {criterion:'legacyVersionsManualMappingsAndExternalPacksInventory',evidence:['installedPackVersions','manualReviewMarkerCounts','externalOwnerDeclarationStatus'],pending:['legacyMappingSemanticReview','externalInventoryCompletenessAndByteVerification',...(owner.binding==='notVerified'?['ownerDeclarationNotBound']:[])]},
  {criterion:'explicitUnmatchedAndExcludedOccurrenceLedger',evidence:['installedAndHistoricalOccurrenceLedger','missingBaselineDispositions','exclusionProposals'],pending:['ownerDispositionDecisions','explicitExclusionApproval']}
 ].map(c=>({...c,status:'blocked'}));
 const body={schemaVersion:'dnd-upstream-inventory-milestone.v1',scope:observed.scope,bindings:{capture:observed.bindings.capture,captureEnvelope:observed.bindings.captureEnvelope,ledger:ledger.fingerprint,reference:reference.fingerprint,runtimeGraph:runtimeGraph.fingerprint,persistence:observed.persistenceReview.fingerprint},
  summary:{surfaces:capture.evidence.summary,persistence:observed.persistenceReview.summary,packVersions:versions,manualReviewMarkers:ledger.summary.manualReviewMarkers,duplicateCanonicalRows:ledger.summary.duplicateCanonicalRows,inconsistentRawOwner:ledger.summary.inconsistentRawOwner,references,graphDivergence,externalOwner:owner,exclusionProposals:ledger.summary.exclusionProposals,approvedExclusions:0,approvedMappings:0},
  criteria,criteriaRequired:4,criteriaAccepted:0,phase:'implementationMilestone',inventoryAcceptance:'notEstablished',readiness:'blocked',writeAuthorized:false,runtimeEligible:false,retirementAuthorized:false,distributionAuthorized:false,executable:false};
 return {...body,fingerprint:digest(body)};
}
module.exports={reviewOwnerInventory,buildInventoryMilestone};
