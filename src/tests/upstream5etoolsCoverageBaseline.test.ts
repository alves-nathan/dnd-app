const {fromCoverage,writeFragment}=require('../../scripts/5etools/cutover-evidence');
import {stageImportV3} from '../compendium/importV3Staging';
import {COMPENDIUM_ENTITY_KINDS} from '../compendium/importDomain';
import * as fs from 'node:fs';
import * as path from 'node:path';
const {buildBaseline,reconcileCoverage,publicSummary,runtimeProfile,readRuntimeProfile}=require('../../scripts/5etools/coverage-baseline');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {buildPinnedFunctionalCorpus,publicFunctionalSummary,buildFunctionalCorpus,scanCorpusFiles,selectFunctionalCorpus,verifyPinnedInputs}=require('../../scripts/5etools/functional-corpus');
const lock=require('../../scripts/5etools/functional-inputs.json');
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
    asOf:process.env.DND_UPSTREAM_BASELINE_AS_OF||lock.asOf,runtime,validate:stageImportV3});
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
  if(process.env.FULL_UPSTREAM_AUDIT==='true'||process.env.DND_FUNCTIONAL_CORPUS_OUT){
   const {execFileSync}=require('node:child_process');
   const app=String(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'})).trim();
   const corpus=buildPinnedFunctionalCorpus(openSnapshot(mainPath,process.env.DND_UPSTREAM_BASELINE_MAIN_REF),openSnapshot(brewPath,process.env.DND_UPSTREAM_BASELINE_BREW_REF),r,app);
   const aggregate=publicFunctionalSummary(corpus);
   console.log(JSON.stringify(aggregate));
   expect(aggregate.totals.main.resolverRows).toBe(r.totalsByOrigin.main.observed);
   expect(aggregate.totals.homebrew.resolverRows).toBe(r.totalsByOrigin.homebrew.observed);
   expect(aggregate.executable).toBe(false);
   const dest=process.env.DND_FUNCTIONAL_CORPUS_OUT;
   if(dest){
    const root=fs.realpathSync(path.resolve(__dirname,'../..')),parent=fs.realpathSync(path.dirname(path.resolve(dest)));
    const relative=path.relative(root,parent);
    if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('functionalCorpusOutputMustBeOutsideRepository');
    fs.writeFileSync(path.join(parent,path.basename(dest)),JSON.stringify(corpus,null,2)+'\n',{flag:'wx',mode:0o600});
   }
  }
},480000);

describe('functional corpus scope and denominator',()=>{
 test('pins immutable snapshots, refuses implicit approval and counts expanded rows separately',()=>{
  expect(()=>verifyPinnedInputs({commit:mainSha},{commit:brewSha})).toThrow('functionalSnapshotLockMismatch');
  const b=reconcileCoverage(scenario());
  expect(b.totalsByOrigin.main).toMatchObject({singleOutputRows:1,multipleOutputRows:1,extraOutputOccurrences:1});
  const empty={resolverRows:0,otherRootRows:0,nestedNamedSourceNodes:0,nestedVersionRows:0,explicitEditionObservations:0};
  const scan={totals:{main:{...empty,resolverRows:5,files:1,nonObjectFiles:0},homebrew:{...empty,resolverRows:1,files:1,nonObjectFiles:0}},sources:[{origin:'main',source:'XPHB',...empty,resolverRows:3},{origin:'main',source:'XDMG',...empty,resolverRows:1},{origin:'main',source:'XPHB',...empty,resolverRows:1},{origin:'homebrew',source:'SECRET_BREW',...empty,resolverRows:1}],fileFingerprint:'a'.repeat(64)};
  // Aggregate the two XPHB observations, like the scanner.
  scan.sources[0].resolverRows=4;scan.sources.splice(2,1);
  const inventory={commits:b.commits,asOf:b.asOf,files:[],sources:[],diagnostics:[]};
  const r=buildFunctionalCorpus(b,inventory,scan,'d'.repeat(40));
  expect(r.totals.main.withoutPilotOutput).toBe(3);
  expect(JSON.stringify(publicFunctionalSummary(r))).not.toContain('SECRET_BREW');
  const selected=selectFunctionalCorpus(r,{schemaVersion:'dnd-upstream-functional-source-selection.v1',corpusFingerprint:r.fingerprint,decisions:[]});
  expect(selected.counts.included).toBe(0);expect(selected.counts.pending).toBe(r.sources.length);
  const brew=r.sources.find((s:any)=>s.origin==='homebrew');
  const decision={sourceId:brew.id,disposition:'include',reason:'fixture local selection'};
  expect(selectFunctionalCorpus(r,{schemaVersion:'dnd-upstream-functional-source-selection.v1',corpusFingerprint:r.fingerprint,decisions:[decision]})).toMatchObject({counts:{included:1},executable:false});
  expect(()=>selectFunctionalCorpus(r,{schemaVersion:'dnd-upstream-functional-source-selection.v1',corpusFingerprint:'stale',decisions:[decision]})).toThrow('functionalSelectionInvalid');
 });
 test('inventories root arrays outside the resolver and nested versions without claiming entity equivalence',()=>{
  const data={'data/races.json':{race:[{name:'Fixture',source:'A',_versions:[{name:'Version',source:'A'}]}],extra:[{name:'Other',source:'B'}]},'data/book/book-a.json':{data:[{type:'entries',entries:[{name:'Nested',source:'A'}]}]}};
  const brew={'brew.json':{spell:[{name:'Fixture brew',source:'B'}]},'_generated/index-sources.json':{B:'brew.json'}};
  const main={files:new Map(Object.keys(data).map(p=>[p,'a'])),readJson:(p:keyof typeof data)=>data[p]},homebrew={files:new Map(Object.keys(brew).map(p=>[p,'b'])),readJson:(p:keyof typeof brew)=>brew[p]};
  const scan=scanCorpusFiles(main,homebrew,{files:[...Object.keys(data).map(path=>({origin:'main',path,blob:'a'})),{origin:'homebrew',path:'brew.json',blob:'b'}]});
  expect(scan.totals.main).toMatchObject({resolverRows:1,otherRootRows:2,nestedNamedSourceNodes:2,nestedVersionRows:1});
  expect(scan.totals.homebrew.resolverRows).toBe(1);
 });
});

