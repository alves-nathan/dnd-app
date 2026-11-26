import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { parseImportPack } from '../compendium/parseImportPack';
import { detectCompendiumImportVersion } from '../compendium/importVersion';
import { CatalogLoader } from '../catalog/catalogLoader';
import type { RuntimeCatalogBundle } from '../catalog/types';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {openHistoricalSnapshot,artifact,envelopeVersion,inspectPacks,inspectRuntime,publicationBaseline,buildHistoricalBaseline,publicSummary}=require('../../scripts/5etools/historical-baseline');
const source={id:'phb',status:'needsReview',confidence:'importedNeedsReview',rulesEra:'2024'};
const item=(id:string,value:number)=>({id,kind:'equipment',name:'Fixture',source,payload:{weight:value}});
const pack=(version:string,items:unknown[])=>({id:'fixture',templateVersion:version,source,items});
function fixture(){
  const a='assets/compendium/fixture.json',b='artifacts/compendium/fixture-v1.json',c='artifacts/compendium/fixture-copy.json';
  const files:Record<string,Buffer>={[a]:Buffer.from(JSON.stringify(pack('dnd-combat-import.v2',[item('a',1)]))),[b]:Buffer.from(JSON.stringify(pack('dnd-combat-import.v1',[item('a',2),item('b',1)])))};
  files[c]=files[a];
  files[a+'.sha256']=Buffer.from(createHash('sha256').update(files[a]).digest('hex')+'  fixture.json');
  const snapshot={commit:'a'.repeat(40),files:new Map(Object.keys(files).map(p=>[p,'b'.repeat(40)])),read:(p:string)=>files[p]};
  const bundled=[{id:'fixture',fileName:'fixture.json',sourceId:'phb',importFormat:'v2'}];
  return {snapshot,files,bundled,a,b,c};
}
describe('a7.1 historical baseline',()=>{
  test('distinguishes versions, duplicate files, repeated IDs and variants without merging',()=>{
    const f=fixture(),r=inspectPacks(f.snapshot,{bundled:f.bundled,parse:parseImportPack,detect:detectCompendiumImportVersion});
    expect(r.summary.files).toBe(3);
    expect(r.summary.bootstrap.count).toBe(1);
    expect(r.summary.overlap).toMatchObject({historicalOccurrences:4,uniqueHistoricalIds:2,duplicateOccurrences:2,multiPayloadIds:1,historicalIdsOutsideBootstrap:1});
    expect(r.summary.byteIdenticalCopies).toBe(1);
    expect(r.summary.versions).toMatchObject({'dnd-combat-import.v1':1,'dnd-combat-import.v2':2});
    expect(r.summary.issues).toEqual({});
    expect(r.rows.every((x:any)=>x.migrationState==='preservePending')).toBe(true);
    expect(r.files.find((x:any)=>x.path===f.a).checksum).toBe('verified');
  });
  test('checksum mismatch, missing bootstrap and unversioned/unsupported input are explicit',()=>{
    const f=fixture();
    f.files[f.a+'.sha256']=Buffer.from('0'.repeat(64));
    expect(artifact(f.snapshot,f.a).checksum).toBe('mismatch');
    const r=inspectPacks(f.snapshot,{bundled:[...f.bundled,{id:'missing',fileName:'missing.json',sourceId:'phb',importFormat:'v2'}],parse:parseImportPack,detect:detectCompendiumImportVersion});
    expect(r.summary.issues).toMatchObject({historicalChecksumMismatch:1,missingBootstrapFile:1});
    expect(envelopeVersion({id:'fixture',source,items:[]})).toBe('legacy-unversioned');
    expect(envelopeVersion({id:'fixture',source,items:[],templateVersion:null})).toBe('legacy-unversioned');
    expect(envelopeVersion(pack('dnd-combat-import.v3',[]))).toBe('dnd-combat-import.v3');
    expect(envelopeVersion({summary:{}})).toBeNull();
  });
  test('source candidates are not entity equivalence and runtime ids are not bootstrap ids',()=>{
    const f=fixture(),historical=inspectPacks(f.snapshot,{bundled:f.bundled,parse:parseImportPack,detect:detectCompendiumImportVersion});
    const runtime={entries:[{id:'different',kind:'equipment',book:'phb-2024'},{id:'local',kind:'feature',book:null}]};
    const inventory={sources:[{origin:'main',code:'XPHB'}]};
    const upstream=[{id:'upstream:main:fixture',kind:'equipment',provenance:{sourceCode:'XPHB'}}];
    const r=publicationBaseline({historical,runtime,inventory,records:[],items:upstream});
    expect(r.summary.sourceStatus.runtime).toMatchObject({mainPublicationCandidate:1,sourceMappingPending:1});
    expect(r.summary.bootstrapRuntimeExactIdOverlap).toBe(0);
    expect(r.summary.bootstrapUpstreamExactIdOverlap).toBe(0);
    expect(r.summary.equivalenceEstablished).toBe(0);
    expect(r.summary.retirementAuthorized).toBe(false);
    expect(r.sources.every((x:any)=>x.migrationState==='preservePending')).toBe(true);
  });
  test('normalization changes retain raw fingerprints and never collapse ambiguous repeated IDs',()=>{
    const f=fixture();
    f.files[f.b]=Buffer.from(JSON.stringify(pack('dnd-combat-import.v1',[item('a',2),item('a',3),item('b',1)])));
    const r=inspectPacks(f.snapshot,{bundled:f.bundled,parse:parseImportPack,detect:detectCompendiumImportVersion});
    const duplicate=r.rows.filter((x:any)=>x.path===f.b&&x.id==='a');
    expect(duplicate).toHaveLength(2);
    expect(duplicate.every((x:any)=>x.normalizationState==='ambiguousIdentity')).toBe(true);
    expect(duplicate[0].payloadHash).not.toBe(duplicate[1].payloadHash);
    const unique=r.rows.find((x:any)=>x.path===f.a&&x.id==='a');
    expect(unique.normalizedPayloadHash).toBe(unique.payloadHash);
    expect(r.summary.normalizationChanges.ambiguousIdentity).toBe(2);
  });
  test('canonical V3 historical input is not silently treated as the active V2 reader',()=>{
    const f=fixture(),p='artifacts/compendium/fixture-v3.json';
    f.files[p]=Buffer.from(JSON.stringify(pack('dnd-combat-import.v3',[item('a',1)])));
    f.snapshot.files.set(p,'b'.repeat(40));
    const r=inspectPacks(f.snapshot,{bundled:f.bundled,parse:parseImportPack,detect:detectCompendiumImportVersion});
    expect(r.files.find((x:any)=>x.path===p)).toMatchObject({version:'dnd-combat-import.v3',detected:'unknown',parserValid:false,migrationState:'preservePending'});
    expect(r.summary.issues).toEqual({});
  });
});
const mainPath=process.env.DND_UPSTREAM_HISTORY_MAIN,brewPath=process.env.DND_UPSTREAM_HISTORY_BREW;
(mainPath&&brewPath?test:test.skip)('real immutable historical packs and runtime baseline reconcile without retirement',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildHistoricalBaseline(openSnapshot(mainPath),openSnapshot(brewPath),openHistoricalSnapshot(process.cwd()),{
    bundled:BUNDLED_COMPENDIUM_PACKS,parse:parseImportPack,detect:detectCompendiumImportVersion,
    loadRuntime:(b:RuntimeCatalogBundle)=>new CatalogLoader().initializeFromBundle(b)
  });
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.issues).toEqual({});
  expect(r.summary.historical.bootstrapPacks).toBe(BUNDLED_COMPENDIUM_PACKS.length);
  expect(r.summary.historical.bootstrap.count).toBe(1997);
  expect(r.summary.historical.overlap.historicalIdsOutsideBootstrap).toBeGreaterThan(0);
  expect(r.summary.runtime.entries).toBe(5841);
  expect(r.summary.runtime.dependencies).toBe(15385);
  expect(r.summary.runtime.aliases).toBe(127);
  expect(r.summary.runtime.categories).toBe(57);
  expect(r.summary.comparison.upstreamItems).toBeGreaterThan(0);
  expect(r.summary.comparison.identityMappingsApproved).toBe(0);
  expect(r.summary.retirementAuthorized).toBe(false);
  const out=process.env.DND_UPSTREAM_HISTORY_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},360000);
