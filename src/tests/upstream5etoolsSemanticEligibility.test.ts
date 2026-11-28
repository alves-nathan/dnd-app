import * as fs from 'node:fs';
const {identity}=require('../../scripts/5etools/resolver');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {createReferenceIndex}=require('../../scripts/5etools/reference-index');
const {compilePrerequisite,evaluatePrerequisite,normalizeSchedule,scheduledCount,choicesFor,validateSelection,evaluateAllocation,evaluateBackgroundAllocation,contextualGrants,evaluateGrant,buildSemanticReport,publicSummary}=require('../../scripts/5etools/semantic-eligibility');
const item={id:'consumer',source:{rulesEra:'2024'},provenance:{origin:'5etools'}};
function fixture(kind:string,name:string,source:string,id:string){
  const entity={name,source},key=identity(kind,entity),blob='b'.repeat(40);
  return {record:{origin:'main',kind,key,entity,path:'fixture.json',index:0,blob},item:{id,kind:kind==='optionalfeature'?'feature':kind,source:{rulesEra:'2024'},provenance:{origin:'5etools',entityKey:key,path:'fixture.json',index:0,blob}}};
}
describe('a6.5.1 executable eligibility subset',()=>{
  test('three-valued conjunction and disjunction never grant an unknown branch automatically',()=>{
    const a={op:'abilityMinimum',ability:'CHA',minimum:13},b={op:'characterLevel',minimum:4},p={op:'pending'};
    expect(evaluatePrerequisite({op:'all',children:[a,b]},{abilities:{CHA:14},characterLevel:4})).toBe('satisfied');
    expect(evaluatePrerequisite({op:'all',children:[a,p]},{abilities:{CHA:8}})).toBe('notSatisfied');
    expect(evaluatePrerequisite({op:'all',children:[a,p]},{abilities:{CHA:14}})).toBe('indeterminate');
    expect(evaluatePrerequisite({op:'any',children:[a,p]},{abilities:{CHA:14}})).toBe('satisfied');
    expect(evaluatePrerequisite({op:'any',children:[a,p]},{abilities:{CHA:8}})).toBe('indeterminate');
    expect(evaluatePrerequisite({op:'any',children:[]},{})).toBe('indeterminate');
  });
  test('compiles exact prerequisite IDs and keeps default and unsupported alternatives pending',()=>{
    const a=fixture('feat','Fixture','XPHB','feat'),b=fixture('feat','Fixture','PHB','old');
    const index=createReferenceIndex([a.record,b.record],[a.item,b.item]);
    const n=compilePrerequisite({op:'referenceRequirement',referenceType:'feat',raw:['Fixture|XPHB','Fixture']},item,index);
    expect(n.children).toEqual([{op:'possesses',entityId:'feat',kind:'feat'},expect.objectContaining({op:'pending',reason:'defaultIdentityCandidate'})]);
    expect(evaluatePrerequisite(n,{possessedIds:['feat']})).toBe('satisfied');
    expect(evaluatePrerequisite(n,{possessedIds:[],possessedIdsComplete:true})).toBe('indeterminate');
    expect(evaluatePrerequisite(n.children[0],{possessedIds:[],possessedIdsComplete:true})).toBe('notSatisfied');
    expect(evaluatePrerequisite(n.children[0],{possessedIds:[]})).toBe('indeterminate');
  });
  test('class-level requirements preserve exact owner and reject omitted subclass conditions',()=>{
    const c=fixture('class','Warlock','XPHB','class'),index=createReferenceIndex([c.record],[c.item]);
    const cls={name:'Warlock',source:'XPHB'};
    const raw={level:5,class:cls},n={op:'classLevel',minimum:5,class:cls,raw};
    const compiled=compilePrerequisite(n,item,index);
    expect(compiled).toEqual({op:'classLevel',classId:'class',minimum:5});
    expect(evaluatePrerequisite(compiled,{characterLevel:12,classLevels:{class:4}})).toBe('notSatisfied');
    expect(evaluatePrerequisite(compiled,{classLevels:{},classLevelsComplete:true})).toBe('notSatisfied');
    expect(evaluatePrerequisite(compiled,{classLevels:{}})).toBe('indeterminate');
    expect(compilePrerequisite({...n,raw:{...raw,subclass:{name:'Fixture'}}},item,index).op).toBe('pending');
    expect(evaluatePrerequisite(compilePrerequisite({op:'spellcasting',rule:'spellcastingFeature'},item,index),{flags:{canCastSpell:true}})).toBe('indeterminate');
  });
  test('selection schedules preserve exact level counts and context without inferring missing levels',()=>{
    const schedule=normalizeSchedule({'3':3,'7':5});
    expect(scheduledCount(schedule,3)).toBe(3);expect(scheduledCount(schedule,4)).toBeUndefined();
    expect(scheduledCount(normalizeSchedule({'*':1}))).toBe(1);
    expect(normalizeSchedule([2,1]).status).toBe('schedulePending');
    expect(normalizeSchedule({'*':1,'3':2}).status).toBe('schedulePending');
    const x=choicesFor({payload:{mechanics:{upstreamClassRecord:{optionalfeatureProgression:[{name:'Fixture',featureType:['EI'],progression:[1,3]}]}}}});
    expect(x[0]).toMatchObject({status:'selectorAndSchedule',selector:{field:'featureType',codes:['EI']}});
  });
  test('validates distinct selections and ability cap without mutating scores',()=>{
    const a={fixed:[],choice:{abilities:['CHA','DEX'],count:1,amount:1,distinct:true},max:20},scores={CHA:19,DEX:20};
    expect(validateSelection(['a','b'],2,['a','a'])).toBe('notSatisfied');
    expect(evaluateAllocation(a,['CHA'],scores)).toBe('satisfied');
    expect(evaluateAllocation(a,['DEX'],scores)).toBe('notSatisfied');
    expect(evaluateAllocation(a,['CHA'],{})).toBe('indeterminate');
    expect(scores).toEqual({CHA:19,DEX:20});
    const bg={options:['STR','DEX','CON'],patterns:[[2,1],[1,1,1]],max:20};
    expect(evaluateBackgroundAllocation(bg,{STR:2,DEX:1},{STR:18,DEX:19})).toBe('satisfied');
    expect(evaluateBackgroundAllocation(bg,{STR:3},{STR:17})).toBe('notSatisfied');
  });
  test('contextual grant checks class level and selected subclass, never activates cross-owner',()=>{
    const owner={id:'sub',kind:'subclass',payload:{classId:'class',progression:[{level:6,featureIds:['feature']}],mechanics:{featureGrantReferences:[{raw:'Fixture',featureId:'feature',level:6}]}}};
    const target={id:'feature',kind:'feature',payload:{classId:'class',subclassId:'sub',levelGained:6}};
    const index={byId:new Map([[target.id,target]])};
    const aliases=[{ownerId:'alias',baseOwnerId:'sub',ownerEmitted:false,status:'completeAliasCandidate',grants:[{status:'inheritedCrossOwnerCandidate',targetId:'feature',targetEmitted:true,level:6}]}];
    const [direct,cross]=contextualGrants([owner],index,aliases);
    expect(direct.status).toBe('directContextCandidate');
    expect(evaluateGrant(direct,{classLevels:{class:6},selectedSubclasses:{class:'sub'}})).toEqual({eligibility:'satisfied',activation:'review-required'});
    expect(evaluateGrant(direct,{classLevels:{class:5},selectedSubclasses:{class:'sub'}}).eligibility).toBe('notSatisfied');
    expect(evaluateGrant(direct,{classLevels:{class:6},selectedSubclasses:{class:'different'}}).eligibility).toBe('notSatisfied');
    expect(evaluateGrant(cross,{classLevels:{class:20},selectedSubclasses:{class:'alias'}}).eligibility).toBe('indeterminate');
  });
});
const mainPath=process.env.DND_UPSTREAM_SEMANTIC_MAIN,brewPath=process.env.DND_UPSTREAM_SEMANTIC_BREW;
(mainPath&&brewPath?test:test.skip)('real semantic compiler emits reviewed candidates and no automatic grants',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildSemanticReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.requirements).toBeGreaterThan(0);
  expect(r.summary.fullyEvaluableRequirements).toBeGreaterThan(0);
  expect(r.summary.grantCounts.directContextCandidate||0).toBeGreaterThan(0);
  expect(r.summary.grantCounts.crossOwnerEndpointOrGrantPending||0).toBeGreaterThan(0);
  expect(r.summary.choices).toBeGreaterThan(0);
  for(const g of r.grants){expect(g.activation).toBe('review-required');expect(evaluateGrant(g,{}).eligibility).toBe('indeterminate');}
  for(const x of [...r.requirements,...r.choices,...r.spellCandidates])expect(x.activation).toBe('review-required');
  const out=process.env.DND_UPSTREAM_SEMANTIC_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},240000);
