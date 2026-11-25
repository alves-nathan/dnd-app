import {stageImportV3} from '../compendium/importV3Staging';
const {buildPilot,physicalId,projectSpellcasting}=require('../../scripts/5etools/class-converter');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const cls=(source='XPHB',extra:Record<string,unknown>={})=>({name:'Fixture',source,hd:{number:1,faces:8},proficiency:['con','int'],classFeatures:['Feature|Fixture|'+source+'|1'],...extra});
const cf=(source='XPHB',extra:Record<string,unknown>={})=>({name:'Feature',source,className:'Fixture',classSource:source,level:1,entries:['Synthetic'],...extra});
const sub=(source='XPHB',extra:Record<string,unknown>={})=>({name:'Path',shortName:'Path',source,className:'Fixture',classSource:source,subclassFeatures:['Choice|Fixture|'+source+'|Path|'+source+'|3'],...extra});
const sf=(source='XPHB',extra:Record<string,unknown>={})=>({name:'Choice',source,className:'Fixture',classSource:source,subclassShortName:'Path',subclassSource:source,level:3,entries:['Synthetic'],...extra});
function fixture(collections:Record<string,unknown>){
  const data:Record<string,unknown>={'data/books.json':{book:['PHB','XPHB','TCE','XGE','EFA'].map(source=>({source,name:'Fixture '+source,published:'2024-01-01'}))},'data/class/class-fixture.json':collections};
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
function combined(r:any){
  return stageImportV3({...r.packs[0],id:'class-graph-test',items:r.packs.flatMap((p:any)=>p.items)});
}
describe('5etools class and progression pilot',()=>{
  test('builds exact bidirectional owners, grouped levels and keeps choice annotations',()=>{
    const c=cls('XPHB',{classFeatures:[{classFeature:'Feature|Fixture|XPHB|1',gainSubclassFeature:true}],primaryAbility:[{int:true}],startingProficiencies:{skills:[{choose:{from:['arcana','history'],count:1}}],weapons:['simple'],armor:['light']}});
    const r=buildPilot(fixture({class:[c],classFeature:[cf()],subclass:[sub()],subclassFeature:[sf()]}),['XPHB']);
    const items=r.packs[0].items;
    expect(items).toHaveLength(4);
    const cl=items.find((i:any)=>i.kind==='class'),sc=items.find((i:any)=>i.kind==='subclass'),f=items.find((i:any)=>i.payload.sourceType==='classFeature'),s=items.find((i:any)=>i.payload.sourceType==='subclassFeature');
    expect(cl.payload).toMatchObject({hitDie:8,primaryAbilities:['INT'],savingThrowProficiencies:['CON','INT'],skillChoiceCount:1,featureIds:[f.id],progression:[{level:1,featureIds:[f.id]}],mechanics:{featureGrantReferences:[{raw:{gainSubclassFeature:true}}]}});
    expect(sc.payload).toMatchObject({classId:cl.id,progression:[{level:3,featureIds:[s.id]}]});
    expect(f.payload.classId).toBe(cl.id);expect(s.payload).toMatchObject({classId:cl.id,subclassId:sc.id,levelGained:3});
    expect(combined(r).ok).toBe(true);
  });
  test('preserves different physical identities for editions, owner and level',()=>{
    expect(physicalId('class',cls('PHB'))).not.toBe(physicalId('class',cls()));
    expect(physicalId('classFeature',cf())).not.toBe(physicalId('classFeature',cf('XPHB',{level:2})));
    expect(physicalId('subclass',sub())).not.toBe(physicalId('subclass',sub('XPHB',{classSource:'PHB'})));
    expect(physicalId('classFeature',cf())).not.toBe(physicalId('subclassFeature',sf()));
  });
  test('resolves source-qualified feature from another publication in a closed graph',()=>{
    const c=cls('PHB',{classFeatures:['Feature|Fixture||1|TCE']});
    const f=cf('TCE',{classSource:'PHB'});
    const r=buildPilot(fixture({class:[c],classFeature:[f]}),['PHB','TCE']);
    expect(r.packs.flatMap((p:any)=>p.items)).toHaveLength(2);expect(combined(r).ok).toBe(true);
    expect(r.packs[0].items[0].payload.featureIds).toEqual([r.packs[1].items[0].id]);
  });
  test('blocks a cross-edition owner mismatch and propagates missing dependencies',()=>{
    const old=cls('PHB'),modern=cls('XPHB');
    const legacy=sub('PHB',{classSource:'XPHB',subclassFeatures:['Choice|Fixture||Path||3']});
    const r=buildPilot(fixture({class:[old,modern],classFeature:[cf('PHB'),cf()],subclass:[sub('PHB'),legacy],subclassFeature:[sf('PHB')]}),['PHB','XPHB']);
    expect(r.counts.PHB.subclass).toEqual({total:2,converted:1,blocked:1});
    expect(r.counts.PHB.blockCodes.crossOwnerFeatureReference).toBe(1);
    expect(combined(r).ok).toBe(true);
    const missing=buildPilot(fixture({class:[modern],classFeature:[cf('XPHB',{name:'Orphan'})],subclass:[sub()],subclassFeature:[sf()]}),['XPHB']);
    expect(missing.packs[0].items).toHaveLength(0);expect(missing.counts.XPHB.blockCodes.dependencyNotEmitted).toBe(3);
  });
  test('rejects duplicate identities and does not emit a partial feature list',()=>{
    const r=buildPilot(fixture({class:[cls()],classFeature:[cf(),cf()]}),['XPHB']);
    expect(r.packs[0].items).toHaveLength(0);
    expect(r.counts.XPHB.classFeature.blocked).toBe(2);expect(r.counts.XPHB.class.blocked).toBe(1);
  });
  test('projects explicit numeric spell tables and pact tables, leaves ambiguous or formula tables raw',()=>{
    const notes=new Set<string>();
    const full=projectSpellcasting({spellcastingAbility:'int',casterProgression:'full',cantripProgression:Array(20).fill(2),preparedSpells:'formula',classTableGroups:[{colLabels:['{@filter 1st|spells|level=1|class=Fixture}'],rowsSpellProgression:Array.from({length:20},()=>[2])}]},notes);
    expect(full).toMatchObject({ability:'INT',cantripsKnownByLevel:Array(20).fill(2),slotsByLevel:{'1':{'1':2},'20':{'1':2}}});
    expect(full.preparedSpellsByLevel).toBeUndefined();expect(notes.has('spellPreparationPolicyPending')).toBe(true);
    const pact=projectSpellcasting({spellcastingAbility:'cha',casterProgression:'pact',classTableGroups:[{colLabels:['Spell Slots','Slot Level'],rows:Array.from({length:20},()=>[2,'{@filter 2nd|spells|level=2|class=Fixture}'])}]},new Set());
    expect(pact.pactSlotsByLevel).toEqual(Array(20).fill(2));expect(pact.pactSlotLevelByLevel).toEqual(Array(20).fill(2));
    const bad=projectSpellcasting({spellcastingAbility:'cha',casterProgression:'pact',classTableGroups:[{colLabels:['Spell Slots','Slot Level'],rows:[[1,1]]}]},new Set());
    expect(bad.pactSlotsByLevel).toBeUndefined();
  });
  test('preserves OR primary abilities and never derives multiclass or resource rules',()=>{
    const c=cls('XPHB',{primaryAbility:[{str:true},{dex:true}],multiclassing:{requirements:{or:[{str:13},{dex:13}]}},optionalfeatureProgression:[{name:'Choice'}],classTableGroups:[{colLabels:['Resource'],rows:[[1]]}]});
    const r=buildPilot(fixture({class:[c],classFeature:[cf()]}),['XPHB']);
    const p=r.packs[0].items.find((i:any)=>i.kind==='class').payload;
    expect(p.primaryAbilities).toBeUndefined();expect(p.resources).toBeUndefined();
    expect(p.mechanics.upstreamClassRecord.multiclassing).toEqual(c.multiclassing);
    expect(combined(r).ok).toBe(true);
  });
});
const snapshotPath=process.env.DND_UPSTREAM_CLASS_SNAPSHOT;
(snapshotPath?test:test.skip)('real class graph pilot validates joint graph and emits aggregate only',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=buildPilot(openSnapshot(snapshotPath)),v=combined(r);
  const codes:Record<string,number>={};
  for(const issue of v.issues)codes[issue.code]=(codes[issue.code]||0)+1;
  const items=r.packs.flatMap((p:any)=>p.items),ids=new Set(items.map((i:any)=>i.id));
  let missing=0;
  for(const i of items)for(const id of [i.payload.classId,i.payload.subclassId,...(i.payload.featureIds||[])].filter(Boolean))if(!ids.has(id))missing++;
  console.log(JSON.stringify({commit:r.commit,counts:r.counts,validation:{ok:v.ok,items:items.length,codes,missing,unique:ids.size},activation:'review-required'}));
  for(const c of Object.values(r.counts) as any[])for(const k of ['class','subclass','classFeature','subclassFeature'])expect(c[k].total).toBe(c[k].converted+c[k].blocked);
  expect(v.ok).toBe(true);expect(missing).toBe(0);expect(ids.size).toBe(items.length);
  expect(r.counts.XPHB.class.converted).toBeGreaterThan(0);
  expect(r.counts.XPHB.subclass.converted).toBeGreaterThan(0);
  expect(r.counts.XPHB.classFeature.converted).toBeGreaterThan(0);
  expect(r.counts.XPHB.subclassFeature.converted).toBeGreaterThan(0);
},120000);
