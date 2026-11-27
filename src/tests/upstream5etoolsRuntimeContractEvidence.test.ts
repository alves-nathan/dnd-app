export {};
const {digest}=require('../../scripts/5etools/integrated-review');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {buildRuntimeContractEvidence,publicSummary}=require('../../scripts/5etools/runtime-contract-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const e=(entityId:string,kind:string,categoryIds:string[])=>({entityId,kind,displayName:'Private '+entityId,sourceBookId:'phb-2024',categoryIds,status:'active',defaultEnabled:true,manualReviewRequired:false});
 const entries=[e('spell','spell',['category']),e('rule','rule',[]),e('category','contentCategory',[])];
 const registry=entries.map(({entityId,kind,sourceBookId})=>({entityId,kind,sourceBookId}));
 const edge={id:'edge',fromId:'rule',toId:'spell',relation:'requires',strength:'hard',status:'active',resolutionPolicy:'preserve',crossBook:false};
 const alias={id:'alias',from:'spell',to:'rule',kind:'alias',relation:'related',status:'active',resolutionPolicy:'review'};
 const category={id:'category',sourceBookId:'phb-2024',memberEntityIds:['spell','rule'],memberCount:2};
 const b={schemaVersion:'dnd-combat-runtime-bundle.v1',catalogVersion:'fixture',manifest:{version:'fixture'},sourcePackage:{version:'fixture'},
  runtimeIndex:{entries,entryCount:3},entityRegistry:{entries:registry},dependencyGraph:{edges:[edge],nodeCount:3,edgeCount:1},aliases:{entities:[alias]},
  contentCategories:{entities:[category]},sourceFiles:{},sourceChecksums:{},contentFilterPolicy:{},readinessProfile:{},integrationContract:{},runtimeOperations:{},
  runtimeErrors:{},snapshotMigrationPolicy:{},activationPolicy:{},selectionContracts:{},providerCollections:{}};
 const items=[{id:'upstream:main:fixture',name:'Private spell',kind:'spell',source:{rulesEra:'2024'},provenance:{origin:'5etools',sourceCode:'XPHB',commit:commits.main},payload:{}}];
 const runtime={entries:entries.map(e=>({id:e.entityId,kind:e.kind,book:e.sourceBookId,fingerprint:digest(e)})),
  dependencies:[{...edge,fingerprint:digest(edge)}],aliases:[{...alias,fingerprint:digest(alias)}],
  categories:[{id:category.id,book:category.sourceBookId,memberIds:category.memberEntityIds,fingerprint:digest(category)}]};
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime,rawHistorical:[],rawRuntime:entries,items,records:[],commits});
 return {runtimeBundle:b,reconciliation,items};
}
describe('a8.11.1 runtime contract preservation evidence',()=>{
 test('accounts for pilot and runtime-only entries, mixed relationships and directional categories',()=>{
  const x=fixture(),before=digest(x),r=buildRuntimeContractEvidence(x);
  expect(r.summary).toMatchObject({entries:3,registry:3,runtimeOnly:2,pilotReview:1,policies:13,
   dependencies:{total:1,byLane:{mixedPreservation:1},byMapping:{endpointMappingPending:1}},
   aliases:{total:1,byLane:{mixedPreservation:1}},categories:{total:1,memberships:2,mappedMemberships:1,runtimeOnlyMemberships:1,inverseMembershipPending:1}});
  expect(r.rows.find((r:any)=>r.id==='spell')).toMatchObject({identityStatus:'identityCandidate',writeAuthorized:false});
  expect(r.rows.find((r:any)=>r.id==='rule')).toMatchObject({coverage:'runtimeOnlyPreserve',preservation:'required'});
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|upstream:main:/);
  expect(digest(x)).toBe(before);
 });
 test('rejects changed raw entries, relation policies and missing categories',()=>{
  const a=fixture();a.runtimeBundle.runtimeIndex.entries[0].displayName='Changed';
  expect(()=>buildRuntimeContractEvidence(a)).toThrow('runtimeContractBindingMismatch');
  const b=fixture();b.runtimeBundle.dependencyGraph.edges[0].resolutionPolicy='changed';
  expect(()=>buildRuntimeContractEvidence(b)).toThrow('runtimeRelationBindingMismatch');
  const c=fixture();c.reconciliation.categories.pop();
  expect(()=>buildRuntimeContractEvidence(c)).toThrow('runtimeCategoryCoverageMismatch');
 });
 test('policy fingerprints are independently retained, without authorizing activation',()=>{
  const a=fixture(),r=buildRuntimeContractEvidence(a);
  const b=fixture();b.runtimeBundle.activationPolicy={mode:'changed'};
  const q=buildRuntimeContractEvidence(b);
  expect(q.bundleFingerprint).not.toBe(r.bundleFingerprint);
  expect(q.policies.find((p:any)=>p.section==='activationPolicy').sourceFingerprint).not.toBe(r.policies.find((p:any)=>p.section==='activationPolicy').sourceFingerprint);
  expect(q).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,writeAuthorized:false,retirementAuthorized:false});
 });
});

const {compareRuntimeContractPreservation}=require('../../scripts/5etools/runtime-contract-preservation');
describe('a8.11.2 runtime bundle preservation',()=>{
 test('binds the complete baseline and preserves every occurrence and policy',()=>{
  const x=fixture(),e=buildRuntimeContractEvidence(x),clone=()=>JSON.parse(JSON.stringify(x.runtimeBundle));
  const before=digest(x),r=compareRuntimeContractPreservation(x,e,clone(),clone());
  expect(r).toMatchObject({status:'runtimeContractPreservationCandidate',codes:[],writeAuthorized:false,preservedCounts:{entries:3,dependencies:1,policies:13}});
  expect(digest(x)).toBe(before);
  const after=clone();after.activationPolicy={changed:true};after.providerCollections={changed:true};after.aliases.entities=[];
  expect(compareRuntimeContractPreservation(x,e,clone(),after)).toMatchObject({status:'preservationBlocked',changedSections:['activationPolicy','aliases','providerCollections']});
  expect(compareRuntimeContractPreservation(x,e,after,clone()).codes).toContain('baseSnapshotMismatch');
  expect(()=>compareRuntimeContractPreservation(x,{...e,approvedMappings:1},clone(),clone())).toThrow('runtimePreservationEvidenceMismatch');
 });
 test('blocks reorder, deletion, unknown fields and selection contract changes',()=>{
  const x=fixture(),e=buildRuntimeContractEvidence(x),after=JSON.parse(JSON.stringify(x.runtimeBundle));
  after.runtimeIndex.entries.reverse();after.selectionContracts={changed:true};after.extra={};
  expect(compareRuntimeContractPreservation(x,e,x.runtimeBundle,after).changedSections).toEqual(['extra','runtimeIndex','selectionContracts']);
 });
});