describe('functional scope batch selection and legacy obligations',()=>{
 const {prepareFunctionalSelection,reconcileFunctionalLegacySources}=require('../../scripts/5etools/functional-scope');
 const {digest}=require('../../scripts/5etools/integrated-review');
 const build=()=>{
  const b=reconcileCoverage(scenario()),empty={resolverRows:0,otherRootRows:0,nestedNamedSourceNodes:0,nestedVersionRows:0,explicitEditionObservations:0};
  const scan={totals:{main:{...empty,resolverRows:5,files:1,nonObjectFiles:0},homebrew:{...empty,resolverRows:1,files:1,nonObjectFiles:0}},sources:[{origin:'main',source:'XPHB',...empty,resolverRows:4},{origin:'main',source:'XDMG',...empty,resolverRows:1},{origin:'homebrew',source:'SECRET_BREW',...empty,resolverRows:1}],fileFingerprint:'a'.repeat(64)};
  return buildFunctionalCorpus(b,{commits:b.commits,asOf:b.asOf,files:[],sources:[],diagnostics:[]},scan,'d'.repeat(40));
 };
 test('selects exact Main snapshot sources in batch and only explicitly selected Homebrew',()=>{
  const d=build(),brew=JSON.stringify(['homebrew','SECRET_BREW']),before=digest(d);
  const r=prepareFunctionalSelection(d,{mainPolicy:'allObservedMain',reason:'fixture'});
  expect(r.scope.counts).toEqual({included:2,excluded:0,pending:1});
  expect(r.selection.decisions.every((x:any)=>x.sourceId!==brew)).toBe(true);
  expect(prepareFunctionalSelection(d,{mainPolicy:'allObservedMain',homebrewSourceIds:[brew],reason:'fixture'}).scope.counts).toEqual({included:3,excluded:0,pending:0});
  expect(()=>prepareFunctionalSelection(d,{mainPolicy:'allObservedMain',homebrewSourceIds:['*'],reason:'fixture'})).toThrow('functionalBatchHomebrewInvalid');
  expect(prepareFunctionalSelection(d,{mainPolicy:'explicitOnly',mainSourceIds:[JSON.stringify(['main','XPHB'])],reason:'fixture'}).scope.counts).toEqual({included:1,excluded:0,pending:2});
  expect(digest(d)).toBe(before);
 });
 test('preserves unmapped historical sources and prevents excluding required Main sources',()=>{
  const d=build(),required=JSON.stringify(['main','XPHB']);
  const row=(domain:string,sourceId:string|null,count:number,codes:string[])=>({domain,sourceId,count,codes,status:codes.length?'mainPublicationCandidate':'sourceMappingPending',migrationState:'preservePending',equivalence:'notEstablished'});
  const history={schemaVersion:'dnd-upstream-historical-baseline.v1',activation:'review-required',commits:d.commits,summary:{issues:{},retirementAuthorized:false,historical:{historical:{count:2},bootstrap:{count:1}},runtime:{entries:2}},comparison:{sources:[row('historicalOccurrences','phb',1,['XPHB']),row('historicalOccurrences','unknown',1,[]),row('bootstrap','phb',1,['XPHB']),row('runtime','phb-2024',1,['XPHB']),row('runtime',null,1,[])]}};
  const r=reconcileFunctionalLegacySources(d,history);
  expect(r).toMatchObject({requiredSourceIds:[required],pending:{historicalOccurrences:1,bootstrap:0,runtime:1},installedInventory:'notInspected',executable:false});
  expect(()=>prepareFunctionalSelection(d,{mainPolicy:'allObservedMain',excludedSourceIds:[required],reason:'fixture'},r)).toThrow('functionalRequiredLegacySourceExcluded');
  expect(()=>reconcileFunctionalLegacySources(d,{...history,commits:{...history.commits,application:'a'.repeat(40)}})).toThrow('functionalHistoryBindingMismatch');
 });
});

