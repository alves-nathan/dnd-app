import { stageImportV3 } from '../compendium/importV3Staging';
const {buildPilot,physicalId} = require('../../scripts/5etools/spell-converter');
const {openSnapshot} = require('../../scripts/5etools/inventory');

const spell = (overrides:Record<string,unknown>={}) => ({
  name:'Fixture Ray',source:'XPHB',page:1,level:0,school:'V',
  time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},
  duration:[{type:'instant'}],components:{v:true,s:true},
  entries:['Make a ranged spell attack against the target. On a hit, the target takes {@damage 1d6} Fire damage.'],
  damageInflict:['fire'],spellAttack:['R'],...overrides
});
function fixture(spells:ReturnType<typeof spell>[],access:Record<string,unknown>={class:{XPHB:{Wizard:true},WoW:{Mage:true}}}) {
  const data:Record<string,unknown> = {
    'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'}]},
    'data/spells/index.json':{XPHB:'spells-xphb.json'},
    'data/spells/spells-xphb.json':{spell:spells},
    'data/generated/gendata-spell-source-lookup.json':{xphb:Object.fromEntries(spells.map(s=>[String(s.name).toLowerCase(),access]))}
  };
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools spell pilot conversion',()=>{
  test('maps typed spell fields, source-filtered class access and narrow direct damage',()=>{
    const r=buildPilot(fixture([spell()]),['XPHB']);
    expect(r.counts.XPHB).toMatchObject({total:1,converted:1,blocked:0,baseDamageMapped:1});
    const item=r.packs[0].items[0];
    expect(item.payload).toMatchObject({level:0,school:'Evocation',classes:['Wizard'],range:'60 ft',duration:'Instantaneous',
      castingTime:{kind:'action',actionCost:'action'},components:{verbal:true,somatic:true,material:false},
      damageFormula:'1d6',damageType:'fire',requiresAttackRoll:true});
    expect(item.payload.mechanics.upstreamSpell.access.class.WoW).toEqual({Mage:true});
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
    expect(item.source.status).toBe('needsReview');
  });
  test('keeps multi-projectile damage, slot scaling, materials and save observations without inventing formulas',()=>{
    const s=spell({name:'Fixture Darts',level:1,spellAttack:[],savingThrow:['dexterity','wisdom'],
      components:{v:true,m:{text:'fixture material',cost:2500,consume:true}},
      entries:['Each dart deals {@damage 1d4 + 1} Force damage.'],damageInflict:['force'],
      entriesHigherLevel:[{entries:['One additional dart.']}]});
    const r=buildPilot(fixture([s]),['XPHB']);
    const item=r.packs[0].items[0];
    expect(item.payload.damageFormula).toBeUndefined();
    expect(item.payload.saveAbility).toBeUndefined();
    expect(item.payload.requiresAttackRoll).toBeUndefined();
    expect(item.payload.mechanics.upstreamSpell.components.m.cost).toBe(2500);
    expect(item.metadata.reviewCodes).toEqual(expect.arrayContaining(['damageSemanticsPending','scalingSemanticsPending','materialCostOrConsumption','multipleOrUnknownSaves']));
    expect(stageImportV3(r.packs[0]).ok).toBe(true);
  });
  test('maps reactions, concentration, ritual and a self-origin area without guessing targets',()=>{
    const s=spell({time:[{number:1,unit:'reaction',condition:'fixture trigger'}],
      range:{type:'emanation',distance:{type:'feet',amount:10}},
      duration:[{type:'timed',duration:{type:'minute',amount:1},concentration:true}],
      meta:{ritual:true},savingThrow:['constitution']});
    const item=buildPilot(fixture([s]),['XPHB']).packs[0].items[0];
    expect(item.payload).toMatchObject({castingTime:{kind:'action',actionCost:'reaction',trigger:'fixture trigger'},
      area:{shape:'emanation',origin:'self',distance:10,unit:'ft'},concentration:true,ritual:true,saveAbility:'CON'});
    expect(item.payload.targets).toBeUndefined();
  });
  test('blocks missing eligible class access, duplicates and invalid levels',()=>{
    expect(buildPilot(fixture([spell()],{class:{WoW:{Mage:true}}}),['XPHB']).counts.XPHB.blocked).toBe(1);
    expect(buildPilot(fixture([spell(),spell()]),['XPHB']).counts.XPHB.blocked).toBe(2);
    expect(buildPilot(fixture([spell({level:10})]),['XPHB']).counts.XPHB.blocked).toBe(1);
  });
  test('physical IDs are stable across case, not across publication source',()=>{
    expect(physicalId('XPHB','Fixture Ray')).toBe(physicalId('xphb','fixture ray'));
    expect(physicalId('PHB','Fixture Ray')).not.toBe(physicalId('XPHB','Fixture Ray'));
  });
});
const snapshotPath=process.env.DND_UPSTREAM_SPELL_SNAPSHOT;
(snapshotPath?test:test.skip)('real upstream pilot: aggregate schema and semantic validation only',()=>{
  if(!snapshotPath) throw Error('missing snapshot');
  const result=buildPilot(openSnapshot(snapshotPath));
  const validated:Record<string,{schemaAndSemanticValid:number;blocked:number;issueCodes:Record<string,number>}>={};
  for(const pack of result.packs) {
    const code=pack.source.id.split(':').at(-1);
    const stats={schemaAndSemanticValid:0,blocked:0,issueCodes:{} as Record<string,number>};
    for(const item of pack.items) {
      const r=stageImportV3({...pack,items:[item]});
      if(r.ok) stats.schemaAndSemanticValid++; else stats.blocked++;
      for(const issue of r.issues) stats.issueCodes[issue.code]=(stats.issueCodes[issue.code]||0)+1;
    }
    validated[code]=stats;
  }
  console.log(JSON.stringify({commit:result.commit,counts:result.counts,validated,activation:'review-required'}));
  for(const code of Object.keys(result.counts)) {
    const c=result.counts[code];
    expect(c.total).toBeGreaterThan(0);
    expect(c.converted+c.blocked).toBe(c.total);
    expect(validated[code].blocked).toBe(0);
  }
},120000);
