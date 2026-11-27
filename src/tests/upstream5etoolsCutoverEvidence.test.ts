import { COMPENDIUM_ENTITY_KINDS } from '../compendium/importDomain';
const {KINDS,fromCoverage,fromGraph,fromMigration,buildMatrix}=require('../../scripts/5etools/cutover-evidence');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildMigrationPreview}=require('../../scripts/5etools/migration-preview');
const commits={main:'a'.repeat(40),homebrew:'b'.repeat(40),application:'c'.repeat(40)};
const rawCount={observed:2,eligible:2,outsidePilot:0,validRow:1,invalidRow:0,notEmitted:1,templateNoOutput:0};
function fixture(){
  const coverage={schemaVersion:'dnd-upstream-coverage-baseline.v1',commits,activation:'review-required',issues:{},
    canonical:{feature:1},canonicalValidation:{feature:{stagingValid:1}},uniquePhysicalIds:1,
    totalsByOrigin:{main:{emitted:1},homebrew:{emitted:0}},runtime:{total:2},
    sources:[{origin:'main',source:'PRIVATE_SOURCE',kinds:{classFeature:rawCount}}]};
  const graph={schemaVersion:'dnd-upstream-global-graph.v1',commits,activation:'review-required',
    summary:{integrityValid:true,stagingValid:true,issues:{},runtimeEligible:0,distributionAuthorized:0,
      registry:2,mainItems:1,homebrewProbes:1,evidenceOccurrences:3,stageIssues:{'warning:fixture':1}},
    nodes:[{id:'private-main-id',kind:'feature',namespace:'main',activation:'review-required',runtimeEligible:false,closure:'hardDependenciesClosed',pendingEvidence:1,evidenceIds:['private-evidence']},
      {id:'private-brew-id',kind:'feat',namespace:'homebrew',activation:'review-required',runtimeEligible:false,closure:'hardDependenciesClosed',pendingEvidence:0,evidenceIds:[]}]};
  const item={id:'pack:legacy',importItemId:'legacy',packId:'pack',sourceId:'source',type:'feature',status:'disabled',
    reviewDecision:'rejected',rawJson:{id:'legacy'},normalizedJson:{id:'legacy'},reviewNotes:'PRIVATE_NOTE'};
  const installed={sources:[{id:'source'}],packs:[{id:'pack',sourceId:'source'}],items:[item],enabledSourceIds:[] as string[]};
  const reconciliation={schemaVersion:'dnd-upstream-historical-reconciliation.v1',commits,activation:'review-required',
    summary:{issues:{},approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false,
      dependencyStatus:{endpointMappingPending:1},aliasStatus:{},legacyLinkStatus:{}},
    historical:[{id:'legacy',kind:'feature',path:'private-path',index:0,evidenceId:'hist',status:'identityCandidate',targetId:'private-main-id',
      sourceFingerprint:'fixture',decision:'unreviewed',preservation:'required',activation:'review-required',comparison:{status:'payloadDifferences'}}],
    historicalGroups:[{id:'legacy',occurrences:1,targetIds:['private-main-id'],status:'consistentIdentityCandidate',preservation:'required'}],
    runtime:[{id:'runtime1',kind:'classFeature',evidenceId:'run1',status:'runtimeOwnerContextPending',sourceFingerprint:'fixture',decision:'unreviewed',preservation:'required',activation:'review-required'},
      {id:'runtime2',kind:'rule',evidenceId:'run2',status:'runtimeContractOutsideV3',sourceFingerprint:'fixture',decision:'unreviewed',preservation:'required',activation:'review-required'}],
    dependencies:[{id:'edge',preservation:'required'}],aliases:[],categories:[],legacyLinks:[]};
  const migration=buildMigrationPreview({reconciliation,baselineSnapshot:installed,installedSnapshot:installed});
  return {coverage,graph,reconciliation,migration,installed};
}
function fragments(f=fixture()){
  return [fromCoverage(f.coverage),fromGraph(f.graph),fromMigration(f.reconciliation,f.migration,f.installed)] as const;
}
describe('a8.4 cutover evidence matrix',()=>{
  test('reconciles 13 kinds without conflating raw, emitted, graph, historical, storage or non-V3 runtime counts',()=>{
    const f=fixture(),before=digest(f),[c,g,m]=fragments(f),r=buildMatrix(c,g,m);
    expect(KINDS).toEqual([...COMPENDIUM_ENTITY_KINDS]);
    expect(r.rows).toHaveLength(13);
    expect(r.rows.find((x:any)=>x.kind==='feature')).toMatchObject({conversion:{emitted:1,stagingValid:1,stagingInvalid:0},
      graph:{main:1,'main:hardDependenciesClosed':1,'main:pendingEvidence':1},
      preservation:{historical:1,'payload:payloadDifferences':1,storage:1,runtime:1},mechanicalParity:'notEstablished',runtimeEligible:0,retirementAuthorized:false});
    expect(r.rows.find((x:any)=>x.kind==='feat').graph.homebrewProbes).toBe(1);
    expect(r.outsideRuntime.rule.runtime).toBe(1);
    expect(r.rawByOrigin.main.classFeature.notEmitted).toBe(1);
    expect(r.totals).toMatchObject({storage:1,historical:1,runtime:2,mainItems:1,homebrewProbes:1,dependencies:1});
    expect(r).toMatchObject({executable:false,runtimeEligible:0,distributionAuthorized:false,retirementAuthorized:false});
    expect(digest(f)).toBe(before);
    expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|private-main-id|private-brew-id|private-evidence|private-path/);
  });
  test('rejects stale snapshot pairs and tampered aggregate fingerprints',()=>{
    const f=fixture(),[c,g,m]=fragments(f);
    expect(()=>buildMatrix({...c,uniquePhysicalIds:99},g,m)).toThrow('fragmentFingerprintMismatch');
    const stale=fromGraph({...f.graph,commits:{...commits,main:'d'.repeat(40)}});
    expect(()=>buildMatrix(c,stale,m)).toThrow('snapshotPairMismatch');
  });
  test('rejects same-total cross-kind substitution even with recomputed fragment',()=>{
    const f=fixture(),[c,,m]=fragments(f);
    const moved=fromGraph({...f.graph,nodes:f.graph.nodes.map(n=>n.namespace==='main'?{...n,kind:'spell'}:n)});
    expect(()=>buildMatrix(c,moved,m)).toThrow('crossKindAccounting');
  });
  test('fails closed on approval, graph activation or changed installed state',()=>{
    const f=fixture();
    expect(()=>fromGraph({...f.graph,summary:{...f.graph.summary,runtimeEligible:1}})).toThrow('invalidGraph');
    expect(()=>fromMigration({...f.reconciliation,summary:{...f.reconciliation.summary,mechanicalParityEstablished:1}},f.migration,f.installed)).toThrow('invalidReconciliation');
    expect(()=>fromMigration(f.reconciliation,f.migration,{...f.installed,enabledSourceIds:['source']})).toThrow('invalidMigrationPreview');
    expect(()=>fromCoverage({...f.coverage,canonicalValidation:{feature:{stagingValid:0}}})).toThrow('coverageKindAccounting');
  });
  test('counts staging-invalid outputs without promoting readiness',()=>{
    const f=fixture(),[,g,m]=fragments(f);
    const invalid=fromCoverage({...f.coverage,canonicalValidation:{feature:{stagingInvalid:1}}});
    const r=buildMatrix(invalid,g,m);
    expect(r.rows.find((x:any)=>x.kind==='feature')).toMatchObject({nextReview:'stagingValidation',runtimeEligible:0,retirementAuthorized:false});
  });
});

