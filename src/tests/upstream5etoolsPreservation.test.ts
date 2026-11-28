import { previewLocalV3File } from '../compendium/importV3LocalPreview';
import { verifyLocalV3Preservation, type LocalV3PreservationInput } from '../compendium/importV3LocalPreservation';
import { prepareV3PreservationCheckpoint, checkV3PreservationCheckpoint, type V3PreservationInputs } from '../compendium/importV3Preservation';
import { prepareAdditiveV3Stage } from '../compendium/importV3AdditiveStage';
import { backupToJson, createCharacterDataBackup, createCharacterBackupIntegrity, parseCharacterDataBackup, restoreCharacterDataBackup, LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION, PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION, type CharacterBackupPayload } from '../backup/characterBackup';
import { createPortableCatalogAuditSection } from '../backup/portableCatalogBackup';
import { preparePortableRestoreSession, canCommitPortableRestoreSession, type PortableRestoreDataCheckpoint } from '../backup/portableRestoreSession';
import { emptyProgressionRecoverySummary } from '../characters/progressionRecovery';
import { emptyCompatibilityRemediationRecoverySummary } from '../characters/compatibilityRemediationRecovery';
import { createDefaultCharacter } from '../data/mockData';
import { compareRotationsForScenario, createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createBuildPresetFromCharacter } from '../presets/buildPresets';
import { createBuildHistorySnapshot } from '../history/buildHistory';
import { CatalogLoader } from '../catalog/catalogLoader';
import { ContentPolicyService } from '../catalog/contentPolicyService';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import { canCommitCatalogUpdate, compareCatalogSnapshots, createCatalogUpdateSession } from '../catalog/catalogUpdateTransaction';
import type { RuntimeCatalogBundle } from '../catalog/types';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createCatalogPackageRepository } from '../storage/catalogPackageRepository';
import { COMPENDIUM_PERSISTENCE_VERSION } from '../storage/compendiumSnapshot';
const minimalBundle = (version: string, name = 'Test Feature'): RuntimeCatalogBundle => ({
  schemaVersion: 'dnd-combat-runtime-bundle.v1', catalogVersion: version, generatedAt: '2026-08-04T00:00:00.000Z',
  sourcePackage: { packageId: 'test', version, ruleset: '2024', sourceBooks: ['phb-2024'], zipSha256: 'test' },
  sourceFiles: {}, sourceChecksums: {}, manifest: { packageId: 'test', version, ruleset: '2024', sourceBooks: ['phb-2024'] },
  runtimeIndex: { lotId: 'runtime', version, entryCount: 1, entries: [{ entityId: 'feature.test', kind: 'feature', displayName: name, displayContext: [], sourceBookId: 'phb-2024', sourceFile: 'test.json', categoryIds: [], status: 'published', defaultEnabled: true, manualReviewRequired: false, dependencyCounts: { outgoing: 0, incoming: 0 }, searchKey: name.toLowerCase() }] },
  entityRegistry: { id: 'registry', kind: 'registry', generatedFromVersion: version, entries: [{ entityId: 'feature.test', kind: 'feature', sourceBookId: 'phb-2024', sourceFile: 'test.json', name, status: 'published', defaultEnabled: true, manualReviewRequired: false }] },
  dependencyGraph: { id: 'graph', kind: 'graph', generatedFromVersion: version, nodeCount: 1, edgeCount: 0, edges: [] },
  aliases: { lotId: 'aliases', entities: [] }, contentCategories: { lotId: 'categories', version, entities: [] },
  contentFilterPolicy: { id: 'policy', kind: 'policy', version, precedence: [], rules: [], profiles: [{ id: 'full-official', name: 'Full official', bookStates: { 'phb-2024': true } }], status: 'published' },
  readinessProfile: {}, integrationContract: {}, runtimeOperations: {}, runtimeErrors: {}, snapshotMigrationPolicy: {}, activationPolicy: {}, selectionContracts: {}, providerCollections: {}
});

const legacySource={id:'legacy-source',status:'active',confidence:'exact'};
const legacyPack={id:'legacy-pack',source:legacySource,items:[{id:'legacy-weapon',kind:'weapon',name:'Manual blade',source:legacySource,payload:{damageFormula:'1d8 + STR'}}]};
const source={id:'upstream:main:XPHB',status:'needsReview',confidence:'importedNeedsReview',rulesEra:'2024',contentType:'official',precedenceScope:'official-dnd',publication:{precision:'day',date:'2024-09-17',year:2024,evidence:'fixture'}};
const candidatePack={templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:fixture:pack',source,items:[{
  id:'upstream:main:condition:fixture',kind:'condition',name:'Fixture',source,identity:{canonicalKey:'condition:fixture',precedenceScope:'official-dnd'},
  precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'fixture'},
  provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit:'a'.repeat(40),blob:'b'.repeat(40),path:'data/conditionsdiseases.json',entityKey:'fixture',index:0,sourceCode:'XPHB',resolverVersion:'fixture',lineage:[]},
  payload:{conditionId:'upstream:main:condition:fixture'}
}]};
const now=()=>new Date('2026-01-01T00:00:00.000Z');
async function fixture(){
  const memory=createMemoryKeyValueStorage(),repository=new KeyValueCompendiumRepository(memory);
  const imported=await repository.saveImportJson(JSON.stringify(legacyPack));
  expect(imported.ok).toBe(true);
  const id=imported.snapshot.items[0].id;
  await repository.updateItemMapping(id,{normalizedJson:{...imported.snapshot.items[0].normalizedJson,customMapping:'keep'},status:'disabled',reviewDecision:'rejected',reviewNotes:'manual review'});
  await repository.setSourceEnabled(legacySource.id,false);
  const installed=await repository.loadSnapshot();
  const catalog=new CatalogLoader().initializeFromBundle(minimalBundle('1.0.0'));
  const filterState=new ContentPolicyService(catalog).createDefaultState();
  const context={installed,runtimeSnapshotId:catalog.snapshotId,runtimeIds:[...catalog.registry.keys()],historicalIds:['legacy-weapon']};
  const stage=prepareAdditiveV3Stage(JSON.stringify(candidatePack),context).stage!;
  const character={...createDefaultCharacter('Fixture hero'),catalogSnapshotId:catalog.snapshotId};
  const scenario=createCombatScenario({id:'scenario-fixture',characterId:character.id,name:'Fixture AC',combatState:{targetAC:15,rollMode:'normal',targetCount:1,resistanceMultiplier:1}});
  const preset=createBuildPresetFromCharacter(character,'Fixture preset');
  const comparison=compareRotationsForScenario(character.rotations,character,scenario);
  const history=createBuildHistorySnapshot({character,scenario,comparison,name:'Fixture history',kind:'manual'});
  const base=createCharacterDataBackup({characters:[character],scenarios:[scenario],buildPresets:[preset],buildHistorySnapshots:[history]});
  // Use the actual normalized backup form for the current fixture.
  const portableCheckpoint: PortableRestoreDataCheckpoint={
    characterStore:{characters:base.entities.characters,progressionDrafts:{},progressionRecovery:emptyProgressionRecoverySummary(),
      compatibilityRemediationPlans:{},compatibilityRemediationRecovery:emptyCompatibilityRemediationRecoverySummary(),compatibilityRemediationQuarantine:{}},
    scenarios:base.entities.scenarios,buildPresets:base.entities.buildPresets,buildHistorySnapshots:base.entities.buildHistorySnapshots,catalog:{filterState,revision:0,history:[]}
  };
  const audit=createPortableCatalogAuditSection({snapshot:catalog,filterState,revision:0,history:[],now});
  const backup=createCharacterDataBackup(base.entities,{catalogAudit:audit});
  const input:V3PreservationInputs={stage,context,portableCheckpoint,catalog,runtimeRef:{kind:'bundled'},compendiumExport:await repository.exportSnapshot(),characterBackup:backupToJson(backup)};
  return {input,memory,repository,id,backup};
}
describe('V3 preservation checkpoint',()=>{
  test('binds actual repository export, portable backup and runtime without writes',async()=>{
    const {input,memory}=await fixture(),before=memory.dump();
    const r=prepareV3PreservationCheckpoint(input);
    expect(r.codes).toEqual([]);
    expect(r.checkpoint).toMatchObject({activation:'review-required',executable:false,retirementAuthorized:false,counts:{storageItems:1,characters:1,scenarios:1,presets:1,history:1,runtimeEntries:1}});
    expect(r.checkpoint?.blockers).toContain('productionTransactionAndRollbackNotVerified');
    expect(checkV3PreservationCheckpoint(r.checkpoint!,input)).toEqual({ok:true,executable:false});
    expect(memory.dump()).toEqual(before);
  });
  test('refuses stale stages, changed runtime inventory, wrong compendium version and partial or corrupt backups',async()=>{
    const {input,backup}=await fixture();
    expect(prepareV3PreservationCheckpoint({...input,context:{...input.context,historicalIds:[]}}).codes).toContain('staleOrInvalidStage');
    expect(prepareV3PreservationCheckpoint({...input,catalog:new CatalogLoader().initializeFromBundle(minimalBundle('2.0.0'))}).codes).toContain('runtimeInventoryMismatch');
    expect(prepareV3PreservationCheckpoint({...input,compendiumExport:JSON.stringify({version:COMPENDIUM_PERSISTENCE_VERSION-1,state:input.context.installed})}).codes).toContain('compendiumBackupMismatch');
    const corrupt={...backup,integrity:{...backup.integrity!,checksum:'bad'}};
    expect(prepareV3PreservationCheckpoint({...input,characterBackup:backupToJson(corrupt)}).codes).toContain('characterBackupInvalid');
    const partial=createCharacterDataBackup({characters:[],scenarios:[],buildPresets:[],buildHistorySnapshots:[]},{catalogAudit:backup.catalogAudit});
    expect(prepareV3PreservationCheckpoint({...input,characterBackup:backupToJson(partial)}).codes).toContain('characterBackupCoverageMismatch');
    const wrongAudit=createCharacterDataBackup(backup.entities,{catalogAudit:{...backup.catalogAudit!,revision:10}});
    expect(prepareV3PreservationCheckpoint({...input,characterBackup:backupToJson(wrongAudit)}).codes).toContain('catalogBackupCoverageMismatch');
  });
  test('full portable checkpoint and runtime reference changes invalidate an otherwise matching manifest',async()=>{
    const {input}=await fixture(),checkpoint=prepareV3PreservationCheckpoint(input).checkpoint!;
    const changed={...input.portableCheckpoint,catalog:{...input.portableCheckpoint.catalog,savedAt:'2026-01-02T00:00:00.000Z'}};
    expect(checkV3PreservationCheckpoint(checkpoint,{...input,portableCheckpoint:changed}).ok).toBe(false);
    expect(checkV3PreservationCheckpoint(checkpoint,{...input,runtimeRef:{kind:'stored',packageId:'other'}}).ok).toBe(false);
    expect(checkV3PreservationCheckpoint({...checkpoint,fingerprint:'tampered'},input).ok).toBe(false);
  });
  test('isolated legacy repository rollback after a partial change and injected write failure restores every field',async()=>{
    const {input,memory,repository,id}=await fixture();
    const baseline=await repository.loadSnapshot(),before=memory.dump();
    await repository.updateItemReview(id,{status:'validated',reviewDecision:'approved',reviewNotes:'temporary change'});
    expect(await repository.loadSnapshot()).not.toEqual(baseline);
    const failing=new KeyValueCompendiumRepository({...memory,setItem:()=>{throw Error('injected write failure');}});
    await expect(failing.setSourceEnabled(legacySource.id,true)).rejects.toThrow('injected write failure');
    const rolled=await repository.importSnapshot(input.compendiumExport);
    expect(rolled.ok).toBe(true);
    expect(await repository.loadSnapshot()).toEqual(baseline);
    expect(memory.dump()).toEqual(before);
    expect(checkV3PreservationCheckpoint(prepareV3PreservationCheckpoint(input).checkpoint!,{...input,context:{...input.context,installed:await repository.loadSnapshot()}}).ok).toBe(true);
  });
  test('existing portable restore keeps its explicit destructive gate and legacy readers remain compatible',async()=>{
    const {input,backup}=await fixture();
    const prepared=preparePortableRestoreSession({backup,options:{mode:'replaceAll'},current:input.portableCheckpoint,now});
    expect(prepared.ok).toBe(true);
    expect(canCommitPortableRestoreSession(prepared.session!)).toBe(false);
    expect(prepared.session?.before).toEqual(input.portableCheckpoint);
    const v1: CharacterBackupPayload={...backup,schemaVersion:LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION,integrity:undefined,catalogAudit:undefined};
    const v2body: CharacterBackupPayload={...backup,schemaVersion:PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION,catalogAudit:undefined};
    const v2: CharacterBackupPayload={...v2body,integrity:createCharacterBackupIntegrity(v2body)};
    for(const old of [v1,v2]){
      const raw=backupToJson(old),parsed=parseCharacterDataBackup(raw);
      expect(parsed.ok).toBe(true);
      const restored=restoreCharacterDataBackup(backup.entities,parsed.backup!,{mode:'replaceAll'});
      expect(restored.characters).toEqual(backup.entities.characters);
      expect(restored.scenarios).toEqual(backup.entities.scenarios);
      expect(restored.buildPresets).toEqual(backup.entities.buildPresets);
      expect(restored.buildHistorySnapshots).toEqual(backup.entities.buildHistorySnapshots);
      expect(prepareV3PreservationCheckpoint({...input,characterBackup:raw}).codes).toContain('currentCharacterBackupRequired');
    }
  });
  test('catalog transaction without trust remains blocked and existing package ref rollback works in memory',async()=>{
    const {input}=await fixture(),current=input.catalog;
    const bundle=minimalBundle('1.1.0'),candidate=new CatalogLoader().initializeFromBundle(bundle),raw=JSON.stringify(bundle);
    const memory=createMemoryKeyValueStorage(),packages=createCatalogPackageRepository(memory,now);
    const descriptor=await packages.stage(raw,{id:'fixture',catalogVersion:candidate.catalogVersion,snapshotId:candidate.snapshotId,checksum:sha256Hex(raw)});
    const session=createCatalogUpdateSession({candidate:descriptor,diff:compareCatalogSnapshots(current,candidate),
      impact:{characters:[],affectedCharacterIds:[],snapshotMigrationCharacterIds:[],blockingCharacterIds:[],affectedEvidenceRecordIds:[],counts:{charactersExamined:0,charactersAffected:0,snapshotMigrations:0,blockingCharacters:0,evidenceRecordsAffected:0}},
      projectedFilterState:new ContentPolicyService(candidate).createDefaultState(),checkpoint:{runtimeRef:input.runtimeRef,catalog:input.portableCheckpoint.catalog,characters:[],evidenceRecords:[]},now});
    expect(canCommitCatalogUpdate(session).ok).toBe(false);
    // Low-level ref rollback rehearsal only, not a trusted catalog transaction.
    const index=await packages.loadIndex();
    await packages.activate({kind:'stored',packageId:descriptor.id});
    expect((await packages.loadActive()).rawText).toBe(raw);
    await packages.restoreActive(index.active,index.previous);
    expect((await packages.loadActive()).ref).toEqual(index.active);
    expect((await packages.loadIndex()).previous).toEqual(index.previous);
    expect((await packages.readPackage(descriptor.id)).rawText).toBe(raw);
  });
});

