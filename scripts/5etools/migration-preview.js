'use strict';
// a8.1: immutable migration planning. No writes, executable operations or approval.
const {digest}=require('./integrated-review');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const push=(m,k,v)=>{const a=m.get(k)||[];a.push(v);m.set(k,a);};
const count=(rows,k='disposition')=>rows.reduce((a,r)=>(bump(a,r[k]||'unknown'),a),dict());
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function inspectSnapshot(snapshot){
  const issues=dict(),groups={};
  if(!rec(snapshot))throw Error('invalidSnapshot');
  for(const k of ['sources','packs','items','enabledSourceIds'])if(!Array.isArray(snapshot[k]))throw Error('invalidSnapshot:'+k);
  for(const k of ['sources','packs','items']){
    const map=new Map();
    for(const row of snapshot[k]){
      if(!rec(row)||!text(row.id)){bump(issues,k+':invalidId');continue;}
      if(map.has(row.id))bump(issues,k+':duplicateId');
      else map.set(row.id,row);
    }
    groups[k]=map;
  }
  const canonical=new Map();
  for(const item of snapshot.items){
    if(!rec(item))continue;
    if(!text(item.importItemId))bump(issues,'invalidCanonicalId');else push(canonical,item.importItemId,item);
    if(!groups.sources.has(item.sourceId))bump(issues,'missingItemSource');
    if(!groups.packs.has(item.packId))bump(issues,'missingItemPack');
    if(!['draft','validated','needsReview','disabled'].includes(item.status))bump(issues,'invalidItemStatus');
    if(!rec(item.rawJson)||!rec(item.normalizedJson))bump(issues,'missingItemPayload');
    else if(item.rawJson.id!==item.importItemId)bump(issues,'canonicalIdMismatch');
  }
  for(const pack of groups.packs.values())if(!groups.sources.has(pack.sourceId))bump(issues,'missingPackSource');
  const enabled=new Set();
  for(const id of snapshot.enabledSourceIds){
    if(!text(id)||!groups.sources.has(id))bump(issues,'unknownEnabledSource');
    if(enabled.has(id))bump(issues,'duplicateEnabledSource');
    enabled.add(id);
  }
  return {...groups,canonical,enabled,issues,fingerprint:digest(snapshot)};
}
function preserveRows(rows,idKey='id'){
  return rows.map(r=>({id:r[idKey],fingerprint:digest(r),disposition:'preserve',writeAuthorized:false}));
}
// Verify the full plan binding. This is a stale/tamper check, not authentication.
function checkPreviewBinding(preview,snapshot){
  if(!rec(preview)||preview.schemaVersion!=='dnd-upstream-migration-preview.v1'||!hex(preview.planFingerprint))return {ok:false,reason:'invalidPreview'};
  const {planFingerprint,...body}=preview;
  if(digest(body)!==planFingerprint)return {ok:false,reason:'previewFingerprintMismatch'};
  if(digest(snapshot)!==preview.checkpoint.snapshotFingerprint)return {ok:false,reason:'snapshotChanged'};
  return {ok:true,executable:false};
}
function buildMigrationPreview({reconciliation,baselineSnapshot,installedSnapshot,scope='bundledFixture'}){
  if(!rec(reconciliation)||reconciliation.schemaVersion!=='dnd-upstream-historical-reconciliation.v1'||reconciliation.activation!=='review-required'||
    !['bundledFixture','localSnapshot'].includes(scope)||!rec(reconciliation.commits))throw Error('invalidReconciliation');
  for(const key of ['historical','runtime','historicalGroups','dependencies','aliases','categories','legacyLinks'])if(!Array.isArray(reconciliation[key]))throw Error('invalidReconciliation:'+key);
  const baseline=inspectSnapshot(baselineSnapshot),installed=inspectSnapshot(installedSnapshot),issues=dict();
  for(const [domain,checks] of [['baseline',baseline.issues],['installed',installed.issues],['reconciliation',reconciliation.summary?.issues||{}]])for(const [k,n] of Object.entries(checks))bump(issues,domain+':'+k,n);
  // Only baseline storage ownership proves a bundled occurrence. An ID alone is
  // insufficient, as a local import may reuse that canonical ID in another pack.
  const byLegacyId=new Map(),groups=new Map(),evidence=new Set();
  for(const r of reconciliation.historical){
    push(byLegacyId,r.id,r);
    if(!text(r.evidenceId)||evidence.has(r.evidenceId))bump(issues,'duplicateOrInvalidHistoricalEvidence');
    evidence.add(r.evidenceId);
    if(r.preservation!=='required'||r.activation!=='review-required')bump(issues,'historicalPreservationMismatch');
  }
  for(const g of reconciliation.historicalGroups){
    if(groups.has(g.id))bump(issues,'duplicateHistoricalGroup');
    groups.set(g.id,g);
    const rs=byLegacyId.get(g.id)||[];
    const targets=[...new Set(rs.map(r=>r.targetId).filter(Boolean))].sort();
    if(rs.length!==g.occurrences||digest(targets)!==digest(g.targetIds)||g.preservation!=='required')bump(issues,'historicalGroupMismatch');
  }
  if(groups.size!==byLegacyId.size)bump(issues,'historicalGroupAccounting');
  const storageRows=[];
  for(const item of installed.items.values()){
    const original=baseline.items.get(item.id),sameOwner=original?.packId===item.packId&&original?.sourceId===item.sourceId&&original?.importItemId===item.importItemId;
    const rs=byLegacyId.get(item.importItemId)||[],g=groups.get(item.importItemId);
    const unchanged=!!original&&digest(original)===digest(item);
    let disposition;
    if(!original)disposition='preserveLocalOnly';
    else if(!sameOwner)disposition='preserveStorageIdentityConflict';
    else if(!unchanged)disposition='preserveLocalModification';
    else if((installed.canonical.get(item.importItemId)||[]).length!==1)disposition='preserveAmbiguousCanonicalId';
    else if(g?.status==='consistentIdentityCandidate'&&g.targetIds.length===1&&rs.every(r=>r.status==='identityCandidate'&&r.targetId===g.targetIds[0]))disposition='preserveCandidatePendingParity';
    else disposition='preserveUnmappedOrVariant';
    storageRows.push({storageId:item.id,canonicalId:item.importItemId,sourceId:item.sourceId,packId:item.packId,status:item.status,
      fingerprint:digest(item),baselineFingerprint:original?digest(original):null,
      disposition,candidateIds:disposition==='preserveCandidatePendingParity'?[...g.targetIds]:[],
      evidenceIds:disposition==='preserveCandidatePendingParity'?rs.map(r=>r.evidenceId).sort():[],
      preservesStorageId:true,preservesReview:true,writeAuthorized:false});
  }
  const missingBaseline=[...baseline.items.values()].filter(i=>!installed.items.has(i.id)).map(i=>({storageId:i.id,canonicalId:i.importItemId,disposition:'respectLocalAbsence',writeAuthorized:false}));
  // Missing baseline sources/packs are not automatically resurrected. Preserve current
  // state including enabledSourceIds, manual mappings, review notes and timestamps.
  const sourceRows=preserveRows([...installed.sources.values()]),packRows=preserveRows([...installed.packs.values()]);
  const runtimeRows=reconciliation.runtime.map(r=>{
    if(!text(r.evidenceId)||evidence.has(r.evidenceId))bump(issues,'duplicateOrInvalidRuntimeEvidence');
    evidence.add(r.evidenceId);
    if(r.preservation!=='required'||r.activation!=='review-required')bump(issues,'runtimePreservationMismatch');
    return {id:r.id,kind:r.kind,evidenceId:r.evidenceId,sourceFingerprint:r.sourceFingerprint,
      disposition:r.status==='identityCandidate'?'preserveRuntimeCandidatePendingParity':'preserveRuntimeContract',
      candidateId:r.status==='identityCandidate'?r.targetId:undefined,writeAuthorized:false};
  });
  const historicalRows=reconciliation.historical.map(r=>({id:r.id,path:r.path,index:r.index,evidenceId:r.evidenceId,
    sourceFingerprint:r.sourceFingerprint,disposition:'preserveHistoricalOccurrence',writeAuthorized:false}));
  const dependencies=preserveRows(reconciliation.dependencies),aliases=preserveRows(reconciliation.aliases),categories=preserveRows(reconciliation.categories);
  const legacyLinks=reconciliation.legacyLinks.map(r=>({fingerprint:digest(r),disposition:'preserveLegacyLink',writeAuthorized:false}));
  const blockers=['mechanicalParityNotApproved','historicalIdentityVariantsPending','runtimeContractsAndRelationsPending',
    'installedUserDataAndCharacterReferencesNotVerified','backupRestoreAndRollbackNotVerified','trustedRuntimePackageNotPrepared','explicitCutoverApprovalMissing'];
  if(scope==='bundledFixture')blockers.push('syntheticInstallationOnly');
  if(Object.keys(issues).length)blockers.push('integrityIssues');
  const report={schemaVersion:'dnd-upstream-migration-preview.v1',commits:{...reconciliation.commits},scope,
    checkpoint:{snapshotFingerprint:installed.fingerprint,baselineFingerprint:baseline.fingerprint,reconciliationFingerprint:digest(reconciliation),
      enabledSourceIds:[...installedSnapshot.enabledSourceIds],storageContract:'CompendiumPersistenceState.v3',catalogAndCharacters:'notInspected'},
    summary:{storageItems:storageRows.length,storageDisposition:count(storageRows),missingBaseline:missingBaseline.length,
      sources:sourceRows.length,packs:packRows.length,enabledSources:installed.enabled.size,historicalOccurrences:historicalRows.length,runtimeEntries:runtimeRows.length,
      runtimeDisposition:count(runtimeRows),dependencies:dependencies.length,aliases:aliases.length,categories:categories.length,legacyLinks:legacyLinks.length,
      writes:0,deletes:0,replacements:0,approvedMappings:0,issues,blockers,executable:false,retirementAuthorized:false},
    storageRows,missingBaseline,sourceRows,packRows,historicalRows,runtimeRows,dependencies,aliases,categories,legacyLinks,
    activation:'review-required',executable:false,retirementAuthorized:false};
  return {...report,planFingerprint:digest(report)};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,scope:r.scope,summary:r.summary,activation:r.activation,executable:r.executable,retirementAuthorized:r.retirementAuthorized};}
module.exports={inspectSnapshot,buildMigrationPreview,checkPreviewBinding,publicSummary};
