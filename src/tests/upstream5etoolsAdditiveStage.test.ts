import { prepareAdditiveV3Stage, checkAdditiveV3Stage, type AdditiveV3StageContext } from '../compendium/importV3AdditiveStage';
import { emptyCompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { KeyValueCompendiumRepository } from '../storage/compendiumRepository';
import { createMemoryKeyValueStorage } from '../storage/keyValueStorage';
import { initializeBundledCompendium } from '../storage/bundledCompendiumBootstrap';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { CatalogLoader } from '../catalog/catalogLoader';
import type { RuntimeCatalogBundle } from '../catalog/types';
const {buildPilot}=require('../../scripts/5etools/condition-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {openHistoricalSnapshot,runtimePath}=require('../../scripts/5etools/historical-baseline');
const source={id:'upstream:main:XPHB',status:'needsReview',confidence:'importedNeedsReview',rulesEra:'2024',contentType:'official',precedenceScope:'official-dnd',publication:{precision:'day',date:'2024-09-17',year:2024,evidence:'fixture'}};
const item=(id='upstream:main:condition:fixture')=>({id,kind:'condition',name:'Fixture',source:{...source},identity:{canonicalKey:'condition:fixture',precedenceScope:'official-dnd'},precedence:{relation:'unresolved',supersedes:[],reprints:[],coexistsWith:[],basis:'fixture'},provenance:{origin:'5etools',repository:'5etools-mirror-3/5etools-src',commit:'a'.repeat(40),blob:'b'.repeat(40),path:'data/conditionsdiseases.json',entityKey:'fixture',index:0,sourceCode:'XPHB',resolverVersion:'fixture',lineage:[]},payload:{conditionId:id}});
const pack=(items:unknown[]=[item()])=>({templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:main:XPHB:conditions',source:{...source},items});
const context=():AdditiveV3StageContext=>({installed:emptyCompendiumPersistenceState(),runtimeSnapshotId:'fixture-runtime',runtimeIds:['legacy-runtime'],historicalIds:['legacy-historical']});
describe('additive V3 staging boundary',()=>{
  test('retains exact input, validation warnings and no executable projection or writes',()=>{
    const c=context(),before=JSON.stringify(c),raw=JSON.stringify(pack(),null,2)+'\n';
    const r=prepareAdditiveV3Stage(raw,c);
    expect(r.ok).toBe(true);
    expect(r.stage).toMatchObject({rawText:raw,activation:'review-required',writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,itemIds:[item().id],upstreamCommit:'a'.repeat(40)});
    expect(r.codes).toContain('V3_UNRESOLVED_PRECEDENCE');
    expect(r).not.toHaveProperty('projection');
    expect(r.stage).not.toHaveProperty('projection');
    expect(JSON.stringify(c)).toBe(before);
    expect(checkAdditiveV3Stage(r.stage!,c)).toEqual({ok:true,executable:false});
  });
  test('rejects historical format, empty pack, duplicate IDs and active inputs',()=>{
    expect(prepareAdditiveV3Stage(JSON.stringify({...pack(),contractRevision:undefined}),context()).ok).toBe(false);
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([])),context()).codes).toContain('emptyCandidatePack');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([item(),item()])),context()).ok).toBe(false);
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([{...item(),source:{...source,status:'active'}}])),context()).codes).toContain('itemOutsideMainReviewScope');
  });
  test('rejects reserved historical/runtime IDs, sources and pack identities',()=>{
    const c=context();
    expect(prepareAdditiveV3Stage(JSON.stringify(pack()),{...c,historicalIds:[item().id]}).codes).toContain('itemIdentityCollision');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack()),{...c,runtimeIds:[pack().id]}).codes).toContain('packIdentityCollision');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack()),{...c,runtimeIds:[source.id]}).codes).toContain('sourceIdentityCollision');
  });
  test('blocks homebrew, manual origins, mixed snapshots and source spoofing',()=>{
    const a=item(),b=item('upstream:main:condition:other');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([{...a,provenance:{origin:'manual',reference:'fixture'}}])),context()).codes).toContain('itemOutsideMainReviewScope');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([{...a,provenance:{...a.provenance,origin:'homebrew'}}])),context()).codes).toContain('itemOutsideMainReviewScope');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([{...a,provenance:{...a.provenance,sourceCode:'PHB'}}])),context()).codes).toContain('itemOutsideMainReviewScope');
    expect(prepareAdditiveV3Stage(JSON.stringify(pack([a,{...b,provenance:{...b.provenance,commit:'c'.repeat(40)}}])),context()).codes).toContain('mixedOrMissingUpstreamCommit');
  });
  test('binding rejects changed context, altered stage and invalid inventory',()=>{
    const c=context(),stage=prepareAdditiveV3Stage(JSON.stringify(pack()),c).stage!;
    expect(checkAdditiveV3Stage(stage,{...c,runtimeSnapshotId:'changed'}).ok).toBe(false);
    expect(checkAdditiveV3Stage({...stage,rawText:stage.rawText+' '},c).ok).toBe(false);
    expect(checkAdditiveV3Stage({...stage,fingerprint:'wrong'},c).ok).toBe(false);
    expect(prepareAdditiveV3Stage(stage.rawText,{...c,historicalIds:['duplicate','duplicate']}).codes).toContain('invalidInventory');
    expect(prepareAdditiveV3Stage(stage.rawText,{...c,installed:{...c.installed,enabledSourceIds:['unknown']}}).codes).toContain('invalidInstalledSnapshot');
  });
});
const snapshotPath=process.env.DND_UPSTREAM_ADDITIVE_MAIN;
(snapshotPath?test:test.skip)('real condition packs stage beside immutable installed bootstrap and runtime IDs',async()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const app=openHistoricalSnapshot(process.cwd());
  const memory=createMemoryKeyValueStorage(),repository=new KeyValueCompendiumRepository(memory);
  const packs=BUNDLED_COMPENDIUM_PACKS.map(p=>({...p,load:()=>JSON.parse(app.read('assets/compendium/'+p.fileName).toString('utf8'))}));
  expect((await initializeBundledCompendium(repository,{packs,now:'2026-01-01T00:00:00.000Z'})).ok).toBe(true);
  const installed=await repository.loadSnapshot(),before=JSON.stringify(memory.dump());
  const runtime=new CatalogLoader().initializeFromBundle(JSON.parse(app.read(runtimePath).toString('utf8')) as RuntimeCatalogBundle);
  const c: AdditiveV3StageContext={installed,runtimeSnapshotId:runtime.snapshotId,runtimeIds:[...runtime.registry.keys()],historicalIds:[...new Set(installed.items.map(i=>i.importItemId))]};
  const pilot=buildPilot(openSnapshot(snapshotPath));
  let staged=0;
  for(const p of pilot.packs){
    const r=prepareAdditiveV3Stage(JSON.stringify(p),c);
    expect(r.ok).toBe(true);
    expect(r.stage?.writeAuthorized).toBe(false);
    expect(checkAdditiveV3Stage(r.stage!,c)).toEqual({ok:true,executable:false});
    staged+=r.stage!.itemIds.length;
  }
  expect(staged).toBe(30);
  expect(JSON.stringify(memory.dump())).toBe(before);
  console.log(JSON.stringify({schemaVersion:'dnd-additive-v3-stage-audit.v1',commit:pilot.commit,staged,installed:installed.items.length,runtime:c.runtimeIds.length,scope:'bundledFixture',writes:0,activation:'review-required'}));
},120000);
