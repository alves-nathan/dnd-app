import * as fs from 'node:fs';
const {identity}=require('../../scripts/5etools/resolver');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {uid,createReferenceIndex,extractReferences,buildReferenceReport,publicSummary}=require('../../scripts/5etools/reference-index');
const sha='a'.repeat(40),blob='b'.repeat(40);
function target(kind:string,name:string,source:string,id:string,era='2024',origin='main',extra:Record<string,unknown>={}){
  const entity={name,source,...extra},key=identity(kind,entity);
  const record={origin,kind,key,entity,path:'fixture.json',index:0,blob};
  const item={id,kind:kind==='baseitem'?'weapon':kind==='optionalfeature'?'feature':kind,source:{rulesEra:era},provenance:{origin:origin==='main'?'5etools':'homebrew',entityKey:key,path:record.path,index:record.index,blob,sourceCode:source,commit:sha}};
  return {record,item};
}
function consumer(mechanics:Record<string,unknown>,era='2024',extra:Record<string,unknown>={}){
  return {id:'consumer',source:{rulesEra:era},provenance:{origin:'5etools',sourceCode:'XPHB'},payload:{mechanics,...extra}};
}
describe('source-qualified reference sidecar',()=>{
  test('never guesses omitted source, suffixes or selector syntax',()=>{
    expect(uid('Fixture')).toMatchObject({status:'sourceRequired'});
    expect(uid('Fixture|XPHB#c')).toMatchObject({status:'unsupportedExpression'});
    expect(uid('Fixture|XPHB|Display')).toMatchObject({status:'unsupportedExpression'});
    expect(uid(' Fixture | XPHB ')).toEqual({name:'Fixture',source:'XPHB'});
  });
  test('separates namespaces and editions, distinguishes raw-only from missing',()=>{
    const a=target('class','Fixture','PHB','old','2014'),b=target('class','Fixture','XPHB','new'),h=target('class','Fixture','XPHB','brew','2024','homebrew');
    const index=createReferenceIndex([a.record,b.record,h.record],[a.item,h.item]);
    expect(index.lookup('main',['class'],{name:'Fixture',source:'XPHB'})).toEqual({status:'targetNotEmitted'});
    expect(index.lookup('homebrew',['class'],{name:'Fixture',source:'XPHB'})).toMatchObject({targetId:'brew'});
    expect(index.lookup('main',['class'],{name:'fixture',source:'phb'})).toMatchObject({targetId:'old'});
    expect(index.lookup('main',['class'],{name:'Fixture',source:'Other'})).toEqual({status:'missingUpstreamIdentity'});
  });
  test('blocks duplicate raw identities and conflicting item families',()=>{
    const a=target('baseitem','Fixture','XPHB','base'),b=target('item','Fixture','XPHB','item');
    const index=createReferenceIndex([a.record,b.record],[a.item]);
    expect(index.lookup('main',['item','baseitem'],{name:'Fixture',source:'XPHB'})).toEqual({status:'ambiguousIdentity'});
    expect(createReferenceIndex([a.record,a.record],[a.item]).lookup('main',['baseitem'],{name:'Fixture',source:'XPHB'})).toEqual({status:'ambiguousIdentity'});
  });
  test('resolves direct spell access and edition-specific condition, never conditional immunity',()=>{
    const c=target('class','Fixture','XPHB','class'),old=target('condition','Exhaustion','PHB','old','2014'),modern=target('condition','Exhaustion','XPHB','new');
    const idx=createReferenceIndex([c.record,old.record,modern.record],[c.item,old.item,modern.item]);
    const x=consumer({upstreamSpell:{selectedClassAccess:[{name:'Fixture',source:'XPHB'}],conditionInflict:['exhaustion'],conditionImmune:[{conditionImmune:['exhaustion']}] }});
    const before=JSON.stringify(x),edges=extractReferences(x,idx);
    expect(edges).toEqual(expect.arrayContaining([expect.objectContaining({relation:'spellClassAccess',targetId:'class'}),expect.objectContaining({relation:'spellConditionInflict',targetId:'new',basis:'officialConditionEditionPolicy'}),expect.objectContaining({status:'conditionalExpressionPending'})]));
    expect(JSON.stringify(x)).toBe(before);
    expect(extractReferences(consumer({upstreamSpell:{conditionInflict:['exhaustion']}},'unknown'),idx)[0].status).toBe('editionRequired');
  });
  test('preserves choice branches, explicit feat links and selector prerequisites without applying them',()=>{
    const a=target('feat','Fixture','XPHB','feat'),b=target('baseitem','Tool','PHB','tool','2014');
    const idx=createReferenceIndex([a.record,b.record],[a.item,b.item]);
    const x=consumer({upstreamOrigin:{feats:[{'Fixture|XPHB':true},{any:1}],startingEquipment:[{A:[{item:'Tool|PHB',quantity:2}],B:[{value:5000}],C:[{equipmentType:'weaponSimple'}]}]},prerequisiteTree:{op:'any',children:[{op:'referenceRequirement',referenceType:'feat',raw:['Fixture|XPHB']},{op:'referenceRequirement',referenceType:'spell',raw:[{choose:'level=0'}]}]}});
    const e=extractReferences(x,idx);
    expect(e).toEqual(expect.arrayContaining([expect.objectContaining({relation:'originFeatGrant',targetId:'feat',path:expect.stringContaining('/0/')}),expect.objectContaining({relation:'startingEquipment',targetId:'tool',crossEra:true,path:expect.stringContaining('/A/')}),expect.objectContaining({relation:'startingEquipment',status:'selectorPending'}),expect.objectContaining({relation:'prerequisite:feat',targetId:'feat'}),expect.objectContaining({relation:'prerequisite:spell',status:'unsupportedExpression'})]));
    expect(e.every((v:any)=>v.activation==='review-required')).toBe(true);
  });
  test('validates physical owners and rejects provenance mismatch',()=>{
    const a=target('class','Fixture','XPHB','class');
    const idx=createReferenceIndex([a.record],[{...a.item,provenance:{...a.item.provenance,blob:'wrong'}}]);
    expect(idx.lookup('main',['class'],{name:'Fixture',source:'XPHB'})).toEqual({status:'provenanceMismatch'});
    expect(extractReferences(consumer({},'2024',{classId:'class',subclassId:'class'}),idx)).toEqual(expect.arrayContaining([expect.objectContaining({relation:'classOwner',targetId:'class'}),expect.objectContaining({relation:'subclassOwner',status:'wrongTargetKind'})]));
  });
});
const mainPath=process.env.DND_UPSTREAM_REFERENCE_MAIN,brewPath=process.env.DND_UPSTREAM_REFERENCE_BREW;
(mainPath&&brewPath?test:test.skip)('real reference sidecar reports aggregate identity resolution only',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildReferenceReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  const out=process.env.DND_UPSTREAM_REFERENCE_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
  expect(r.items).toBeGreaterThan(0);expect(r.byStatus.resolvedIdentity).toBeGreaterThan(0);
  expect(r.byStatus.provenanceMismatch||0).toBe(0);expect(r.byStatus.wrongTargetKind||0).toBe(0);
  expect(r.byRelation.spellClassAccess.resolvedIdentity).toBeGreaterThan(0);
  expect(r.byRelation.originFeatGrant.resolvedIdentity).toBeGreaterThan(0);
  expect(r.byRelation.featureGrant.resolvedIdentity).toBeGreaterThan(0);
  expect(r.edges.every((e:any)=>e.activation==='review-required')).toBe(true);
  expect(Object.values(r.byStatus).reduce((a:number,b:unknown)=>a+Number(b),0)).toBe(r.edges.length);
},240000);