describe('functional conversion inputs',()=>{
 const {buildFunctionalInputPlan,readSelectedFunctionalInputs,publicInputPlanSummary}=require('../../scripts/5etools/functional-input-plan');
 const {digest}=require('../../scripts/5etools/integrated-review');
 const fixture=()=>{
  const data:Record<string,unknown>={'data/races.json':{race:[{name:'Fixture',source:'A',_versions:[{name:'Variant'}]}],other:[{name:'Unclassified'}]},'data/book/book-a.json':{data:[{name:'Chapter',entries:['private text']}]},'data/shared.json':{definitions:{x:1}}};
  const brew:Record<string,unknown>={'brew.json':{spell:[{name:'Private brew',source:'B'}]},'_generated/index-sources.json':{B:'brew.json'}};
  const main={commit:mainSha,files:new Map(Object.keys(data).map(p=>[p,'a'])),readJson:(p:string)=>data[p]},homebrew={commit:brewSha,files:new Map(Object.keys(brew).map(p=>[p,'b'])),readJson:(p:string)=>brew[p]};
  const inventory={commits:{main:mainSha,homebrew:brewSha},sources:[{origin:'main',code:'A',publications:[{kind:'book',id:'A'}],paths:[]},{origin:'homebrew',code:'B',publications:[],paths:[{path:'brew.json'}]}],files:[...Object.keys(data).map(path=>({origin:'main',path,blob:'a'})),{origin:'homebrew',path:'brew.json',blob:'b'}]};
  const source=(origin:string,source:string|null)=>({id:JSON.stringify([origin,source]),origin,source});
  const body={schemaVersion:'dnd-upstream-functional-corpus.v1',scope:'privateScopeDraft',executable:false,commits:{...inventory.commits,application:'d'.repeat(40)},bindings:{inventory:digest(inventory)},sources:[source('main','A'),source('main',null),source('homebrew','B')],totals:{main:{resolverRows:1,otherRootRows:2},homebrew:{resolverRows:1,otherRootRows:0}}};
  const draft={...body,fingerprint:digest(body)},selection={schemaVersion:'dnd-upstream-functional-source-selection.v1',corpusFingerprint:draft.fingerprint,decisions:[{sourceId:JSON.stringify(['main','A']),disposition:'include',reason:'fixture'}]};
  return {main,homebrew,inventory,draft,selection,data};
 };
 test('routes selected mechanical and consultation inputs, preserves nested versions and tracks unresolved support',()=>{
  const {main,homebrew,inventory,draft,selection}=fixture();
  const p=buildFunctionalInputPlan(main,homebrew,inventory,draft,selection);
  expect(p.totals.main).toMatchObject({resolverRows:1,otherRootRows:2,nonArrayValues:1,included:2,sourcePending:1,sharedSupportPending:1});
  expect(p.totals.homebrew).toMatchObject({included:0,sourcePending:1});
  const values=[...readSelectedFunctionalInputs(main,homebrew,inventory,draft,selection,p)];
  expect(values.map((r:any)=>r.descriptor.lane).sort()).toEqual(['publicationSection','resolverEntity']);
  expect(values.find((r:any)=>r.descriptor.lane==='resolverEntity').value._versions).toHaveLength(1);
  expect(JSON.stringify(publicInputPlanSummary(p))).not.toContain('Private brew');
  expect(JSON.stringify(publicInputPlanSummary(p))).not.toContain('private text');
  expect(JSON.stringify(p)).not.toContain('private text');
 });
 test('rejects stale plans, mismatched snapshots and changed raw values',()=>{
  const {main,homebrew,inventory,draft,selection,data}=fixture(),p=buildFunctionalInputPlan(main,homebrew,inventory,draft,selection);
  expect(()=>[...readSelectedFunctionalInputs(main,homebrew,inventory,draft,selection,{...p,fingerprint:'stale'})]).toThrow('functionalInputPlanMismatch');
  expect(()=>buildFunctionalInputPlan({...main,commit:'e'.repeat(40)},homebrew,inventory,draft,selection)).toThrow('functionalInputSnapshotMismatch');
  data['data/book/book-a.json']={data:[{name:'changed'}]};
  expect(()=>[...readSelectedFunctionalInputs(main,homebrew,inventory,draft,selection,p)]).toThrow('functionalInputPlanMismatch');
 });
});

