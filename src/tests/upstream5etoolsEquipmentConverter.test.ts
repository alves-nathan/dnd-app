import {stageImportV3} from '../compendium/importV3Staging';
const {buildPilot,physicalId}=require('../../scripts/5etools/equipment-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');

const weapon=(overrides:Record<string,unknown>={})=>({
  name:'Fixture Blade',source:'XPHB',page:1,edition:'one',type:'M|XPHB',rarity:'none',
  weaponCategory:'simple',dmg1:'1d4',dmgType:'P',property:['F|XPHB','T|XPHB','L|XPHB'],
  range:'20/60',value:200,weight:1,mastery:['Nick|XPHB'],...overrides
});
function fixture(base:Record<string,unknown>[],items:Record<string,unknown>[]=[]){
  const data:Record<string,unknown>={
    'data/books.json':{book:[{source:'XPHB',name:'Fixture Book',published:'2024-09-17'}]},
    'data/items-base.json':{baseitem:base,itemProperty:['F','T','L','2H','V','S'].map(abbreviation=>({abbreviation,source:'XPHB'})),
      itemMastery:[{name:'Nick',source:'XPHB'}],itemType:[{name:'Adventuring Gear',abbreviation:'G',source:'XPHB'}]},
    'data/items.json':{item:items}
  };
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools equipment pilot',()=>{
  test('maps finesse, thrown range, mastery and cost without discarding UIDs',()=>{
    const r=buildPilot(fixture([weapon()]),['XPHB']);
    expect(r.counts.XPHB).toMatchObject({observed:1,eligible:1,converted:1,blocked:0,kinds:{weapon:1,armor:0,equipment:0}});
    expect(r.packs[0].items[0].payload).toMatchObject({weaponType:'finesse',weaponCategory:'simple',
      attackAbility:{kind:'choice',options:['STR','DEX']},damageFormula:'1d4 + STR_OR_DEX',damageType:'piercing',
      properties:['finesse','thrown','light'],range:{normal:20,long:60,unit:'ft'},mastery:'Nick',cost:{amount:2,unit:'GP'}});
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('preserves conditional properties and maps versatile damage without assuming mastery',()=>{
    const s=weapon({property:['V|XPHB',{uid:'2H|XPHB',note:'unless mounted'}],mastery:['Unknown|XPHB'],dmg1:'1d8',dmg2:'1d10'});
    const i=buildPilot(fixture([s]),['XPHB']).packs[0].items[0];
    expect(i.payload.properties).toEqual(['versatile']);
    expect(i.payload.damageFormula).toBe('1d8 + STR');
    expect(i.payload.versatileDamageFormula).toBe('1d10 + STR');
    expect(i.payload.mastery).toBeUndefined();
    expect(i.metadata.reviewCodes).toEqual(expect.arrayContaining(['conditionalWeaponProperty','masteryReferencePending']));
  });
  test('maps shields as additive AC and armor dexterity caps',()=>{
    const a=(name:string,type:string,ac:number,extra:Record<string,unknown>={})=>({name,type,ac,source:'XPHB',rarity:'none',value:1000,...extra});
    const r=buildPilot(fixture([a('Fixture Shield','S|XPHB',2),a('Fixture Heavy','HA|XPHB',16,{strength:'13',stealth:true}),
      a('Fixture Medium','MA|XPHB',14),a('Fixture Light','LA|XPHB',11)]),['XPHB']);
    const byName=new Map(r.packs[0].items.map((i:any)=>[i.name,i.payload]));
    expect(byName.get('Fixture Shield')).toMatchObject({armorCategory:'shield',baseAC:0,acBonus:2,stacksWithArmor:true});
    expect(byName.get('Fixture Heavy')).toMatchObject({armorCategory:'heavy',baseAC:16,dexCap:0,strengthRequirement:13,stealthDisadvantage:true});
    expect(byName.get('Fixture Medium')).toMatchObject({dexCap:2});
    expect(byName.get('Fixture Light')).toMatchObject({dexCap:null});
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('preserves equipment bundles, exact CP value and excludes magical records',()=>{
    const g={name:'Fixture Pack',type:'G|XPHB',source:'XPHB',rarity:'none',value:125,weight:3,packContents:['Fixture']};
    const r=buildPilot(fixture([],[g,{...g,name:'Fixture Magic',rarity:'rare'}]),['XPHB']);
    expect(r.counts.XPHB).toMatchObject({observed:2,eligible:1,excludedMagicOrUnclassified:1,converted:1});
    expect(r.packs[0].items[0].payload).toMatchObject({equipmentCategory:'Adventuring Gear',cost:{amount:125,unit:'CP'},mechanics:{upstreamItem:{packContents:['Fixture']}}});
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('blocks no-damage weapons and duplicate physical identities across item files',()=>{
    const w=weapon();
    const r=buildPilot(fixture([w,weapon({name:'Fixture Net',dmg1:undefined})],[w]),['XPHB']);
    expect(r.counts.XPHB).toMatchObject({eligible:3,converted:0,blocked:3,blockCodes:{weaponDamageUnresolved:1,duplicatePhysicalId:2}});
  });
  test('physical IDs distinguish source and kind',()=>{
    expect(physicalId('XPHB','weapon','Fixture')).toBe(physicalId('xphb','weapon','fixture'));
    expect(physicalId('PHB','weapon','Fixture')).not.toBe(physicalId('XPHB','weapon','Fixture'));
    expect(physicalId('XPHB','weapon','Fixture')).not.toBe(physicalId('XPHB','equipment','Fixture'));
  });
});
const snapshotPath=process.env.DND_UPSTREAM_EQUIPMENT_SNAPSHOT;
(snapshotPath?test:test.skip)('real equipment pilot reports aggregate validation only',()=>{
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
    expect(c.observed).toBe(c.eligible+c.excludedMagicOrUnclassified);
    expect(c.eligible).toBe(c.converted+c.blocked);
    expect(validated[code].blocked).toBe(0);
  }
  expect(r.counts.PHB.converted).toBeGreaterThan(0);
  expect(r.counts.XPHB.converted).toBeGreaterThan(0);
},120000);