async function localFixture() {
  const {input,memory}=await fixture();
  const installed=input.context.installed;
  // Mirror the UI preview's object insertion order, then the store snapshot.
  const uiContext={installed:{items:installed.items,packs:installed.packs,sources:installed.sources,enabledSourceIds:installed.enabledSourceIds},
    catalog:input.catalog,compendiumReady:true,catalogReady:true};
  const rawText=input.stage.rawText;
  const preview=previewLocalV3File(rawText,uiContext);
  expect(preview.ok).toBe(true);
  const local: LocalV3PreservationInput={
    rawText,expectedStageFingerprint:preview.summary!.fingerprint,
    context:{...uiContext,installed:{sources:installed.sources,packs:installed.packs,items:installed.items,enabledSourceIds:installed.enabledSourceIds}},
    portableReady:true,portableCheckpoint:input.portableCheckpoint,runtimeRef:input.runtimeRef,
    compendiumExport:input.compendiumExport,characterBackup:input.characterBackup
  };
  return {local,memory};
}

describe('local preservation evidence bridge',()=>{
  test('verifies real exports against current preview across UI/store property order, without writes or exposing backup contents',async()=>{
    const {local,memory}=await localFixture(),before=memory.dump();
    const r=verifyLocalV3Preservation(local);
    expect(r).toMatchObject({ok:true,executable:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,activation:'review-required',
      checkpoint:{stageFingerprint:local.expectedStageFingerprint,counts:{storageItems:1,characters:1,scenarios:1,presets:1,history:1,runtimeEntries:1}}});
    expect(r.checkpoint?.blockers).toContain('durableFullCheckpointNotVerified');
    expect(r).not.toHaveProperty('compendiumExport');expect(r).not.toHaveProperty('characterBackup');expect(r).not.toHaveProperty('rawText');
    expect(memory.dump()).toEqual(before);
  });
  test('blocks stale preview, changed file and unready stores',async()=>{
    const {local}=await localFixture();
    expect(verifyLocalV3Preservation({...local,rawText:local.rawText+' '}).codes).toContain('staleOrInvalidStage');
    expect(verifyLocalV3Preservation({...local,expectedStageFingerprint:'wrong'}).codes).toContain('staleOrInvalidStage');
    expect(verifyLocalV3Preservation({...local,portableReady:false}).codes).toContain('portableInventoryNotReady');
    expect(verifyLocalV3Preservation({...local,context:{...local.context,compendiumReady:false}}).codes).toContain('localInventoryNotReady');
    expect(verifyLocalV3Preservation({...local,context:{...local.context,catalogReady:false}}).codes).toContain('localInventoryNotReady');
  });
  test('rejects missing, corrupt, swapped and stale backup selections',async()=>{
    const {local}=await localFixture();
    expect(verifyLocalV3Preservation({...local,characterBackup:''}).codes).toContain('backupSizeOrType');
    expect(verifyLocalV3Preservation({...local,characterBackup:'{bad'}).ok).toBe(false);
    expect(verifyLocalV3Preservation({...local,compendiumExport:local.characterBackup,characterBackup:local.compendiumExport}).ok).toBe(false);
    const stale={...local.portableCheckpoint!,characterStore:{...local.portableCheckpoint!.characterStore,
      characters:local.portableCheckpoint!.characterStore.characters.map(c=>({...c,name:'Changed after backup'}))}};
    expect(verifyLocalV3Preservation({...local,portableCheckpoint:stale}).codes).toContain('characterBackupCoverageMismatch');
  });
});

import {buildLocalInventoryEvidence,LOCAL_INVENTORY_SURFACES,type LocalInventoryInput} from '../compendium/localInventoryEvidence';
describe('a8.13.1 local inventory contract',()=>{
 async function observations(){
  const f=await fixture(),captureId='fixture-capture',input:LocalInventoryInput={captureId,scope:'disposableFixture',observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:f.input.context.installed},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:f.input.portableCheckpoint},
   runtime:{status:'observed',source:'catalogStore',captureId,value:{snapshot:f.input.catalog,ref:f.input.runtimeRef}},
   packageContents:{status:'unavailable',source:'catalogPackageRepository',captureId},
   trust:{status:'busy',source:'catalogTrustStore',captureId}
  }};
  return {f,input};
 }
 test('binds real disposable repository and portable observations, distinguishes missing and unavailable',async()=>{
  const {f,input}=await observations(),before=f.memory.dump(),r=buildLocalInventoryEvidence(input);
  expect(r.summary).toEqual({required:Object.keys(LOCAL_INVENTORY_SURFACES).length,observed:3,notInspected:15,unavailable:1,busy:1,invalid:0,stale:0});
  expect(r.surfaces.find(s=>s.surface==='compendium')).toMatchObject({status:'observed',counts:{items:1,packs:1,itemsWithReviewMarkers:1}});
  expect(r.surfaces.find(s=>s.surface==='portable')).toMatchObject({status:'observed',counts:{characters:1,scenarios:1,presets:1,buildHistory:1}});
  expect(r.surfaces.find(s=>s.surface==='runtime')).toMatchObject({status:'observed',counts:{entries:1,registry:1}});
  expect(r).toMatchObject({readiness:'blocked',inventoryAcceptance:'notEstablished',writeAuthorized:false,executable:false});
  expect(JSON.stringify(r)).not.toMatch(/Manual blade|Fixture hero|legacy-weapon|manual review|fixture-capture/);
  expect(f.memory.dump()).toEqual(before);
  expect(buildLocalInventoryEvidence(input)).toEqual(r);
 });
 test('does not treat stale observations or duplicate identities as observed',async()=>{
  const {f,input}=await observations(),captureId=input.captureId;
  input.observations.compendium={status:'observed',source:'activeCompendiumRepository',captureId,value:{...f.input.context.installed,items:[...f.input.context.installed.items,...f.input.context.installed.items]}};
  input.observations.runtime={status:'observed',source:'catalogStore',captureId:'older',value:{snapshot:f.input.catalog,ref:f.input.runtimeRef}};
  const r=buildLocalInventoryEvidence(input);
  expect(r.surfaces.find(s=>s.surface==='compendium')).toMatchObject({status:'invalid',codes:['invalidSurfaceData']});
  expect(r.surfaces.find(s=>s.surface==='runtime')).toMatchObject({status:'stale',codes:['captureBindingMismatch']});
  expect(r.summary.observed).toBe(1);
 });
 test('binds changes to recovery data and refuses non-JSON auxiliary state',async()=>{
  const {f,input}=await observations(),before=buildLocalInventoryEvidence(input),captureId=input.captureId;
  input.observations.portable={status:'observed',source:'portableDataCheckpoint',captureId,value:{...f.input.portableCheckpoint,catalog:{...f.input.portableCheckpoint.catalog,revision:1}}};
  input.observations.trust={status:'observed',source:'catalogTrustStore',captureId,value:{registry:new Map()}};
  const after=buildLocalInventoryEvidence(input);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(after.surfaces.find(s=>s.surface==='trust')?.status).toBe('invalid');
  expect(after.surfaces.find(s=>s.surface==='portable')?.counts?.catalogRevision).toBe(1);
 });
 test('even all observed surface envelopes do not establish acceptance',async()=>{
  const {input}=await observations();
  // Generic auxiliary observations are unverified JSON, not evidence of completeness.
  for(const [surface,source] of Object.entries(LOCAL_INVENTORY_SURFACES)){
   if(['compendium','portable','runtime'].includes(surface))continue;
   Object.assign(input.observations,{[surface]:{status:'observed',source,captureId:input.captureId,value:{}}});
  }
  const r=buildLocalInventoryEvidence(input);
  expect(r.summary.observed).toBe(r.summary.required);
  expect(r.inventoryAcceptance).toBe('notEstablished');
  expect(r.readiness).toBe('blocked');
 });
});

import {captureLocalInventoryEvidence,type InventoryStoreFrame} from '../compendium/localInventoryCapture';
import {COMPENDIUM_STORAGE_KEY} from '../storage/compendiumSnapshot';
import {CATALOG_PACKAGE_INDEX_KEY} from '../storage/catalogPackageRepository';
describe('a8.13.2 read-only inventory capture',()=>{
 async function captureFixture(){
  const f=await fixture(),captureId='capture-fixture';
  const frame:InventoryStoreFrame={guard:[f.input.catalog,f.input.portableCheckpoint],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:f.input.context.installed},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:f.input.portableCheckpoint},
   runtime:{status:'observed',source:'catalogStore',captureId,value:{snapshot:f.input.catalog,ref:f.input.runtimeRef}}
  }};
  return {f,frame,captureId};
 }
 test('reads raw legacy envelope twice without writes or invented default indexes',async()=>{
  const {f,frame,captureId}=await captureFixture(),before=f.memory.dump(),reads:string[]=[];
  const result=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:{getItem:key=>{reads.push(key);return f.memory.getItem(key);}}},'disposableFixture');
  expect(result.captureStatus).toBe('stableObservation');
  expect(reads.filter(k=>k===COMPENDIUM_STORAGE_KEY)).toHaveLength(2);
  expect(result.evidence.surfaces.find(s=>s.surface==='legacyCompendium')?.status).toBe('observed');
  expect(result.evidence.surfaces.find(s=>s.surface==='packageIndex')?.status).toBe('unavailable');
  expect(result.evidence.surfaces.find(s=>s.surface==='packageContents')?.status).toBe('notInspected');
  expect(result.evidence.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(result)).not.toMatch(/Manual blade|legacy-weapon|capture-fixture/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('distinguishes corruption and read failure from absent storage',async()=>{
  const {frame,captureId}=await captureFixture();
  const result=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:{getItem:key=>{
   if(key===CATALOG_PACKAGE_INDEX_KEY)return '{corrupt';
   if(key===COMPENDIUM_STORAGE_KEY)throw Error('private storage failure');
   return null;
  }}});
  expect(result.captureStatus).toBe('stableObservation');
  expect(result.evidence.surfaces.find(s=>s.surface==='packageIndex')?.status).toBe('invalid');
  expect(result.evidence.surfaces.find(s=>s.surface==='legacyCompendium')?.status).toBe('unavailable');
  expect(JSON.stringify(result)).not.toContain('private storage failure');
 });
 test('blocks busy sessions before any storage reads and expires changed stores',async()=>{
  const {frame,captureId}=await captureFixture();let reads=0,frames=0;
  const storage={getItem:()=>{reads++;return null;}};
  const blocked=await captureLocalInventoryEvidence(captureId,{readStores:()=>({...frame,blocked:true}),storage});
  expect(blocked.captureStatus).toBe('blocked');expect(reads).toBe(0);
  const stale=await captureLocalInventoryEvidence(captureId,{readStores:()=>++frames===1?frame:{...frame,guard:[{}]},storage});
  expect(stale.captureStatus).toBe('stale');expect(stale.evidence.summary.observed).toBe(0);
 });
 test('detects changes in raw storage and same-reference observation data',async()=>{
  const {f,frame,captureId}=await captureFixture();let reads=0;
  const result=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:{getItem:key=>key===COMPENDIUM_STORAGE_KEY?String(++reads):null}});
  expect(result.captureStatus).toBe('stale');
  const mutable=f.input.portableCheckpoint;let calls=0;
  const changed=await captureLocalInventoryEvidence(captureId,{readStores:()=>{if(++calls===2)mutable.catalog.revision++;return frame;},storage:{getItem:()=>null}});
  expect(changed.captureStatus).toBe('stale');
  expect(changed.evidence.summary.observed).toBe(0);
 });
});

