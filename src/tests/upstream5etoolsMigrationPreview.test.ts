const {fromMigration,writeFragment}=require('../../scripts/5etools/cutover-evidence');
import {captureLocalInventoryEvidence,type InventoryStoreFrame} from '../compendium/localInventoryCapture';
import type {CompendiumPersistenceState} from '../storage/compendiumSnapshot';
const {buildInventoryObservationReview}=require('../../scripts/5etools/inventory-observation-review');

import {reviewLocalInventoryReferences} from '../compendium/localInventoryReferenceReview';
import {ContentPolicyService} from '../catalog/contentPolicyService';
import {emptyProgressionRecoverySummary} from '../characters/progressionRecovery';
import {emptyCompatibilityRemediationRecoverySummary} from '../characters/compatibilityRemediationRecovery';
import type {PortableRestoreDataCheckpoint} from '../backup/portableRestoreSession';
const {deriveRuntimeBaseline,buildInventoryClosureReview}=require('../../scripts/5etools/inventory-closure-review');

import * as fs from 'node:fs';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { parseImportPack } from '../compendium/parseImportPack';
import { detectCompendiumImportVersion } from '../compendium/importVersion';
import { CatalogLoader } from '../catalog/catalogLoader';
import type { RuntimeCatalogBundle } from '../catalog/types';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';
import { initializeBundledCompendium } from '../storage/bundledCompendiumBootstrap';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {openHistoricalSnapshot}=require('../../scripts/5etools/historical-baseline');
const {buildReconciliation}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {inspectSnapshot,buildMigrationPreview,checkPreviewBinding,publicSummary}=require('../../scripts/5etools/migration-preview');
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function fixture(){
  const item={id:'pack:legacy',importItemId:'legacy',packId:'pack',sourceId:'source',status:'disabled',reviewDecision:'rejected',reviewNotes:'local',rawJson:{id:'legacy'},normalizedJson:{id:'legacy',manual:true},createdAt:'fixture',updatedAt:'fixture'};
  const baselineSnapshot={sources:[{id:'source',status:'needsReview'}],packs:[{id:'pack',sourceId:'source'}],items:[item],enabledSourceIds:[] as string[]};
  const installedSnapshot=clone(baselineSnapshot);
  const r={id:'legacy',path:'asset',index:0,status:'identityCandidate',targetId:'upstream:new',evidenceId:'migration:fixture',preservation:'required',activation:'review-required',sourceFingerprint:'fixture'};
  const reconciliation={schemaVersion:'dnd-upstream-historical-reconciliation.v1',activation:'review-required',commits:{application:'a',main:'b',homebrew:'c'},summary:{issues:{}},historical:[r],
    historicalGroups:[{id:'legacy',occurrences:1,targetIds:['upstream:new'],status:'consistentIdentityCandidate',preservation:'required'}],
    runtime:[{id:'runtime',kind:'rule',status:'runtimeContractOutsideV3',evidenceId:'migration:runtime',sourceFingerprint:'fixture',preservation:'required',activation:'review-required'}],
    dependencies:[{id:'edge'}],aliases:[{id:'alias'}],categories:[{id:'category'}],legacyLinks:[{fromId:'legacy'}]};
  return {baselineSnapshot,installedSnapshot,reconciliation};
}
describe('a8.1 migration preview',()=>{
  test('keeps existing storage IDs, disabled review status and runtime contracts without writes',()=>{
    const f=fixture(),before=digest(f),p=buildMigrationPreview(f);
    expect(p.summary.issues).toEqual({});
    expect(p.storageRows[0]).toMatchObject({storageId:'pack:legacy',canonicalId:'legacy',status:'disabled',disposition:'preserveCandidatePendingParity',candidateIds:['upstream:new'],preservesReview:true,writeAuthorized:false});
    expect(p.summary).toMatchObject({writes:0,deletes:0,replacements:0,approvedMappings:0,dependencies:1,aliases:1,categories:1,legacyLinks:1,executable:false,retirementAuthorized:false});
    expect(p.runtimeRows[0].disposition).toBe('preserveRuntimeContract');
    expect(digest(f)).toBe(before);
    expect(checkPreviewBinding(p,f.installedSnapshot)).toEqual({ok:true,executable:false});
  });
  test('local manual edits and local packs never inherit bundled identity candidates',()=>{
    const f=fixture();
    f.installedSnapshot.items[0].normalizedJson.manual=false;
    f.installedSnapshot.items.push({...f.installedSnapshot.items[0],id:'custom:legacy',packId:'custom'});
    f.installedSnapshot.packs.push({id:'custom',sourceId:'source'});
    const p=buildMigrationPreview({...f,scope:'localSnapshot'});
    expect(p.storageRows.map((x:any)=>x.disposition)).toEqual(['preserveLocalModification','preserveLocalOnly']);
    expect(p.storageRows.every((x:any)=>x.candidateIds.length===0&&!x.writeAuthorized)).toBe(true);
    expect(p.summary.issues).toEqual({});
  });
  test('locally removed items are not restored; stale snapshot and tampered plan fail binding',()=>{
    const f=fixture(),p=buildMigrationPreview(f);
    f.installedSnapshot.items=[];
    expect(checkPreviewBinding(p,f.installedSnapshot).reason).toBe('snapshotChanged');
    const next=buildMigrationPreview(f);
    expect(next.missingBaseline[0].disposition).toBe('respectLocalAbsence');
    expect(next.summary.writes).toBe(0);
    expect(checkPreviewBinding({...next,executable:true},f.installedSnapshot).reason).toBe('previewFingerprintMismatch');
  });
  test('duplicate storage IDs, missing sources, inconsistent group evidence remain blocked',()=>{
    const f=fixture();f.installedSnapshot.items.push(clone(f.installedSnapshot.items[0]));f.installedSnapshot.sources=[];
    f.reconciliation.historicalGroups[0].targetIds=['wrong'];
    const p=buildMigrationPreview(f);
    expect(p.summary.issues).toMatchObject({'installed:items:duplicateId':1,'installed:missingItemSource':2,historicalGroupMismatch:1});
    expect(p.summary.blockers).toContain('integrityIssues');
    expect(p.executable).toBe(false);
  });
  test('same canonical ID in different storage rows cannot be automatically resolved',()=>{
    const f=fixture();f.installedSnapshot.items.push({...f.installedSnapshot.items[0],id:'other:legacy'});
    const p=buildMigrationPreview(f);
    expect(p.storageRows[0].disposition).toBe('preserveAmbiguousCanonicalId');
    expect(p.storageRows[1].disposition).toBe('preserveLocalOnly');
    expect(inspectSnapshot(f.installedSnapshot).canonical.get('legacy')).toHaveLength(2);
  });
});
const mainPath=process.env.DND_UPSTREAM_MIGRATION_MAIN,brewPath=process.env.DND_UPSTREAM_MIGRATION_BREW;
(mainPath&&brewPath?test:test.skip)('real bundled bootstrap in memory and immutable migration preview preserve all state',async()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const snapshot=openHistoricalSnapshot(process.cwd());
  const r=buildReconciliation(openSnapshot(mainPath),openSnapshot(brewPath),snapshot,{
    bundled:BUNDLED_COMPENDIUM_PACKS,parse:parseImportPack,detect:detectCompendiumImportVersion,
    loadRuntime:(b:RuntimeCatalogBundle)=>new CatalogLoader().initializeFromBundle(b)
  });
  const memory=createMemoryKeyValueStorage(),repository=new KeyValueCompendiumRepository(memory);
  // Use exact tracked bytes, not a mutable working tree, with real bootstrap API.
  const packs=BUNDLED_COMPENDIUM_PACKS.map(p=>({...p,load:()=>JSON.parse(snapshot.read('assets/compendium/'+p.fileName).toString('utf8'))}));
  const seeded=await initializeBundledCompendium(repository,{packs,now:'2026-01-01T00:00:00.000Z'});
  expect(seeded.ok).toBe(true);
  expect(seeded.seeded).toBe(true);
  const baseline=await repository.loadSnapshot(),installed=clone(baseline),before=digest(memory.dump());
  const p=buildMigrationPreview({reconciliation:r,baselineSnapshot:baseline,installedSnapshot:installed,scope:'bundledFixture'});
  console.log(JSON.stringify(publicSummary(p)));
  const ledger=buildInventoryDispositionLedger({reconciliation:r,baselineSnapshot:baseline,installedSnapshot:installed,scope:'bundledFixture'},p);
  console.log(JSON.stringify(inventoryLedgerSummary(ledger)));
  expect(ledger.summary).toMatchObject({installed:baseline.items.length,historical:6335,runtimeBaseline:5841,approvedMappings:0,approvedExclusions:0,writes:0,deletes:0});
  expect(ledger.readiness).toBe('blocked');
  const captureId='bundled-ledger-fixture';
  const runtime={snapshot:new CatalogLoader().initializeFromBundle(JSON.parse(snapshot.read('assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json').toString('utf8')) as RuntimeCatalogBundle),ref:{kind:'bundled'} as const};
  const portable:PortableRestoreDataCheckpoint={characterStore:{characters:[],progressionDrafts:{},progressionRecovery:emptyProgressionRecoverySummary(),compatibilityRemediationPlans:{},compatibilityRemediationRecovery:emptyCompatibilityRemediationRecoverySummary(),compatibilityRemediationQuarantine:{}},scenarios:[],buildPresets:[],buildHistorySnapshots:[],catalog:{filterState:new ContentPolicyService(runtime.snapshot).createDefaultState(),revision:0,history:[]}};
  const frame:InventoryStoreFrame={guard:[installed,runtime,portable],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},
   runtime:{status:'observed',source:'catalogStore',captureId,value:runtime},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:portable}
  }};
  const capture=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:memory},'disposableFixture');
  const observationReview=buildInventoryObservationReview({reconciliation:r,baselineSnapshot:baseline,installedSnapshot:installed,scope:'bundledFixture'},p,ledger,capture);
  console.log(JSON.stringify(observationReview));
  expect(observationReview.summary).toMatchObject({installedRows:baseline.items.length,historicalOccurrences:6335,runtimeBaseline:5841,approvedMappings:0,approvedExclusions:0});
  expect(observationReview.blockers).toContain('disposableFixtureNotInstalledEvidence');
  const input={reconciliation:r,baselineSnapshot:baseline,installedSnapshot:installed,scope:'bundledFixture'};
  const referenceInput={captureId,scope:'disposableFixture' as const,installed,runtime,portable};
  const referenceReview=reviewLocalInventoryReferences({...referenceInput,baselineRuntime:deriveRuntimeBaseline(r)},capture);
  const closure=buildInventoryClosureReview({input,preview:p,ledger,capture,observationReview,referenceInput,referenceReview,reviewReferences:reviewLocalInventoryReferences});
  console.log(JSON.stringify(closure));
  expect(closure.summary.runtimeDispositions).toEqual({exactEntry:5841});
  expect(closure).toMatchObject({criteriaAccepted:0,criteriaRequired:4,inventoryAcceptance:'notEstablished',executable:false});
  expect(p.summary.issues).toEqual({});
  expect(p.summary.storageItems).toBe(baseline.items.length);
  expect(p.summary.storageItems).toBeGreaterThan(0);
  expect(p.summary.packs).toBe(6);
  expect(p.summary.historicalOccurrences).toBe(6335);
  expect(p.summary.runtimeEntries).toBe(5841);
  expect(p.summary.dependencies).toBe(15385);
  expect(p.summary.aliases).toBe(127);
  expect(p.summary.categories).toBe(57);
  expect(p.summary.writes).toBe(0);
  expect(p.executable).toBe(false);
  expect(checkPreviewBinding(p,installed)).toEqual({ok:true,executable:false});
  expect(digest(memory.dump())).toBe(before);
  if(process.env.DND_UPSTREAM_EVIDENCE_DIR)writeFragment(process.env.DND_UPSTREAM_EVIDENCE_DIR,'migration',fromMigration(r,p,installed));
  const out=process.env.DND_UPSTREAM_MIGRATION_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(p,null,2)+'\n',{flag:'wx'});
},360000);


