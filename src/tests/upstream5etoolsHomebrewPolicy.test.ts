import * as fs from 'node:fs';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {identity}=require('../../scripts/5etools/resolver');
const {sourceId,physicalCandidateId,readBrewManifest,createPolicy,buildHomebrewPolicy,publicSummary}=require('../../scripts/5etools/homebrew-policy');
const commits={main:'a'.repeat(40),homebrew:'b'.repeat(40)};
const blob='c'.repeat(40);
const coordinate=(r:any)=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
function fixture(options:{collision?:boolean,cycle?:boolean,undeclared?:boolean}={}){
  const row=(origin:string,path:string,source:string,name:string,index=0)=>{
    const entity={name,source},kind='spell',key=identity(kind,entity);
    return {origin,path,kind,index,blob,key,id:JSON.stringify([origin,key]),entity};
  };
  const a=row('homebrew','spell/a.json','A','Fixture A'),b=row('homebrew','spell/b.json','B','Fixture B');
  const official=row('main','data/spells/spells-phb.json','PHB','Fixture Official');
  const meta=(code:string,dependencies:any={})=>({sources:[{json:code,full:'Fixture '+code,authors:['Fixture author'],convertedBy:['Fixture converter']}],edition:'classic',dateAdded:1,dependencies});
  const data:Record<string,any>={
    '_generated/index-sources.json':{A:a.path,B:b.path},
    [a.path]:{_meta:meta('A',options.undeclared?{}:{spell:['B','PHB']}),spell:[a.entity]},
    [b.path]:{_meta:meta('B',options.cycle?{spell:['A']}:{}),spell:[b.entity]}
  };
  const snapshot={commit:commits.homebrew,files:new Map(Object.keys(data).map(k=>[k,blob])),readJson:(p:string)=>data[p]};
  const records=[a,b,official];
  if(options.collision)records.push(row('main','data/spells/spells-a.json','A','Fixture A'));
  const structural={entities:records.map(r=>({...r,lineage:r===a?[b.id,official.id]:[],references:r===a?[{relation:'spellReference',target:official.id}]:[]}))};
  const args={manifest:readBrewManifest(snapshot),collection:{records,invalidRecords:[]},structural,inventory:{sources:[{origin:'main',code:'PHB'}]},commits};
  return {args,a,b,official,data,snapshot};
}
describe('a6.6.1 homebrew source and dependency policy',()=>{
  test('keeps isolated IDs, edition evidence and local structural candidates without rights inference',()=>{
    const f=fixture(),r=createPolicy(f.args);
    expect(r.summary.rowCounts.structuralSourceCandidate).toBe(2);
    expect(r.summary.linkCounts).toMatchObject({homebrewLinkCandidate:1,mainLinkCandidate:1});
    const a=r.sources.find((s:any)=>s.code==='a');
    expect(a).toMatchObject({id:sourceId('A'),editionCandidate:'2014',rulesEra:'unknown',classification:'unclassified',rights:'notEstablished',distribution:'blocked',licenseStatus:'noDeclarationObserved'});
    expect(a.publication.precision).toBe('unknown');
    expect(a.authorDeclared).toBe(true);
    expect(r.rows.find((x:any)=>x.coordinate===coordinate(f.a)).candidateId).toBe(physicalCandidateId(f.a));
    expect(physicalCandidateId(f.a)).toMatch(/^upstream:homebrew:spell:/);
    expect(r.summary.emitted).toBe(0);
  });
  test('blocks exact collision and does not choose namespace by fallback',()=>{
    const f=fixture({collision:true}),r=createPolicy(f.args);
    expect(r.summary.collisionCounts).toMatchObject({sourceCodes:1,entityIdentities:1});
    expect(r.rows.find((x:any)=>x.coordinate===coordinate(f.a)).reasons).toContain('namespaceCollisionPending');
    expect(r.summary.emitted).toBe(0);
  });
  test('dependency cycles and undeclared cross-file copy are not candidates',()=>{
    const c=fixture({cycle:true}),a=createPolicy(c.args);
    expect(a.summary.cycleOrDependentFiles).toBe(2);
    expect(a.summary.rowCounts.blocked).toBe(2);
    const b=createPolicy(fixture({undeclared:true}).args);
    expect(b.summary.linkCounts.undeclaredDependencyPending).toBe(2);
    expect(b.summary.rowCounts.blocked).toBe(1);
  });
  test('case-fold source index collision and mismatched file declarations remain quarantined',()=>{
    const f=fixture();
    f.data['_generated/index-sources.json'].a=f.a.path;
    f.data[f.b.path]._meta.sources[0].json='OTHER';
    const r=createPolicy({...f.args,manifest:readBrewManifest(f.snapshot)});
    expect(r.sources.find((s:any)=>s.code==='a').status).toBe('indexIdentityPending');
    expect(r.sources.find((s:any)=>s.code==='b').status).toBe('declarationIdentityPending');
    expect(r.summary.rowCounts.blocked).toBe(2);
  });
  test('source decisions are snapshot-bound and cannot authorize redistribution or mark official precedence',()=>{
    const f=fixture(),a=createPolicy(f.args).sources.find((s:any)=>s.code==='a');
    const decision={sourceId:a.id,fingerprint:a.fingerprint,mainCommit:commits.main,homebrewCommit:commits.homebrew,approved:true,reviewer:'fixture',evidence:'fixture',classification:'official-reproduction',rulesEra:'2014',usagePolicy:'localReviewOnly'};
    const bad=createPolicy({...f.args,decisions:[{...decision,homebrewCommit:'stale'}]});
    expect(bad.decisionResults[0].status).toBe('staleEvidence');
    const good=createPolicy({...f.args,decisions:[decision]});
    expect(good.sources.find((s:any)=>s.code==='a')).toMatchObject({classification:'official-reproduction',rulesEra:'2014',rights:'localReviewDecision',distribution:'blocked',activation:'review-required'});
    expect(good.summary.distributionAuthorized).toBe(0);
    expect(good.summary.emitted).toBe(0);
    expect(createPolicy({...f.args,decisions:[decision,decision]}).decisionResults[0].status).toBe('conflictingDecisions');
  });
  test('license declarations and otherSources/includes are observations, not grants or materialization',()=>{
    const f=fixture();
    f.data[f.a.path]._meta.license='fixture';
    f.data[f.a.path]._meta.includes={spell:['B']};
    f.data[f.a.path]._meta.otherSources={spell:{PHB:'A'}};
    const r=createPolicy({...f.args,manifest:readBrewManifest(f.snapshot)});
    expect(r.sources.find((s:any)=>s.code==='a')).toMatchObject({licenseStatus:'declarationUnverified',distribution:'blocked'});
    expect(r.summary.dependencyCounts['includes:homebrewDependencyCandidate']).toBe(1);
    expect(r.summary.dependencyCounts['otherSources:mainDependencyCandidate']).toBe(1);
    expect(r.summary.rowCounts.blocked).toBe(1);
    expect(JSON.stringify(publicSummary(r))).not.toContain('Fixture author');
  });
});
const mainPath=process.env.DND_UPSTREAM_HOMEBREW_MAIN,brewPath=process.env.DND_UPSTREAM_HOMEBREW_BREW;
(mainPath&&brewPath?test:test.skip)('real homebrew policy reconciles source and dependency evidence without emissions',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildHomebrewPolicy(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.rows).toBe(r.rows.length);
  expect(Object.values(r.summary.rowCounts).reduce((n:number,v:any)=>n+v,0)).toBe(r.rows.length);
  expect(r.summary.sourceCounts.sourceIdentityCandidate||0).toBeGreaterThan(0);
  expect(r.summary.rowCounts.structuralSourceCandidate||0).toBeGreaterThan(0);
  expect(r.summary.emitted).toBe(0);
  expect(r.summary.distributionAuthorized).toBe(0);
  expect(r.summary.issues.forbiddenMainToHomebrew||0).toBe(0);
  expect(r.summary.issues.duplicateCandidateId||0).toBe(0);
  expect(r.sources.every((s:any)=>s.distribution==='blocked'&&s.activation==='review-required')).toBe(true);
  expect(r.rows.every((x:any)=>x.activation==='review-required')).toBe(true);
  expect(r.decisionResults).toHaveLength(0);
  const out=process.env.DND_UPSTREAM_HOMEBREW_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},360000);