describe('a8.13.3 package observations and local coherence',()=>{
 async function packageFixture(){
  const f=await fixture(),captureId='package-capture',packages=createCatalogPackageRepository(f.memory,now);
  const raw=JSON.stringify(minimalBundle('1.0.0')),checksum=sha256Hex(raw);
  const descriptor=await packages.stage(raw,{id:'private-package',catalogVersion:'1.0.0',snapshotId:f.input.catalog.snapshotId,checksum});
  await packages.activate({kind:'stored',packageId:descriptor.id});
  const runtime={...f.input.catalog,bundleSha256:checksum};
  const frame:InventoryStoreFrame={guard:[runtime],blocked:false,activeBackend:'legacy',observations:{
   runtime:{status:'observed',source:'catalogStore',captureId,value:{snapshot:runtime,ref:{kind:'stored',packageId:descriptor.id}}},
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:f.input.context.installed}
  }};
  return {f,frame,captureId,descriptor};
 }
 test('verifies indexed bytes and active legacy snapshot without mutating storage',async()=>{
  const {f,frame,captureId}=await packageFixture(),before=f.memory.dump();
  const r=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:f.memory});
  expect(r.captureStatus).toBe('stableObservation');
  expect(r.evidence.surfaces.find(s=>s.surface==='packageContents')?.status).toBe('observed');
  expect(r.coherence).toEqual({runtimePackage:'storedPackageMatch',activePersistence:'legacySnapshotMatch'});
  expect(r.evidence.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(r)).not.toContain('private-package');
  expect(f.memory.dump()).toEqual(before);
 });
 test('blocks corrupt chunks and does not claim coherence',async()=>{
  const {f,frame,captureId,descriptor}=await packageFixture();
  const key=CATALOG_PACKAGE_INDEX_KEY+'/package/'+descriptor.id+'/chunk/0';
  const original=f.memory.getItem(key) as string;
  f.memory.setItem(key,original.replace('Test Feature','Fake Feature'));
  const r=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:f.memory});
  expect(r.evidence.surfaces.find(s=>s.surface==='packageContents')?.status).toBe('invalid');
  expect(r.coherence).toMatchObject({runtimePackage:'notVerified',packageCode:'packageChecksumMismatch'});
 });
 test('detects package/reference mismatch and does not independently read sqlite',async()=>{
  const {f,frame,captureId}=await packageFixture();
  const runtime=frame.observations.runtime!;
  if(runtime.status!=='observed')throw Error('fixture');
  const changed:InventoryStoreFrame={...frame,activeBackend:'sqlite',observations:{...frame.observations,runtime:{...runtime,value:{...runtime.value,ref:{kind:'bundled'}}}}};
  const r=await captureLocalInventoryEvidence(captureId,{readStores:()=>changed,storage:f.memory});
  expect(r.coherence).toEqual({runtimePackage:'mismatch',activePersistence:'notVerified'});
 });
 test('expires the whole observation when package chunks change between reads',async()=>{
  const {f,frame,captureId,descriptor}=await packageFixture();let reads=0;
  const key=CATALOG_PACKAGE_INDEX_KEY+'/package/'+descriptor.id+'/chunk/0';
  const result=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:{getItem:k=>{
   const raw=f.memory.getItem(k);
   return k===key&&++reads===2&&typeof raw==='string'?raw.replace('Test Feature','Fake Feature'):raw;
  }}});
  expect(result.captureStatus).toBe('stale');
  expect(result.evidence.summary.observed).toBe(0);
 });
});

import {presentLocalInventory,compareLocalInventoryRevalidation} from '../compendium/localInventoryPanelModel';
describe('a8.13.4 inventory panel presentation and revalidation',()=>{
 async function panelFixture(){
  const f=await fixture(),captureId='panel-fixture';
  const frame:InventoryStoreFrame={guard:[f.input.catalog],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:f.input.context.installed},
   runtime:{status:'observed',source:'catalogStore',captureId,value:{snapshot:f.input.catalog,ref:f.input.runtimeRef}}
  }};
  return {f,frame,captureId,read:()=>captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:f.memory},'disposableFixture')};
 }
 test('presents every surface and explicit non-authorization without raw data',async()=>{
  const {read}=await panelFixture(),view=presentLocalInventory(await read());
  expect(view.surfaces).toHaveLength(20);
  expect(view.surfaces.find(s=>s.surface==='externalPacksAndBackups')).toMatchObject({status:'Não inspecionado'});
  expect(view).toMatchObject({runtimePackage:'Não verificado',activePersistence:'Não verificado',readiness:'Migração bloqueada',canMigrate:false});
  expect(JSON.stringify(view)).not.toMatch(/Manual blade|legacy-weapon|panel-fixture/);
 });
 test('revalidation compares the same capture and coherence without accepting the gate',async()=>{
  const {read,f,frame,captureId}=await panelFixture(),first=await read();
  expect(compareLocalInventoryRevalidation(first,await read())).toBe('unchanged');
  expect(compareLocalInventoryRevalidation(first,{...first,coherence:{...first.coherence,activePersistence:'mismatch'}})).toBe('changed');
  f.memory.setItem(COMPENDIUM_STORAGE_KEY,'{}');
  expect(compareLocalInventoryRevalidation(first,await read())).toBe('changed');
  const blocked=await captureLocalInventoryEvidence(captureId,{readStores:()=>({...frame,blocked:true}),storage:f.memory});
  expect(compareLocalInventoryRevalidation(first,blocked)).toBe('unavailable');
 });
 test('different capture identifiers cannot revalidate previous observations',async()=>{
  const {f,frame,read}=await panelFixture(),first=await read();
  const other=await captureLocalInventoryEvidence('different',{readStores:()=>frame,storage:f.memory},'disposableFixture');
  expect(compareLocalInventoryRevalidation(first,other)).toBe('changed');
 });
});

import {reviewLocalInventoryReferences} from '../compendium/localInventoryReferenceReview';
describe('a8.13.7 runtime and portable reference inventory',()=>{
 async function referenceFixture(){
  const f=await fixture(),captureId='reference-fixture',scope='disposableFixture' as const;
  const runtime={snapshot:f.input.catalog,ref:f.input.runtimeRef},portable=f.input.portableCheckpoint,installed=f.input.context.installed;
  const baselineRuntime=f.input.catalog.entries.map(e=>({id:e.entityId,kind:e.kind,sourceFingerprint:nodeDigest(e)}));
  const input={captureId,scope,runtime,portable,installed,baselineRuntime};
  const read=()=>captureLocalInventoryEvidence(captureId,{readStores:()=>({guard:[installed,runtime,portable],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},
   runtime:{status:'observed',source:'catalogStore',captureId,value:runtime},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:portable}
  }}),storage:f.memory},scope);
  return {f,input,read};
 }
 test('binds exact runtime entries and explicit portable references while all criteria remain blocked',async()=>{
  const {f,input,read}=await referenceFixture(),before=f.memory.dump(),r=reviewLocalInventoryReferences(input,await read());
  expect(r.ok).toBe(true);
  if(!r.ok)throw Error(r.code);
  expect(r.review.summary.runtimeDispositions).toEqual({exactEntry:1});
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='scenarioCharacter')).toMatchObject({total:1,statuses:{present:1}});
  expect(r.review.obligations).toHaveLength(4);
  expect(r.review.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(r)).not.toMatch(/Fixture hero|Manual blade|feature\.test|reference-fixture/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('distinguishes changed/missing runtime entries and orphan references without repairing',async()=>{
  const {input,read}=await referenceFixture();
  input.baselineRuntime[0].sourceFingerprint='a'.repeat(64);
  input.baselineRuntime.push({id:'missing-entry',kind:'feature',sourceFingerprint:'b'.repeat(64)});
  input.portable.scenarios[0].characterId='missing-character';
  const r=reviewLocalInventoryReferences(input,await read());
  if(!r.ok)throw Error(r.code);
  expect(r.review.summary.runtimeDispositions).toEqual({changedEntry:1,missingLoadedEntry:1});
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='scenarioCharacter')).toMatchObject({statuses:{missing:1}});
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='historyScenario')).toMatchObject({statuses:{ownerMismatch:1}});
  expect(input.portable.scenarios[0].characterId).toBe('missing-character');
 });
 test('rejects stale capture, duplicate baseline identities and changed core observations',async()=>{
  const {input,read}=await referenceFixture(),capture=await read();
  expect(reviewLocalInventoryReferences(input,{...capture,captureStatus:'stale'})).toMatchObject({ok:false,code:'captureBindingMismatch'});
  input.baselineRuntime.push(input.baselineRuntime[0]);
  expect(reviewLocalInventoryReferences(input,capture)).toMatchObject({ok:false,code:'invalidRuntimeBaseline'});
  input.baselineRuntime.pop();
  input.portable.catalog.revision++;
  expect(reviewLocalInventoryReferences(input,capture)).toMatchObject({ok:false,code:'coreObservationBindingMismatch'});
 });
});
const {digest:nodeDigest}=require('../../scripts/5etools/integrated-review');

