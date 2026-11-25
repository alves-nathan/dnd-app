import {stageImportV3} from '../compendium/importV3Staging';
const {buildPilot,backgroundAbility,mergeSubrace}=require('../../scripts/5etools/origin-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const weighted=(from=['str','dex','con'])=>[{choose:{weighted:{from,weights:[2,1]}}},{choose:{weighted:{from,weights:[1,1,1]}}}];
function fixture(race:unknown[]=[],subrace:unknown[]=[],background:unknown[]=[],feat:unknown[]=[]){
  const data:Record<string,unknown>={
    'data/books.json':{book:[{source:'XPHB',name:'Fixture Revised',published:'2024-09-17'},{source:'PHB',name:'Fixture Classic',published:'2014-08-19'}]},
    'data/races.json':{race,subrace},'data/backgrounds.json':{background},'data/feats.json':{feat}
  };
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools species and backgrounds',()=>{
  test('only exact weighted background ASI alternatives project into runtime format',()=>{
    expect(backgroundAbility(weighted())).toEqual({abilityScoreOptions:['STR','DEX','CON'],abilityScoreIncreaseRule:{
      chooseOnePlus2AndDifferentOnePlus1:true,orIncreaseAllBy1:true,maximumScoreAfterIncrease:20}});
    expect(backgroundAbility(weighted(['str','str','con']))).toBeUndefined();
    expect(backgroundAbility([weighted()[0]])).toBeUndefined();
    expect(backgroundAbility([weighted()[0],weighted(['int','wis','cha'])[1]])).toBeUndefined();
  });
  test('normalizes 2024 background ASI, exact proficiency and starting equipment alternatives; retains feat candidate only',()=>{
    const r=buildPilot(fixture([],[],[{name:'Fixture Background',source:'XPHB',ability:weighted(),
      skillProficiencies:[{athletics:true,perception:true}],toolProficiencies:[{choose:{from:['Fixture Tools']}}],
      feats:[{'fixture feat|xphb':true}],startingEquipment:[{A:[{item:'fixture|xphb'},{value:500}],B:[{value:5000}]}]}],
      [{name:'Fixture Feat',source:'XPHB'}]),['XPHB']);
    const p=r.packs[0].items[0].payload;
    expect(p).toMatchObject({abilityScoreOptions:['STR','DEX','CON'],skillProficiencies:['Athletics','Perception'],
      toolProficiencyChoice:{count:1,options:['Fixture Tools'],from:'tools'}});
    expect(p.featIds).toBeUndefined();
    expect(p.mechanics.featReferences).toEqual([expect.objectContaining({matched:true,candidateId:expect.any(String)})]);
    expect(p.mechanics.startingEquipmentPlan.groups[0].options).toHaveLength(2);
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('merges parent traits and ASI without summing overlapping abilities',()=>{
    const base={name:'Fixture Species',source:'PHB',size:['M'],speed:30,ability:[{con:2}],entries:[{name:'Original',entries:['fixture']}]};
    const sub={name:'Hill',source:'PHB',raceName:'Fixture Species',raceSource:'PHB',ability:[{wis:1}],
      entries:[{name:'Replacement',data:{overwrite:'Original'},entries:['fixture']}]};
    const r=buildPilot(fixture([base],[sub]),['PHB']);
    const i=r.packs[0].items.find((x:any)=>x.metadata.upstreamKind==='subrace');
    expect(i.name).toBe('Fixture Species (Hill)');
    expect(i.payload).toMatchObject({size:'Medium',speed:30,mechanics:{upstreamOrigin:{ability:[{con:2,wis:1}],entries:[expect.objectContaining({name:'Replacement'})]},parent:{name:'Fixture Species',source:'PHB'}}});
    expect(i.payload.abilityScoreOptions).toBeUndefined();
    expect(i.provenance.lineage).toHaveLength(1);
    expect(mergeSubrace(base,{...sub,ability:[{con:1}]},new Set()).ability).toEqual([{con:1}]);
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('retains revised base with lineage templates but does not grant conditional resistance or legacy ASI',()=>{
    const r=buildPilot(fixture([{name:'Fixture Lineage',source:'XPHB',size:['S','M'],creatureTypes:['humanoid'],
      speed:{walk:30,fly:true},darkvision:60,ability:[{str:2}],resist:[{choose:{from:['fire','cold']}}],
      entries:[{name:'Fixture Trait',entries:['fixture']}],_versions:[{name:'Variant',source:'XPHB'}]}]),['XPHB']);
    const i=r.packs[0].items[0];
    expect(i.payload).toMatchObject({size:['Small','Medium'],speed:{walk:30,fly:30},darkvisionFt:60});
    expect(i.payload.resistances).toBeUndefined();expect(i.payload.abilityScoreIncrease).toBeUndefined();
    expect(i.payload.mechanics.versions).toHaveLength(1);
    expect(i.metadata.reviewCodes).toEqual(expect.arrayContaining(['lineageVersionsPending','speciesAbilityPolicyPending','conditionalDamageTypesPending']));
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('blocks missing parents and ambiguous merges; keeps legacy background ASI out of 2024 projection',()=>{
    const r=buildPilot(fixture([{name:'Base',source:'PHB',ability:[{str:2},{dex:2}]}],
      [{name:'Child',source:'PHB',raceName:'Base',raceSource:'PHB',ability:[{wis:1}]},
       {name:'Missing',source:'PHB',raceName:'Absent',raceSource:'PHB'}],
      [{name:'Legacy',source:'PHB',ability:weighted()}]),['PHB']);
    expect(r.counts.PHB.subrace).toMatchObject({total:2,converted:0,blocked:2});
    expect(r.packs[0].items.find((x:any)=>x.kind==='background').payload.abilityScoreOptions).toBeUndefined();
  });
  test('does not flatten alternative proficiency groups or unqualified feat grants',()=>{
    const r=buildPilot(fixture([],[],[{name:'Choices',source:'XPHB',skillProficiencies:[{arcana:true},{history:true}],
      languageProficiencies:[{anyStandard:2}],feats:[{anyFromCategory:{category:['O'],count:1}}]}]),['XPHB']);
    const i=r.packs[0].items[0];
    expect(i.payload.skillProficiencies).toBeUndefined();
    expect(i.payload.languageProficiencyChoice).toBeUndefined();
    expect(i.payload.mechanics.upstreamOrigin.feats).toHaveLength(1);
    expect(i.metadata.reviewCodes).toEqual(expect.arrayContaining(['skillAlternativesPending','languageProficiencyPending','featGrantsPending']));
  });
});
const snapshotPath=process.env.DND_UPSTREAM_ORIGIN_SNAPSHOT;
(snapshotPath?test:test.skip)('real origin pilot reports aggregate only',()=>{
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
    for(const k of ['race','subrace','background']){const c=r.counts[code][k];expect(c.total).toBe(c.converted+c.blocked);}
    expect(validation[code].invalid).toBe(0);
  }
  expect(r.counts.XPHB.race.converted).toBeGreaterThan(0);expect(r.counts.XPHB.background.converted).toBeGreaterThan(0);
},120000);