test('functional input plan recognizes pinned publication wrapper shapes and rejects conflicting ownership',()=>{
 const {buildFunctionalInputPlan,readSelectedFunctionalInputs}=require('../../scripts/5etools/functional-input-plan');
 const {buildReferencePacks}=require('../../scripts/5etools/functional-reference-pack');
 const {digest}=require('../../scripts/5etools/integrated-review');
 const data:Record<string,unknown>={'data/book/book-a.json':{bookData:[{id:'A',source:'A',data:[{name:'Chapter',entries:['Fixture narrative']}]}]},'data/adventure/adventure-b.json':{adventureData:[{id:'B',source:'B',data:[{name:'Adventure',entries:['Fixture encounter']}]}]},'data/book/book-c.json':{bookData:[{id:'C',source:'OTHER',data:[]}]}};
 const main={commit:mainSha,files:new Map(Object.keys(data).map(p=>[p,'a'.repeat(40)])),readJson:(p:string)=>data[p]};
 const homebrew={commit:brewSha,files:new Map(),readJson:()=>({})};
 const inventory={commits:{main:mainSha,homebrew:brewSha},sources:[{origin:'main',code:'A',publications:[{kind:'book',id:'A'}],paths:[]},{origin:'main',code:'B',publications:[{kind:'adventure',id:'B'}],paths:[]},{origin:'main',code:'C',publications:[{kind:'book',id:'C'}],paths:[]}],files:Object.keys(data).map(path=>({origin:'main',path,blob:'a'.repeat(40)}))};
 const source=(code:string|null)=>({id:JSON.stringify(['main',code]),origin:'main',source:code});
 const body={schemaVersion:'dnd-upstream-functional-corpus.v1',scope:'privateScopeDraft',executable:false,commits:{...inventory.commits,application:'d'.repeat(40)},bindings:{inventory:digest(inventory)},sources:['A','B','C','OTHER',null].map(source),totals:{main:{resolverRows:0,otherRootRows:3},homebrew:{resolverRows:0,otherRootRows:0}}};
 const draft={...body,fingerprint:digest(body)},selection={schemaVersion:'dnd-upstream-functional-source-selection.v1',corpusFingerprint:draft.fingerprint,decisions:['A','B','C','OTHER'].map(code=>({sourceId:source(code).id,disposition:'include',reason:'fixture'}))};
 const plan=buildFunctionalInputPlan(main,homebrew,inventory,draft,selection);
 expect(plan.totals.main).toMatchObject({otherRootRows:3,included:2,sourcePending:1});
 expect(plan.rows.every((r:any)=>r.lane==='publicationSection')).toBe(true);
 expect(plan.rows.find((r:any)=>r.path==='data/book/book-c.json')).toMatchObject({attribution:'conflictingPublicationSource',disposition:'sourcePending'});
 const packs=buildReferencePacks(plan,readSelectedFunctionalInputs(main,homebrew,inventory,draft,selection,plan));
 expect(packs).toHaveLength(2);
 expect(packs.flatMap((p:any)=>p.records).map((r:any)=>r.kind).sort()).toEqual(['adventureData','bookData']);
 expect(packs.every((p:any)=>p.usage==='consultation'&&p.runtimeEligible===false)).toBe(true);
});