const {buildMigrationPreview:closureMigrationPreview}=require('../../scripts/5etools/migration-preview');
const {buildInventoryDispositionLedger:closureLedger}=require('../../scripts/5etools/inventory-disposition-ledger');
const {buildInventoryObservationReview:closureObservation}=require('../../scripts/5etools/inventory-observation-review');
const {deriveRuntimeBaseline:closureBaseline,buildInventoryClosureReview}=require('../../scripts/5etools/inventory-closure-review');
describe('a8.13.8 inventory closure review',()=>{
 async function closureFixture(){
  const f=await fixture(),captureId='closure-fixture',scope='disposableFixture' as const,installed=f.input.context.installed;
  const runtime={snapshot:f.input.catalog,ref:f.input.runtimeRef},portable=f.input.portableCheckpoint;
  const item=installed.items[0],target=f.input.catalog.entries[0];
  const reconciliation={schemaVersion:'dnd-upstream-historical-reconciliation.v1',activation:'review-required',commits:{application:'a',main:'b',homebrew:'c'},
   summary:{issues:{},approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false},
   historical:[{id:item.importItemId,kind:item.type,sourceId:item.sourceId,path:'fixture',index:0,status:'noQualifiedNameCandidate',sourceFingerprint:nodeDigest(item.rawJson),evidenceId:'migration:historical',decision:'unreviewed',preservation:'required',activation:'review-required'}],
   historicalGroups:[{id:item.importItemId,occurrences:1,targetIds:[],status:'preserveIdentityVariants',preservation:'required'}],
   runtime:[{id:target.entityId,kind:target.kind,status:'runtimeContractOutsideV3',sourceFingerprint:nodeDigest(target),evidenceId:'migration:runtime',decision:'unreviewed',preservation:'required',activation:'review-required'}],
   dependencies:[],aliases:[],categories:[],legacyLinks:[]};
  const input={reconciliation,baselineSnapshot:installed,installedSnapshot:installed,scope:'bundledFixture'};
  const preview=closureMigrationPreview(input),ledger=closureLedger(input,preview);
  const read=(id:string)=>captureLocalInventoryEvidence(id,{readStores:()=>({guard:[installed,runtime,portable],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId:id,value:installed},
   runtime:{status:'observed',source:'catalogStore',captureId:id,value:runtime},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId:id,value:portable}
  }}),storage:f.memory},scope);
  const capture=await read(captureId),observationReview=closureObservation(input,preview,ledger,capture);
  const referenceInput={captureId,scope,installed,runtime,portable};
  const referenceReview=reviewLocalInventoryReferences({...referenceInput,baselineRuntime:closureBaseline(reconciliation)},capture);
  return {f,read,args:{input,preview,ledger,capture,observationReview,referenceInput,referenceReview,reviewReferences:reviewLocalInventoryReferences}};
 }
 test('joins the same capture and historical baseline without authorizing any criterion',async()=>{
  const {f,args}=await closureFixture(),before=f.memory.dump(),r=buildInventoryClosureReview(args);
  expect(r.summary).toMatchObject({installedRows:1,historicalOccurrences:1,runtimeBaseline:1,loadedEntries:1,runtimeDispositions:{exactEntry:1},approvedMappings:0});
  expect(r).toMatchObject({criteriaAccepted:0,criteriaRequired:4,readiness:'blocked',inventoryAcceptance:'notEstablished',writeAuthorized:false});
  expect(r.obligations.every((o:any)=>o.status==='blocked'&&o.pending.length>0)).toBe(true);
  expect(r.inventoryMilestone).toMatchObject({phase:'implementationMilestone',criteriaRequired:4,criteriaAccepted:0,inventoryAcceptance:'notEstablished',summary:{externalOwner:{binding:'notVerified',completeness:'notEstablished'}}});
  expect(r.bindings.inventoryMilestone).toBe(r.inventoryMilestone.fingerprint);
  expect(JSON.stringify(r)).not.toMatch(/Fixture hero|Manual blade|feature\.test|closure-fixture|migration:historical/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('rejects cross-capture and alternate-baseline reference reports',async()=>{
  const {args,read}=await closureFixture(),otherId='other-capture',other=await read(otherId);
  const otherInput={...args.referenceInput,captureId:otherId};
  const otherReview=reviewLocalInventoryReferences({...otherInput,baselineRuntime:closureBaseline(args.input.reconciliation)},other);
  expect(()=>buildInventoryClosureReview({...args,referenceReview:otherReview})).toThrow('closureReferenceReviewMismatch');
  const alternate=reviewLocalInventoryReferences({...args.referenceInput,baselineRuntime:[]},args.capture);
  expect(()=>buildInventoryClosureReview({...args,referenceReview:alternate})).toThrow('closureReferenceReviewMismatch');
 });
 test('rejects stale raw observations, modified observation reports and promoted reference flags',async()=>{
  const {args}=await closureFixture();
  expect(()=>buildInventoryClosureReview({...args,observationReview:{...args.observationReview,inventoryAcceptance:'accepted'}})).toThrow('closureObservationReviewMismatch');
  expect(()=>buildInventoryClosureReview({...args,referenceReview:{...args.referenceReview,writeAuthorized:true}})).toThrow('closureReferenceReviewMismatch');
  args.referenceInput.portable.catalog.revision++;
  expect(()=>buildInventoryClosureReview(args)).toThrow('closureReferenceReviewMismatch');
 });
});

import {observeOpenSQLiteCompendium,observeExistingKeyValueCompendium,compareIndependentCompendiumReads,INDEPENDENT_COMPENDIUM_SQL,type IndependentSQLiteReadPort} from '../storage/readOnlyCompendiumObservation';
describe('a8.14.1 independent read-only compendium observation',()=>{
 async function backendFixture(){
  const f=await fixture(),state=f.input.context.installed;
  const rows=[
   ...state.sources.map(s=>({lane:'source',id:s.id,json:JSON.stringify(s),enabled:state.enabledSourceIds.includes(s.id)?1:0})),
   ...state.packs.map(p=>({lane:'pack',id:p.id,json:JSON.stringify(p),source_id:p.sourceId})),
   ...state.items.map(i=>({lane:'item',id:i.id,json:JSON.stringify(i),source_id:i.sourceId,pack_id:i.packId,import_item_id:i.importItemId,type:i.type,name:i.name,status:i.status}))
  ];
  const calls:string[]=[];
  const db:IndependentSQLiteReadPort={getAllAsync:async<T>(query:string)=>{calls.push(query);return rows as unknown as T[];}};
  return {f,state,rows,db,calls};
 }
 test('reads a single SELECT across all tables and binds the full hydrated snapshot',async()=>{
  const {f,state,db,calls}=await backendFixture(),before=f.memory.dump();
  const first=await observeOpenSQLiteCompendium(db),second=await observeOpenSQLiteCompendium(db);
  expect(calls).toEqual([INDEPENDENT_COMPENDIUM_SQL,INDEPENDENT_COMPENDIUM_SQL]);
  expect(first).toMatchObject({status:'observed',backend:'sqlite',counts:{items:1,packs:1}});
  expect(compareIndependentCompendiumReads(first,second,state)).toBe('snapshotMatch');
  expect(compareIndependentCompendiumReads(first,second,{...state,enabledSourceIds:[state.sources[0].id]})).toBe('mismatch');
  expect(JSON.stringify(first)).not.toMatch(/Manual blade|legacy-weapon|manual review/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('does not open an uninitialized connection or hide corrupt rows',async()=>{
  const {rows,db}=await backendFixture();
  expect(await observeOpenSQLiteCompendium(undefined)).toMatchObject({status:'unavailable',code:'connectionNotInitialized'});
  const item=rows.find(r=>r.lane==='item')!;
  item.json='{bad';
  expect(await observeOpenSQLiteCompendium(db)).toMatchObject({status:'invalid',code:'invalidPersistedRow'});
 });
 test('rejects mirrored-column mismatch and detects changed raw reads',async()=>{
  const {rows,db,state}=await backendFixture(),first=await observeOpenSQLiteCompendium(db);
  const item=rows.find(r=>r.lane==='item')!;
  item.id='different-id';
  const second=await observeOpenSQLiteCompendium(db);
  expect(second).toMatchObject({status:'invalid',code:'rowIdentityMismatch'});
  expect(compareIndependentCompendiumReads(first,second,state)).toBe('stale');
 });
 test('strict key-value observation distinguishes absent/corrupt/current envelopes',async()=>{
  const {f,state}=await backendFixture(),before=f.memory.dump();
  const first=await observeExistingKeyValueCompendium('legacy',f.memory);
  expect(first).toMatchObject({status:'observed',backend:'legacy'});
  expect(compareIndependentCompendiumReads(first,first,state)).toBe('snapshotMatch');
  expect(await observeExistingKeyValueCompendium('web',{getItem:()=>null})).toMatchObject({status:'unavailable',code:'persistedSnapshotAbsent'});
  expect(await observeExistingKeyValueCompendium('web',{getItem:()=>'{}'})).toMatchObject({status:'invalid',code:'unsupportedPersistedEnvelope'});
  expect(f.memory.dump()).toEqual(before);
 });
});

describe('a8.14.2 independent persistence capture integration',()=>{
 async function independentFixture(){
  const f=await fixture(),captureId='independent-capture',state=f.input.context.installed;
  const legacy=await observeExistingKeyValueCompendium('legacy',f.memory);
  if(legacy.status!=='observed')throw Error('fixture');
  const independent={...legacy,backend:'sqlite' as const};
  const frame:InventoryStoreFrame={guard:[state],blocked:false,activeBackend:'sqlite',observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:state}
  }};
  return {f,frame,captureId,independent};
 }
 test('binds repeated independent reads and presents matching SQLite evidence',async()=>{
  const {f,frame,captureId,independent}=await independentFixture(),before=f.memory.dump();let reads=0;
  const ports={readStores:()=>frame,storage:f.memory,readActivePersistence:async()=>{reads++;return independent;}};
  const first=await captureLocalInventoryEvidence(captureId,ports),second=await captureLocalInventoryEvidence(captureId,ports);
  expect(reads).toBe(4);
  expect(first.coherence).toMatchObject({activePersistence:'sqliteSnapshotMatch',independentPersistence:{backend:'sqlite',status:'observed'}});
  expect(presentLocalInventory(first)).toMatchObject({activePersistence:'Snapshot SQLite correspondente',independentPersistence:{status:'Observado',counts:{items:1}}});
  expect(compareLocalInventoryRevalidation(first,second)).toBe('unchanged');
  expect(first.evidence.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(first)).not.toMatch(/Manual blade|legacy-weapon|independent-capture/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('does not fall back to legacy success when strict independent reads are invalid or unavailable',async()=>{
  const {f,frame,captureId}=await independentFixture();
  const legacyFrame={...frame,activeBackend:'legacy' as const};
  const r=await captureLocalInventoryEvidence(captureId,{readStores:()=>legacyFrame,storage:f.memory,readActivePersistence:async()=>({status:'invalid',backend:'legacy',code:'unsupportedPersistedEnvelope'})});
  expect(r.coherence).toMatchObject({activePersistence:'notVerified',independentPersistence:{status:'invalid'}});
  const web=await captureLocalInventoryEvidence(captureId,{readStores:()=>({...frame,activeBackend:'web'}),storage:f.memory,readActivePersistence:async()=>({status:'unavailable',backend:'web',code:'nonInitializingReadUnavailable'})});
  expect(web.coherence).toMatchObject({activePersistence:'notVerified',independentPersistence:{status:'unavailable',backend:'web'}});
 });
 test('distinguishes stable mismatch, raw fingerprint changes across captures and concurrent backend changes',async()=>{
  const {f,frame,captureId,independent}=await independentFixture();
  const ports={readStores:()=>frame,storage:f.memory};
  const match=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:async()=>independent});
  const mismatch=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:async()=>({...independent,snapshotFingerprint:'a'.repeat(64)})});
  expect(mismatch.coherence.activePersistence).toBe('mismatch');
  const rawChange=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:async()=>({...independent,rawFingerprint:'b'.repeat(64)})});
  expect(compareLocalInventoryRevalidation(match,rawChange)).toBe('changed');
  let reads=0;
  const stale=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:async()=>++reads===1?independent:{...independent,rawFingerprint:'b'.repeat(64)}});
  expect(stale).toMatchObject({captureStatus:'stale',coherence:{independentPersistence:{status:'stale'}}});
  expect(stale.evidence.summary.observed).toBe(0);
  const wrongBackend=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:async()=>({...independent,backend:'legacy'})});
  expect(wrongBackend.captureStatus).toBe('stale');
 });
 test('blocks reads for active operations and invalidates replaced repository guard',async()=>{
  const {f,frame,captureId,independent}=await independentFixture();let reads=0,frames=0;
  const port=async()=>{reads++;return independent;};
  const blocked=await captureLocalInventoryEvidence(captureId,{readStores:()=>({...frame,blocked:true}),storage:f.memory,readActivePersistence:port});
  expect(blocked.captureStatus).toBe('blocked');expect(reads).toBe(0);
  const stale=await captureLocalInventoryEvidence(captureId,{readStores:()=>++frames===1?frame:{...frame,guard:[{}]},storage:f.memory,readActivePersistence:port});
  expect(stale.captureStatus).toBe('stale');
 });
});

import {readExistingIndexedDbValue,type ExistingIndexedDbFactory} from '../storage/indexedDbStorageAdapter';
describe('a8.14.3 existing-only IndexedDB observation',()=>{
 const dbName='dnd-combat-math-web-storage',storeName='key-value';
 function browserFixture(value:unknown,mode:'success'|'upgrade'|'blocked'|'abort'|'missingStore'='success'){
  const calls:string[]=[];
  const request:any={onsuccess:null,onerror:null,onblocked:null,onupgradeneeded:null,transaction:{abort:()=>{calls.push('abortUpgrade');Promise.resolve().then(()=>request.onerror?.());}}};
  const get:any={result:value,onsuccess:null,onerror:null};
  const tx:any={oncomplete:null,onabort:null,onerror:null,objectStore:(name:string)=>{
   calls.push('store:'+name);
   return {get:(key:string)=>{calls.push('get:'+key);Promise.resolve().then(()=>{
    get.onsuccess?.();
    if(mode==='abort')tx.onabort?.();else tx.oncomplete?.();
   });return get;}};
  }};
  const db={version:1,objectStoreNames:{contains:(name:string)=>name===storeName&&mode!=='missingStore'},
   close:()=>calls.push('close'),transaction:(name:string,access:string)=>{calls.push('transaction:'+name+':'+access);return tx;}};
  request.result=db;
  const factory:ExistingIndexedDbFactory={databases:async()=>[{name:dbName,version:1}],open:(name,version)=>{
   calls.push('open:'+name+':'+version);
   Promise.resolve().then(()=>{
    if(mode==='upgrade')request.onupgradeneeded?.();
    else if(mode==='blocked'){request.onblocked?.();Promise.resolve().then(()=>request.onsuccess?.());}
    else request.onsuccess?.();
   });return request;
  }};
  return {factory,calls};
 }
 test('never opens an absent, mismatched or non-enumerable database',async()=>{
  const open=jest.fn();
  expect(await readExistingIndexedDbValue('key',{open})).toMatchObject({status:'unavailable',code:'indexedDbEnumerationUnavailable'});
  expect(await readExistingIndexedDbValue('key',{open,databases:async()=>[]})).toMatchObject({status:'unavailable',code:'indexedDbDatabaseAbsentOrAmbiguous'});
  expect(await readExistingIndexedDbValue('key',{open,databases:async()=>[{name:dbName,version:2}]})).toMatchObject({status:'unavailable',code:'indexedDbVersionMismatch'});
  expect(open).not.toHaveBeenCalled();
 });
 test('uses only readonly get and completes before closing; preserves missing and invalid values',async()=>{
  const {factory,calls}=browserFixture('raw');
  expect(await readExistingIndexedDbValue('key',factory)).toEqual({status:'read',value:'raw'});
  expect(calls).toEqual(['open:'+dbName+':1','transaction:'+storeName+':readonly','store:'+storeName,'get:key','close']);
  expect(await readExistingIndexedDbValue('key',browserFixture(undefined).factory)).toEqual({status:'read',value:null});
  expect(await readExistingIndexedDbValue('key',browserFixture({invalid:true}).factory)).toMatchObject({status:'invalid',code:'indexedDbValueTypeMismatch'});
 });
 test('aborts raced creation or upgrade and closes late blocked success',async()=>{
  const upgrade=browserFixture('raw','upgrade');
  expect(await readExistingIndexedDbValue('key',upgrade.factory)).toMatchObject({status:'unavailable',code:'indexedDbUpgradeAborted'});
  expect(upgrade.calls).toEqual(['open:'+dbName+':1','abortUpgrade']);
  const blocked=browserFixture('raw','blocked');
  expect(await readExistingIndexedDbValue('key',blocked.factory)).toMatchObject({status:'unavailable',code:'indexedDbOpenBlocked'});
  await Promise.resolve();
  expect(blocked.calls).toEqual(['open:'+dbName+':1','close']);
 });
 test('transaction abort and missing store cannot return a successful observation',async()=>{
  const aborted=browserFixture('raw','abort');
  expect(await readExistingIndexedDbValue('key',aborted.factory)).toMatchObject({status:'unavailable',code:'indexedDbReadFailed'});
  expect(aborted.calls.at(-1)).toBe('close');
  const absent=browserFixture('raw','missingStore');
  expect(await readExistingIndexedDbValue('key',absent.factory)).toMatchObject({status:'unavailable',code:'indexedDbSchemaMismatch'});
  expect(absent.calls).toEqual(['open:'+dbName+':1','close']);
 });
 test('feeds strict web observation into double-read capture and expires changed reads',async()=>{
  const f=await fixture(),captureId='web-inventory',state=f.input.context.installed;
  const raw=await f.memory.getItem(COMPENDIUM_STORAGE_KEY);
  const frame:InventoryStoreFrame={guard:[state],blocked:false,activeBackend:'web',observations:{compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:state}}};
  const read=async(value:unknown)=>{
   const result=await readExistingIndexedDbValue(COMPENDIUM_STORAGE_KEY,browserFixture(value).factory);
   return result.status==='read'?observeExistingKeyValueCompendium('web',{getItem:()=>result.value}):{...result,backend:'web' as const};
  };
  const ports={readStores:()=>frame,storage:f.memory};
  const match=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:()=>read(raw)});
  expect(match.coherence).toMatchObject({activePersistence:'webSnapshotMatch',independentPersistence:{status:'observed',backend:'web'}});
  let reads=0;
  const stale=await captureLocalInventoryEvidence(captureId,{...ports,readActivePersistence:()=>read(++reads===1?raw:'{}')});
  expect(stale.captureStatus).toBe('stale');
  expect(match.evidence.inventoryAcceptance).toBe('notEstablished');
 });
});

