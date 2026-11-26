const {fromCoverage,writeFragment}=require('../../scripts/5etools/cutover-evidence');
import {stageImportV3} from '../compendium/importV3Staging';
import {COMPENDIUM_ENTITY_KINDS} from '../compendium/importDomain';
import * as fs from 'node:fs';
import * as path from 'node:path';
const {buildBaseline,reconcileCoverage,publicSummary,runtimeProfile,readRuntimeProfile}=require('../../scripts/5etools/coverage-baseline');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const row=(kind:string,index:number,entity:Record<string,unknown>,file='data/conditionsdiseases.json',origin='main')=>({origin,kind,index,path:file,blob:'b'.repeat(40),entity});
const mainSha='a'.repeat(40),brewSha='c'.repeat(40);
function output(r:ReturnType<typeof row>,id:string,sourceCode:string,kind='condition'){
  return {id,kind,source:{status:'needsReview'},provenance:{origin:'5etools',commit:mainSha,path:r.path,index:r.index,blob:r.blob,entityKey:JSON.stringify([r.kind,'fixture',sourceCode]),sourceCode},metadata:{reviewCodes:['fixtureReviewPending']}};
}
function profile(){
  return runtimeProfile({schemaVersion:'dnd-combat-runtime-bundle.v1',catalogVersion:'fixture',runtimeIndex:{entryCount:2,entries:[
    {entityId:'r1',kind:'condition',sourceBookId:'phb-2024',defaultEnabled:true,manualReviewRequired:false},
    {entityId:'r2',kind:'condition',sourceBookId:'unmapped',defaultEnabled:false,manualReviewRequired:true}]}},'fixture-digest');
}
function scenario(){
  const c=row('condition',0,{name:'Fixture',source:'XPHB'}),blocked=row('condition',1,{name:'Blocked',source:'XPHB'}),
    outside=row('status',0,{name:'Status',source:'XPHB'}),bad=row('condition',2,{source:'XPHB'}),
    brew=row('condition',0,{name:'Brew',source:'SECRET_BREW'},'brew.json','homebrew'),
    template=row('magicvariant',0,{name:'Template',inherits:{source:'XDMG'}},'data/magicvariants.json');
  const pack=(items:unknown[])=>({metadata:{activation:'review-required'},items});
  return {collection:{records:[c,blocked,outside,brew],invalidRecords:[bad,template]},
    structural:{commits:{main:mainSha,homebrew:brewSha},entities:[c,outside,brew],issueCounts:{invalidIdentity:2}},
    inventory:{asOf:'2026-11-25',sources:[{origin:'main',code:'XPHB',publications:[{}],releaseStatus:'catalog-date-reached'}],diagnostics:[]},
    runs:[{stage:'a5.8',result:{commit:mainSha,activation:'review-required',counts:{XPHB:{}},diagnostics:[{code:'fixtureBlocked'}],packs:[pack([output(c,'id1','XPHB')])]}},
      {stage:'a5.4',result:{commit:mainSha,activation:'review-required',counts:{XDMG:{}},diagnostics:[],packs:[pack([output(template,'id2','XDMG','magicItem'),output(template,'id3','XDMG','magicItem')])]}}],
    indexPaths:{spell:new Set(),monster:new Set()},runtime:profile(),validate:()=>({ok:true})};
}
describe('integrated coverage baseline',()=>{
  test('reconciles source rows independently of expanded outputs and structural status',()=>{
    const r=reconcileCoverage(scenario()),main=r.totalsByOrigin.main;
    expect(r.issues).toEqual({});
    expect(main).toMatchObject({observed:5,identityInvalid:2,structuralBlocked:1,structuralResolved:2,eligible:4,outsidePilot:1,validRow:2,notEmitted:2,emitted:3,stagingValid:3,invalidIdentityWithOutput:1,semanticReviewRequired:3});
    expect(r.totalsByOrigin.homebrew).toMatchObject({observed:1,outsidePilot:1,emitted:0});
    expect(r.priority).toEqual(expect.arrayContaining([expect.objectContaining({source:'XPHB',gaps:2,runtimeEntries:1})]));
    expect(JSON.stringify(publicSummary(r))).not.toContain('SECRET_BREW');
  });
  test('flags duplicate output IDs and provenance mismatches',()=>{
    const s=scenario();const item=s.runs[0].result.packs[0].items[0];
    s.runs[0].result.packs[0].items.push(item);
    expect(reconcileCoverage(s).issues.duplicatePhysicalId).toBe(1);
  });
  test('records staging failure without promoting semantic readiness',()=>{
    const r=reconcileCoverage({...scenario(),validate:()=>({ok:false})});
    expect(r.totalsByOrigin.main).toMatchObject({invalidRow:2,stagingInvalid:3,semanticReviewRequired:3});
  });
  test('preserves unmapped runtime books instead of guessing source identity',()=>{
    expect(profile().books).toEqual(expect.arrayContaining([expect.objectContaining({book:'unmapped',source:null,total:1,manualReview:1})]));
  });
});
const mainPath=process.env.DND_UPSTREAM_BASELINE_MAIN,brewPath=process.env.DND_UPSTREAM_BASELINE_BREW;
(mainPath&&brewPath?test:test.skip)('real baseline reconciles rows, all pilots, staging and runtime priority',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const runtime=readRuntimeProfile(path.resolve(__dirname,'../../assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json'));
  const r=buildBaseline(openSnapshot(mainPath,process.env.DND_UPSTREAM_BASELINE_MAIN_REF),openSnapshot(brewPath,process.env.DND_UPSTREAM_BASELINE_BREW_REF),{
    asOf:process.env.DND_UPSTREAM_BASELINE_AS_OF||new Date().toISOString().slice(0,10),runtime,validate:stageImportV3});
  console.log(JSON.stringify(publicSummary(r)));
  const out=process.env.DND_UPSTREAM_BASELINE_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
  expect(r.issues).toEqual({});
  expect(r.structuralIssueCounts.unreadableFile||0).toBe(0);
  expect(Object.keys(r.canonical).sort()).toEqual([...COMPENDIUM_ENTITY_KINDS].sort());
  expect(r.totalsByOrigin.main.stagingInvalid).toBe(0);
  expect(r.totalsByOrigin.main.stagingValid).toBe(r.uniquePhysicalIds);
  expect(r.totalsByOrigin.homebrew.emitted).toBe(0);
  expect(runtime.total).toBe(5841);
  if(process.env.DND_UPSTREAM_EVIDENCE_DIR)writeFragment(process.env.DND_UPSTREAM_EVIDENCE_DIR,'coverage',fromCoverage(r));
},240000);
