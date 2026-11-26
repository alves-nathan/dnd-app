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
  const out=process.env.DND_UPSTREAM_MIGRATION_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(p,null,2)+'\n',{flag:'wx'});
},360000);
