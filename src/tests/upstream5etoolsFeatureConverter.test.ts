import {stageImportV3} from '../compendium/importV3Staging';
const {buildPilot,prerequisite,flatPrerequisite,abilityPlan,simpleAbility,physicalId}=require('../../scripts/5etools/feature-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const feat=(extra:Record<string,unknown>={})=>({name:'Fixture Feat',source:'XPHB',category:'G',entries:['Fixture'],...extra});
const feature=(extra:Record<string,unknown>={})=>({name:'Fixture Invocation',source:'XPHB',featureType:['EI'],entries:['Fixture'],...extra});
function fixture(feats:unknown[],features:unknown[]=[]){
  const data:Record<string,unknown>={'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'}]},'data/feats.json':{feat:feats},'data/optionalfeatures.json':{optionalfeature:features}};
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools feat and optional feature pilot',()=>{
  test('projects exact conjunctive level and ability requirements but never flattens OR',()=>{
    const p=prerequisite([{level:4,ability:[{str:13,dex:13}]}]);
    expect(flatPrerequisite(p)).toEqual({level:4,abilities:{STR:13,DEX:13}});
    const or=prerequisite([{level:4,ability:[{str:13}]},{level:4,ability:[{dex:13}]}]);
    expect(or.children).toHaveLength(2);
    expect(flatPrerequisite(or)).toBeUndefined();
    expect(flatPrerequisite(prerequisite([{ability:[{str:13},{dex:13}]}]))).toBeUndefined();
  });
  test('distinguishes class levels and retains source-qualified requirements and spell filters',()=>{
    const p=prerequisite([{level:{level:5,class:{name:'Warlock',source:'XPHB'}},optionalfeature:['pact of the blade|xphb'],spell:[{choose:'level=0|class=Warlock'}]}]);
    expect(p.children[0].children).toEqual(expect.arrayContaining([
      expect.objectContaining({op:'classLevel',minimum:5,class:{name:'Warlock',source:'XPHB'}}),
      expect.objectContaining({op:'referenceRequirement',referenceType:'optionalfeature',references:[expect.objectContaining({source:'xphb'})]}),
      expect.objectContaining({op:'referenceRequirement',referenceType:'spell',raw:[{choose:'level=0|class=Warlock'}]})
    ]));
    expect(flatPrerequisite(p)).toBeUndefined();
    expect(flatPrerequisite(prerequisite([{level:4,other:'unknown condition'}]))).toBeUndefined();
  });
  test('keeps ASI alternatives, distinct choices and Epic Boon cap',()=>{
    const plan=abilityPlan([{choose:{from:['str','dex'],amount:2},hidden:true},{choose:{from:['str','dex'],count:2},hidden:true}]);
    expect(plan.alternatives.map((x:any)=>x.choice)).toEqual([
      {abilities:['STR','DEX'],amount:2,count:1,distinct:true},{abilities:['STR','DEX'],amount:1,count:2,distinct:true}]);
    expect(simpleAbility(plan)).toBeUndefined();
    expect(simpleAbility(abilityPlan([{choose:{from:['str','dex']},max:30}]))).toEqual([{abilities:['STR','DEX'],amount:1,max:30}]);
    expect(simpleAbility(abilityPlan([{cha:1}]))).toEqual([{abilities:['CHA'],amount:1,max:20}]);
    expect(simpleAbility(abilityPlan([{choose:{weighted:{from:['str','dex'],weights:[2,1]}}}]))).toBeUndefined();
  });
  test('maps categories and families, preserves grants and repeatability without inferred eligibility',()=>{
    const r=buildPilot(fixture([feat({category:'O',repeatable:true,additionalSpells:[{known:{_:[{choose:'level=0',count:2}]}}]})],
      [feature({prerequisite:[{level:{level:2,class:{name:'Warlock',source:'XPHB'}}}],consumes:{name:'Fixture Resource'}})]),['XPHB']);
    expect(r.counts.XPHB.feat.converted).toBe(1);expect(r.counts.XPHB.optionalfeature.converted).toBe(1);
    const f=r.packs[0].items.find((x:any)=>x.kind==='feat'),o=r.packs[0].items.find((x:any)=>x.kind==='feature');
    expect(f.payload).toMatchObject({category:'origin',repeatable:true,mechanics:{upstreamFeature:{additionalSpells:[{known:{_:[{choose:'level=0',count:2}]}}]}}});
    expect(o.payload).toMatchObject({sourceType:'eldritchInvocation'});
    expect(o.payload.levelGained).toBeUndefined();expect(o.payload.prerequisite).toBeUndefined();
    expect(o.metadata.reviewCodes).toEqual(expect.arrayContaining(['resourceConsumptionPending','classLevelReferencePending','compoundPrerequisitePending']));
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('blocks unresolved variants and duplicate identities, retains source distinctions',()=>{
    const r=buildPilot(fixture([feat(),feat(),feat({name:'Variant',_versions:[{}]})]),['XPHB']);
    expect(r.counts.XPHB.feat).toEqual({total:3,converted:0,blocked:3});
    expect(physicalId('feat','PHB','Fixture')).not.toBe(physicalId('feat','XPHB','Fixture'));
    expect(physicalId('feat','XPHB','Fixture')).not.toBe(physicalId('feature','XPHB','Fixture'));
  });
});
const snapshotPath=process.env.DND_UPSTREAM_FEATURE_SNAPSHOT;
(snapshotPath?test:test.skip)('real feat and optional feature pilot reports aggregate only',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=buildPilot(openSnapshot(snapshotPath));
  const validation:Record<string,{valid:number;invalid:number;codes:Record<string,number>}>={};
  for(const p of r.packs){
    const code=p.source.id.split(':').at(-1),stats={valid:0,invalid:0,codes:{} as Record<string,number>};
    for(const item of p.items){
      const v=stageImportV3({...p,items:[item]});if(v.ok)stats.valid++;else stats.invalid++;
      for(const issue of v.issues)stats.codes[issue.code]=(stats.codes[issue.code]||0)+1;
    }
    validation[code]=stats;
  }
  console.log(JSON.stringify({commit:r.commit,counts:r.counts,validation,activation:'review-required'}));
  for(const code of Object.keys(r.counts)){
    for(const k of ['feat','optionalfeature']){const c=r.counts[code][k];expect(c.total).toBe(c.converted+c.blocked);}
    expect(validation[code].invalid).toBe(0);
  }
  expect(r.counts.XPHB.feat.converted).toBeGreaterThan(0);expect(r.counts.XPHB.optionalfeature.converted).toBeGreaterThan(0);
},120000);
