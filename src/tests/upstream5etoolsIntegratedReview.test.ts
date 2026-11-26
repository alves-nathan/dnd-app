import * as fs from 'node:fs';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {digest,compatibility,createLedger,applyDecisions,summarize,buildIntegratedReport,publicSummary}=require('../../scripts/5etools/integrated-review');
const commits={main:'a'.repeat(40),homebrew:'b'.repeat(40)};
function fixture(){
  const raw=(index:number,source:string)=>({origin:'main',path:'data/conditionsdiseases.json',kind:'condition',index,blob:'c'.repeat(40),key:JSON.stringify(['condition','fixture'+index,source]),entity:{name:'fixture'+index,source}});
  const a=raw(0,'PHB'),b=raw(1,'XPHB'),c=raw(2,'XPHB'),d=raw(3,'XPHB');
  const item=(r:any,id:string,era:string)=>({id,kind:'condition',source:{status:'needsReview',rulesEra:era},provenance:{origin:'5etools',path:r.path,index:r.index,blob:r.blob,entityKey:r.key,commit:commits.main,sourceCode:r.entity.source}});
  const i=item(a,'old','2014'),j=item(b,'new','2024');
  const args={collection:{records:[a,b,c,d],invalidRecords:[]},structural:{entities:[a,b,c]},runs:[{stage:'a5.8',result:{commit:commits.main,activation:'review-required',counts:{PHB:{},XPHB:{}},packs:[{metadata:{activation:'review-required'},items:[i,j]}]}}],
    indexPaths:{spell:new Set(),monster:new Set()},commits};
  return {args,a,b,c,d,i,j};
}
describe('a6.5.4 integrated review ledger',()=>{
  test('distinguishes raw rows, emitted entities, evidence and still-uncovered gaps',()=>{
    const f=fixture(),l=createLedger(f.args);
    l.add('reference',{status:'resolvedIdentity'},{itemId:'old',targetId:'new'});
    l.add('version',{status:'structuralPreview'},{rawCoordinate:f.c,candidateId:'candidate',kind:'structuralCandidate'});
    const s=summarize(l,[]);
    expect(s).toMatchObject({upstreamRows:4,emittedItems:2,evidenceOccurrences:2,rowStates:{emitted:2,gapWithStructuralCandidate:1,gapWithoutCandidate:1},issues:{}});
    expect(s.byCompatibility.reference.crossEraReviewRequired).toBe(1);
    expect(s.bySourceKind.find((x:any)=>x.source==='XPHB').outputs).toBe(1);
  });
  test('rejects stale origin and missing resolved target, and never guesses source',()=>{
    const f=fixture(),l=createLedger(f.args);
    expect(l.add('version',{status:'structuralPreview'},{rawCoordinate:{...f.c,blob:'bad'}})).toBeUndefined();
    expect(l.add('reference',{status:'resolvedIdentity'},{itemId:'old',targetId:'missing'})).toBeUndefined();
    expect(l.issues).toMatchObject({unverifiedEvidenceOrigin:1,unverifiedEvidenceTarget:1});
    expect(l.evidence.size).toBe(0);
  });
  test('decisions are fingerprint and snapshot bound, non-activating, conflict safe',()=>{
    const f=fixture(),l=createLedger(f.args);
    const e=l.add('version',{status:'structuralPreview'},{rawCoordinate:f.c,kind:'structuralCandidate'});
    const d={evidenceId:e.id,fingerprint:e.fingerprint,mainCommit:commits.main,homebrewCommit:commits.homebrew,approved:true,reason:'fixture',reviewer:'fixture',decision:'acceptEvidence'};
    expect(applyDecisions(l,[{...d,mainCommit:'stale'}])[0].status).toBe('staleEvidence');
    expect(applyDecisions(l,[d,{...d,decision:'rejectEvidence'}])[0].status).toBe('conflictingDecisions');
    expect(e.review).toBe('unreviewed');
    expect(applyDecisions(l,[d])[0].status).toBe('recorded');
    expect(e).toMatchObject({review:'acceptEvidence',activation:'review-required'});
    expect(summarize(l,[]).rowStates.gapWithStructuralCandidate).toBe(1);
    expect(l.items.size).toBe(2);
  });
  test('optional local evidence detail does not change the fingerprint or public summary',()=>{
    const f=fixture(),a=createLedger(f.args),b=createLedger({...f.args,includeDetails:true});
    const row={status:'structuralPreview',entity:{name:'private-fixture'}};
    const e=a.add('version',row,{rawCoordinate:f.c}),g=b.add('version',row,{rawCoordinate:f.c});
    expect(g.id).toBe(e.id);
    expect(e.detail).toBeUndefined();
    expect(g.detail).toEqual(row);
    expect(JSON.stringify(summarize(b,[]))).not.toContain('private-fixture');
  });
  test('evidence hashes canonical key order, but change with row and snapshot',()=>{
    expect(digest({a:1,b:2})).toBe(digest({b:2,a:1}));
    const f=fixture(),a=createLedger(f.args),b=createLedger(f.args);
    const e=a.add('version',{status:'structuralPreview',x:1},{rawCoordinate:f.c});
    expect(b.add('version',{x:1,status:'structuralPreview'},{rawCoordinate:f.c}).id).toBe(e.id);
    expect(b.add('version',{x:2,status:'structuralPreview'},{rawCoordinate:f.c}).id).not.toBe(e.id);
    expect(a.add('version',{status:'structuralPreview',x:1},{rawCoordinate:f.c})).toBeUndefined();
    expect(a.issues.duplicateEvidence).toBe(1);
    expect(compatibility(f.i,f.j)).toBe('crossEraReviewRequired');
  });
});
const mainPath=process.env.DND_UPSTREAM_INTEGRATED_MAIN,brewPath=process.env.DND_UPSTREAM_INTEGRATED_BREW;
(mainPath&&brewPath?test:test.skip)('real ledger reconciles all domains without new emissions',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildIntegratedReport(openSnapshot(mainPath),openSnapshot(brewPath),{includeDetails:!!process.env.DND_UPSTREAM_INTEGRATED_OUT});
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.issues).toEqual({});
  expect(r.summary.emittedItems).toBe(r.items.length);
  expect(r.summary.upstreamRows).toBe(r.rows.length);
  expect(r.rows.reduce((n:number,x:any)=>n+x.outputIds.length,0)).toBe(r.items.length);
  expect(Object.values(r.summary.rowStates).reduce((n:number,x:any)=>n+x,0)).toBe(r.rows.length);
  expect(r.summary.byReview.unreviewed).toBe(r.evidence.length);
  expect(r.summary.byDomain.reference.resolvedIdentity).toBeGreaterThan(0);
  expect(r.summary.byCompatibility.reference.crossEraReviewRequired).toBeGreaterThan(0);
  expect(r.summary.byDomain.contextualGrant.crossOwnerEndpointOrGrantPending).toBeGreaterThan(0);
  expect(r.summary.byDomain['effect:damage'].damageFormulaCandidate).toBeGreaterThan(0);
  expect(r.items.every((x:any)=>x.activation==='review-required')).toBe(true);
  expect(r.evidence.every((x:any)=>x.activation==='review-required')).toBe(true);
  expect(r.decisionResults).toHaveLength(0);
  const out=process.env.DND_UPSTREAM_INTEGRATED_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},360000);
