import * as fs from 'node:fs';
import { createDefaultCharacter } from '../data/mockData';
import { applySpellSlotRest, checkSpellSlotAvailability, spendSpellSlots } from '../rules-engine/resources/spellSlotManager';
import { applyRest, checkResourceAvailability, spendResources } from '../rules-engine/resources/resourceManager';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {compileProfile,profileAtLevel,derivePools,compileSpellCost,evaluateCast,compileResourceEvidence,compileSpellResource,resourcePool,resourceCost,checkActionBudget,buildResourceReport,publicSummary}=require('../../scripts/5etools/resource-spellcasting-preview');
const fullTable=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+1),{'1':i===0?2:4,'2':i>=2?2:0}]));
const full={status:'tableCandidate',kind:'class',rulesEra:'2024',progression:'fullCaster',upstreamProgression:'full',slotsByLevel:fullTable,limits:{},activation:'review-required'};
const pact={status:'tableCandidate',kind:'class',rulesEra:'2024',progression:'pactMagic',upstreamProgression:'pact',pactSlotsByLevel:Array(20).fill(2),pactSlotLevelByLevel:Array(20).fill(2),limits:{},activation:'review-required'};
const binding=(profile:any,classInstanceId:string,level:number)=>({profile,classInstanceId,level});
describe('a6.5.2 resource and spellcasting preview',()=>{
  test('profile projection reuses exact tables, rejects missing or partial data',()=>{
    const item={id:'class',kind:'class',source:{rulesEra:'2024'},provenance:{sourceCode:'XPHB'},payload:{spellcasting:{slotsByLevel:fullTable,ability:'INT',preparedSpellsByLevel:Array(20).fill(3)},mechanics:{upstreamClassRecord:{casterProgression:'full',preparedSpells:'formula'}}}};
    const p=compileProfile(item);
    expect(p).toMatchObject({status:'tableCandidate',progression:'fullCaster',preparationFormulaPending:true});
    expect(profileAtLevel(p,3)).toMatchObject({slots:{'1':4,'2':2},limits:{preparedSpellsByLevel:3}});
    expect(profileAtLevel(p,21).status).toBe('indeterminate');
    expect(compileProfile({...item,payload:{...item.payload,spellcasting:{slotsByLevel:{'1':{'1':2}}}}}).status).toBe('indeterminate');
  });
  test('subclass tables are independent candidates and require explicit activation context',()=>{
    const raw={casterProgression:'1/3',spellcastingAbility:'int',subclassTableGroups:[{colLabels:['{@filter 1st|spells|level=1}'],rowsSpellProgression:Array.from({length:20},(_,i)=>[i<2?0:2])}]};
    const p=compileProfile({id:'sub',kind:'subclass',source:{rulesEra:'2024'},provenance:{sourceCode:'XPHB'},payload:{classId:'fighter',mechanics:{upstreamClassRecord:raw}}});
    expect(p).toMatchObject({status:'tableCandidate',progression:'thirdCaster',classId:'fighter',subclassActivationPending:true});
    expect(derivePools([binding(p,'fighter-instance',3)]).status).toBe('indeterminate');
    expect(derivePools([{...binding(p,'fighter-instance',3),subclassConfirmed:true}]).pools[0]).toMatchObject({level:1,max:2});
  });
  test('regular and Pact pools stay separate and existing runtime spends and recovers them independently',()=>{
    const r=derivePools([binding(full,'wizard-instance',3),binding(pact,'warlock-instance',3)]);
    expect(r.status).toBe('poolCandidate');
    const character={...createDefaultCharacter('Fixture'),spellSlots:r.pools};
    const cost={slotLevel:2 as const,minimumSlotLevel:1 as const,poolKind:'pactMagic' as const,sourceClassId:'warlock-instance',amount:1};
    expect(checkSpellSlotAvailability(character,[cost]).ok).toBe(true);
    const spent=spendSpellSlots({character,costs:[cost]}).character;
    expect(spent.spellSlots.find(s=>s.poolKind==='pactMagic')?.current).toBe(1);
    expect(spent.spellSlots.find(s=>s.poolKind==='spellcasting'&&s.level===2)?.current).toBe(2);
    const regularSpent=spendSpellSlots({character:spent,costs:[{slotLevel:2,poolKind:'spellcasting',amount:1}]}).character;
    const rested=applySpellSlotRest(regularSpent,'shortRest').character;
    expect(rested.spellSlots.find(s=>s.poolKind==='pactMagic')?.current).toBe(2);
    expect(rested.spellSlots.find(s=>s.poolKind==='spellcasting'&&s.level===2)?.current).toBe(1);
    expect(character.spellSlots.find((s:any)=>s.poolKind==='pactMagic').current).toBe(2);
  });
  test('multiclassing requires explicit rounding and an edition-qualified full-caster table',()=>{
    const half={...full,progression:'halfCaster',upstreamProgression:'artificer'};
    const bs=[binding(full,'wizard',2),binding(half,'paladin',3)];
    expect(derivePools(bs).reason).toBe('multiclassPolicyRequired');
    const multiclassPolicy={rulesEra:'2024',rounding:{full:'floor',artificer:'ceil'}};
    expect(derivePools(bs,{multiclassPolicy}).reason).toBe('multiclassReferenceTableRequired');
    expect(derivePools(bs,{multiclassPolicy,referenceProfile:full})).toMatchObject({status:'poolCandidate',effectiveCasterLevel:4});
    expect(derivePools([bs[0],binding({...half,rulesEra:'2014'},'legacy',3)],{multiclassPolicy,referenceProfile:full}).reason).toBe('multiclassEditionPending');
    expect(derivePools([binding(full,'same',3),binding(pact,'same',3)]).status).toBe('indeterminate');
  });
  test('spell cost requires access, trigger and explicit pool; cantrips consume no slot',()=>{
    const spell=(level:number,actionCost='action')=>({id:'spell',kind:'spell',payload:{level,castingTime:{kind:'action',actionCost},mechanics:{upstreamSpell:{time:[{number:1,unit:actionCost==='reaction'?'reaction':'action'}]}}}});
    const p=compileSpellCost(spell(2,'reaction'));
    expect(evaluateCast(p,{mode:'normal',accessConfirmed:true}).reason).toBe('triggerPending');
    expect(evaluateCast(p,{mode:'normal',accessConfirmed:true,triggerConfirmed:true,pool:{level:1,poolKind:'spellcasting'}}).status).toBe('notSatisfied');
    expect(evaluateCast(p,{mode:'normal',accessConfirmed:true,triggerConfirmed:true,pool:{level:3,poolKind:'pactMagic',sourceClassId:'warlock'}})).toMatchObject({slotCosts:[{slotLevel:3,minimumSlotLevel:2,poolKind:'pactMagic',sourceClassId:'warlock'}]});
    expect(evaluateCast(compileSpellCost(spell(0)),{mode:'normal',accessConfirmed:true})).toMatchObject({slotCosts:[]});
    expect(evaluateCast(compileSpellCost(spell(0)),{mode:'ritual',accessConfirmed:true}).status).toBe('indeterminate');
  });
  test('resource adapters use existing resource manager, including partial recovery, no name inference',()=>{
    const spec={id:'fixture',name:'Fixture',max:3,current:3,recharge:'longRest',recoveryRules:[{trigger:'shortRest',amount:1}]};
    const p=resourcePool(spec),c=resourceCost({resourceId:'fixture',amount:2});
    const character={...createDefaultCharacter('Fixture'),resources:[p.pool]};
    expect(checkResourceAvailability(character,[c.cost]).ok).toBe(true);
    const spent=spendResources({character,costs:[c.cost]}).character;
    expect(spent.resources[0].current).toBe(1);
    expect(applyRest(spent,'shortRest').character.resources[0].current).toBe(2);
    expect(applyRest(spent,'longRest').character.resources[0].current).toBe(3);
    expect(resourcePool({...spec,recharge:'daily'}).status).toBe('indeterminate');
    expect(resourceCost({resourceId:'fixture',amount:-1}).status).toBe('indeterminate');
    expect(compileResourceEvidence({id:'f',payload:{mechanics:{upstreamFeature:{consumes:{name:'Die'}}}}})[0].status).toBe('resourceBindingPending');
    expect(compileSpellResource({fromId:'f',status:'resolvedIdentity',context:{rechargeType:'daily'}}).recoveryPolicy).toBe('rechargeSemanticsPending');
  });
  test('action budget counts only explicit simple actions and preserves unresolved restrictions',()=>{
    const b={action:1,bonusAction:1,reaction:1};
    expect(checkActionBudget([{actionCost:'action',amount:1},{actionCost:'bonusAction',amount:1}],b).status).toBe('satisfied');
    expect(checkActionBudget([{actionCost:'action',amount:2}],b).status).toBe('notSatisfied');
    expect(checkActionBudget([{actionCost:'action',amount:1,restricted:true}],b).status).toBe('indeterminate');
    expect(checkActionBudget([{actionCost:'movement',amount:1}],b).status).toBe('indeterminate');
  });
});
const mainPath=process.env.DND_UPSTREAM_RESOURCE_MAIN,brewPath=process.env.DND_UPSTREAM_RESOURCE_BREW;
(mainPath&&brewPath?test:test.skip)('real resource and spellcasting preview stays review-required',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildResourceReport(openSnapshot(mainPath),openSnapshot(brewPath));
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.byProfile.tableCandidate||0).toBeGreaterThan(0);
  expect(r.summary.byProgression['class:pactMagic']||0).toBeGreaterThan(0);
  expect(r.summary.bySpellCost.costCandidate||0).toBeGreaterThan(0);
  expect(r.summary.resourceEvidence).toBeGreaterThan(0);
  expect(r.summary.spellResources).toBeGreaterThan(0);
  for(const p of r.profiles.filter((x:any)=>x.status==='tableCandidate')){
    for(let n=1;n<=20;n++)expect(profileAtLevel(p,n).status).toBe('tableCandidate');
  }
  for(const x of [...r.profiles,...r.spellCosts,...r.resourceEvidence,...r.spellResources])expect(x.activation).toBe('review-required');
  const out=process.env.DND_UPSTREAM_RESOURCE_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},240000);
