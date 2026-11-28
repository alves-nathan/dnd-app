export {};
const {tableColumns,consumption,scheduleRows,compareChoiceCheckpoints,buildFeatureResourceEvidence,publicSummary}=require('../../scripts/5etools/feature-resource-evidence');
const {buildPilot}=require('../../scripts/5etools/class-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
const table={colLabels:['Rages','Weapon Mastery','Unknown Label'],rows:Array.from({length:20},(_,i)=>[i===19?'Unlimited':String(i+1),2,i===0?'—':{type:'bonus',value:2}])};
function fixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-01-01'}]},
  'data/class/class-fixture.json':{
   class:[{name:'Private Class',source:'XPHB',hd:{number:1,faces:8},proficiency:['int','wis'],classTableGroups:[table],
    optionalfeatureProgression:[{name:'Private Choice',featureType:['EI'],progression:{'1':1,'3':2}}],
    classFeatures:[{classFeature:'Private Feature|Private Class|XPHB|1',gainSubclassFeature:true}]}],
   classFeature:[{name:'Private Feature',source:'XPHB',className:'Private Class',classSource:'XPHB',level:1,entries:['PRIVATE_TEXT'],consumes:{name:'Private Resource',amount:2}}]
  }
 };
 const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
 const old=[
  {id:'old-class',kind:'class',name:'Private Class',payload:{resources:[{id:'private-pool',max:3,recharge:'shortRest'}],featureIds:['old-feature'],progression:[{level:1,featureIds:['old-feature']}]}},
  {id:'old-feature',kind:'feature',name:'Private Feature',payload:{classId:'old-class',levelGained:1,sourceType:'classFeature',consumes:[{resourceId:'private-pool',amount:2}],grantsActions:[{id:'private-action'}],effectTemplates:[{id:'private-effect'}]}}
 ];
 const rawHistorical=old.map((item,index)=>({path:'PRIVATE_PATH',index,item}));
 const rows=rawHistorical.map(({item,path,index})=>({path,index,id:item.id,kind:item.kind,sourceId:'phb',rulesEra:'2024',itemHash:digest(item)}));
 const reconciliation=reconcile({historical:{rows,bootstrapRows:rows},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[],items,records:[],commits});
 return {reconciliation,rawHistorical,items};
}
describe('a8.6.4 class feature resource evidence',()=>{
 test('observes complete columns without treating numeric cells as resource pools',()=>{
  const r=tableColumns({classTableGroups:[table,{colLabels:['Spell Slots','Slot Level'],rows:Array.from({length:20},()=>[2,1])},{colLabels:['slot'],rowsSpellProgression:Array.from({length:20},()=>[2])}]});
  expect(r).toHaveLength(6);
  expect(r[0]).toMatchObject({labelKind:'capacityLabelCandidate',status:'mixedColumnPending',cellCounts:{integerText:19,unlimitedCandidate:1},recovery:'notEstablished',resourceBinding:'notEstablished'});
  expect(r[0].values[19]).toEqual({kind:'unlimitedCandidate'});
  expect(r[1]).toMatchObject({labelKind:'selectionLabelCandidate',status:'completeNumericColumnCandidate',cellCounts:{integer:20}});
  expect(r[2]).toMatchObject({labelKind:'unclassifiedLabel',status:'mixedColumnPending',cellCounts:{dashPending:1,nonNumericPending:19}});
  expect(r[3].status).toBe('spellColumnExcluded');
  expect(r[4].status).toBe('spellColumnExcluded');
  expect(r[5].status).toBe('spellTableExcluded');
  expect(tableColumns({classTableGroups:[{...table,rows:table.rows.slice(1)}]})[0].status).toBe('tableShapePending');
  expect(tableColumns({classTableGroups:[{...table,rows:Array.from({length:20},()=>[1,2])}]})[0].status).toBe('tableShapePending');
 });
 test('distinguishes explicit consumption amount, missing amount and ambiguous expression',()=>{
  expect(consumption({})).toBeNull();
  expect(consumption({consumes:{name:'Fixture'}})).toMatchObject({status:'amountNotExplicit'});
  expect(consumption({consumes:{name:'Fixture'}})).not.toHaveProperty('amount');
  expect(consumption({consumes:{name:'Fixture',amount:2}})).toMatchObject({status:'explicitAmountCandidate',amount:2});
  for(const amount of [0,-1,1.5,'2','formula'])expect(consumption({consumes:{name:'Fixture',amount}}).status).toBe('amountPending');
  expect(consumption({consumes:{name:'Fixture',amount:1,condition:'pending'}}).status).toBe('consumptionShapePending');
 });
 test('selection schedules expose exact count checkpoints without inferring replacement or sparse values',()=>{
  const i={payload:{mechanics:{upstreamClassRecord:{optionalfeatureProgression:[{name:'Choice',featureType:['EI'],progression:{'1':1,'3':2}}],
    featProgression:[{name:'Feat',category:['EB'],progression:{'*':1}}],
    itemMasteriesProgression:{'1':2,'4':3}}}}};
  const [choice,feat,mastery]=scheduleRows(i);
  expect(choice).toMatchObject({status:'selectorAndSchedule',semantics:'countOnlyNotGrantOrReplacement',writeAuthorized:false});
  expect(compareChoiceCheckpoints(choice,1,3)).toMatchObject({status:'countDifferenceCandidate',before:1,after:2,difference:1,semantics:'notGrantOrReplacement'});
  expect(compareChoiceCheckpoints(choice,1,2).reason).toBe('checkpointNotPresent');
  expect(compareChoiceCheckpoints(choice,3,1).status).toBe('indeterminate');
  expect(compareChoiceCheckpoints(feat,1,3).status).toBe('indeterminate');
  expect(compareChoiceCheckpoints(mastery,1,4)).toMatchObject({difference:1});
 });
 test('binds grants and actual historical runtime fields without auto-applying anything',()=>{
  const f=fixture(),before=digest(f),r=buildFeatureResourceEvidence(f);
  expect(r.byScope.class).toMatchObject({items:1,grants:{grantOptionsPending:1},choices:{'optionalfeatureProgression:selectorAndSchedule':1}});
  expect(r.byScope.classFeature).toMatchObject({items:1,consumption:{explicitAmountCandidate:1}});
  expect(r.historical.class).toMatchObject({occurrences:1,identityCandidates:1,fields:{resources:{missingCandidate:1}}});
  expect(r.historical.feature).toMatchObject({occurrences:1,identityCandidates:1,fields:{consumes:{missingCandidate:1},grantsActions:{missingCandidate:1},effectTemplates:{missingCandidate:1}}});
  expect(r).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false,retirementAuthorized:false});
  expect(r.rows.every((x:any)=>!x.writeAuthorized&&x.recoveryStatus==='notEstablished'&&x.replacementStatus==='notEstablished')).toBe(true);
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|PRIVATE_|private-pool|old-feature/);
  expect(digest(f)).toBe(before);
 });
 test('rejects altered occurrence, altered target and incomplete historical inventory',()=>{
  const f=fixture();
  expect(()=>buildFeatureResourceEvidence({...f,rawHistorical:f.rawHistorical.map(x=>({...x,item:{...x.item,name:'changed'}}))})).toThrow('historicalBindingMismatch');
  expect(()=>buildFeatureResourceEvidence({...f,items:f.items.map((x:any)=>x.kind==='class'?{...x,payload:{...x.payload,hitDie:12}}:x)})).toThrow('targetBindingMismatch');
  expect(()=>buildFeatureResourceEvidence({...f,reconciliation:{...f.reconciliation,historical:f.reconciliation.historical.slice(1)}})).toThrow('historicalCoverageMismatch');
 });
});
