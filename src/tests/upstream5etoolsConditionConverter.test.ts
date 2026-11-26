import {stageImportV3} from '../compendium/importV3Staging';
import {COMPENDIUM_ENTITY_KINDS} from '../compendium/importDomain';
const {buildPilot,physicalId}=require('../../scripts/5etools/condition-converter');
const {converters,summarizePilotCoverage}=require('../../scripts/5etools/pilot-coverage');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const condition=(name:string,source='XPHB',extra:Record<string,unknown>={})=>({name,source,entries:['Synthetic fixture'],...extra});
function fixture(conditions:unknown[],statuses:unknown[]=[],diseases:unknown[]=[]){
  const data:Record<string,unknown>={'data/books.json':{book:[{source:'PHB',name:'Fixture 2014',published:'2014-01-01'},{source:'XPHB',name:'Fixture 2024',published:'2024-01-01'}]},'data/conditionsdiseases.json':{condition:conditions,status:statuses,disease:diseases}};
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools condition pilot',()=>{
  test('keeps edition-specific identities, staging slugs and raw exhaustion rules separate',()=>{
    const legacy=condition('Exhaustion','PHB',{entries:['Old synthetic rule'],reprintedAs:['Exhaustion|XPHB']});
    const revised=condition('Exhaustion','XPHB',{entries:['New synthetic rule']});
    const r=buildPilot(fixture([legacy,revised]));
    const a=r.packs[0].items[0],b=r.packs[1].items[0];
    expect(a.id).not.toBe(b.id);expect(a.id).toBe(physicalId(legacy));expect(a.identity.canonicalKey).toBe(b.identity.canonicalKey);
    expect(a.payload.conditionId).not.toBe(b.payload.conditionId);
    expect(a.payload).toMatchObject({officialCondition:true,mechanics:{runtimeConditionCandidate:'exhaustion',upstreamCondition:legacy}});
    expect(a.payload.effects).toBeUndefined();expect(a.payload.endConditions).toBeUndefined();
    expect(a.payload.mechanics.conditionReviewCandidate).toEqual({rulesEra:'2014',stackPolicy:'editionSpecificPending',effectPolicy:'unreviewed',endPolicy:'unreviewed',runtimeAlias:'unapproved'});
    expect(b.payload.mechanics.conditionReviewCandidate).toEqual({...a.payload.mechanics.conditionReviewCandidate,rulesEra:'2024'});
    expect(a.metadata.reviewCodes).toContain('stackedConditionEditionPolicyPending');
    expect(a.precedence.relation).toBe('unresolved');expect(a.metadata.upstreamReprintedAs).toEqual(['Exhaustion|XPHB']);
    expect(stageImportV3({...r.packs[0],items:[a,b]}).ok).toBe(true);
  });
  test('counts statuses, diseases and nonpilot conditions without emitting them',()=>{
    const r=buildPilot(fixture([condition('Blinded'),condition('Blinded','Other')],[condition('Concentration'),condition('Bloodied')],[condition('Blinded','DMG')]));
    expect(r.inventory.condition).toMatchObject({total:2,pilot:1,deferred:1});
    expect(r.inventory.status).toMatchObject({total:2,pilot:0,deferred:2});
    expect(r.inventory.disease).toMatchObject({total:1,pilot:0,deferred:1});
    expect(r.packs.flatMap((p:any)=>p.items)).toHaveLength(1);
    expect(stageImportV3(r.packs[1]).ok).toBe(true);
  });
  test('blocks ambiguous identity, unknown official classification, invalid entries and variants',()=>{
    const r=buildPilot(fixture([condition('Blinded'),condition('Blinded'),condition('Unknown'),condition('Prone','XPHB',{entries:[]}),condition('Charmed','XPHB',{_versions:[{}]})]),['XPHB']);
    expect(r.counts.XPHB).toMatchObject({total:5,converted:0,blocked:5,blockCodes:{ambiguousIdentity:2,conditionClassificationPending:1,invalidConditionEntries:1,unsupportedVariantOrTemplate:1}});
    expect(r.packs[0].items).toHaveLength(0);
  });
  test('registry covers exactly the 13 contract kinds and eight pilot stages',()=>{
    const kinds=new Set<string>(converters.flatMap((c:{kinds:string[]})=>c.kinds));
    expect([...kinds].sort()).toEqual([...COMPENDIUM_ENTITY_KINDS].sort());
    expect(new Set(converters.map((c:{stage:string})=>c.stage)).size).toBe(8);
  });
});
const snapshotPath=process.env.DND_UPSTREAM_CONDITION_SNAPSHOT;
(snapshotPath?test:test.skip)('real conditions validate jointly with no collisions and aggregate deferred families',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=buildPilot(openSnapshot(snapshotPath)),items=r.packs.flatMap((p:any)=>p.items),v=stageImportV3({...r.packs[0],items});
  const codes:Record<string,number>={};for(const issue of v.issues)codes[issue.code]=(codes[issue.code]||0)+1;
  const ids=new Set(items.map((i:any)=>i.payload.conditionId));
  console.log(JSON.stringify({commit:r.commit,counts:r.counts,inventory:r.inventory,validation:{ok:v.ok,items:items.length,uniqueConditionIds:ids.size,codes},activation:r.activation}));
  expect(v.ok).toBe(true);expect(ids.size).toBe(items.length);
  for(const i of items){
    expect(i.payload.mechanics.conditionReviewCandidate).toMatchObject({rulesEra:i.source.rulesEra,effectPolicy:'unreviewed',endPolicy:'unreviewed',runtimeAlias:'unapproved'});
    expect(i.payload.effects).toBeUndefined();
    expect(i.payload.endConditions).toBeUndefined();
  }
  expect(r.inventory.condition.total).toBe(r.inventory.condition.pilot+r.inventory.condition.deferred);
  for(const c of Object.values(r.counts) as {total:number;converted:number;blocked:number}[])expect(c.total).toBe(c.converted+c.blocked);
  expect(r.counts.PHB.converted).toBe(15);expect(r.counts.XPHB.converted).toBe(15);
  for(const k of ['status','disease'])expect(r.inventory[k].total).toBe(r.inventory[k].deferred);
},120000);
(snapshotPath?test:test.skip)('all eight real pilots emit the 13 kinds, distinct physical IDs and review-required only',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=summarizePilotCoverage(openSnapshot(snapshotPath));
  console.log(JSON.stringify(r));
  expect(Object.keys(r.totals).sort()).toEqual([...COMPENDIUM_ENTITY_KINDS].sort());
  expect(r.issues).toEqual({});expect(r.emitted).toBe(r.uniquePhysicalIds);
},240000);