import {AUXILIARY_PERSISTENCE,readAuxiliaryPersistence,reviewAuxiliaryPersistence} from '../compendium/localInventoryAuxiliaryPersistence';
describe('a8.14.5 auxiliary persistence and rehearsal validation',()=>{
 test('compares persisted projections without exposing values and separates missing or old envelopes',async()=>{
  const memory=createMemoryKeyValueStorage(),captureId='auxiliary-fixture';
  const trust={registry:{fixture:'private-value'}},a=AUXILIARY_PERSISTENCE.trust;
  await memory.setItem(a.key,JSON.stringify({version:a.version,state:trust}));
  await memory.setItem(AUXILIARY_PERSISTENCE.updateSessions.key,JSON.stringify({version:1,state:{history:[]}}));
  const before=memory.dump();
  const report=reviewAuxiliaryPersistence(await readAuxiliaryPersistence(memory),{trust:{status:'observed',source:'catalogTrustStore',captureId,value:trust.registry}});
  expect(report.summary).toMatchObject({required:11,match:1,invalid:1,unavailable:9});
  expect(JSON.stringify(report)).not.toContain('private-value');
  expect(memory.dump()).toEqual(before);
 });
 test('redacts aggregation secret and reports only projected presence',async()=>{
  const memory=createMemoryKeyValueStorage(),def=AUXILIARY_PERSISTENCE.rolloutAggregation,captureId='secret-fixture';
  const state={contributorSecret:'private-secret',policies:{},submissions:[],reports:[],approvals:[],decisions:[],events:[]};
  await memory.setItem(def.key,JSON.stringify({version:def.version,state}));
  const {contributorSecret,...rest}=state;
  const observations={rolloutAggregation:{status:'observed' as const,source:'catalogRolloutAggregationStore' as const,captureId,value:{...rest,contributorSecretPresent:!!contributorSecret}}};
  const a=reviewAuxiliaryPersistence(await readAuxiliaryPersistence(memory),observations);
  await memory.setItem(def.key,JSON.stringify({version:def.version,state:{...state,contributorSecret:'another-secret'}}));
  const b=reviewAuxiliaryPersistence(await readAuxiliaryPersistence(memory),observations);
  expect(a.summary.match).toBe(1);expect(a.fingerprint).toBe(b.fingerprint);
  expect(JSON.stringify(a)).not.toContain('private-secret');
 });
 test('invalidates capture on changed auxiliary raw data and compares later projected differences',async()=>{
  const f=await fixture(),captureId='aux-capture',def=AUXILIARY_PERSISTENCE.trust;
  const value={registry:{test:'first'}};
  await f.memory.setItem(def.key,JSON.stringify({version:def.version,state:value}));
  const frame:InventoryStoreFrame={guard:[],blocked:false,observations:{trust:{status:'observed',source:'catalogTrustStore',captureId,value:value.registry}}};
  const ports={readStores:()=>frame,storage:f.memory,observeAuxiliaryPersistence:true};
  const first=await captureLocalInventoryEvidence(captureId,ports);
  expect(first.coherence.auxiliaryPersistence?.summary.match).toBe(1);
  await f.memory.setItem(def.key,JSON.stringify({version:def.version,state:{registry:{test:'second'}}}));
  const changed=await captureLocalInventoryEvidence(captureId,ports);
  expect(changed.coherence.auxiliaryPersistence?.summary.mismatch).toBe(1);
  expect(compareLocalInventoryRevalidation(first,changed)).toBe('changed');
  let reads=0;
  const stale=await captureLocalInventoryEvidence(captureId,{...ports,storage:{getItem:async key=>key===def.key?JSON.stringify({version:def.version,state:{registry:{n:++reads}}}):f.memory.getItem(key)}});
  expect(stale.captureStatus).toBe('stale');
 });
 test('validates exact rehearsal binding and checks but never native or inventory acceptance',()=>{
  const {validateRehearsal}=require('../../scripts/5etools/validate-persistence-rehearsal');
  const expected={gitSha:'a'.repeat(40),sourceFingerprint:'b'.repeat(64)};
  const report={schemaVersion:'dnd-independent-persistence-rehearsal.v1',scope:'disposableFixture',...expected,inventoryAcceptance:'notEstablished',writeAuthorized:false,executable:false,nativeEvidence:false,environment:'nodeSQLite',nodeVersion:'v22.16.0',engineVersion:'3.50.0',checks:['actualSQLiteMatch','noRowMutation','hydratedMismatch','uninitializedUnavailable','mirrorCorruptionRejected','changedReadStale','invalidJsonRejected'],passed:true};
  expect(validateRehearsal(report,expected)).toMatchObject({status:'consistentRehearsal',nativeEvidence:false,inventoryAcceptance:'notEstablished'});
  expect(validateRehearsal({...report,checks:report.checks.slice(1)},expected).status).toBe('invalid');
  expect(validateRehearsal({...report,nativeEvidence:true},expected).status).toBe('invalid');
  expect(validateRehearsal({...report,gitSha:'c'.repeat(40)},expected).status).toBe('invalid');
 });
});

import {PORTABLE_PERSISTENCE,readPortablePersistence,reviewPortablePersistence} from '../compendium/localInventoryPortablePersistence';
import {CATALOG_FILTER_PREFERENCES_SCHEMA} from '../storage/catalogFilterPreferences';
describe('a8.14.6 portable persistence review',()=>{
 async function portablePersistenceFixture(){
  const f=await fixture(),captureId='portable-persist-fixture',p=f.input.portableCheckpoint;
  const reconciliation={version:1,changedCharacterIds:[],repairedLinkCount:0,unresolvedLinkCount:0};
  const doc={schemaVersion:CATALOG_FILTER_PREFERENCES_SCHEMA,catalogVersion:f.input.catalog.catalogVersion,savedAt:'2026-01-01T00:00:00.000Z',filterState:p.catalog.filterState,revision:p.catalog.revision,history:p.catalog.history};
  const defs=PORTABLE_PERSISTENCE;
  const set=async(key:string,version:number,state:unknown)=>f.memory.setItem(key,JSON.stringify({version,state}));
  await set(defs.characters.key,defs.characters.version,{...p.characterStore,catalogAwareReconciliation:reconciliation});
  await set(defs.scenarios.key,defs.scenarios.version,{scenarios:p.scenarios});
  await set(defs.presets.key,defs.presets.version,{presets:p.buildPresets});
  await set(defs.history.key,defs.history.version,{snapshots:p.buildHistorySnapshots});
  await f.memory.setItem(defs.catalog.key,JSON.stringify(doc));
  const frame:InventoryStoreFrame={guard:[],blocked:false,observations:{
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:p},
   characterReconciliation:{status:'observed',source:'characterStore',captureId,value:reconciliation},
   runtime:{status:'observed',source:'catalogStore',captureId,value:{snapshot:f.input.catalog,ref:f.input.runtimeRef}}
  }};
  return {f,frame,captureId,doc,defs,set,p};
 }
 test('matches five exact projections and leaves unobserved savedAt explicit',async()=>{
  const {f,frame}=await portablePersistenceFixture(),before=f.memory.dump();
  const r=reviewPortablePersistence(await readPortablePersistence(f.memory),frame.observations);
  expect(r.summary).toEqual({required:5,match:5,mismatch:0,unavailable:0,invalid:0,notVerified:0});
  expect(r.rows.find(x=>x.lane==='catalog')).toMatchObject({timestampComparison:'notObserved'});
  expect(JSON.stringify(r)).not.toMatch(/Fixture hero|portable-persist-fixture/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('distinguishes version, catalog mismatch, absent storage and lost hydration',async()=>{
  const {f,frame,defs,set,p,doc}=await portablePersistenceFixture();
  await set(defs.characters.key,24,p.characterStore);
  await f.memory.removeItem(defs.presets.key);
  await f.memory.setItem(defs.catalog.key,JSON.stringify({...doc,catalogVersion:'other'}));
  const r=reviewPortablePersistence(await readPortablePersistence(f.memory),frame.observations);
  expect(r.summary).toMatchObject({match:2,mismatch:1,invalid:1,unavailable:1});
  const unhydrated=reviewPortablePersistence(await readPortablePersistence(f.memory),{});
  expect(unhydrated.summary.notVerified).toBe(3);
 });
 test('preserves recovery and reconciliation and detects changes between captures',async()=>{
  const {f,frame,defs,set,p,captureId}=await portablePersistenceFixture();
  const ports={readStores:()=>frame,storage:f.memory,observePortablePersistence:true};
  const a=await captureLocalInventoryEvidence(captureId,ports);
  expect(a.coherence.portablePersistence?.summary.match).toBe(5);
  await set(defs.characters.key,defs.characters.version,{...p.characterStore,catalogAwareReconciliation:{version:1,changedCharacterIds:[],repairedLinkCount:1,unresolvedLinkCount:0}});
  const b=await captureLocalInventoryEvidence(captureId,ports);
  expect(b.coherence.portablePersistence?.summary.mismatch).toBe(1);
  expect(compareLocalInventoryRevalidation(a,b)).toBe('changed');
  let reads=0;
  const stale=await captureLocalInventoryEvidence(captureId,{...ports,storage:{getItem:async key=>key===defs.history.key?JSON.stringify({version:1,state:{snapshots:[{id:String(++reads)}]}}):f.memory.getItem(key)}});
  expect(stale.captureStatus).toBe('stale');
 });
 test('rejects unknown persisted fields and duplicate identities without normalization',async()=>{
  const {f,frame,defs,set,p}=await portablePersistenceFixture();
  await set(defs.scenarios.key,defs.scenarios.version,{scenarios:[...p.scenarios,...p.scenarios]});
  await set(defs.presets.key,defs.presets.version,{presets:p.buildPresets,unknownField:true});
  const r=reviewPortablePersistence(await readPortablePersistence(f.memory),frame.observations);
  expect(r.summary.invalid).toBe(2);
 });
});

const {buildInventoryPersistenceReview}=require('../../scripts/5etools/inventory-persistence-review');
describe('a8.14.7 consolidated persistence evidence',()=>{
 async function consolidatedFixture(){
  const f=await fixture(),captureId='persistence-closure',installed=f.input.context.installed,p=f.input.portableCheckpoint;
  const registry={fixture:'private-registry'},def=AUXILIARY_PERSISTENCE.trust;
  await f.memory.setItem(def.key,JSON.stringify({version:def.version,state:{registry}}));
  await f.memory.setItem(PORTABLE_PERSISTENCE.scenarios.key,JSON.stringify({version:5,state:{scenarios:p.scenarios}}));
  const frame:InventoryStoreFrame={guard:[],blocked:false,activeBackend:'legacy',observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:p},
   trust:{status:'observed',source:'catalogTrustStore',captureId,value:registry}
  }};
  const capture=await captureLocalInventoryEvidence(captureId,{readStores:()=>frame,storage:f.memory,observeAuxiliaryPersistence:true,observePortablePersistence:true,readActivePersistence:()=>observeExistingKeyValueCompendium('legacy',f.memory)},'disposableFixture');
  return {f,installed,capture};
 }
 test('accounts for all seventeen lanes without conflating projected and verified equality',async()=>{
  const {f,installed,capture}=await consolidatedFixture(),before=f.memory.dump();
  const r=buildInventoryPersistenceReview(capture,installed);
  expect(r.summary).toMatchObject({required:17,match:3,unavailable:14,notInspected:0});
  expect(r.rows.find((x:any)=>x.lane==='activeCompendium').binding).toBe('snapshotFingerprintBound');
  expect(r.rows.find((x:any)=>x.lane==='trust').binding).toBe('projectionFingerprintBound');
  expect(r.rows.find((x:any)=>x.lane==='scenarios').binding).toBe('reportedProjectionMatch');
  expect(r.gaps).toContain('catalogSavedAtNotBound');
  expect(r.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(r)).not.toMatch(/private-registry|persistence-closure/);
  expect(f.memory.dump()).toEqual(before);
 });
 test('old captures retain all seventeen missing lanes rather than infer coverage',async()=>{
  const {capture,installed}=await consolidatedFixture();
  const r=buildInventoryPersistenceReview({...capture,coherence:{runtimePackage:'notVerified',activePersistence:'legacySnapshotMatch'}},installed);
  expect(r.summary).toMatchObject({required:17,notInspected:17,match:0});
 });
 test('rejects altered denominator, repeated lane and forged auxiliary match even with recomputed hash',async()=>{
  const {capture,installed}=await consolidatedFixture(),a=capture.coherence.auxiliaryPersistence!;
  const replace=(report:any)=>({...capture,coherence:{...capture.coherence,auxiliaryPersistence:report}});
  expect(()=>buildInventoryPersistenceReview(replace({...a,summary:{...a.summary,match:11}}),installed)).toThrow('persistenceGroupAccountingMismatch');
  const duplicate=[...a.rows];duplicate[1]=duplicate[0];
  expect(()=>buildInventoryPersistenceReview(replace({...a,rows:duplicate,fingerprint:nodeDigest(duplicate)}),installed)).toThrow('persistenceGroupRowInvalid');
  const forged=a.rows.map(r=>r.surface==='trust'?{...r,fingerprint:'a'.repeat(64)}:r);
  expect(()=>buildInventoryPersistenceReview(replace({...a,rows:forged,fingerprint:nodeDigest(forged)}),installed)).toThrow('persistenceAuxiliaryBindingMismatch');
 });
 test('rejects false active backend match and portable rows with unauthorized promotion',async()=>{
  const {capture,installed}=await consolidatedFixture(),i=capture.coherence.independentPersistence!;
  expect(()=>buildInventoryPersistenceReview({...capture,coherence:{...capture.coherence,independentPersistence:{...i,snapshotFingerprint:'b'.repeat(64)}}},installed)).toThrow('persistenceActiveBindingMismatch');
  expect(()=>buildInventoryPersistenceReview({...capture,coherence:{...capture.coherence,portablePersistence:{...capture.coherence.portablePersistence,writeAuthorized:true}}},installed)).toThrow('persistenceGroupFingerprintMismatch');
 });
});

