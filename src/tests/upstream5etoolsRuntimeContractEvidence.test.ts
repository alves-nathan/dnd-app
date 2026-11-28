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

const {buildRuntimeClosureReview}=require('../../scripts/5etools/runtime-closure-review');
describe('a8.11.3 runtime closure review',()=>{
 test('consolidates unchanged fixture, pending identity and relation boundaries without approval',()=>{
  const x=fixture(),before=digest(x),evidence=buildRuntimeContractEvidence(x);
  const preservation=compareRuntimeContractPreservation(x,evidence,x.runtimeBundle,x.runtimeBundle);
  const r=buildRuntimeClosureReview(x,{evidence,preservation});
  expect(r).toMatchObject({scope:'bundledFixtureOnly',readiness:'blocked',identity:{entries:3,pilotReview:1,runtimeOnly:2,candidates:1,pending:2,editionPending:1},
   relationships:{dependencies:{occurrences:1,requiredByCurrentFilter:1,requiredWithPendingEndpoints:1},aliases:{occurrences:1,active:1,endpointPending:1}},
   categories:{memberships:2,inverseMembershipPending:1},policies:{total:13},approvedMappings:0,mechanicalParityEstablished:0,writeAuthorized:false});
  expect(r.blockers.map((x:any)=>x.code)).toContain('installedRuntimeInventoryAndConfigurationNotVerified');
  expect(JSON.stringify(r)).not.toMatch(/Private|upstream:main:/);
  expect(digest(x)).toBe(before);
 });
 test('rejects changed bundles and internally rehashed forged evidence',()=>{
  const x=fixture(),evidence=buildRuntimeContractEvidence(x),preservation=compareRuntimeContractPreservation(x,evidence,x.runtimeBundle,x.runtimeBundle);
  const blocked=compareRuntimeContractPreservation(x,evidence,x.runtimeBundle,{...x.runtimeBundle,selectionContracts:{changed:true}});
  expect(()=>buildRuntimeClosureReview(x,{evidence,preservation:blocked})).toThrow('runtimeClosurePreservationBlocked');
  const {fingerprint,...body}=preservation,forged={...body,preservedCounts:{...body.preservedCounts,aliases:0}};
  expect(()=>buildRuntimeClosureReview(x,{evidence,preservation:{...forged,fingerprint:digest(forged)}})).toThrow('runtimeClosureSourceMismatch');
  expect(()=>buildRuntimeClosureReview(x,{evidence:{...evidence,fingerprint:'stale'},preservation})).toThrow('runtimeClosureFingerprintMismatch');
 });
 test('counts active alias shadowing without silently resolving or rewriting it',()=>{
  const x=fixture(),b=x.runtimeBundle;
  const alias={...b.aliases.entities[0],id:'another',to:'category'};
  b.aliases.entities.push(alias);
  const old=x.reconciliation.aliases[0];
  x.reconciliation.aliases.push({...old,...alias,fingerprint:digest(alias)});
  x.reconciliation.summary.runtimeAliases++;
  const evidence=buildRuntimeContractEvidence(x),preservation=compareRuntimeContractPreservation(x,evidence,b,b);
  const r=buildRuntimeClosureReview(x,{evidence,preservation});
  expect(r.relationships.aliases).toMatchObject({occurrences:2,active:2,activeFromGroups:1,activeFromWithMultipleOccurrences:1,activeFromWithConflictingTargets:1,activeOccurrencesShadowedByLaterRecord:1});
  expect(r.readiness).toBe('blocked');
 });
});

const {buildRelationshipPolicyReview}=require('../../scripts/5etools/relationship-policy-review');
describe('a8.18.2 relationship policy preservation',()=>{
 test('keeps direct lookup, directional categories and policy evidence separate',()=>{
  const x=fixture(),before=digest(x),r=buildRelationshipPolicyReview(x,buildRuntimeContractEvidence(x));
  expect(r.alias).toMatchObject({occurrences:1,groups:1,selectedActive:1,directEntryPrecedesAliasLookup:1});
  expect(r.category).toMatchObject({occurrences:1,membershipOccurrences:2,entryDeclarations:1,selectedMembershipWithoutEntryDeclaration:1});
  expect(r.policySections).toHaveLength(13);
  expect(r).toMatchObject({relationshipParityEstablished:0,writeAuthorized:false,readiness:'blocked'});
  expect(digest(x)).toBe(before);
 });
 test('reports last-record shadowing including inactive winners and duplicate categories',()=>{
  const x=fixture(),b=x.runtimeBundle;
  const alias={...b.aliases.entities[0],id:'last',to:'category',status:'inactive'};
  b.aliases.entities.push(alias);
  x.reconciliation.aliases.push({...x.reconciliation.aliases[0],...alias,statusOriginal:alias.status,fingerprint:digest(alias)});
  x.reconciliation.summary.runtimeAliases++;
  const c={...b.contentCategories.entities[0],memberEntityIds:['rule','rule'],memberCount:2};
  b.contentCategories.entities.push(c);
  x.reconciliation.categories.push({...x.reconciliation.categories[0],memberIds:c.memberEntityIds,mappedMembers:0,fingerprint:digest(c)});
  x.reconciliation.summary.runtimeCategories++;
  const r=buildRelationshipPolicyReview(x,buildRuntimeContractEvidence(x));
  expect(r.alias).toMatchObject({occurrences:2,groups:1,conflictingTargetGroups:1,shadowedActive:1,activeShadowedByNonActive:1,selectedNonActive:1});
  expect(r.category).toMatchObject({occurrences:2,groups:1,shadowedOccurrences:1,conflictingMembershipGroups:1,duplicateMembersWithinRecord:1,shadowedMembershipOccurrences:2,entryNotInSelectedCategory:1,selectedMembershipWithoutEntryDeclaration:2});
 });
 test('counts topology without resolving chains; stale order and policy changes fail closed',()=>{
  const x=fixture(),b=x.runtimeBundle;
  const alias={...b.aliases.entities[0],id:'reverse',from:'rule',to:'spell'};
  b.aliases.entities.push(alias);
  x.reconciliation.aliases.push({...x.reconciliation.aliases[0],...alias,fromCandidate:undefined,toCandidate:x.items[0].id,fingerprint:digest(alias)});
  x.reconciliation.summary.runtimeAliases++;
  const e=buildRuntimeContractEvidence(x),r=buildRelationshipPolicyReview(x,e);
  expect(r.alias).toMatchObject({selectedActiveChainStarts:2,selectedActiveCycleMembers:2,directEntryPrecedesAliasLookup:2});
  b.aliases.entities.reverse();
  expect(()=>buildRelationshipPolicyReview(x,e)).toThrow('relationshipPolicyBindingMismatch');
  const y=fixture(),f=buildRuntimeContractEvidence(y);y.runtimeBundle.activationPolicy={mode:'changed'};
  expect(()=>buildRelationshipPolicyReview(y,f)).toThrow('relationshipPolicyBindingMismatch');
 });
});
