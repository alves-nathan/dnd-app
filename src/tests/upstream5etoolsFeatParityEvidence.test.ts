import { describe, expect, test } from '@jest/globals';
const {convert}=require('../../scripts/5etools/feature-converter');
const {identity:fixtureIdentity}=require('../../scripts/5etools/resolver');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {compareFeatFields,featContractEvidence,buildFeatParityEvidence,publicSummary}=require('../../scripts/5etools/feat-parity-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function feat(name:string,code='XPHB',extra:Record<string,unknown>={}){
 const entity={name,source:code,entries:[],...extra};
 return convert({kind:'feat',blob:'d'.repeat(40),path:'data/feats.json',key:fixtureIdentity('feat',entity),index:0},{entity,lineage:[]},
  {id:'upstream:main:'+code,rulesEra:code==='PHB'?'2014':'2024',precedenceScope:'official-dnd'},commits.main);
}
function input(){
 const items=[feat('Fixture','XPHB',{category:'G',repeatable:false,ability:[{str:1}]}),feat('Fixture','PHB',{repeatable:true})];
 const a={id:'old',kind:'feat',name:'Fixture',source:{id:'phb',rulesEra:'2024'},payload:{repeatable:false,mechanics:{skillProficiencyChoice:1}}};
 const b={...a,payload:{repeatable:true}};
 const c={...a,id:'unresolved',name:'Other'};
 const rawHistorical=[a,b,c].map((item,index)=>({path:'fixture',index,item}));
 const rows=rawHistorical.map(({item,path,index})=>({path,index,id:item.id,kind:item.kind,sourceId:item.source.id,rulesEra:item.source.rulesEra,itemHash:digest(item)}));
 const rt={entityId:'runtime',displayName:'Fixture'};
 const reconciliation=reconcile({historical:{rows,bootstrapRows:[]},runtime:{entries:[{id:'runtime',kind:'feat',book:'phb-2024',rulesEra:'2024',fingerprint:digest(rt)}],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[rt],items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.9.1 feat parity evidence',()=>{
 test('does not conflate absent with false or grant semantics with exact values',()=>{
  expect(compareFeatFields({repeatable:false,mechanics:{skillProficiencyChoice:1}},{mechanics:{skillProficiencyChoice:1}})).toEqual(expect.arrayContaining([
   {field:'/payload/repeatable',status:'missingCandidate'},{field:'/payload/mechanics/skillProficiencyChoice',status:'exactValue'}]));
  const c=featContractEvidence(feat('Fixture','XPHB',{category:'G',repeatable:true,repeatableNote:'different choice',ability:[{str:1}],additionalSpells:[]}),commits.main);
  expect(c).toMatchObject({repeatability:'conditionalPending',category:'mappedCategoryCandidate',asi:'simpleShapeCandidate',declarations:[{field:'additionalSpells',status:'semanticsPending'}]});
  expect(featContractEvidence(feat('Fixture'),commits.main).repeatability).toBe('notDeclared');
 });
 test('preserves distinct historical occurrences and source-qualified identities; emits aggregate only',()=>{
  const x=input(),r=buildFeatParityEvidence(x);
  expect(r.historical).toMatchObject({occurrences:3,identityCandidates:2,identityPending:1,eraPending:0});
  expect(r.runtime).toMatchObject({occurrences:1,identityCandidates:1});
  expect(r.rows.slice(0,2).map((row:any)=>row.targetId)).toEqual([x.items[0].id,x.items[0].id]);
  expect(r.rows[0].sourceFingerprint).not.toBe(r.rows[1].sourceFingerprint);
  expect(r.upstream.items).toBe(2);
  expect([...r.rows,...r.upstreamRows,...r.runtimeRows].every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
  expect(r.mechanicalParityEstablished).toBe(0);
  const summary=publicSummary(r);
  expect(summary.rows).toBeUndefined();expect(summary.upstreamRows).toBeUndefined();expect(summary.runtimeRows).toBeUndefined();
  expect(buildFeatParityEvidence(x).fingerprint).toBe(r.fingerprint);
 });
 test('rejects tampered source, wrong edition target even with matching digest, and missing occurrences',()=>{
  const x=input();x.items[0].provenance.sourceCode='PHB';
  expect(()=>buildFeatParityEvidence(x)).toThrow('featSourceMismatch');
  const y=input();y.reconciliation.historical[0].targetId=y.items[1].id;y.reconciliation.historical[0].targetFingerprint=digest(y.items[1]);
  expect(()=>buildFeatParityEvidence(y)).toThrow('targetBindingMismatch');
  const z=input();z.reconciliation.historical.pop();
  expect(()=>buildFeatParityEvidence(z)).toThrow('historicalCoverageMismatch');
 });
});

const {buildFeatRequirementProjection,previewFeatRequirements,publicSummary:requirementSummary}=require('../../scripts/5etools/feat-requirement-projection');
function requirementsFixture(){
 const x=input();
 const items=[...x.items,feat('Required'),feat('Gate','XPHB',{category:'G',prerequisite:[{level:4,ability:[{str:13},{dex:13}],feat:['Required|XPHB']}]}),
  feat('Unqualified','XPHB',{category:'G',prerequisite:[{feat:['Required']}]}),
  feat('Cross era','XPHB',{category:'G',prerequisite:[{feat:['Fixture|PHB']}]}),
  feat('Partial','XPHB',{category:'G',prerequisite:[{level:4},{campaign:['fixture']}]}),
  feat('Origin','XPHB',{category:'O'}),feat('Legacy','PHB')];
 return {...x,items};
}
describe('a8.9.2 feat requirement projection',()=>{
 function request(x:ReturnType<typeof requirementsFixture>,name:string,facts:Record<string,unknown>){
  const p=buildFeatRequirementProjection(x),i=x.items.find((item:any)=>item.name===name),row=p.rows.find((r:any)=>r.featId===i.id);
  return {projectionFingerprint:p.fingerprint,sourceFingerprint:row.sourceFingerprint,featId:i.id,rulesEra:row.rulesEra,
   allowedCategories:['general'],factsConfirmed:true,categoryPolicyConfirmed:true,facts};
 }
 test('qualified AND/OR and exact possession; no implicit feat grant',()=>{
  const x=requirementsFixture(),id=x.items.find((i:any)=>i.name==='Required').id;
  const facts={characterLevel:4,abilities:{STR:10,DEX:13},possessedIds:[id],possessedIdsComplete:true};
  const q=request(x,'Gate',facts);
  expect(previewFeatRequirements(x,q)).toMatchObject({status:'requirementsCandidate',prerequisiteStatus:'satisfied',writeAuthorized:false,executable:false});
  expect(previewFeatRequirements(x,{...q,facts:{...facts,characterLevel:3}}).status).toBe('notSatisfied');
  expect(previewFeatRequirements(x,{...q,facts:{...facts,possessedIds:[],possessedIdsComplete:false}}).status).toBe('indeterminate');
  expect(previewFeatRequirements(x,{...q,facts:{...facts,possessedIds:[]}}).status).toBe('notSatisfied');
  expect(previewFeatRequirements(x,{...q,facts:{...facts,possessedIds:['unqualified']}}).reason).toBe('unqualifiedCharacterFacts');
 });
 test('missing sources, cross edition and category policy remain distinct',()=>{
  const x=requirementsFixture(),facts={characterLevel:4};
  for(const name of ['Unqualified','Cross era'])expect(previewFeatRequirements(x,request(x,name,facts)).status).toBe('indeterminate');
  expect(previewFeatRequirements(x,request(x,'Origin',facts)).reason).toBe('categoryOutsideConfirmedContext');
  expect(previewFeatRequirements(x,request(x,'Legacy',facts)).reason).toBe('categoryPolicyPending');
  expect(previewFeatRequirements(x,request(x,'Partial',facts)).status).toBe('requirementsCandidate');
  expect(previewFeatRequirements(x,request(x,'Partial',{characterLevel:3})).status).toBe('indeterminate');
 });
 test('binds raw tree, evidence and context; only aggregate summary is public',()=>{
  const x=requirementsFixture(),p=buildFeatRequirementProjection(x),q=request(x,'Gate',{characterLevel:4});
  expect(requirementSummary(p).rows).toBeUndefined();
  expect(previewFeatRequirements(x,{...q,projectionFingerprint:'stale'}).reason).toBe('staleProjection');
  expect(previewFeatRequirements(x,{...q,rulesEra:'2014'}).reason).toBe('featIdentityOrEditionMismatch');
  expect(previewFeatRequirements(x,{...q,facts:{characterLevel:21}}).reason).toBe('explicitContextRequired');
  expect(()=>buildFeatRequirementProjection(x,{...buildFeatParityEvidence(x),approvedMappings:1})).toThrow('featEvidenceMismatch');
  x.items.find((i:any)=>i.name==='Gate').payload.mechanics.prerequisiteTree={op:'none'};
  expect(()=>buildFeatRequirementProjection(x)).toThrow('featPrerequisiteBindingMismatch');
 });
});

const {buildFeatAllocationProjection,previewFeatAllocation,previewFeatInstance,publicSummary:allocationSummary}=require('../../scripts/5etools/feat-allocation-projection');
function allocationFixture(){
 const x=requirementsFixture();
 return {...x,items:[...x.items,
  feat('Alloc','XPHB',{category:'G',repeatable:true,ability:[{choose:{from:['str','dex'],amount:2}},{choose:{from:['str','dex','con'],count:2}}]}),
  feat('Fixed','XPHB',{category:'G',ability:[{str:1,con:1,max:30}]}),
  feat('Conditional','XPHB',{category:'G',repeatable:true,repeatableNote:'different option'}),
  feat('Overlap','XPHB',{category:'G',ability:[{str:1,choose:{from:['str','dex']}}]}),
  feat('Ability Score Improvement','XPHB',{category:'G'}),
  feat('Hidden','XPHB',{category:'G',ability:[{str:1,hidden:true}]})]};
}
describe('a8.9.3 feat allocation and instance boundaries',()=>{
 function context(x:ReturnType<typeof allocationFixture>,name:string){
  const p=buildFeatAllocationProjection(x),i=x.items.find((i:any)=>i.name===name),r=p.rows.find((r:any)=>r.featId===i.id);
  return {featId:i.id,sourceFingerprint:r.sourceFingerprint,projectionFingerprint:p.fingerprint,rulesEra:r.rulesEra};
 }
 const scores={STR:18,DEX:19,CON:20,INT:10,WIS:10,CHA:10};
 test('keeps alternatives distinct, exact choices, cap and fixed increases',()=>{
  const x=allocationFixture(),q={...context(x,'Alloc'),scores,scoreContextConfirmed:true,allocationPolicyConfirmed:true,alternativeIndex:0,selected:['STR']};
  expect(previewFeatAllocation(x,q)).toMatchObject({status:'allocationCandidate',increases:{STR:2},after:{STR:20,DEX:19},writeAuthorized:false});
  expect(previewFeatAllocation(x,{...q,selected:['DEX']}).status).toBe('notSatisfied');
  expect(previewFeatAllocation(x,{...q,alternativeIndex:1,selected:['STR','DEX']})).toMatchObject({increases:{STR:1,DEX:1}});
  expect(previewFeatAllocation(x,{...q,alternativeIndex:1,selected:['STR','STR']}).status).toBe('notSatisfied');
  expect(previewFeatAllocation(x,{...q,...context(x,'Fixed'),selected:[]})).toMatchObject({increases:{STR:1,CON:1},maximum:30});
  expect(scores.STR).toBe(18);
 });
 test('hidden, overlap, legacy name fallback and incomplete context never grant ASI',()=>{
  const x=allocationFixture(),q={scores,scoreContextConfirmed:true,allocationPolicyConfirmed:true,alternativeIndex:0,selected:[]};
  for(const name of ['Hidden','Overlap','Ability Score Improvement'])expect(previewFeatAllocation(x,{...q,...context(x,name)}).status).toBe('indeterminate');
  expect(previewFeatAllocation(x,{...q,...context(x,'Origin'),alternativeIndex:undefined}).status).toBe('noDeclaredAllocation');
  expect(previewFeatAllocation(x,{...q,...context(x,'Fixed'),scores:{STR:18}}).status).toBe('indeterminate');
 });
 test('physical instance identity, conditional repeatability, explicit false and preserved indices',()=>{
  const x=allocationFixture();
  function request(name:string){
   const c=context(x,name);
   return {...c,inventoryCompleteConfirmed:true,physicalIdentityScopeConfirmed:true,retainedHistoryCollisionExcludedConfirmed:true,repeatabilityConditionsExcludedConfirmed:true,
    instances:[{featId:c.featId,sourceFingerprint:c.sourceFingerprint,instanceId:'existing',instanceIndex:2}],newInstanceId:'new',newInstanceIndex:3};
  }
  const q=request('Alloc');
  expect(previewFeatInstance(x,q)).toMatchObject({status:'instanceCandidate',priorCount:1,newInstanceIndex:3,executable:false});
  expect(previewFeatInstance(x,{...q,retainedHistoryCollisionExcludedConfirmed:false}).status).toBe('indeterminate');
  expect(previewFeatInstance(x,{...q,newInstanceIndex:1}).reason).toBe('nextInstanceIndexRequired');
  expect(previewFeatInstance(x,{...q,newInstanceId:'existing'}).reason).toBe('instanceAlreadyExists');
  expect(previewFeatInstance(x,{...q,repeatabilityConditionsExcludedConfirmed:false}).status).toBe('indeterminate');
  expect(previewFeatInstance(x,request('Fixture')).reason).toBe('explicitNonRepeatable');
  expect(previewFeatInstance(x,request('Conditional')).reason).toBe('repeatabilityPolicyPending');
  expect(previewFeatInstance(x,request('Fixed')).reason).toBe('repeatabilityPolicyPending');
  expect(previewFeatInstance(x,{...q,instances:[...q.instances,...q.instances]}).status).toBe('indeterminate');
  expect(previewFeatInstance(x,{...q,instances:[],newInstanceIndex:0}).status).toBe('instanceCandidate');
 });
 test('binds evidence and raw projections; public output excludes individual rows',()=>{
  const x=allocationFixture(),p=buildFeatAllocationProjection(x);
  expect(allocationSummary(p).rows).toBeUndefined();
  expect(p.mechanicalParityEstablished).toBe(0);
  expect(()=>buildFeatAllocationProjection(x,{...buildFeatRequirementProjection(x),approvedMappings:1})).toThrow('featRequirementEvidenceMismatch');
  x.items.find((i:any)=>i.name==='Alloc').payload.mechanics.abilityAllocationPlan.alternatives[0].max=30;
  expect(()=>buildFeatAllocationProjection(x)).toThrow('featAllocationBindingMismatch');
 });
});

const {buildFeatGrantEvidence,previewFeatGrant,publicSummary:grantSummary}=require('../../scripts/5etools/feat-grant-evidence');
function grantFixture(){
 const x=allocationFixture();
 return {...x,items:[...x.items,
  feat('Choice','XPHB',{category:'G',skillProficiencies:[{arcana:true,choose:{from:['history','nature'],count:1}}],featProgression:[{name:'Fixture',category:['O'],progression:{'4':1}}],feats:[{'Required|XPHB':true}],consumes:{name:'Fixture Pool',amount:2},uses:3,recharge:'longRest'}),
  feat('Pending grant','XPHB',{category:'G',feats:[{'Fixture|PHB':true},{'Required':true},{'Pending grant|XPHB':true}],skillProficiencies:[{any:1}],additionalSpells:[{ability:'cha',known:{'1':['Fixture|XPHB']}}]}),
  feat('Complex','XPHB',{category:'G',skillProficiencies:[{arcana:true}],expertise:[{arcana:true}]})]};
}
describe('a8.9.4 feat grant evidence',()=>{
 function ctx(x:ReturnType<typeof grantFixture>,name:string){
  const p=buildFeatGrantEvidence(x),i=x.items.find((i:any)=>i.name===name),r=p.rows.find((r:any)=>r.featId===i.id);
  return {featId:i.id,sourceFingerprint:r.sourceFingerprint,projectionFingerprint:p.fingerprint,rulesEra:r.rulesEra,contextConfirmed:true,selectionPolicyConfirmed:true};
 }
 test('literal proficiency alternatives, duplicates and complex policy',()=>{
  const x=grantFixture(),q={...ctx(x,'Choice'),domain:'proficiency',category:'skill',literalIdentityConfirmed:true,existingInventoryComplete:true,existing:['stealth'],selected:['history']};
  expect(previewFeatGrant(x,q)).toMatchObject({status:'proficiencyCandidate',grants:['arcana','history'],writeAuthorized:false});
  expect(previewFeatGrant(x,{...q,selected:['stealth']}).status).toBe('notSatisfied');
  expect(previewFeatGrant(x,{...q,existing:['arcana']}).reason).toBe('duplicateProficiencyPolicyPending');
  expect(previewFeatGrant(x,{...q,...ctx(x,'Complex'),selected:[]}).status).toBe('indeterminate');
 });
 test('qualified selector checkpoint and direct feat grants stay separate',()=>{
  const x=grantFixture(),origin=x.items.find((i:any)=>i.name==='Origin').id,required=x.items.find((i:any)=>i.name==='Required').id;
  const q={...ctx(x,'Choice'),domain:'selection',index:0,endpointCoverageConfirmed:true,endpointEligibilityConfirmed:true,countSemanticsConfirmed:true,existingInventoryComplete:true,existingIds:[],selectedIds:[origin],characterLevel:4};
  expect(previewFeatGrant(x,q)).toMatchObject({status:'selectionCandidate',count:1,targets:[{targetId:origin}],executable:false});
  expect(previewFeatGrant(x,{...q,characterLevel:5}).reason).toBe('checkpointPending');
  expect(previewFeatGrant(x,{...q,selectedIds:[required]}).status).toBe('notSatisfied');
  const g={...q,domain:'feat',group:0,groupPolicyConfirmed:true};
  expect(previewFeatGrant(x,g)).toMatchObject({status:'featGrantCandidate',targets:[{targetId:required}]});
  expect(previewFeatGrant(x,{...g,existingIds:[required]}).status).toBe('indeterminate');
 });
 test('cross edition, omitted source, self-reference and missing spells stay pending; resource evidence is not a pool',()=>{
  const x=grantFixture(),p=buildFeatGrantEvidence(x),pending=p.rows.find((r:any)=>r.featId===ctx(x,'Pending grant').featId),choice=p.rows.find((r:any)=>r.featId===ctx(x,'Choice').featId);
  expect(pending.feats.map((g:any)=>g.entries[0].status)).toEqual(['editionPending','selectorOrSourcePending','selfGrantPending']);
  expect(pending.spells[0].entries[0].status).toBe('endpointPending');
  expect(choice.resources).toMatchObject({cost:{status:'explicitAmountCandidate',amount:2},recoveryStatus:'notEstablished',bindingStatus:'notEstablished'});
  expect(previewFeatGrant(x,{...ctx(x,'Choice'),domain:'resource'}).status).toBe('indeterminate');
  expect(grantSummary(p).rows).toBeUndefined();
  expect(p.mechanicalParityEstablished).toBe(0);
  expect(()=>buildFeatGrantEvidence(x,{...buildFeatAllocationProjection(x),approvedMappings:1})).toThrow('featAllocationEvidenceMismatch');
 });
});