import {collectBuildReferenceOccurrences} from '../compendium/localInventoryBuildReferences';
describe('a8.15.1 complex build reference occurrences',()=>{
 test('retains distinct choice paths, including nested invocations and repeated selections',()=>{
  const rows=collectBuildReferenceOccurrences({buildChoices:{startingClassItemId:'catalog:class',speciesChoices:[{speciesItemId:'species',featureItemId:'feature',replacementSpellItemId:'spell'}],spellAssignments:{source:'spell'},equipmentSelections:[{sourceItemId:'class',items:[{compendiumItemId:'weapon'}]}]},featChoices:[{featItemId:'feat',eldritchInvocationChoice:{invocationItemId:'inv',cantripItemIds:['spell','spell']}}]},'character');
  expect(rows.filter(r=>r.value==='spell')).toHaveLength(4);
  expect(rows.map(r=>r.path.join('.'))).toContain('featChoices.0.eldritchInvocationChoice.cantripItemIds.1');
  expect(rows.map(r=>r.path.join('.'))).toContain('buildChoices.spellAssignments.0.key');
 });
 test('preset only inspects fields actually stored, not nonexistent character choices or instance ids',()=>{
  const rows=collectBuildReferenceOccurrences({weapons:[{id:'instance',pactWeaponSourceItemId:'weapon'}],spells:[{id:'spell-instance',grantedByInvocationItemId:'inv'}],buildChoices:{startingClassItemId:'ignored'}},'preset');
  expect(rows.map(r=>r.value)).toEqual(['weapon','inv']);
 });
 test('binds qualified, ambiguous or unqualified occurrences to the same capture without repair',async()=>{
  const f=await fixture(),captureId='complex-build-fixture',scope='disposableFixture' as const,installed=f.input.context.installed,portable=f.input.portableCheckpoint;
  const runtime={snapshot:f.input.catalog,ref:f.input.runtimeRef},c=portable.characterStore.characters[0],item=installed.items[0];
  // Complete typed build-choice fixture; keep unrelated choices empty.
  c.buildChoices={speciesChoices:[],classSkillChoices:[],classToolChoices:[],expertiseSkills:[],languages:[],equipmentSelections:[],startingClassItemId:'catalog:feature.test',speciesFeatItemId:item.importItemId,spellAssignments:{'catalog:missing':'compendium:'+item.id}};
  portable.buildPresets[0].snapshot.weapons=[{id:'fixture-weapon',pactWeaponSourceItemId:'compendium:'+item.id} as any];
  const input={captureId,scope,installed,runtime,portable,baselineRuntime:runtime.snapshot.entries.map(e=>({id:e.entityId,kind:e.kind,sourceFingerprint:nodeDigest(e)}))};
  const capture=await captureLocalInventoryEvidence(captureId,{readStores:()=>({guard:[],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},
   runtime:{status:'observed',source:'catalogStore',captureId,value:runtime},
   portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:portable}
  }}),storage:f.memory},scope);
  const result=reviewLocalInventoryReferences(input,capture);
  if(!result.ok)throw Error(result.code);
  expect(result.review.summary.referenceLanes.find(l=>l.lane==='characterBuildChoice')?.statuses).toMatchObject({present:2,missing:1,unqualified:1});
  expect(result.review.summary.referenceLanes.find(l=>l.lane==='presetBuildReference')?.statuses).toMatchObject({present:1});
  expect(result.review.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(result)).not.toContain('catalog:missing');
 });
});

import {collectOwnerInstanceReferences,collectScenarioInstanceReferences,collectHistoryInstanceReferences} from '../compendium/localInventoryInstanceReferences';
describe('a8.15.2 instance and tactical reference inventory',()=>{
 test('scopes loadout and rotations to the owning character and retains ambiguous duplicate ids',()=>{
  const c=createDefaultCharacter('instance fixture');
  c.weapons=[{id:'w'},{id:'w'}] as typeof c.weapons;
  c.buildChoices={speciesChoices:[],classSkillChoices:[],classToolChoices:[],expertiseSkills:[],languages:[],spellAssignments:{},equipmentSelections:[],activeLoadout:{mainHandWeaponId:'w',offHandWeaponId:'missing',armorAccessoryIds:[]}};
  c.rotations=[{id:'r',characterId:'other',name:'test',actions:[]}];
  const rows=collectOwnerInstanceReferences(c,c.id);
  expect(rows.find(r=>r.path.join('.')==='buildChoices.activeLoadout.mainHandWeaponId')?.status).toBe('ambiguous');
  expect(rows.find(r=>r.path.join('.')==='buildChoices.activeLoadout.offHandWeaponId')?.status).toBe('missing');
  expect(rows.find(r=>r.path.join('.')==='rotations.0.characterId')?.status).toBe('ownerMismatch');
 });
 test('scopes tactical relations to scenario targets and leaves generated actions unqualified',async()=>{
  const f=await fixture(),s=f.input.portableCheckpoint.scenarios[0],c=f.input.portableCheckpoint.characterStore.characters[0];
  s.participants=[{id:'actor',kind:'character',name:'Actor',initiative:1,hasActed:false,reactionAvailable:true,movementSpentFeet:0}];
  s.activeParticipantId='actor';
  s.readyActions=[{id:'ready',participantId:'actor',actionId:'generated',actionName:'Ready',trigger:'fixture',targetId:'missing',createdRound:1}];
  s.pendingReaction={id:'reaction',kind:'ready',reactorParticipantId:'actor',readyActionId:'ready',trigger:'fixture',createdRound:1};
  const rows=collectScenarioInstanceReferences(s,[c]);
  expect(rows.find(r=>r.path.join('.')==='activeParticipantId')?.status).toBe('present');
  expect(rows.find(r=>r.path.join('.')==='readyActions.0.targetId')?.status).toBe('missing');
  expect(rows.find(r=>r.path.join('.')==='readyActions.0.actionId')?.status).toBe('unqualified');
  expect(rows.find(r=>r.path.join('.')==='pendingReaction.readyActionId')?.status).toBe('present');
 });
 test('validates historical winners against archived rows, not live rotation identity',async()=>{
  const f=await fixture(),h=f.input.portableCheckpoint.buildHistorySnapshots[0];
  h.winners.bestByAverageRotationId=h.rows[0]?.rotationId??'missing';
  h.winners.bestByGuaranteedRotationId='missing-history';
  const rows=collectHistoryInstanceReferences(h);
  expect(rows.find(r=>r.path.join('.')==='winners.bestByGuaranteedRotationId')?.status).toBe('missing');
  if(h.rows.length)expect(rows.find(r=>r.path.join('.')==='winners.bestByAverageRotationId')?.status).toBe('present');
 });
 test('joins instance and tactical lanes to capture without exposing identifiers',async()=>{
  const f=await fixture(),captureId='instance-lanes',scope='disposableFixture' as const,installed=f.input.context.installed,portable=f.input.portableCheckpoint,runtime={snapshot:f.input.catalog,ref:f.input.runtimeRef};
  const c=portable.characterStore.characters[0],s=portable.scenarios[0];
  c.buildChoices={speciesChoices:[],classSkillChoices:[],classToolChoices:[],expertiseSkills:[],languages:[],spellAssignments:{},equipmentSelections:[],activeLoadout:{mainHandWeaponId:'private-missing-weapon',armorAccessoryIds:[]}};
  s.activeParticipantId='private-missing-participant';
  const input={captureId,scope,installed,portable,runtime,baselineRuntime:runtime.snapshot.entries.map(e=>({id:e.entityId,kind:e.kind,sourceFingerprint:nodeDigest(e)}))};
  const capture=await captureLocalInventoryEvidence(captureId,{readStores:()=>({guard:[],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},runtime:{status:'observed',source:'catalogStore',captureId,value:runtime},portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:portable}
  }}),storage:f.memory},scope);
  const r=reviewLocalInventoryReferences(input,capture);
  if(!r.ok)throw Error(r.code);
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='characterInstance')?.statuses.missing).toBeGreaterThan(0);
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='scenarioTactical')?.statuses.missing).toBeGreaterThan(0);
  expect(r.review.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(r)).not.toMatch(/private-missing/);
 });
});

