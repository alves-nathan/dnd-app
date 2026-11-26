import { isV3StagingJson, detectCompendiumImportVersion } from '../compendium/importVersion';
import { parseLocalCompendiumFileContent } from '../compendium/fileImport';
import { previewLocalV3File, type LocalV3PreviewContext } from '../compendium/importV3LocalPreview';
import { validateCompendiumJson } from '../compendium/importer';
import { parseImportPack } from '../compendium/parseImportPack';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { emptyCompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { CatalogLoader } from '../catalog/catalogLoader';
import type { RuntimeCatalogBundle } from '../catalog/types';
const source={id:'upstream:main:XPHB',status:'needsReview',confidence:'importedNeedsReview',rulesEra:'2024',contentType:'official',precedenceScope:'official-dnd',publication:{precision:'day',date:'2024-09-17',year:2024,evidence:'fixture'}};
const item={id:'upstream:main:condition:fixture',kind:'condition',name:'Fixture',source,identity:{canonicalKey:'condition:fixture',precedenceScope:'official-dnd'},precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'fixture'},provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit:'a'.repeat(40),blob:'b'.repeat(40),path:'data/conditionsdiseases.json',entityKey:'fixture',index:0,sourceCode:'XPHB',resolverVersion:'fixture',lineage:[]},payload:{conditionId:'upstream:main:condition:fixture'}};
const pack={templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:XPHB:conditions',source,items:[item]};
const raw=JSON.stringify(pack);
const options={source:{id:'fixture',book:'Fixture'}};
const bundle=(id='legacy-feature'):RuntimeCatalogBundle=>({
  schemaVersion:'dnd-combat-runtime-bundle.v1',catalogVersion:'1.0.0',generatedAt:'2026-01-01T00:00:00.000Z',
  sourcePackage:{packageId:'test',version:'1.0.0',ruleset:'2024',sourceBooks:['phb-2024'],zipSha256:'test'},
  sourceFiles:{},sourceChecksums:{},manifest:{packageId:'test',version:'1.0.0',ruleset:'2024',sourceBooks:['phb-2024']},
  runtimeIndex:{lotId:'runtime',version:'1.0.0',entryCount:1,entries:[{entityId:id,kind:'feature',displayName:'Fixture',displayContext:[],sourceBookId:'phb-2024',sourceFile:'test.json',categoryIds:[],status:'published',defaultEnabled:true,manualReviewRequired:false,dependencyCounts:{outgoing:0,incoming:0},searchKey:'fixture'}]},
  entityRegistry:{id:'registry',kind:'registry',generatedFromVersion:'1.0.0',entries:[{entityId:id,kind:'feature',sourceBookId:'phb-2024',sourceFile:'test.json',name:'Fixture',status:'published',defaultEnabled:true,manualReviewRequired:false}]},
  dependencyGraph:{id:'graph',kind:'graph',generatedFromVersion:'1.0.0',nodeCount:1,edgeCount:0,edges:[]},
  aliases:{lotId:'aliases',entities:[]},contentCategories:{lotId:'categories',version:'1.0.0',entities:[]},
  contentFilterPolicy:{id:'policy',kind:'policy',version:'1.0.0',precedence:[],rules:[],profiles:[{id:'full-official',name:'Full official',bookStates:{'phb-2024':true}}],status:'published'},
  readinessProfile:{},integrationContract:{},runtimeOperations:{},runtimeErrors:{},snapshotMigrationPolicy:{},activationPolicy:{},selectionContracts:{},providerCollections:{}
});
const context=():LocalV3PreviewContext=>({installed:emptyCompendiumPersistenceState(),catalog:new CatalogLoader().initializeFromBundle(bundle()),compendiumReady:true,catalogReady:true});

describe('local V3 preview and persistence isolation',()=>{
  test('detects canonical and historical V3 without declaring persistence support',()=>{
    for(const value of [pack,{...pack,contractRevision:undefined},{...pack,templateVersion:'dnd-combat-import.v2'}]){
      expect(isV3StagingJson(JSON.stringify(value))).toBe(true);
      expect(detectCompendiumImportVersion(value)).toBe('unknown');
      expect(parseImportPack(value).issues[0]?.code).toBe('IMPORT_V3_STAGING_ONLY');
      expect(validateCompendiumJson(JSON.stringify(value)).issues[0]?.code).toBe('IMPORT_V3_STAGING_ONLY');
    }
    expect(isV3StagingJson('{invalid')).toBe(false);
    expect(isV3StagingJson(JSON.stringify({templateVersion:'dnd-combat-import.v2'}))).toBe(false);
  });
  test('file parser never converts a V3 envelope to a text draft regardless of extension or forced kind',()=>{
    for(const forceKind of ['auto','json','markdown','text','unknown'] as const){
      const r=parseLocalCompendiumFileContent({name:'mislabelled.txt',mimeType:'text/plain'},raw,{...options,forceKind});
      expect(r).toMatchObject({ok:false,kind:'json',generatedJson:'',detectedItemCount:0});
      expect(r.issues[0].code).toBe('IMPORT_V3_STAGING_ONLY');
      expect(r.semiStructuredDraft).toBeUndefined();
      expect(r.preview.data).toBeUndefined();
    }
  });
  test('returns only aggregate preview and never grants authorization',()=>{
    const c=context(),before=JSON.stringify(c.installed);
    const r=previewLocalV3File(raw,c);
    expect(r).toMatchObject({ok:true,activation:'review-required',writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,inventoryScope:'observedInstalledAndRuntimeOnly',summary:{packId:pack.id,items:1,sources:1,upstreamCommit:'a'.repeat(40)}});
    expect(r.codes).toContain('V3_UNRESOLVED_PRECEDENCE');
    expect(r).not.toHaveProperty('stage');expect(r).not.toHaveProperty('rawText');expect(r).not.toHaveProperty('projection');
    expect(JSON.stringify(c.installed)).toBe(before);
    expect(previewLocalV3File(raw,c).summary?.fingerprint).toBe(r.summary?.fingerprint);
  });
  test('blocks unavailable inventory, historical V3 and runtime collisions',()=>{
    const c=context();
    expect(previewLocalV3File(raw,{...c,compendiumReady:false}).codes).toContain('localInventoryNotReady');
    expect(previewLocalV3File(raw,{...c,catalogReady:false}).codes).toContain('localInventoryNotReady');
    expect(previewLocalV3File(JSON.stringify({...pack,contractRevision:undefined}),c).ok).toBe(false);
    expect(previewLocalV3File(raw,{...c,catalog:new CatalogLoader().initializeFromBundle(bundle(item.id))}).codes).toContain('itemIdentityCollision');
  });
  test('both legacy and V2 repository paths reject V3 without touching an existing pack',async()=>{
    const storage=createMemoryKeyValueStorage(),repository=new KeyValueCompendiumRepository(storage);
    const legacy={id:'existing',source:{id:'legacy',status:'active',confidence:'exact'},items:[{id:'legacy-weapon',kind:'weapon',name:'Fixture weapon',source:{id:'legacy',status:'active',confidence:'exact'},payload:{damageFormula:'1d6'}}]};
    expect((await repository.saveImportJson(JSON.stringify(legacy))).ok).toBe(true);
    const before=storage.dump();
    for(const value of [pack,{...pack,contractRevision:undefined},{...pack,templateVersion:'dnd-combat-import.v1'}]){
      const text=JSON.stringify(value);
      expect((await repository.saveImportJson(text)).ok).toBe(false);
      expect((await repository.saveImportV2Json(text)).ok).toBe(false);
      expect(storage.dump()).toEqual(before);
    }
  });
});
