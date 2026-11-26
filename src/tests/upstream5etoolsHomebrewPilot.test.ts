import * as fs from 'node:fs';
import { stageImportV3 } from '../compendium/importV3Staging';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {identity}=require('../../scripts/5etools/resolver');
const {sourceId,physicalCandidateId}=require('../../scripts/5etools/homebrew-policy');
const {sourceProjection,makeExplicitIndex,directClassAccess,standalone,convertCandidate,packFor,evidenceFor,buildHomebrewPilot,publicSummary}=require('../../scripts/5etools/homebrew-pilot');
const commit='a'.repeat(40),blob='b'.repeat(40);
function raw(kind:string,entity:any,origin='homebrew'){
  const key=identity(kind,entity);
  return {kind,entity,origin,key,id:JSON.stringify([origin,key]),path:'fixture.json',index:0,blob};
}
const s={id:sourceId('BREW'),code:'brew',fingerprint:'fixture',precedenceScope:'homebrew-source:'+sourceId('BREW'),classification:'unclassified',rulesEra:'unknown',publication:{precision:'unknown',date:null,year:null,evidence:'fixture'}};
const meta={full:'Fixture'};
const defs={properties:new Map(),masteries:new Map(),types:new Map()};
describe('a6.6.2 isolated homebrew pilot',()=>{
  test('provisional classification is technical only; reviewed classification remains distinct',()=>{
    expect(sourceProjection(s,meta)).toMatchObject({contentType:'homebrew',rulesEra:'unknown',status:'needsReview'});
    expect(sourceProjection({...s,classification:'third-party',rulesEra:'2024',review:{usagePolicy:'localReviewOnly'}},meta)).toMatchObject({contentType:'third-party',rulesEra:'2024'});
    expect(sourceProjection({...s,classification:'official-reproduction',review:{usagePolicy:'localReviewOnly'}},meta)).toMatchObject({contentType:'homebrew',rulesEra:'unknown'});
  });
  test('explicit class access resolves exact main class and never falls through a local un-emitted identity',()=>{
    const c=raw('class',{name:'Wizard',source:'PHB'},'main');
    const item={id:'main-class',kind:'class',source:{rulesEra:'2014'},provenance:{origin:'5etools',entityKey:c.key,path:c.path,index:c.index,blob}};
    const access={classes:{fromClassList:[{name:'Wizard',source:'PHB'}]}};
    expect(directClassAccess(access,makeExplicitIndex([c],[item])).targetIds).toEqual(['main-class']);
    const shadow=raw('class',{name:'Wizard',source:'PHB'});
    expect(()=>directClassAccess(access,makeExplicitIndex([c,shadow],[item]))).toThrow('classAccessEndpointPending');
    expect(()=>directClassAccess({classes:{fromClassList:[{name:'Wizard'}]}},makeExplicitIndex([c],[item]))).toThrow('classAccessQualifierPending');
  });
  test('feat conversion reuses canonical converter with isolated provenance, staging and review evidence',()=>{
    const r=raw('feat',{name:'Fixture',source:'BREW',entries:['Fixture {@dice 1d6}.']});
    const index=makeExplicitIndex([r],[]);
    const item=convertCandidate(r,{entity:r.entity,lineage:[]},s,meta,{index,defs,commit});
    expect(item.id).toBe(physicalCandidateId(r));
    expect(item.provenance).toMatchObject({origin:'homebrew',repository:'TheGiddyLimit/homebrew',commit,blob});
    expect(item.metadata.homebrewPolicy).toMatchObject({classificationProvisional:true,distribution:'blocked'});
    expect(stageImportV3(packFor(item)).ok).toBe(true);
    expect(evidenceFor(item,index).every((e:any)=>e.activation==='review-required')).toBe(true);
  });
  test('complex grants, copy, magic and unqualified equipment types remain outside the narrow pilot',()=>{
    const f=raw('feat',{name:'Fixture',source:'BREW',prerequisite:[{level:4}]});
    expect(standalone(f,f.entity)).toBe('featGrantOrPrerequisitePending');
    const i=raw('item',{name:'Fixture',source:'BREW',rarity:'none',type:'G'});
    expect(standalone(i,i.entity)).toBe('equipmentTypeSourcePending');
    expect(standalone(i,{...i.entity,type:'G|XPHB',attachedSpells:['Fixture|BREW']})).toBe('equipmentDependencyPending');
    expect(standalone(i,{...i.entity,_copy:{name:'Fixture',source:'PHB'}})).toBe('copyOrVariantPending');
  });
});
const mainPath=process.env.DND_UPSTREAM_BREW_PILOT_MAIN,brewPath=process.env.DND_UPSTREAM_BREW_PILOT_BREW;
(mainPath&&brewPath?test:test.skip)('real isolated V3 probes validate, never export unclassified sources',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildHomebrewPilot(openSnapshot(mainPath),openSnapshot(brewPath),{validate:stageImportV3});
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.issues).toEqual({});
  expect(r.summary.mainItems).toBeGreaterThan(0);
  expect(r.summary.byKind.spell.stagingValid).toBeGreaterThan(0);
  expect(r.summary.byKind.feat.stagingValid).toBeGreaterThan(0);
  expect(r.summary.probes).toBeGreaterThan(0);
  expect(r.summary.exportableLocalPacks).toBe(0);
  expect(r.exportPacks).toHaveLength(0);
  expect(r.summary.distributionAuthorized).toBe(0);
  expect(r.probes.every((p:any)=>p.classificationProvisional&&p.distribution==='blocked'&&p.activation==='review-required')).toBe(true);
  const out=process.env.DND_UPSTREAM_BREW_PILOT_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},360000);