const {buildInventoryDispositionLedger,publicSummary:inventoryLedgerSummary}=require('../../scripts/5etools/inventory-disposition-ledger');
describe('a8.13.5 inventory disposition ledger',()=>{
 function ledgerFixture(){
  const f=fixture(),i=f.installedSnapshot.items[0];
  Object.assign(i,{type:'weapon',rawJson:{id:'legacy',kind:'weapon',source:{id:'source'},payload:{damage:'1d6'}}});
  f.baselineSnapshot=clone(f.installedSnapshot);
  Object.assign(f.reconciliation.historical[0],{kind:'weapon',sourceId:'source',sourceFingerprint:digest(i.rawJson),decision:'unreviewed'});
  Object.assign(f.reconciliation.summary,{approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false});
  return f;
 }
 test('binds exact occurrence separately from local review and never approves identity',()=>{
  const f=ledgerFixture(),p=buildMigrationPreview(f),before=digest(f),r=buildInventoryDispositionLedger(f,p);
  expect(r.storage[0]).toMatchObject({identityStatus:'singleExactRawOccurrence',manualReviewMarkers:true,baselineStatus:'unchanged',disposition:'preserveCandidatePendingParity',writeAuthorized:false});
  expect(r.historical[0]).toMatchObject({identityStatus:'singleExactRawOccurrence',exactInstalled:1,preservation:'required'});
  expect(r.summary).toMatchObject({installed:1,historical:1,runtimeBaseline:1,approvedMappings:0,approvedExclusions:0,writes:0,deletes:0});
  expect(JSON.stringify(inventoryLedgerSummary(r))).not.toMatch(/pack:legacy|upstream:new|migration:fixture/);
  expect(digest(f)).toBe(before);
 });
 test('distinguishes duplicate occurrences, modified payloads and absent baseline storage',()=>{
  const f=ledgerFixture(),h=f.reconciliation.historical[0];
  f.reconciliation.historical.push({...h,index:1,evidenceId:'migration:second'});
  Object.assign(f.reconciliation.historicalGroups[0],{occurrences:2});
  const r=buildInventoryDispositionLedger(f,buildMigrationPreview(f));
  expect(r.storage[0].identityStatus).toBe('multipleExactRawOccurrences');
  Object.assign(f.installedSnapshot.items[0].rawJson,{payload:{damage:'2d6'}});
  const changed=buildInventoryDispositionLedger(f,buildMigrationPreview(f));
  expect(changed.storage[0]).toMatchObject({identityStatus:'qualifiedIdentityPayloadDiffers',baselineStatus:'changed',disposition:'preserveLocalModification'});
  f.installedSnapshot.items=[];
  const absent=buildInventoryDispositionLedger(f,buildMigrationPreview(f));
  expect(absent.historical.every((x:any)=>x.identityStatus==='notObservedInstalled')).toBe(true);
  expect(absent.missingBaseline[0].disposition).toBe('respectLocalAbsence');
 });
 async function captureLedgerFixture(f:ReturnType<typeof ledgerFixture>,scope:'disposableFixture'|'observedLocal'='disposableFixture'){
  const captureId='ledger-join-fixture';
  const frame:InventoryStoreFrame={guard:[f.installedSnapshot],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:f.installedSnapshot as unknown as CompendiumPersistenceState}
  }};
  return captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:{getItem:()=>null}},scope);
 }
 test('binds the observed snapshot without leaking row identities or approving the inventory',async()=>{
  const f=ledgerFixture(),p=buildMigrationPreview(f),ledger=buildInventoryDispositionLedger(f,p),capture=await captureLedgerFixture(f);
  const r=buildInventoryObservationReview(f,p,ledger,capture);
  expect(r.surfaceReview.find((x:any)=>x.surface==='compendium')).toMatchObject({disposition:'snapshotFingerprintBound'});
  expect(r).toMatchObject({runtimeCountComparison:'notVerified',portableCoverage:'coveragePending',readiness:'blocked',inventoryAcceptance:'notEstablished',writeAuthorized:false});
  expect(r.summary).toMatchObject({installedRows:1,historicalOccurrences:1,approvedMappings:0,approvedExclusions:0});
  expect(JSON.stringify(r)).not.toMatch(/pack:legacy|upstream:new|migration:fixture|ledger-join-fixture/);
  expect(r.blockers).toContain('disposableFixtureNotInstalledEvidence');
 });
 test('rejects fixture promotion, stale observed data and modified evidence or ledger',async()=>{
  const f=ledgerFixture(),p=buildMigrationPreview(f),ledger=buildInventoryDispositionLedger(f,p),capture=await captureLedgerFixture(f);
  const local={...f,scope:'localSnapshot'},lp=buildMigrationPreview(local),ll=buildInventoryDispositionLedger(local,lp);
  expect(()=>buildInventoryObservationReview(local,lp,ll,capture)).toThrow('inventoryCaptureScopeMismatch');
  expect(()=>buildInventoryObservationReview(f,p,{...ledger,writeAuthorized:true},capture)).toThrow('inventoryLedgerBindingMismatch');
  expect(()=>buildInventoryObservationReview(f,p,ledger,{...capture,evidence:{...capture.evidence,inventoryAcceptance:'accepted'}})).toThrow('inventoryCaptureFingerprintMismatch');
  expect(()=>buildInventoryObservationReview(f,p,ledger,{...capture,captureStatus:'stale'})).toThrow('stableInventoryCaptureRequired');
  Object.assign(f.installedSnapshot.items[0].normalizedJson,{manual:false});
  const next=buildMigrationPreview(f),nextLedger=buildInventoryDispositionLedger(f,next);
  expect(()=>buildInventoryObservationReview(f,next,nextLedger,capture)).toThrow('installedObservationBindingMismatch');
 });
 test('keeps exclusion proposals and coherence discrepancies pending for local scope',async()=>{
  const f={...ledgerFixture(),scope:'localSnapshot'},p=buildMigrationPreview(f),base=buildInventoryDispositionLedger(f,p);
  const proposals=[{rowFingerprint:base.storage[0].rowFingerprint,reason:'sourceRightsPending'}];
  const ledger=buildInventoryDispositionLedger(f,p,proposals),capture=await captureLedgerFixture(f,'observedLocal');
  const r=buildInventoryObservationReview(f,p,ledger,{...capture,coherence:{...capture.coherence,activePersistence:'mismatch'}},proposals);
  expect(r.summary).toMatchObject({exclusionProposals:1,approvedExclusions:0});
  expect(r.blockers).toContain('observedCoherenceMismatch');
  expect(r.executable).toBe(false);
 });
 test('does not transfer identity across kind/source and blocks stale previews or exclusion proposals',()=>{
  const f=ledgerFixture(),p=buildMigrationPreview(f),r=buildInventoryDispositionLedger(f,p);
  const proposal={rowFingerprint:r.storage[0].rowFingerprint,reason:'outsideProposedScope'};
  const proposed=buildInventoryDispositionLedger(f,p,[proposal]);
  expect(proposed.exclusions[0]).toMatchObject({status:'proposedNotApproved',preservation:'required',writeAuthorized:false});
  expect(proposed.summary).toMatchObject({exclusionProposals:1,approvedExclusions:0,installed:1});
  expect(()=>buildInventoryDispositionLedger(f,p,[proposal,proposal])).toThrow('invalidExclusionProposal');
  Object.assign(f.installedSnapshot.items[0],{type:'armor'});
  expect(()=>buildInventoryDispositionLedger(f,p)).toThrow('inventoryPreviewBindingMismatch');
  const next=buildMigrationPreview(f);
  expect(buildInventoryDispositionLedger(f,next).storage[0].identityStatus).toBe('qualifiedIdentityMismatch');
  expect(()=>buildInventoryDispositionLedger(f,next,[proposal])).toThrow('invalidExclusionProposal');
 });
});
