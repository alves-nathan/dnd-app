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
