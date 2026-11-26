export {};
const {ownerAndLevelGraph,compareProgression,buildClassProgressionEvidence,publicSummary}=require('../../scripts/5etools/class-progression-evidence');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildPilot}=require('../../scripts/5etools/class-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Synthetic',published:'2024-01-01'}]},
  'data/class/class-fixture.json':{
   class:[{name:'Private Class',source:'XPHB',hd:{number:1,faces:8},proficiency:['int','wis'],
    classFeatures:['Private Feature|Private Class|XPHB|1',{classFeature:'Private Feature|Private Class|XPHB|1',gainSubclassFeature:true}]}],
   classFeature:[{name:'Private Feature',source:'XPHB',className:'Private Class',classSource:'XPHB',level:1,entries:['PRIVATE_TEXT']}],
   subclass:[{name:'Private Path',shortName:'Private Path',source:'XPHB',className:'Private Class',classSource:'XPHB',
    subclassFeatures:['Private Choice|Private Class|XPHB|Private Path|XPHB|3']}],
   subclassFeature:[{name:'Private Choice',source:'XPHB',className:'Private Class',classSource:'XPHB',subclassShortName:'Private Path',subclassSource:'XPHB',level:3,entries:['PRIVATE_TEXT']}]
  }
 };
 const pilot=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']);
 const items=pilot.packs[0].items;
 const legacy=[
  {id:'old-class',kind:'class',name:'Private Class',payload:{hitDie:8,featureIds:['old-feature'],progression:[{level:1,featureIds:['old-feature']}]}},
  {id:'old-feature',kind:'feature',name:'Private Feature',payload:{sourceType:'classFeature',classId:'old-class',levelGained:1}},
  {id:'old-subclass',kind:'subclass',name:'Private Path',payload:{classId:'old-class',featureIds:['old-choice'],progression:[{level:3,featureIds:['old-choice']}]}},
  {id:'old-choice',kind:'feature',name:'Private Choice',payload:{sourceType:'subclassFeature',classId:'old-class',subclassId:'old-subclass',levelGained:3}}
 ];
 const rawHistorical=legacy.map((item,index)=>({path:'PRIVATE_PATH',index,item}));
 const rows=rawHistorical.map(({item,path,index})=>({id:item.id,kind:item.kind,sourceId:'phb',rulesEra:'2024',path,index,itemHash:digest(item)}));
 const reconciliation=reconcile({historical:{rows,bootstrapRows:rows},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},
  rawHistorical,rawRuntime:[],items,records:[],commits});
 return {reconciliation,rawHistorical,items};
}
describe('a8.6.1 owner and progression evidence',()=>{
 test('rechecks exact owner graph and counts annotated duplicate grants without inventing grants',()=>{
  const f=fixture(),g=ownerAndLevelGraph(f.items,commits.main);
  expect(g.byFamily.class).toMatchObject({items:1,owners:1,uniqueGrants:1,grantOccurrences:2,duplicateGrants:1,annotatedGrants:1});
  expect(g.byFamily.subclass).toMatchObject({items:1,uniqueGrants:1});
  expect(g.byFamily.classFeature).toMatchObject({items:1,unlistedFeatures:0});
  expect(g.byFamily.subclassFeature).toMatchObject({items:1,unlistedFeatures:0});
  const cl=f.items.find((i:any)=>i.kind==='class');
  const bad=f.items.map((i:any)=>i.id===cl.id?{...i,payload:{...i.payload,progression:[{level:2,featureIds:cl.payload.featureIds}]}}:i);
  expect(()=>ownerAndLevelGraph(bad,commits.main)).toThrow('targetProgressionProjectionMismatch');
  const feature=f.items.find((i:any)=>i.payload.sourceType==='classFeature');
  expect(()=>ownerAndLevelGraph(f.items.map((i:any)=>i.id===feature.id?{...i,payload:{...i.payload,classId:'missing'}}:i),commits.main)).toThrow();
 });
 test('binds all historical occurrences and reports candidate ownership, level and field evidence only',()=>{
  const f=fixture(),before=digest(f),r=buildClassProgressionEvidence(f);
  expect(r.byKind.class).toMatchObject({occurrences:1,identityCandidates:1,fieldStatus:{hitDie:{exactValue:1}},progressionStatus:{featureIds:{orderedGrantCandidate:1},progression:{orderedGrantCandidate:1}}});
  expect(r.byKind.subclass.ownerStatus).toEqual({ownerIdentityCandidate:1});
  expect(r.byKind.feature).toMatchObject({occurrences:2,identityCandidates:2,ownerStatus:{ownerIdentityCandidate:3}});
  expect(r).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false,retirementAuthorized:false});
  expect(r.rows.every((x:any)=>!x.writeAuthorized)).toBe(true);
  expect(digest(f)).toBe(before);
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|PRIVATE_|old-class|old-feature/);
 });
 test('progression distinguishes pending endpoints, edition, duplicate references, order and wrong grant level',()=>{
  const resolve=(id:string)=>id==='missing'?undefined:{target:{id:id==='a'?'A':'B'},eraPending:id==='uncertain'};
  const b={featureIds:['A','B'],progression:[{level:1,featureIds:['A']},{level:2,featureIds:['B']}]};
  expect(compareProgression({featureIds:['a','missing'],progression:[{level:3,featureIds:['a']}]},b,resolve)).toMatchObject([
   {status:'endpointMappingPending',unresolved:1},{status:'grantDifferences',levelMismatch:1}]);
  expect(compareProgression({featureIds:['b','a']},b,resolve)[0].status).toBe('orderReviewPending');
  expect(compareProgression({featureIds:['a','a','b']},b,resolve)[0]).toMatchObject({status:'grantDifferences',duplicateHistorical:1,duplicateMapped:1});
  expect(compareProgression({featureIds:['a','uncertain']},b,resolve)[0].status).toBe('endpointEditionPending');
  expect(compareProgression({progression:[{level:0,featureIds:['a']}]},b,resolve)[1].status).toBe('historicalShapePending');
  expect(compareProgression({},b,resolve)[0].status).toBe('historicalFieldAbsent');
 });
 test('does not use a legacy owner or feature ID whose occurrences disagree',()=>{
  const f=fixture(),row=f.reconciliation.historical.find((x:any)=>x.id==='old-feature');
  const item=f.rawHistorical.find((x:any)=>x.item.id==='old-feature').item;
  const other={...row,index:99,status:'ownerMappingPending',targetId:undefined,targetFingerprint:undefined,evidenceId:'other'};
  const changed={...f,reconciliation:{...f.reconciliation,historical:[...f.reconciliation.historical,other]},rawHistorical:[...f.rawHistorical,{path:row.path,index:99,item}]};
  const r=buildClassProgressionEvidence(changed);
  expect(r.byKind.feature).toMatchObject({occurrences:3,identityCandidates:2,identityPending:1});
  expect(r.byKind.class.progressionStatus.featureIds).toEqual({endpointMappingPending:1});
 });
 test('rejects tampered source or target and missing historical rows',()=>{
  const f=fixture();
  expect(()=>buildClassProgressionEvidence({...f,rawHistorical:f.rawHistorical.map((x:any)=>({...x,item:{...x.item,name:'changed'}}))})).toThrow('historicalBindingMismatch');
  const t=f.items.find((i:any)=>i.kind==='class');
  expect(()=>buildClassProgressionEvidence({...f,items:f.items.map((i:any)=>i.id===t.id?{...i,payload:{...i.payload,hitDie:10}}:i)})).toThrow('targetBindingMismatch');
  expect(()=>buildClassProgressionEvidence({...f,reconciliation:{...f.reconciliation,historical:f.reconciliation.historical.slice(1)}})).toThrow('historicalCoverageMismatch');
 });
});
