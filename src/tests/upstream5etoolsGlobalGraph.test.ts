const {buildGraphRelationshipFragment}=require('../../scripts/5etools/relationship-milestone-review');
const {fromGraph,writeFragment}=require('../../scripts/5etools/cutover-evidence');
import * as fs from 'node:fs';
import { stageImportV3 } from '../compendium/importV3Staging';
import type { CompendiumImportItemV3Input } from '../compendium/importV3Schemas';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {identity}=require('../../scripts/5etools/resolver');
const {digest}=require('../../scripts/5etools/integrated-review');
const {physicalCandidateId,sourceId}=require('../../scripts/5etools/homebrew-policy');
const {residual,rawGraph,validateGraph,buildGlobalGraph,publicSummary}=require('../../scripts/5etools/global-graph');
const commits={main:'a'.repeat(40),homebrew:'b'.repeat(40)},blob='c'.repeat(40);
const fixturePrecedence = (): CompendiumImportItemV3Input['precedence'] => ({
  relation:'unresolved',reprints:[],supersedes:[],coexistsWith:[],basis:'fixture'
});
function fixture(){
  const row=(kind:string,name:string,source:string,origin='main',extra:Record<string,unknown>={})=>{
    const entity={name,source,...extra},key=identity(kind,entity);
    return {origin,kind,path:origin+'/'+kind+'.json',index:0,key,id:JSON.stringify([origin,key]),entity,blob};
  };
  const c=row('class','Fixture','PHB'),f=row('classFeature','Grant','PHB','main',{className:'Fixture',classSource:'PHB',level:1});
  const b=row('feat','Brew','BREW','homebrew');
  const item=(r:any,id:string,kind:string,payload:any)=>({
    id,kind,name:r.entity.name,source:{id:r.origin==='main'?'main-source':sourceId('BREW'),status:'needsReview',rulesEra:'2014',contentType:r.origin==='main'?'official':'homebrew',precedenceScope:r.origin==='main'?'official-dnd':'homebrew-source:'+sourceId('BREW'),publication:{precision:'year',date:null,year:2014,evidence:'fixture'}},
    identity:{canonicalKey:kind+':'+r.entity.name,precedenceScope:r.origin==='main'?'official-dnd':'homebrew-source:'+sourceId('BREW')},
    precedence:fixturePrecedence(),
    provenance:{origin:r.origin==='main'?'5etools':'homebrew',commit:commits[r.origin as keyof typeof commits],blob,path:r.path,entityKey:r.key,index:0,sourceCode:r.entity.source,lineage:[]},
    payload,metadata:r.origin==='homebrew'?{homebrewPolicy:{sourceId:sourceId('BREW'),classificationProvisional:true,distribution:'blocked',activation:'review-required'}}:{}
  });
  const cls=item(c,'upstream:main:class:fixture','class',{featureIds:['upstream:main:feature:fixture'],progression:[{level:1,featureIds:['upstream:main:feature:fixture']}]}),
    feat=item(f,'upstream:main:feature:fixture','feature',{sourceType:'classFeature',classId:cls.id,levelGained:1}),brew=item(b,physicalCandidateId(b),'feat',{});
  const coordinate=(r:any)=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
  const mainItems=[cls,feat],mainLedger={commits,summary:{issues:{}},items:[c,f].map((r,i)=>({id:mainItems[i].id,coordinateKey:coordinate(r),provenance:mainItems[i].provenance,activation:'review-required',evidenceIds:[] as string[]})),evidence:[] as any[]};
  const brewPilot={commits,summary:{issues:{},mainItems:2,mainDigest:digest(mainItems.map(i=>[i.id,digest(i)]).sort((a,b)=>a[0].localeCompare(b[0])))},probes:[{itemId:brew.id,coordinate:coordinate(b),fingerprint:digest(brew),sourceId:brew.source.id,classificationProvisional:true,distribution:'blocked',evidenceIds:[] as string[]}],evidence:[] as any[]};
  const records=[c,f,b],structural={entities:records.map(r=>({...r,lineage:[],references:[]}))};
  return {cls,feat,brew,mainLedger,brewPilot,args:{collection:{records,invalidRecords:[]},structural,items:[cls,feat,brew],precedenceItems:mainItems,mainLedger,brewPilot,commits,validate:()=>({ok:true,issues:[]})}};
}
describe('a6.7 global graph',()=>{
  test('valid ownership reciprocity and quarantined brew do not imply runtime eligibility',()=>{
    const f=fixture(),r=validateGraph(f.args);
    expect(r.summary.issues).toEqual({});
    expect(r.summary.byClosure.hardDependenciesClosed).toBe(3);
    expect(r.summary.byNamespace).toMatchObject({main:{semanticReviewRequired:2},homebrew:{homebrewQuarantined:1}});
    expect(r.summary.runtimeEligible).toBe(0);
    expect(r.nodes.every((n:any)=>n.runtimeEligible===false)).toBe(true);
  });
  test('binds graph relationships and evidence without promoting structural closure',()=>{
    const f=fixture(),r=validateGraph(f.args),before=digest(r),g=buildGraphRelationshipFragment(r);
    expect(g).toMatchObject({mainItems:2,homebrewProbes:1,readiness:'blocked',relationshipParityEstablished:0,writeAuthorized:false});
    expect(g.edgeOccurrences).toBe(r.edges.length);
    expect(()=>buildGraphRelationshipFragment({...r,edges:[]})).toThrow('relationshipGraphEdgeAccounting');
    expect(digest(r)).toBe(before);
  });
  test('rejects forbidden namespace direction and propagates hard dependency failures',()=>{
    const f=fixture();
    f.cls.payload.featureIds=['missing-feature'];
    const r=validateGraph(f.args);
    expect(r.summary.issues.hardEndpointMissing).toBeGreaterThan(0);
    expect(r.summary.byClosure.dependencyBlocked).toBeGreaterThan(0);
    expect(r.summary.integrityValid).toBe(false);
    const g=fixture();const fingerprint=digest('fixture');
    g.mainLedger.evidence.push({id:'review:'+fingerprint,fingerprint,itemId:g.cls.id,targetId:g.brew.id,domain:'reference',status:'resolvedIdentity',activation:'review-required'});
    g.mainLedger.items[0].evidenceIds.push('review:'+fingerprint);
    expect(validateGraph(g.args).summary.issues.forbiddenMainToHomebrew).toBe(1);
  });
  test('rejects stale probe and evidence membership mismatch',()=>{
    const f=fixture();f.brewPilot.probes[0].fingerprint='stale';
    const fingerprint=digest('fixture');
    f.brewPilot.evidence.push({id:'review:'+fingerprint,fingerprint,itemId:f.brew.id,domain:'formula',status:'numericFormulaCandidate',activation:'review-required'});
    const r=validateGraph(f.args);
    expect(r.summary.issues.brewProbeMismatch).toBe(1);
    expect(r.summary.issues.evidenceMembershipMismatch).toBe(1);
  });
  test('copy and precedence DAG residual is distinct from normal graph reciprocity',()=>{
    expect(residual(['a','b','c','d'],[['a','b'],['b','a'],['c','a']]).sort()).toEqual(['a','b','c']);
    expect(residual(['a','b'],[['a','b']])).toEqual([]);
    const f=fixture();const r=rawGraph(f.args.collection,f.args.structural);
    expect(r.issues).toEqual({});expect(r.cycleOrDependent).toBe(0);
    f.args.structural.entities[0].blob='stale';
    expect(rawGraph(f.args.collection,f.args.structural).issues.rawResolvedProvenanceMismatch).toBe(1);
  });
  test('rejects cross-scope precedence and checks namespace before endpoint kind',()=>{
    const f=fixture();
    f.cls.precedence={relation:'reprint',reprints:[f.brew.id],supersedes:[],coexistsWith:[],basis:'fixture'};
    expect(validateGraph(f.args).summary.issues.invalidPrecedenceEndpoint).toBe(1);
    const g=fixture();g.cls.payload.featureIds=[g.brew.id];
    expect(validateGraph(g.args).summary.issues.forbiddenMainToHomebrew).toBe(1);
  });
  test('a global validator failure cannot be hidden by closed local dependencies',()=>{
    const f=fixture(),r=validateGraph({...f.args,validate:()=>({ok:false,issues:[{severity:'error',code:'fixture',itemId:f.feat.id}]})});
    expect(r.summary.issues).toMatchObject({'globalStagingError:fixture':1,globalStagingInvalid:1});
    expect(r.summary.byClosure.dependencyBlocked).toBe(2);
    expect(r.summary.runtimeEligible).toBe(0);
  });
});
const mainPath=process.env.DND_UPSTREAM_GRAPH_MAIN,brewPath=process.env.DND_UPSTREAM_GRAPH_BREW;
(mainPath&&brewPath?test:test.skip)('real global Main and quarantined Homebrew graph validates without activation',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildGlobalGraph(openSnapshot(mainPath),openSnapshot(brewPath),{validate:stageImportV3});
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.issues).toEqual({});
  expect(r.summary.integrityValid).toBe(true);
  expect(r.summary.stagingValid).toBe(true);
  expect(r.summary.registry).toBe(r.summary.mainItems+r.summary.homebrewProbes);
  expect(r.summary.homebrewProbes).toBeGreaterThan(0);
  expect(r.summary.byClosure.hardDependenciesClosed).toBe(r.summary.registry);
  expect(r.summary.precedenceResidual).toBe(0);
  expect(r.summary.runtimeEligible).toBe(0);
  expect(r.summary.distributionAuthorized).toBe(0);
  expect(r.nodes.every((n:any)=>n.activation==='review-required'&&!n.runtimeEligible)).toBe(true);
  if(process.env.DND_UPSTREAM_EVIDENCE_DIR){
    writeFragment(process.env.DND_UPSTREAM_EVIDENCE_DIR,'graph',fromGraph(r));
    writeFragment(process.env.DND_UPSTREAM_EVIDENCE_DIR,'relationship-graph',buildGraphRelationshipFragment(r));
  }
  const out=process.env.DND_UPSTREAM_GRAPH_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},360000);