import {createProgressionDraft} from '../characters/progressionTransaction';
import {collectRecoveryAndTransactionReferences} from '../compendium/localInventoryRecoveryReferences';
describe('a8.15.3 recovery and transaction reference inventory',()=>{
 const context={snapshotId:'catalog-current',choiceStatus:(v:unknown)=>typeof v==='string'&&v==='catalog:known'?'present' as const:'missing' as const,linkStatus:()=> 'unqualified' as const,entityExists:()=>false,bookExists:()=>false,categoryExists:()=>false};
 function inspect(checkpoint:PortableRestoreDataCheckpoint['characterStore']){
  const rows:Array<{lane:string;path:string;status:string}>=[];
  collectRecoveryAndTransactionReferences(checkpoint,context,(lane,path,_value,status)=>rows.push({lane,path:path.join('.'),status}));
  return rows;
 }
 test('inspects both draft snapshots, key ownership and fingerprint conflict without modifying draft',async()=>{
  const f=await fixture(),p=f.input.portableCheckpoint.characterStore,c=p.characters[0];
  const d=createProgressionDraft({character:c,targetCatalogSnapshotId:'catalog-current'});
  d.workingCharacter.buildChoices={speciesChoices:[],classSkillChoices:[],classToolChoices:[],expertiseSkills:[],languages:[],equipmentSelections:[],spellAssignments:{},startingClassItemId:'catalog:known'};
  p.progressionDrafts[c.id]=d;
  const before=JSON.stringify(p),rows=inspect(p);
  expect(rows.find(r=>r.path.endsWith('.baseSnapshotFingerprint'))?.status).toBe('present');
  expect(rows.find(r=>r.path.endsWith('.workingCharacter.buildChoices.startingClassItemId'))?.status).toBe('present');
  expect(JSON.stringify(p)).toBe(before);
  c.level++;
  expect(inspect(p).find(r=>r.path.endsWith('.baseFingerprint'))?.status).toBe('ownerMismatch');
 });
 test('keeps historical absences unqualified while detecting a transaction owned by another character',async()=>{
  const f=await fixture(),p=f.input.portableCheckpoint.characterStore,c=p.characters[0];
  c.resourceTransactions=[{id:'tx',characterId:'other',resourceId:'removed-resource',resourceName:'Old',amount:1,before:2,after:1,reason:'fixture',createdAt:'2026-01-01'}];
  const rows=inspect(p);
  expect(rows.find(r=>r.path.endsWith('.resourceTransactions.0.characterId'))?.status).toBe('ownerMismatch');
  expect(rows.find(r=>r.path.endsWith('.resourceTransactions.0.resourceId'))?.status).toBe('unqualified');
 });
 test('preserves opaque quarantine and explicit recovery index, even for orphaned plans',async()=>{
  const f=await fixture(),p=f.input.portableCheckpoint.characterStore;
  p.compatibilityRemediationQuarantine.q={id:'q',quarantinedAt:'2026-01-01',reason:'invalid',characterId:'orphan',rawPlan:{arbitrary:'private-payload'}};
  p.compatibilityRemediationRecovery.quarantinedPlanIds=['q','missing'];
  const rows=inspect(p);
  expect(rows.filter(r=>r.lane==='remediationQuarantine').map(r=>r.status)).toEqual(['present','unqualified','unqualified']);
  expect(rows.filter(r=>r.path.startsWith('quarantinedPlanIds')).map(r=>r.status)).toEqual(['present','missing']);
  expect(JSON.stringify(rows)).not.toContain('private-payload');
 });
 test('binds recovery lanes to exact capture and never exposes raw quarantine or authorizes migration',async()=>{
  const f=await fixture(),captureId='recovery-lanes',scope='disposableFixture' as const,installed=f.input.context.installed,portable=f.input.portableCheckpoint,runtime={snapshot:f.input.catalog,ref:f.input.runtimeRef};
  const c=portable.characterStore.characters[0];
  portable.characterStore.progressionDrafts[c.id]=createProgressionDraft({character:c});
  portable.characterStore.compatibilityRemediationQuarantine.q={id:'q',quarantinedAt:'2026-01-01',reason:'invalid',rawPlan:{private:'opaque-secret-fixture'}};
  const input={captureId,scope,installed,portable,runtime,baselineRuntime:runtime.snapshot.entries.map(e=>({id:e.entityId,kind:e.kind,sourceFingerprint:nodeDigest(e)}))};
  const capture=await captureLocalInventoryEvidence(captureId,{readStores:()=>({guard:[],blocked:false,observations:{
   compendium:{status:'observed',source:'activeCompendiumRepository',captureId,value:installed},runtime:{status:'observed',source:'catalogStore',captureId,value:runtime},portable:{status:'observed',source:'portableDataCheckpoint',captureId,value:portable}
  }}),storage:f.memory},scope);
  const r=reviewLocalInventoryReferences(input,capture);
  if(!r.ok)throw Error(r.code);
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='progressionDraft')?.total).toBeGreaterThan(0);
  expect(r.review.summary.referenceLanes.find(l=>l.lane==='remediationQuarantine')?.statuses.unqualified).toBe(1);
  expect(r.review.inventoryAcceptance).toBe('notEstablished');
  expect(JSON.stringify(r)).not.toContain('opaque-secret-fixture');
  portable.characterStore.compatibilityRemediationQuarantine.q.rawPlan={private:'changed'};
  expect(reviewLocalInventoryReferences(input,capture)).toMatchObject({ok:false,code:'coreObservationBindingMismatch'});
 });
});

import {collectConfigurationHistoryReferences} from '../compendium/localInventoryConfigurationReferences';
import {createCatalogConfigurationHistoryEntry} from '../catalog/catalogConfigurationHistory';
const {reviewRuntimeGraph,compareOccurrences}=require('../../scripts/5etools/inventory-runtime-graph-review');
describe('a8.15.4 runtime graph and configuration inventory',()=>{
 test('counts duplicate baseline alias occurrences without silently collapsing them',()=>{
  const a={id:'alias',from:'a',to:'b'},b={id:'alias',from:'a',to:'c'};
  const result=compareOccurrences([{id:a.id,fingerprint:nodeDigest(a)},{id:b.id,fingerprint:nodeDigest(b)}],[a]);
  expect(result).toMatchObject({baseline:2,loaded:1,statuses:{exact:1,missing:1}});
 });
 test('compares registry fingerprints and detects missing baseline dependency, alias and membership',async()=>{
  const f=await fixture(),s=f.input.catalog,e=s.entries[0],r=s.registry.get(e.entityId)!;
  const graph=reviewRuntimeGraph({runtime:[{id:e.entityId,registryFingerprint:nodeDigest(r)}],dependencies:[{id:'edge',fingerprint:'a'.repeat(64)}],aliases:[{id:'alias',fingerprint:'b'.repeat(64)}],categories:[{id:'category',memberIds:[e.entityId],fingerprint:'c'.repeat(64)}]},s);
  expect(graph.registry.statuses.exact).toBe(1);
  expect(graph.dependencies.statuses.missing).toBe(1);
  expect(graph.aliases.statuses.missing).toBe(1);
  expect(graph.memberships).toMatchObject({baseline:1,loaded:0,missing:1});
  expect(graph.indexAgreement).toBe(true);
  expect(graph.writeAuthorized).toBe(false);
 });
 test('keeps older registry baselines explicitly not verified',async()=>{
  const f=await fixture(),s=f.input.catalog;
  const graph=reviewRuntimeGraph({runtime:s.entries.map(e=>({id:e.entityId})),dependencies:[],aliases:[],categories:[]},s);
  expect(graph.registry.coverage).toBe('partialBaseline');
  expect(graph.registry.statuses.notVerified).toBe(s.entries.length);
 });
 test('retains historical config references and distinguishes current snapshot missing IDs',async()=>{
  const f=await fixture(),s=f.input.catalog,p=f.input.portableCheckpoint,filter=p.catalog.filterState;
  const before={...filter,entityStates:{...filter.entityStates}},after={...filter,entityStates:{...filter.entityStates,'missing-config-entity':'disabled' as const}};
  const entry=createCatalogConfigurationHistoryEntry({revision:1,committedAt:'2026-01-01T00:00:00Z',label:'fixture',origin:'entity',catalogVersion:s.catalogVersion,catalogSnapshotId:s.snapshotId,beforeState:before,afterState:after,impact:new ContentPolicyService(s).previewImpact(before,after)});
  p.catalog.revision=1;p.catalog.history=[entry,{...entry,id:'old-commit',catalogSnapshotId:'old-snapshot'}];
  const rows:Array<{path:string;status:string}>=[];
  collectConfigurationHistoryReferences(p.catalog,s,new Set(),(_lane,path,_value,status)=>rows.push({path:path.join('.'),status}));
  expect(rows.find(r=>r.path==='history.0.afterState.entityStates.missing-config-entity')?.status).toBe('missing');
  expect(rows.find(r=>r.path==='history.1.afterState.entityStates.missing-config-entity')?.status).toBe('unqualified');
 });
});

const {reviewOwnerInventory}=require('../../scripts/5etools/inventory-milestone-review');
describe('a8.15.5 owner inventory declaration and milestone',()=>{
 const make=(scope:'disposableFixture'|'observedLocal'='disposableFixture')=>{
  const captureFingerprint=nodeDigest({captureId:'owner-fixture'}),file={sha256:'a'.repeat(64),byteLength:10,format:'v3'};
  const manifest={schemaVersion:'dnd-owner-inventory-declaration.v1',scope,captureFingerprint,areas:[
   {area:'externalPacks',status:'declared',files:[file,file]},
   {area:'characterBackups',status:'notInspected',files:[]},
   {area:'catalogBackups',status:'unavailable',files:[]},
   {area:'historicalArtifacts',status:'declared',files:[]}
  ]};
  const capture={evidence:{scope,captureFingerprint,surfaces:[{surface:'externalPacksAndBackups',status:'observed',fingerprint:nodeDigest(manifest)}]}};
  return {capture,manifest};
 };
 test('never treats absent declaration as complete even if a surface is observed',()=>{
  const {capture}=make(),r=reviewOwnerInventory(capture,undefined);
  expect(r).toMatchObject({binding:'notVerified',declaredOccurrences:0,completeness:'notEstablished'});
  expect(r.areas).toHaveLength(4);
 });
 test('binds declaration and counts repeated byte hashes without deduplicating occurrences',()=>{
  const {capture,manifest}=make(),r=reviewOwnerInventory(capture,manifest);
  expect(r).toMatchObject({binding:'declarationFingerprintBound',declaredOccurrences:2,distinctContent:1,duplicateContentOccurrences:1,completeness:'notEstablished'});
  expect(JSON.stringify(r)).not.toContain('a'.repeat(64));
 });
 test('rejects cross-scope, stale and malformed declarations even with recomputed fingerprint',()=>{
  const {capture,manifest}=make();
  expect(()=>reviewOwnerInventory(capture,{...manifest,scope:'observedLocal'})).toThrow('ownerInventoryContextMismatch');
  expect(()=>reviewOwnerInventory(capture,{...manifest,areas:[]})).toThrow('ownerInventoryBindingMismatch');
  manifest.areas[1].files.push(manifest.areas[0].files[0]);
  capture.evidence.surfaces[0].fingerprint=nodeDigest(manifest);
  expect(()=>reviewOwnerInventory(capture,manifest)).toThrow('ownerInventoryUnavailableFiles');
 });
});

describe('a8.19.1 in-memory durable checkpoint candidate',()=>{
 const {captureV3DurableCheckpoint,verifyV3CheckpointPayload}=require('../compendium/v3DurableCheckpoint') as typeof import('../compendium/v3DurableCheckpoint');
 const {observeExistingKeyValueCompendium}=require('../storage/readOnlyCompendiumObservation') as typeof import('../storage/readOnlyCompendiumObservation');
 async function checkpointFixture(){
  const {input,memory}=await fixture();
  const bundled=JSON.stringify(minimalBundle('1.0.0'));
  const guard=[input],readFrame=()=>({guard,blocked:false,backend:'legacy' as const,preservation:input,observations:{}});
  const ports={readFrame,storage:{getItem:memory.getItem,getAllKeys:()=>Object.keys(memory.dump())},observeActiveCompendium:()=>observeExistingKeyValueCompendium('legacy',memory),readBundledRuntimeText:async()=>bundled};
  return {input,memory,ports};
 }
 test('retains exact local bytes and explicit absences without writes or approval',async()=>{
  const {memory,ports}=await checkpointFixture();
  memory.setItem('@dnd-combat-math/catalog-download-cache/v1/session/fixture/chunk/0','private cached text');
  memory.setItem('dnd-combat-math-future-store','{"value":"private"}');
  memory.setItem('unrelated-app','not in scope');
  const before=memory.dump(),r=await captureV3DurableCheckpoint(ports);
  expect(r.ok).toBe(true);if(!r.ok)throw Error(r.code);
  expect(r.manifest).toMatchObject({packageStatus:'bundledAssetSupplied',writeAuthorized:false,executable:false});
  expect(r.payload.keyValues).toContainEqual({key:'dnd-combat-math-future-store',raw:'{"value":"private"}'});
  expect(r.payload.keyValues.some(x=>x.raw===null)).toBe(true);
  expect(r.payload.keyValues.some(x=>x.key==='unrelated-app')).toBe(false);
  expect(JSON.stringify(r.manifest)).not.toContain('private cached text');
  expect(verifyV3CheckpointPayload(r.manifest,r.payload)).toBe(true);
  expect(verifyV3CheckpointPayload(r.manifest,{...r.payload,bundledRuntimeText:r.payload.bundledRuntimeText+' '})).toBe(false);
  expect(verifyV3CheckpointPayload(r.manifest,{...r.payload,keyValues:r.payload.keyValues.slice(1)})).toBe(false);
  expect(memory.dump()).toEqual(before);
 });
 test('rejects runtime content that differs from the loaded graph and stale raw reads',async()=>{
  const {memory,ports}=await checkpointFixture();
  const wrong=await captureV3DurableCheckpoint({...ports,readBundledRuntimeText:async()=>JSON.stringify(minimalBundle('1.0.0','Different'))});
  expect(wrong).toMatchObject({ok:false,executable:false});
  let reads=0;
  const stale=await captureV3DurableCheckpoint({...ports,readBundledRuntimeText:async()=>{
   if(++reads===1)memory.setItem('dnd-combat-math-future-store','changed');
   return ports.readBundledRuntimeText();
  }});
  expect(stale).toMatchObject({ok:false,code:'checkpointCaptureStale'});
 });
 test('retains indexed package bytes and rejects corrupted chunks',async()=>{
  const {memory,ports}=await checkpointFixture();
  const raw=JSON.stringify(minimalBundle('2.0.0'));
  const snapshot=await new CatalogLoader().initializeFromText(raw);
  await createCatalogPackageRepository(memory,now).stage(raw,{id:'fixture-package',catalogVersion:snapshot.catalogVersion,snapshotId:snapshot.snapshotId,checksum:sha256Hex(raw)});
  const key='@dnd-combat-math/catalog-packages/v1/package/fixture-package/chunk/0';
  const r=await captureV3DurableCheckpoint(ports);
  expect(r.ok).toBe(true);if(!r.ok)throw Error(r.code);
  expect(r.payload.keyValues).toContainEqual({key,raw});
  memory.setItem(key,raw+' ');
  expect(await captureV3DurableCheckpoint(ports)).toMatchObject({ok:false,code:'indexedRuntimePackageInvalid'});
 });
 test('rejects an active backend that is not independently verified',async()=>{
  const {ports}=await checkpointFixture();
  const r=await captureV3DurableCheckpoint({...ports,observeActiveCompendium:async()=>({status:'unavailable',backend:'legacy',code:'fixture'})});
  expect(r).toMatchObject({ok:false,code:'activeCompendiumNotVerified'});
 });
});

