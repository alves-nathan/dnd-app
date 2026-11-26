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
