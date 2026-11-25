import {stageImportV3} from '../compendium/importV3Staging';
const {buildPilot,matches,expand}=require('../../scripts/5etools/magic-item-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const base={name:'Fixture Blade',source:'XPHB',edition:'one',type:'M|XPHB',weapon:true,weaponCategory:'simple',dmg1:'1d6',dmgType:'S',value:1000,weight:3,rarity:'none'};
const template={name:'Fixture Template',requires:[{weapon:true}],inherits:{source:'XDMG',nameSuffix:' +1',rarity:'uncommon',bonusWeapon:'+1',reqAttune:true}};
function fixture(variants:unknown[]=[template],items:unknown[]=[],bases:unknown[]=[base]){
  const data:Record<string,unknown>={
    'data/books.json':{book:[{source:'XDMG',name:'Fixture',published:'2024-11-12'}]},
    'data/items-base.json':{baseitem:bases},'data/items.json':{item:items},'data/magicvariants.json':{magicvariant:variants}
  };
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('magic item staging',()=>{
  test('requires OR/AND, excludes OR and edition compatibility',()=>{
    expect(matches(base,{...template,requires:[{weapon:true,weaponCategory:'martial'},{type:'M|XPHB'}]})).toBe(true);
    expect(matches(base,{...template,excludes:{weapon:true,type:'R'}})).toBe(false);
    expect(matches({...base,edition:'classic'},template)).toBe(false);
    expect(()=>matches(base,{...template,requires:[{weapon:{special:true}}]})).toThrow();
  });
  test('variant inherits base mechanics but not mundane price or source',()=>{
    const r=buildPilot(fixture(),['XDMG']);const item=r.packs[0].items[0];
    expect(r.counts.XDMG).toMatchObject({templates:1,templatesResolved:1,variantCandidates:1,variantsConverted:1});
    expect(item.name).toBe('Fixture Blade +1');
    expect(item.payload).toMatchObject({magicBonus:1,rarity:'uncommon',attunement:true,weight:3});
    expect(item.payload.cost).toBeUndefined();
    expect(item.payload.mechanics.baseEquipment).toMatchObject({damageFormula:'1d6 + STR',damageType:'slashing'});
    expect(item.metadata.variantBase).toMatchObject({source:'XPHB',index:0,blob:'b'.repeat(40)});
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('nested source and template copy modifications are resolved',()=>{
    const child={name:'Fixture Upgrade',source:'XDMG',_copy:{name:template.name,source:'XDMG',_mod:{'inherits.nameSuffix':{mode:'setProp',value:' +2'},'inherits.bonusWeapon':{mode:'setProp',value:'+2'}}}};
    const r=buildPilot(fixture([template,child]),['XDMG']);
    expect(r.counts.XDMG).toMatchObject({templates:2,templatesResolved:2,variantsConverted:2});
    expect(r.packs[0].items.map((x:any)=>x.payload.magicBonus).sort()).toEqual([1,2]);
  });
  test('blocks unsupported expressions instead of guessing and preserves concrete charges and attunement',()=>{
    const t={...template,inherits:{...template.inherits,valueExpression:'[[baseItem.value]] * 2'}};
    const item={name:'Fixture Charm',source:'XDMG',rarity:'rare',reqAttune:'by a wizard',charges:3,recharge:'dawn',rechargeAmount:'1d3',bonusAc:'+1'};
    const r=buildPilot(fixture([t],[item]),['XDMG']);
    expect(r.counts.XDMG).toMatchObject({concreteConverted:1,variantCandidates:1,variantsBlocked:1});
    expect(r.packs[0].items[0].payload).toMatchObject({attunement:true,mechanics:{armorClassBonus:1,upstreamItem:{charges:3}}});
    expect(r.packs[0].items[0].metadata.reviewCodes).toEqual(expect.arrayContaining(['chargeAndRechargePending','attunementRequirementsPending']));
  });
  test('conditional transforms and base identity are not silently overwritten',()=>{
    expect(()=>expand(base,{...template,inherits:{...template.inherits,resist:['fire']}})).toThrow();
    const r=buildPilot(fixture([template],[],[base,base]),['XDMG']);
    expect(r.counts.XDMG).toMatchObject({variantsConverted:0,variantsBlocked:2,blockCodes:{duplicatePhysicalId:2}});
  });
});
const snapshotPath=process.env.DND_UPSTREAM_MAGIC_SNAPSHOT;
(snapshotPath?test:test.skip)('real magic item pilot validates aggregate only',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=buildPilot(openSnapshot(snapshotPath));
  const validation:Record<string,{valid:number;invalid:number;codes:Record<string,number>}>={};
  for(const p of r.packs){
    const code=p.source.id.split(':').at(-1),stats={valid:0,invalid:0,codes:{} as Record<string,number>};
    for(const item of p.items){
      const result=stageImportV3({...p,items:[item]});
      if(result.ok)stats.valid++;else stats.invalid++;
      for(const issue of result.issues)stats.codes[issue.code]=(stats.codes[issue.code]||0)+1;
    }
    validation[code]=stats;
  }
  console.log(JSON.stringify({commit:r.commit,counts:r.counts,validation,activation:'review-required'}));
  for(const code of Object.keys(r.counts)){
    const c=r.counts[code];
    expect(c.concrete).toBe(c.concreteConverted+c.concreteBlocked);
    expect(c.templates).toBe(c.templatesResolved+c.templatesBlocked);
    expect(c.variantCandidates).toBe(c.variantsConverted+c.variantsBlocked);
    expect(validation[code].invalid).toBe(0);
  }
  expect(r.counts.XDMG.concreteConverted).toBeGreaterThan(0);
  expect(r.counts.XDMG.variantsConverted).toBeGreaterThan(0);
},120000);
