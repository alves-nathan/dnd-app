import {stageImportV3} from '../compendium/importV3Staging';
const {buildPilot,physicalId,pbFromCR}=require('../../scripts/5etools/creature-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');

const creature=(overrides:Record<string,unknown>={})=>({
  name:'Fixture Beast',source:'XMM',page:1,size:['M'],type:'beast',alignment:['U'],
  ac:[13],hp:{average:11,formula:'2d8 + 2'},speed:{walk:40},cr:'1/4',
  str:12,dex:14,con:12,int:3,wis:10,cha:6,save:{dex:'+4'},skill:{perception:'+2'},
  action:[{name:'Fixture Bite',entries:['{@atkr m} {@hit 4}, reach 5 ft. {@h}5 ({@damage 1d6 + 2}) Piercing damage.']}],
  ...overrides
});
function fixture(creatures:ReturnType<typeof creature>[]) {
  const data:Record<string,unknown>={
    'data/books.json':{book:[{source:'XMM',name:'Fixture Book',published:'2025-02-18'}]},
    'data/adventures.json':{adventure:[]},
    'data/bestiary/index.json':{XMM:'bestiary-xmm.json'},
    'data/bestiary/bestiary-xmm.json':{monster:creatures}
  };
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools creature pilot',()=>{
  test('maps static stats and exact 2024 attack pattern through V3 staging',()=>{
    const r=buildPilot(fixture([creature()]),['XMM']);
    expect(r.counts.XMM).toMatchObject({total:1,converted:1,blocked:0,actions:1,simpleAttacks:1});
    const p=r.packs[0].items[0].payload;
    expect(p).toMatchObject({size:'Medium',creatureType:'beast',armorClass:13,hitPoints:{average:11,formula:'2d8 + 2'},
      speed:{walk:40},abilityScores:{STR:12,DEX:14,CON:12,INT:3,WIS:10,CHA:6},challenge:'1/4',proficiencyBonus:2,
      savingThrows:{DEX:4},skills:{Perception:2},actions:[{type:'attack',attackBonus:4,damageFormula:'1d6 + 2',damageType:'piercing',reach:'5 ft.'}]});
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
    expect(r.packs[0].items[0].source.status).toBe('needsReview');
  });
  test('recognizes exact classic attack format and does not promote multi-damage attacks or riders',()=>{
    const c=creature({action:[
      {name:'Classic',entries:['{@atk rw} {@hit 5} to hit, range 30/120 ft., one target. {@h}6 ({@damage 1d6 + 3}) piercing damage.']},
      {name:'Two Types',entries:['{@atkr m} {@hit 4}, reach 5 ft. {@h}5 ({@damage 1d6 + 2}) Piercing damage plus 3 ({@damage 1d6}) Fire damage.']},
      {name:'Rider',entries:['{@atkr m} {@hit 4}, reach 5 ft. {@h}5 ({@damage 1d6 + 2}) Piercing damage, and the target is prone.']},
      {name:'Multiattack',entries:['The beast makes two attacks.']}
    ]});
    const r=buildPilot(fixture([c]),['XMM']);
    const a=r.packs[0].items[0].payload.actions;
    expect(a[0]).toMatchObject({range:'30/120 ft.',attackBonus:5,damageFormula:'1d6 + 3'});
    expect(a[1].damageFormula).toBeUndefined();
    expect(a[2].damageFormula).toBeUndefined();
    expect(r.counts.XMM).toMatchObject({simpleAttacks:1,multiattacks:1});
  });
  test('preserves alternative AC, dynamic HP, movement and conditional damage immunities without flattening',()=>{
    const c=creature({ac:[12,{ac:15,condition:'with shield'}],hp:{special:'5 per level'},cr:undefined,pbNote:'equals yours',
      speed:{walk:20,fly:{number:40,condition:'while transformed'},canHover:true},
      resist:['fire',{resist:['slashing'],note:'from nonmagical attacks'}],
      immune:[{immune:['poison'],note:'conditional'}],conditionImmune:['charmed'],
      spellcasting:[{name:'Spellcasting',will:['fixture']}],legendary:[{name:'Fixture',entries:['fixture']}]
    });
    // Undefined is not a JSON value; emulate the actual upstream shape.
    const actual=JSON.parse(JSON.stringify(c));
    const r=buildPilot(fixture([actual]),['XMM']),item=r.packs[0].items[0];
    expect(item.payload.armorClass).toEqual({alternatives:actual.ac});
    expect(item.payload.hitPoints).toEqual({special:'5 per level'});
    expect(item.payload.challenge).toBeUndefined();
    expect(item.payload.proficiencyBonus).toBeUndefined();
    expect(item.payload.resistances).toEqual(['fire']);
    expect(item.payload.immunities).toEqual({damage:[],conditions:['charmed']});
    expect(item.payload.mechanics.upstreamCreature).toMatchObject({immune:actual.immune,legendary:actual.legendary});
    expect(item.metadata.reviewCodes).toEqual(expect.arrayContaining(['dynamicOrAlternativeAC','dynamicHP','conditionalResistancesPending','conditionalImmunitiesPending','spellcastingPending','legendaryAndLairPending']));
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('blocks variants, duplicate identities and malformed ability scores; preserves denominators',()=>{
    const r=buildPilot(fixture([creature(),creature(),creature({name:'Variant',_versions:[{}]}),creature({name:'Bad',str:null})]),['XMM']);
    expect(r.counts.XMM).toMatchObject({total:4,converted:0,blocked:4,blockCodes:{ambiguousIdentity:2,unsupportedVariantOrTemplate:1,invalidAbilityScore:1}});
  });
  test('physical IDs are source-scoped and CR proficiency has correct boundaries',()=>{
    expect(physicalId('XMM','Fixture Beast')).toBe(physicalId('xmm','fixture beast'));
    expect(physicalId('MM','Fixture Beast')).not.toBe(physicalId('XMM','Fixture Beast'));
    expect([0.125,4,5,8,9,30].map(pbFromCR)).toEqual([2,2,3,3,4,9]);
  });
});
const snapshotPath=process.env.DND_UPSTREAM_CREATURE_SNAPSHOT;
(snapshotPath?test:test.skip)('real creature pilot reports aggregate schema and semantic validation only',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=buildPilot(openSnapshot(snapshotPath));
  const validated:Record<string,{schemaAndSemanticValid:number;blocked:number;issueCodes:Record<string,number>}>={};
  for(const p of r.packs){
    const code=p.source.id.split(':').at(-1);
    const stats={schemaAndSemanticValid:0,blocked:0,issueCodes:{} as Record<string,number>};
    for(const item of p.items){
      const v=stageImportV3({...p,items:[item]});
      if(v.ok)stats.schemaAndSemanticValid++;else stats.blocked++;
      for(const issue of v.issues)stats.issueCodes[issue.code]=(stats.issueCodes[issue.code]||0)+1;
    }
    validated[code]=stats;
  }
  console.log(JSON.stringify({commit:r.commit,counts:r.counts,validated,activation:'review-required'}));
  for(const code of Object.keys(r.counts)){
    const c=r.counts[code];
    expect(c.total).toBeGreaterThan(0);
    expect(c.converted).toBeGreaterThan(0);
    expect(c.converted+c.blocked).toBe(c.total);
    expect(validated[code].blocked).toBe(0);
  }
},120000);

