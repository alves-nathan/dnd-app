import * as fs from 'node:fs';
const {identity}=require('../../scripts/5etools/resolver');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {createReferenceIndex,extractReferences}=require('../../scripts/5etools/reference-index');
const {scan,category,parseUid,resolveUid,inlineEdges,refineEdges,spellLists,buildTagReport,publicSummary}=require('../../scripts/5etools/tag-uid-preview');
function fixture(kind:string,name:string,source:string,id:string,era='2024',extra:Record<string,unknown>={}){
  const entity={name,source,...extra},key=identity(kind,entity),blob='b'.repeat(40);
  return {record:{origin:'main',kind,key,entity,path:'fixture.json',index:0,blob},
    item:{id,kind:kind==='classFeature'||kind==='subclassFeature'?'feature':kind,source:{rulesEra:era},provenance:{origin:'5etools',entityKey:key,path:'fixture.json',index:0,blob,sourceCode:source}}};
}
const consumer=(mechanics:Record<string,unknown>)=>({id:'consumer',source:{rulesEra:'2024'},provenance:{origin:'5etools',sourceCode:'XPHB'},payload:{mechanics}});
describe('a6.4.3 inline tags and source-qualified UIDs',()=>{
  test('balanced nested tags keep pipe boundaries, offsets and display text',()=>{
    const text='Before {@b use {@spell Fixture|XPHB|{@i shown|text}}} after';
    const r=scan(text);
    expect(r.error).toBeNull();expect(r.nodes.map((n:any)=>n.tag)).toEqual(['b','spell','i']);
    expect(r.nodes[1].parts).toEqual(['Fixture','XPHB','{@i shown|text}']);
    expect(r.nodes.every((n:any)=>text.slice(n.start,n.end)===n.raw)).toBe(true);
    expect(scan('{@b {@spell Fixture}').error).toBe('unclosedTag');
    expect(scan('{@!bad x}').error).toBe('malformedTag');
    expect(category('damage')).toBe('formula');expect(category('filter')).toBe('special');
  });
  test('static defaults differ by kind and do not pick the revised edition',()=>{
    const a=fixture('spell','Fixture','PHB','old','2014'),b=fixture('spell','Fixture','XPHB','new');
    const index=createReferenceIndex([a.record,b.record],[a.item,b.item]),c=consumer({});
    expect(resolveUid(c,index,'spell',['Fixture'])).toMatchObject({status:'defaultIdentityCandidate',targetId:'old',crossEra:true,defaulted:true});
    expect(resolveUid(c,index,'spell',['Fixture','XPHB'])).toMatchObject({status:'resolvedIdentity',targetId:'new'});
    expect(parseUid('item',['Fixture']).target.source).toBe('DMG');
    expect(parseUid('creature',['Fixture']).target.source).toBe('MM');
    expect(parseUid('itemMastery',['Fixture']).target.source).toBe('XPHB');
  });
  test('owner-sensitive UIDs preserve default owner source and level, not display identity',()=>{
    const a=fixture('subclassFeature','Fixture','PHB','f','2014',{className:'Wizard',classSource:'XPHB',subclassShortName:'Test',subclassSource:'PHB',level:6});
    const index=createReferenceIndex([a.record],[a.item]);
    expect(resolveUid(consumer({}),index,'subclassFeature',['Fixture','Wizard','XPHB','Test','','6','','Display'],{allowDisplay:true})).toMatchObject({status:'defaultIdentityCandidate',targetId:'f',display:'Display'});
    expect(parseUid('classFeature',['Fixture','Wizard','XPHB','3']).target.source).toBe('XPHB');
    expect(parseUid('classFeature',['Fixture','Wizard','XPHB','0']).status).toBe('unsupportedExpression');
  });
  test('inline references remain separate from markup, formula, filters and malformed text',()=>{
    const a=fixture('spell','Fixture','XPHB','spell'),index=createReferenceIndex([a.record],[a.item]);
    const x=consumer({upstreamSpell:{entries:['{@b {@spell Fixture|XPHB}} {@damage 1d6} {@filter select|spells|level=0}','{@spell Fixture|XPHB']}});
    const before=JSON.stringify(x),edges=inlineEdges(x,index);
    expect(edges).toEqual(expect.arrayContaining([expect.objectContaining({status:'resolvedIdentity',targetId:'spell'}),expect.objectContaining({category:'formula',status:'nonReference'}),expect.objectContaining({status:'specialTagPending'}),expect.objectContaining({status:'unclosedTag'})]));
    expect(JSON.stringify(x)).toBe(before);
  });
  test('refines spell qualifier c but preserves x alternatives and old edges',()=>{
    const a=fixture('spell','Fixture','XPHB','spell'),index=createReferenceIndex([a.record],[a.item]);
    const x=consumer({prerequisiteTree:{op:'referenceRequirement',referenceType:'spell',raw:['Fixture|XPHB#c','Fixture#x']}});
    const old=extractReferences(x,index),edges=refineEdges(x,index,old);
    expect(old.map((e:any)=>e.status)).toEqual(['unsupportedExpression','unsupportedExpression']);
    expect(edges).toEqual([expect.objectContaining({status:'resolvedIdentity',qualifier:'c',targetId:'spell',previousStatus:'unsupportedExpression'}),expect.objectContaining({status:'specialQualifierPending'})]);
  });
  test('structured spell lists preserve grant category, level, recharge and selection context',()=>{
    const a=fixture('spell','Fixture','XPHB','spell'),index=createReferenceIndex([a.record],[a.item]);
    const x=consumer({upstreamOrigin:{additionalSpells:[{innate:{'3':{daily:{'1':['Fixture|XPHB#c',{choose:{from:['Fixture|XPHB'],count:1}},{all:'level=0'}]}}}}]},upstreamItem:{attachedSpells:{charges:{'2':['Fixture|XPHB']},ability:'cha'}}});
    const e=spellLists(x,index);
    expect(e).toEqual(expect.arrayContaining([expect.objectContaining({targetId:'spell',qualifier:'c',context:{block:0,additionType:'innate',levelKey:'3',rechargeType:'daily',rechargeKey:'1'}}),expect.objectContaining({status:'selectorPending'}),expect.objectContaining({targetId:'spell',context:expect.objectContaining({choiceCandidate:true})}),expect.objectContaining({relation:'structuredAttachedSpell',context:{rechargeType:'charges',rechargeKey:'2'}})]));
    expect(e.every((v:any)=>v.activation==='review-required')).toBe(true);
  });
});
const mainPath=process.env.DND_UPSTREAM_TAG_MAIN,brewPath=process.env.DND_UPSTREAM_TAG_BREW;
(mainPath&&brewPath?test:test.skip)('real inline and UID preview preserves previous reference ledger and aggregates only',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildTagReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.items).toBeGreaterThan(0);
  expect(r.summary.byInlineStatus.resolvedIdentity||0).toBeGreaterThan(0);
  expect(r.summary.defaultCandidates).toBeGreaterThan(0);
  expect(r.summary.byRefinementStatus.resolvedIdentity||0).toBeGreaterThanOrEqual(0);
  expect(r.summary.structuredCount).toBeGreaterThan(0);
  expect(r.summary.previous.provenanceMismatch||0).toBe(0);
  for(const list of [r.inline,r.refinements,r.structured]){
    expect(list.every((e:any)=>e.activation==='review-required')).toBe(true);
    expect(list.filter((e:any)=>e.status==='provenanceMismatch')).toHaveLength(0);
  }
  const out=process.env.DND_UPSTREAM_TAG_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},240000);