describe('a8.19.2 private archive and isolated restore rehearsal',()=>{
 const {captureV3DurableCheckpoint}=require('../compendium/v3DurableCheckpoint') as typeof import('../compendium/v3DurableCheckpoint');
 const {writeV3CheckpointArchive,readV3CheckpointArchive,rehearseV3CheckpointRestore}=require('../compendium/v3CheckpointArchive') as typeof import('../compendium/v3CheckpointArchive');
 const {observeExistingKeyValueCompendium}=require('../storage/readOnlyCompendiumObservation') as typeof import('../storage/readOnlyCompendiumObservation');
 async function captured(){
  const {input,memory}=await fixture(),guard=[input];
  memory.setItem('dnd-combat-math-unknown-recovery','{"private":"keep"}');
  const r=await captureV3DurableCheckpoint({readFrame:()=>({guard,blocked:false,backend:'legacy',preservation:input,observations:{}}),storage:{getItem:memory.getItem,getAllKeys:()=>Object.keys(memory.dump())},observeActiveCompendium:()=>observeExistingKeyValueCompendium('legacy',memory),readBundledRuntimeText:async()=>JSON.stringify(minimalBundle('1.0.0'))});
  if(!r.ok)throw Error(r.code);return {r,memory};
 }
 (process.platform==='win32'?test.skip:test)('syncs private file, reopens with fresh adapter and rehearses all captured logical lanes',async()=>{
  const {r,memory}=await captured(),before=memory.dump();
  const fs:typeof import('node:fs/promises')=require('node:fs/promises');
  const os:typeof import('node:os')=require('node:os');
  const path:typeof import('node:path')=require('node:path');
  const {createPrivateCheckpointFilePort}=require('../../scripts/5etools/private-checkpoint-file-port');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dnd-checkpoint-'));
  try{
   const first=await createPrivateCheckpointFilePort(dir),written=await writeV3CheckpointArchive(first,r.manifest,r.payload);
   if(!written.ok)throw Error(written.code);
   const second=await createPrivateCheckpointFilePort(dir),id=written.receipt.archiveId;
   expect(await readV3CheckpointArchive(second,id)).toMatchObject({manifest:r.manifest,payload:r.payload});
   expect(await rehearseV3CheckpointRestore(second,id)).toMatchObject({ok:true,report:{scope:'disposableMemoryOnly',counts:{compendiumItems:1,characters:1,runtimeEntries:1},writeAuthorized:false}});
   expect(await writeV3CheckpointArchive(second,r.manifest,r.payload)).toMatchObject({ok:false,code:'checkpointArchiveWriteFailed'});
   expect((await fs.readdir(dir))).toEqual([id+'.json']);
   expect((await fs.stat(path.join(dir,id+'.json'))).mode&0o077).toBe(0);
   await fs.appendFile(path.join(dir,id+'.json'),' ');
   expect(await readV3CheckpointArchive(second,id)).toBeNull();
   expect(await rehearseV3CheckpointRestore(second,id)).toMatchObject({ok:false,code:'checkpointArchiveInvalid'});
   expect(memory.dump()).toEqual(before);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });
 test('rejects tampering, write failure and corrupt readback before issuing receipt',async()=>{
  const {r}=await captured();
  const port={createExclusive:async()=>{},read:async()=>null};
  expect(await writeV3CheckpointArchive(port,{...r.manifest,fingerprint:'wrong'},r.payload)).toMatchObject({ok:false,code:'checkpointPayloadInvalid'});
  expect(await writeV3CheckpointArchive(port,r.manifest,r.payload)).toMatchObject({ok:false,code:'checkpointArchiveReadbackMismatch'});
  expect(await writeV3CheckpointArchive({...port,createExclusive:async()=>{throw Error('injected');}},r.manifest,r.payload)).toMatchObject({ok:false,code:'checkpointArchiveWriteFailed'});
  expect(await readV3CheckpointArchive(port,'../invalid')).toBeNull();
 });
});

describe('a8.20.1 isolated additive migration plan',()=>{
 const {captureV3DurableCheckpoint}=require('../compendium/v3DurableCheckpoint') as typeof import('../compendium/v3DurableCheckpoint');
 const {writeV3CheckpointArchive}=require('../compendium/v3CheckpointArchive') as typeof import('../compendium/v3CheckpointArchive');
 const {prepareV3MigrationPlan,revalidateV3MigrationPlan,inspectV3MigrationCandidate,V3_CANDIDATE_NAMESPACE}=require('../compendium/v3MigrationPlan') as typeof import('../compendium/v3MigrationPlan');
 const {observeExistingKeyValueCompendium}=require('../storage/readOnlyCompendiumObservation') as typeof import('../storage/readOnlyCompendiumObservation');
 async function setup(){
  const {input,memory}=await fixture(),guard=[input];
  const ports={readFrame:()=>({guard,blocked:false,backend:'legacy' as const,preservation:input,observations:{}}),storage:{getItem:memory.getItem,getAllKeys:()=>Object.keys(memory.dump())},observeActiveCompendium:()=>observeExistingKeyValueCompendium('legacy',memory),readBundledRuntimeText:async()=>JSON.stringify(minimalBundle('1.0.0'))};
  const captured=await captureV3DurableCheckpoint(ports);if(!captured.ok)throw Error(captured.code);
  const archives=new Map<string,string>(),archivePort={createExclusive:async(id:string,raw:string)=>{if(archives.has(id))throw Error('exists');archives.set(id,raw);},read:async(id:string)=>archives.get(id)??null};
  const written=await writeV3CheckpointArchive(archivePort,captured.manifest,captured.payload);if(!written.ok)throw Error(written.code);
  const id=written.receipt.archiveId;
  const prepared=await prepareV3MigrationPlan(ports,archivePort,id);if(!prepared.ok)throw Error(prepared.code);
  return {input,memory,ports,archivePort,id,plan:prepared.plan};
 }
 test('binds archive and fresh capture deterministically without active writes or V2 projection',async()=>{
  const {input,memory,ports,archivePort,id,plan}=await setup(),before=memory.dump();
  expect(plan).toMatchObject({scope:'isolatedCandidateOnly',writeAuthorized:false,executable:false,counts:{candidateItems:1,preservedStorageItems:1,preservedRuntimeEntries:1,plannedCandidateWrites:3,activeWrites:0,deletes:0,replacements:0}});
  expect(plan.operations.map(x=>x.role)).toEqual(['rawPack','reviewIndex','completionMarker']);
  expect(plan.operations.every(x=>x.key.startsWith(V3_CANDIDATE_NAMESPACE))).toBe(true);
  expect(plan.operations[0].value).toBe(input.stage.rawText);
  expect(await prepareV3MigrationPlan(ports,archivePort,id)).toMatchObject({ok:true,plan});
  expect(await revalidateV3MigrationPlan(plan,ports,archivePort)).toEqual({ok:true,executable:false});
  expect(memory.dump()).toEqual(before);
 });
 test('classifies empty, exact interrupted prefix, complete and conflicting candidates without mutation',async()=>{
  const {plan}=await setup(),candidate=createMemoryKeyValueStorage();
  expect(await inspectV3MigrationCandidate(plan,candidate)).toMatchObject({state:'empty',matchingRecords:0});
  const [raw,index,marker]=plan.operations;
  candidate.setItem(raw.key,raw.value);
  expect(await inspectV3MigrationCandidate(plan,candidate)).toMatchObject({state:'matchingPrefix',matchingRecords:1});
  candidate.setItem(marker.key,marker.value);
  expect(await inspectV3MigrationCandidate(plan,candidate)).toMatchObject({state:'conflict'});
  candidate.setItem(index.key,index.value);
  const before=candidate.dump();
  expect(await inspectV3MigrationCandidate(plan,candidate)).toMatchObject({state:'complete',matchingRecords:3});
  expect(candidate.dump()).toEqual(before);
  candidate.setItem(raw.key,raw.value+' ');
  expect(await inspectV3MigrationCandidate(plan,candidate)).toMatchObject({state:'conflict'});
 });

 const {executeV3IsolatedMigration,inspectV3IsolatedExecution}=require('../compendium/v3IsolatedMigrationExecutor') as typeof import('../compendium/v3IsolatedMigrationExecutor');
 const requestFor=(plan:{fingerprint:string})=>({scope:'disposableCandidateOnly' as const,planFingerprint:plan.fingerprint,acknowledgement:'preserveActiveState' as const});
 test('journals all operations and retries idempotently without active writes',async()=>{
  const {plan,ports,archivePort,memory}=await setup(),before=memory.dump(),rows=new Map<string,string>();
  const candidate={read:async(key:string)=>rows.get(key)??null,createExclusive:async(key:string,value:string)=>{if(rows.has(key))throw Error('exists');rows.set(key,value);}};
  const r=await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,candidate);
  expect(r).toMatchObject({ok:true,createdRecords:11,receipt:{verifiedRecords:11,artifactRecords:3,journalRecords:8,activeWrites:0,writeAuthorized:false}});
  expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,candidate)).toMatchObject({ok:true,createdRecords:0});
  expect(memory.dump()).toEqual(before);
 });
 test('recovers failures before or after each exclusive write with a reopened adapter',async()=>{
  const {plan,ports,archivePort,memory}=await setup(),before=memory.dump();
  for(const phase of ['before','after']){
   for(let fault=1;fault<=11;fault++){
    const rows=new Map<string,string>();let calls=0;
    const read=async(key:string)=>rows.get(key)??null;
    const create=async(key:string,value:string)=>{if(rows.has(key))throw Error('exists');rows.set(key,value);};
    const interrupted={read,createExclusive:async(key:string,value:string)=>{
     const hit=++calls===fault;if(hit&&phase==='before')throw Error('injected');
     await create(key,value);if(hit&&phase==='after')throw Error('injected');
    }};
    expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,interrupted)).toMatchObject({ok:false,code:'isolatedExecutionInterrupted'});
    const reopened={read,createExclusive:create};
    expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,reopened)).toMatchObject({ok:true,receipt:{verifiedRecords:11,activeWrites:0}});
    expect(rows.size).toBe(11);
   }
  }
  expect(memory.dump()).toEqual(before);
 },60000);
 test('refuses unjournaled artifacts, stale active state and wrong acknowledgement',async()=>{
  const {plan,ports,archivePort,memory}=await setup(),rows=new Map<string,string>();
  const candidate={read:async(key:string)=>rows.get(key)??null,createExclusive:async(key:string,value:string)=>{if(rows.has(key))throw Error('exists');rows.set(key,value);}};
  expect(await executeV3IsolatedMigration(plan,{...requestFor(plan),planFingerprint:'wrong'},ports,archivePort,candidate)).toMatchObject({ok:false,code:'isolatedExecutionRequestInvalid'});
  rows.set(plan.operations[0].key,plan.operations[0].value);
  expect(await inspectV3IsolatedExecution(plan,candidate)).toMatchObject({state:'conflict'});
  expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,candidate)).toMatchObject({ok:false,code:'isolatedExecutionJournalConflict'});
  rows.clear();memory.setItem('dnd-combat-math-new-recovery','changed');
  expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,candidate)).toMatchObject({ok:false,code:'isolatedExecutionCheckpointStale'});
  expect(rows.size).toBe(0);
 });
 (process.platform==='win32'?test.skip:test)('reopens actual isolated POSIX candidate files with no overwrite',async()=>{
  const {plan,ports,archivePort}=await setup();
  const fs:typeof import('node:fs/promises')=require('node:fs/promises');
  const os:typeof import('node:os')=require('node:os');
  const path:typeof import('node:path')=require('node:path');
  const {createPrivateCandidateFilePort}=require('../../scripts/5etools/private-candidate-file-port');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dnd-candidate-'));
  try{
   const candidate=await createPrivateCandidateFilePort(dir);
   expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,candidate)).toMatchObject({ok:true,createdRecords:11});
   const reopened=await createPrivateCandidateFilePort(dir);
   expect(await executeV3IsolatedMigration(plan,requestFor(plan),ports,archivePort,reopened)).toMatchObject({ok:true,createdRecords:0});
   await expect(reopened.createExclusive(plan.operations[0].key,'changed')).rejects.toThrow();
   expect(await reopened.read(plan.operations[0].key)).toBe(plan.operations[0].value);
   expect((await fs.readdir(dir)).length).toBe(11);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 },30000);
 test('blocks stale active data, tampered plan and missing archive',async()=>{
  const {memory,ports,archivePort,id,plan}=await setup();
  const altered={...plan,operations:plan.operations.map((o,i)=>i===0?{...o,key:'dnd-combat-math-compendium'}:o)};
  expect(await inspectV3MigrationCandidate(altered,memory)).toMatchObject({state:'invalidPlan'});
  expect(await revalidateV3MigrationPlan(altered,ports,archivePort)).toMatchObject({ok:false});
  memory.setItem('dnd-combat-math-new-recovery','changed');
  expect(await prepareV3MigrationPlan(ports,archivePort,id)).toMatchObject({ok:false,code:'migrationCheckpointStale'});
  expect(await prepareV3MigrationPlan(ports,archivePort,'a'.repeat(64))).toMatchObject({ok:false,code:'migrationCheckpointArchiveInvalid'});
 });
});