const {buildGlobalCheckpointReview}=require('../../scripts/5etools/global-checkpoint-review');
function globalFixture(){
 const [c,g,m]=fragments(),matrix=buildMatrix(c,g,m);
 const checkpoints:Record<string,string>={weapon:'equipment',armor:'equipment',class:'classes',subclass:'classes',feature:'classes',spell:'spells',species:'origins',background:'origins',feat:'feats',equipment:'remaining',magicItem:'remaining',creatureStatBlock:'remaining',condition:'conditions'};
 const rows=Object.fromEntries(matrix.rows.map((x:any)=>[x.kind,{checkpoint:checkpoints[x.kind],upstream:x.conversion.emitted,historical:x.preservation.historical??0,runtime:x.preservation.runtime??0,historicalCandidates:x.preservation['historical:identityCandidate']??0,runtimeCandidates:x.preservation['runtime:identityCandidate']??0,historicalEraPending:0,runtimeEraPending:0}]));
 const body={schemaVersion:'dnd-upstream-family-checkpoint-fragment.v1',commits,rows,outside:{historical:0,runtime:1},totals:{upstream:1,historical:1,runtime:2,dependencies:1,aliases:0,categories:0,legacyLinks:0},
  runtimeIdentity:{entries:2,runtimeOnly:1},bindings:{},conditionScope:{},checkpointBlockers:{},approvedMappings:0,mechanicalParityEstablished:0,activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false};
 return {matrix,fragment:{...body,fingerprint:digest(body)}};
}
describe('a8.12.1 global checkpoint review',()=>{
 test('joins all family denominators and retains every global blocker',()=>{
  const {matrix,fragment}=globalFixture(),before=digest({matrix,fragment}),r=buildGlobalCheckpointReview(matrix,fragment);
  expect(r.rows).toHaveLength(13);
  expect(r.rows.find((v:any)=>v.kind==='feature')).toMatchObject({checkpoint:'classes',upstream:1,historical:1,runtime:1,historicalCandidates:1,storage:1,reviewStatus:'scopedEvidenceOnly'});
  expect(r).toMatchObject({readiness:'blocked',outside:{runtime:1},approvedMappings:0,mechanicalParityEstablished:0,writeAuthorized:false});
  expect(r.blockers).toEqual(matrix.blockers);
  expect(digest({matrix,fragment})).toBe(before);
 });
 test('blocks stale snapshots, altered fingerprints and cross-kind redistribution',()=>{
  const {matrix,fragment}=globalFixture();
  expect(()=>buildGlobalCheckpointReview(matrix,{...fragment,fingerprint:'stale'})).toThrow('familyFragmentFingerprintMismatch');
  const {fingerprint,...body}=fragment;
  const stale={...body,commits:{...commits,application:'d'.repeat(40)}};
  expect(()=>buildGlobalCheckpointReview(matrix,{...stale,fingerprint:digest(stale)})).toThrow('globalCheckpointCommitMismatch');
  const rows={...body.rows,feature:{...body.rows.feature,upstream:0},spell:{...body.rows.spell,upstream:1}},moved={...body,rows};
  expect(()=>buildGlobalCheckpointReview(matrix,{...moved,fingerprint:digest(moved)})).toThrow('globalCheckpointKindAccounting');
 });
 test('never promotes an aggregate to distribution or migration approval',()=>{
  const {matrix,fragment}=globalFixture(),{fingerprint,...body}=fragment;
  const changed={...body,writeAuthorized:true};
  expect(()=>buildGlobalCheckpointReview(matrix,{...changed,fingerprint:digest(changed)})).toThrow('invalidFamilyFragment');
  expect(()=>buildGlobalCheckpointReview({...matrix,distributionAuthorized:true},fragment)).toThrow('invalidGlobalMatrix');
 });
});
