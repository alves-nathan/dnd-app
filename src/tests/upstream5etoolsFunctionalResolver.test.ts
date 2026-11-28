import {stageImportV3} from '../compendium/importV3Staging';
const {identity,makeResolver}=require('../../scripts/5etools/resolver');
const {createFunctionalResolver,expandFunctionalVersions}=require('../../scripts/5etools/functional-resolver');
const {buildFunctionalIndexed}=require('../../scripts/5etools/functional-indexed-converter');
const commit='a'.repeat(40),blob='b'.repeat(40);
function fixture(monsters:Record<string,unknown>[],templates:unknown[]=[]){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'NEW',name:'Fixture',published:'2025-01-01',edition:'one'}]},
  'data/bestiary/index.json':{NEW:'bestiary-new.json'},
  'data/bestiary/bestiary-new.json':{monster:monsters},
  'data/bestiary/template.json':{monsterTemplate:templates,legendaryGroupTemplate:[]}
 };
 return {commit,files:new Map(Object.keys(data).map(p=>[p,blob])),readJson:(p:string)=>data[p]};
}
const beast=(name:string,extra:Record<string,unknown>={})=>({name,source:'NEW',size:['M'],type:'beast',ac:[12],hp:{average:9,formula:'2d8'},speed:{walk:30},str:10,dex:10,con:10,int:3,wis:10,cha:6,cr:'1/4',...extra});
function record(entity:Record<string,unknown>,index=0){
 const key=identity('monster',entity);
 return {id:JSON.stringify(['main',key]),key,kind:'monster',origin:'main',path:'data/bestiary/bestiary-new.json',index,blob,entity};
}
describe('functional structural resolution and variant emission',()=>{
 test('applies exact external template with child root precedence, ordered mods and provenance',()=>{
  const base=beast('Base',{trait:[{name:'Original',entries:['Fixture']}]}),child={name:'Child',source:'NEW',ac:[14],_copy:{name:'Base',source:'NEW',_templates:[{name:'Fixture Template',source:'NEW'}],_mod:{trait:{mode:'appendArr',items:[{name:'Child trait',entries:['Fixture']}]}}}};
  const template={name:'Fixture Template',source:'NEW',apply:{_root:{ac:[17],speed:{walk:40}},_mod:{trait:{mode:'appendArr',items:[{name:'Template trait',entries:['Fixture']}]}}}};
  const snapshot=fixture([base,child],[template]),records=[record(base),record(child,1)];
  expect(()=>makeResolver(records).resolve(records[1])).toThrow();
  const resolved=createFunctionalResolver(snapshot,records).resolve(records[1]);
  expect(resolved.entity.ac).toEqual([14]);expect(resolved.entity.speed).toEqual({walk:40});
  expect(resolved.entity.trait.map((x:any)=>x.name)).toEqual(['Original','Child trait','Template trait']);
  expect(resolved.templateLineage[0]).toMatchObject({path:'data/bestiary/template.json',index:0,blob});
  expect(resolved.lineage).toEqual([records[0].id]);
  const r=buildFunctionalIndexed(snapshot,'monster',['NEW']),item=r.packs[0].items.find((i:any)=>i.name==='Child');
  expect(r.counts.NEW).toMatchObject({total:2,converted:2,blocked:0});
  expect(item.metadata.externalTemplateLineage).toEqual(resolved.templateLineage);
  expect(stageImportV3(r.packs[0]).ok).toBe(true);
 });
 test('emits base and same-source versions, retains explicit pending foreign source and collisions',()=>{
  const parent=beast('Base',{_versions:[{name:'Variant',source:'NEW',_mod:{_:{mode:'setProp',prop:'ac',value:[15]}}},{name:'Foreign',source:'OTHER'},{name:'Existing',source:'NEW'},{name:'Duplicate',source:'NEW'},{name:'Duplicate',source:'NEW'}]});
  const snapshot=fixture([parent,beast('Existing')]),r=buildFunctionalIndexed(snapshot,'monster',['NEW']);
  expect(r.counts.NEW).toMatchObject({total:2,converted:2,blocked:0,versionCandidates:5,versionsConverted:1,versionsBlocked:4,blockCodes:{versionSourceSelectionPending:1,versionIdentityCollision:3}});
  const items=r.packs[0].items,variant=items.find((i:any)=>i.name==='Variant');
  expect(items.map((i:any)=>i.name).sort()).toEqual(['Base','Existing','Variant']);
  expect(variant.payload.armorClass).toBe(15);
  expect(variant.metadata.versionOrigin).toMatchObject({parentKey:identity('monster',parent),containerIndex:0,implementation:null});
  expect(variant.provenance).toMatchObject({index:0,entityKey:identity('monster',parent),sourceCode:'NEW'});
  expect(items.find((i:any)=>i.name==='Base').payload.mechanics.upstreamVersionContainer).toHaveLength(5);
  expect(stageImportV3(r.packs[0]).ok).toBe(true);
  expect(buildFunctionalIndexed(snapshot,'monster',['NEW'])).toEqual(r);
 });
 test('fails closed for missing template, cycles and unsafe template roots',()=>{
  const base=beast('Base'),child={name:'Child',source:'NEW',_copy:{name:'Base',source:'NEW',_templates:[{name:'Missing',source:'NEW'}]}};
  const rows=[record(base),record(child,1)];
  expect(()=>createFunctionalResolver(fixture([base,child]),rows).resolve(rows[1])).toThrow('missingTemplate');
  const unsafe={name:'Missing',source:'NEW',apply:{_root:{name:'Other'}}};
  expect(()=>createFunctionalResolver(fixture([base,child],[unsafe]),rows).resolve(rows[1])).toThrow('unsafeTemplateRoot');
  const cycle=record({...child,_copy:{...child._copy,name:'Child'}});
  expect(()=>createFunctionalResolver(fixture([]),[cycle]).resolve(cycle)).toThrow();
 });
 test('preserves abstract implementation coordinates and does not implicitly inherit version containers',()=>{
  const parent=beast('Base',{_versions:[{_abstract:{name:'{{label}}',source:'NEW'},_implementations:[{_variables:{label:'Variant A'}},{_variables:{label:'Variant B'}}]}]});
  const r=record(parent),resolved=createFunctionalResolver(fixture([parent]),[r]).resolve(r);
  const expanded=expandFunctionalVersions(r,resolved,new Set([r.id]));
  expect(expanded.candidates.map((v:any)=>[v.entity.name,v.containerIndex,v.implementation])).toEqual([['Variant A',0,0],['Variant B',0,1]]);
  const child=record({name:'Child',source:'NEW',_copy:{name:'Base',source:'NEW',_preserve:{'*':true}}},1);
  expect(()=>createFunctionalResolver(fixture([]),[r,child]).resolve(child)).toThrow();
 });
});
