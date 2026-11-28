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

describe('functional copy operations',()=>{
 const {applyMods}=require('../../scripts/5etools/resolver');
 test('adds attack/DC tags, renames entries, prefixes strings and floors numeric scaling only in functional mode',()=>{
  const entity={name:'Fixture',trait:[{name:'Old Trait',entries:['Old prose {@hit +4} {@dc 12|CON} {@damage 1d6}',{type:'entries',entries:['{@hit -1}']}]}],skill:{arcana:'+5'},label:'core'};
  const mods={trait:[{mode:'replaceName',replace:'Old',with:'New'},{mode:'scalarAddHit',scalar:2},{mode:'scalarAddDc',scalar:1}],skill:{mode:'scalarMultProp',prop:'arcana',scalar:0.5,floor:true},_:{mode:'prefixSuffixStringProp',prop:'label',prefix:'pre-',suffix:'-post'}};
  expect(()=>applyMods(JSON.parse(JSON.stringify(entity)),mods)).toThrow();
  const out=applyMods(JSON.parse(JSON.stringify(entity)),mods,{functional:true});
  expect(out.trait[0]).toEqual({name:'New Trait',entries:['Old prose {@hit 6} {@dc 13} {@damage 1d6}',{type:'entries',entries:['{@hit 1}']}]});
  expect(out.skill.arcana).toBe('+2');expect(out.label).toBe('pre-core-post');
  expect(entity.trait[0].name).toBe('Old Trait');
 });
 test('keeps unsafe modifiers and dynamic expressions blocked',()=>{
  const entity={trait:[{name:'Fixture',entries:['{@hit 3}']}]};
  expect(()=>applyMods(entity,{trait:{mode:'replaceName',replace:'F.*',with:'X'}},{functional:true})).toThrow();
  expect(()=>applyMods(entity,{_:{mode:'prefixSuffixStringProp',prop:'__proto__.polluted',prefix:'x'}},{functional:true})).toThrow();
  expect(()=>applyMods(entity,{trait:{mode:'scalarAddHit',scalar:1,extra:'unknown'}},{functional:true})).toThrow();
  expect(()=>applyMods(entity,{trait:{mode:'replaceName',replace:'Fixture',with:'<$name$>'}},{functional:true})).toThrow();
 });
 test('uses extended operations inside external templates and nested versions',()=>{
  const base=beast('Base',{trait:[{name:'Old Trait',entries:['{@hit 4}']}]});
  const child={name:'Child',source:'NEW',_copy:{name:'Base',source:'NEW',_templates:[{name:'Fixture Template',source:'NEW'}]},_versions:[{name:'Version',source:'NEW',_mod:{trait:{mode:'scalarAddHit',scalar:1}}}]};
  const template={name:'Fixture Template',source:'NEW',apply:{_mod:{trait:{mode:'scalarAddHit',scalar:2}}}};
  const rows=[record(base),record(child,1)],snapshot=fixture([base,child],[template]),resolved=createFunctionalResolver(snapshot,rows).resolve(rows[1]);
  expect(resolved.entity.trait[0].entries).toEqual(['{@hit 6}']);
  const v=expandFunctionalVersions(rows[1],resolved,new Set(rows.map(r=>r.id)));
  expect(v.candidates[0].entity.trait[0].entries).toEqual(['{@hit 7}']);
 });
});

test('binds cross-source versions to selected source and parent, preserves target pack and exact provenance',()=>{
 const {describeVersionScope,versionAuthorization}=require('../../scripts/5etools/functional-version-scope');
 const {assembleReviewConversion}=require('../../scripts/5etools/functional-convert');
 const {digest}=require('../../scripts/5etools/integrated-review');
 const parent=beast('Base',{_versions:[{name:'Foreign',source:'OTHER'},{name:'Excluded',source:'NO'}]});
 const snapshot=fixture([parent]);
 const descriptor={origin:'main',path:'data/bestiary/bestiary-new.json',kind:'monster',index:0,blob,rootArray:true,lane:'resolverEntity',sourceId:JSON.stringify(['main','NEW']),disposition:'included',valueFingerprint:digest(parent)};
 const decisions=new Map([['["main","NEW"]','include'],['["main","OTHER"]','include'],['["main","NO"]','exclude']]);
 const row={...descriptor,versions:describeVersionScope(descriptor,parent,decisions)};
 const body={schemaVersion:'dnd-upstream-functional-input-plan.v1',scope:'privateConversionInputs',executable:false,commits:{main:commit,homebrew:'b'.repeat(40),application:'c'.repeat(40)},bindings:{corpus:'fixture',scope:'fixture'},rows:[row]};
 const plan={...body,fingerprint:digest(body)};
 const r=buildFunctionalIndexed(snapshot,'monster',['NEW'],versionAuthorization(plan));
 expect(r.counts.NEW).toMatchObject({total:1,converted:1,versionsConverted:1,versionsBlocked:1});
 expect(r.packs.map((p:any)=>p.source.id)).toEqual(['upstream:main:NEW','upstream:main:OTHER']);
 const foreign=r.packs[1].items[0];
 expect(foreign.provenance).toMatchObject({entityKey:identity('monster',parent),sourceCode:'OTHER',index:0});
 const assembled=assembleReviewConversion(plan,[{stage:'a5.2',kinds:['creatureStatBlock'],result:r}],stageImportV3);
 expect(assembled.manifest.counts).toMatchObject({partialReview:1,exportedItems:2});
 expect(assembled.manifest.ledger[0].versions.map((v:any)=>[v.disposition,v.outputs.length])).toEqual([['included',1],['excluded',0]]);
 foreign.metadata.versionOrigin.specFingerprint='tampered';
 expect(()=>assembleReviewConversion(plan,[{stage:'a5.2',kinds:['creatureStatBlock'],result:r}],stageImportV3)).toThrow('functionalConversionProvenanceMismatch');
 const excluded={...descriptor,disposition:'excluded'};
 expect(describeVersionScope(excluded,parent,decisions).every((v:any)=>v.disposition==='parentNotIncluded')).toBe(true);
});