describe('functional Main creature conversion beyond pilots',()=>{
 const {buildFunctionalIndexed}=require('../../scripts/5etools/functional-indexed-converter');
 test('converts indexed and unindexed records, retains explicit era and blocks malformed rows',()=>{
  const data:Record<string,unknown>={'data/books.json':{book:[]},'data/adventures.json':{adventure:[{source:'NEW',name:'Fixture adventure',published:'2025-01-01',edition:'classic'}]},'data/bestiary/index.json':{NEW:'bestiary-new.json'},'data/bestiary/bestiary-new.json':{monster:[creature({source:'NEW',name:'New Beast'}),creature({source:'NEW',name:'Broken',str:null})]},'data/bestiary/bestiary-extra.json':{monster:[creature({source:'NEW',name:'Extra',edition:'one'}),creature({source:'OTHER',name:'Excluded'})]}};
  const snapshot={commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
  const r=buildFunctionalIndexed(snapshot,'monster',['NEW']);
  expect(r.counts.NEW).toMatchObject({total:3,converted:2,blocked:1,blockCodes:{invalidAbilityScore:1}});
  expect(r.packs[0].items.find((x:any)=>x.name==='New Beast').source.rulesEra).toBe('2014');
  const conflict=r.packs[0].items.find((x:any)=>x.name==='Extra');
  expect(conflict.source.rulesEra).toBe('unknown');
  expect(conflict.metadata.reviewCodes).toContain('sourceEditionConflict');
  expect(stageImportV3(r.packs[0]).ok).toBe(true);
 });
});
