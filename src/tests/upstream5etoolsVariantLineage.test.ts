import * as fs from 'node:fs';
const {identity,makeResolver}=require('../../scripts/5etools/resolver');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {createTemplateIndex,previewExternalTemplate,versionSpecs,previewVersion,crossOwnerCandidates,buildVariantReport,publicSummary}=require('../../scripts/5etools/variant-lineage');
const row=(kind:string,entity:Record<string,unknown>,index=0)=>{
  const key=identity(kind,entity);
  return {kind,entity,key,id:JSON.stringify(['main',key]),origin:'main',path:'fixture.json',index,blob:'b'.repeat(40)};
};
const template=(entities:unknown[])=>createTemplateIndex({files:new Map([['data/bestiary/template.json','t'.repeat(40)]]),readJson:()=>({monsterTemplate:entities,legendaryGroupTemplate:[]})});
describe('a6.4.2 template and lineage preview',()=>{
  test('templates preserve explicit child roots, apply roots then combined mods and retain provenance',()=>{
    const base=row('monster',{name:'Base',source:'PHB',size:['M'],type:'beast',trait:[{name:'Base trait'}]});
    const child=row('monster',{name:'Child',source:'PHB',size:['S'],_copy:{name:'Base',source:'PHB',_templates:[{name:'Template',source:'DMG'}],_mod:{trait:{mode:'appendArr',items:[{name:'Child trait'}]}}}},1);
    const t=template([{name:'Template',source:'DMG',apply:{_root:{size:['L'],type:'fiend'},_mod:{trait:{mode:'appendArr',items:[{name:'Template trait'}]}}}}]);
    const before=JSON.stringify([base,child]),v=previewExternalTemplate(child,makeResolver([base,child]),t);
    expect(v.entity).toMatchObject({name:'Child',size:['S'],type:'fiend',trait:[{name:'Base trait'},{name:'Child trait'},{name:'Template trait'}]});
    expect(v.templateLineage).toEqual([expect.objectContaining({kind:'monsterTemplate',index:0,blob:'t'.repeat(40)})]);
    expect(JSON.stringify([base,child])).toBe(before);
  });
  test('rejects missing/ambiguous templates, prerequisites, dynamic operations and identity overrides',()=>{
    const base=row('monster',{name:'Base',source:'PHB'}),child=row('monster',{name:'Child',source:'PHB',_copy:{name:'Base',source:'PHB',_templates:[{name:'T',source:'DMG'}]}},1);
    const r=makeResolver([base,child]),t={name:'T',source:'DMG',apply:{_root:{type:'fiend'}}};
    expect(()=>previewExternalTemplate(child,r,template([]))).toThrow('missingTemplate');
    expect(()=>previewExternalTemplate(child,r,template([t,t]))).toThrow('ambiguousTemplate');
    expect(()=>previewExternalTemplate(child,r,template([{...t,prerequisite:'synthetic'}]))).toThrow('templatePrerequisitePending');
    expect(()=>previewExternalTemplate(child,r,template([{...t,apply:{_root:{source:'XPHB'}}}]))).toThrow('unsafeTemplateRoot');
    expect(()=>previewExternalTemplate(child,r,template([{...t,apply:{_root:{type:'<$name$>'}}}]))).toThrow('dynamicValuePending');
  });
  test('expands simple abstract variables individually and rejects missing variables',()=>{
    const v=versionSpecs({_abstract:{name:'Fixture {{color}}',source:'XPHB',_mod:{entries:{mode:'appendArr',items:['{{color}}']}}},_implementations:[{_variables:{color:'Blue'}},{_variables:{}}]});
    expect(v[0]).toMatchObject({implementation:0,spec:{name:'Fixture Blue',source:'XPHB',_mod:{entries:{items:['Blue']}}}});
    expect(v[1]).toMatchObject({implementation:1,status:'versionVariablePending'});
  });
  test('simple version inherits explicit owner fields, keeps base immutable, blocks existing identities',()=>{
    const p=row('race',{name:'Fixture',source:'PHB',entries:['base'],hasFluff:true,otherSources:[{source:'XPHB'},{source:'TCE'}],_versions:[{}]});
    const spec={name:'Fixture Revised',source:'XPHB',_mod:{entries:{mode:'appendArr',items:['new']}}};
    const v=previewVersion(p,p.entity,spec,new Set());
    expect(v.entity).toMatchObject({name:'Fixture Revised',source:'XPHB',entries:['base','new'],otherSources:[{source:'TCE'}]});
    expect(v.entity).not.toHaveProperty('_versions');expect(v.entity).not.toHaveProperty('hasFluff');
    expect(p.entity.entries).toEqual(['base']);
    expect(()=>previewVersion(p,p.entity,spec,new Set([v.id]))).toThrow('versionIdentityCollision');
  });
  test('cross-owner candidates require direct copy ancestry and exact old-owner membership',()=>{
    const old=row('subclass',{name:'Fixture',shortName:'Fixture',source:'PHB',className:'Wizard',classSource:'PHB',subclassFeatures:['Grant|Wizard|PHB|Fixture|PHB|6|PHB']});
    const grant=row('subclassFeature',{name:'Grant',source:'PHB',className:'Wizard',classSource:'PHB',subclassShortName:'Fixture',subclassSource:'PHB',level:6,entries:[]},1);
    const alias=row('subclass',{name:'Fixture',shortName:'Fixture',source:'PHB',className:'Wizard',classSource:'XPHB',_copy:{name:'Fixture',shortName:'Fixture',source:'PHB',className:'Wizard',classSource:'PHB'}},2);
    const result=crossOwnerCandidates([old,grant,alias],new Set());
    expect(result).toEqual([expect.objectContaining({status:'completeAliasCandidate',ownerEmitted:false,grants:[expect.objectContaining({status:'inheritedCrossOwnerCandidate',level:6,targetEmitted:false})]})]);
    const unrelated=row('subclassFeature',{...grant.entity,name:'Unlisted'},3);
    const changed={...alias,entity:{...alias.entity,subclassFeatures:['Unlisted|Wizard|PHB|Fixture|PHB|6|PHB']}};
    expect(crossOwnerCandidates([old,grant,unrelated,changed],new Set())[0].grants[0].status).toBe('crossOwnerUnproven');
  });
});
const mainPath=process.env.DND_UPSTREAM_VARIANT_MAIN,brewPath=process.env.DND_UPSTREAM_VARIANT_BREW;
(mainPath&&brewPath?test:test.skip)('real variant and lineage preview reports structural candidates without activating',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildVariantReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.templateDefinitions).toBeGreaterThan(0);
  expect(r.summary.versions.structuralPreview||0).toBeGreaterThan(0);
  expect(r.summary.aliasGrants.inheritedCrossOwnerCandidate||0).toBeGreaterThan(0);
  expect(r.summary.magic.resolvedBaseStructuralMatch||0).toBeGreaterThan(0);
  expect(r.summary.magic.variantProvenanceMismatch||0).toBe(0);
  expect(r.activation).toBe('review-required');
  const out=process.env.DND_UPSTREAM_VARIANT_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},240000);
export {};
