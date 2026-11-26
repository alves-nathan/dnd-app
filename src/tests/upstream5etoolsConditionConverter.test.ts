import {createEmptyCharacter,defaultCombatState} from '../data/mockData';
import {createCombatScenario} from '../rules-engine/turns/compareRotations';
import {createTacticalTarget,combatStateForTarget,effectiveTargetSpeed} from '../rules-engine/turns/tacticalCombat';
import {calculateHitChance} from '../rules-engine/damage/hitChance';
import {activeEffectConditionIds,addActiveEffectToCharacter,clearConcentration,getActiveConcentrationEffect} from '../rules-engine/effects/activeEffects';
import type {ActiveEffect} from '../types';
const {bindCondition,buildCapabilityMatrix,publicSummary:capabilitySummary}=require('../../scripts/5etools/condition-capability-matrix');
const {bindExhaustion,previewExhaustion,previewExhaustionTransition,buildConditionMechanicsReport,publicSummary:conditionMechanicsSummary}=require('../../scripts/5etools/condition-mechanics-preview');
import {stageImportV3} from '../compendium/importV3Staging';
import {COMPENDIUM_ENTITY_KINDS} from '../compendium/importDomain';
const {buildPilot,physicalId}=require('../../scripts/5etools/condition-converter');
const {converters,summarizePilotCoverage}=require('../../scripts/5etools/pilot-coverage');
const {openSnapshot}=require('../../scripts/5etools/inventory');
const condition=(name:string,source='XPHB',extra:Record<string,unknown>={})=>({name,source,entries:['Synthetic fixture'],...extra});
function fixture(conditions:unknown[],statuses:unknown[]=[],diseases:unknown[]=[]){
  const data:Record<string,unknown>={'data/books.json':{book:[{source:'PHB',name:'Fixture 2014',published:'2014-01-01'},{source:'XPHB',name:'Fixture 2024',published:'2024-01-01'}]},'data/conditionsdiseases.json':{condition:conditions,status:statuses,disease:diseases}};
  return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]};
}
describe('5etools condition pilot',()=>{
  test('keeps edition-specific identities, staging slugs and raw exhaustion rules separate',()=>{
    const legacy=condition('Exhaustion','PHB',{entries:['Old synthetic rule'],reprintedAs:['Exhaustion|XPHB']});
    const revised=condition('Exhaustion','XPHB',{entries:['New synthetic rule']});
    const r=buildPilot(fixture([legacy,revised]));
    const a=r.packs[0].items[0],b=r.packs[1].items[0];
    expect(a.id).not.toBe(b.id);expect(a.id).toBe(physicalId(legacy));expect(a.identity.canonicalKey).toBe(b.identity.canonicalKey);
    expect(a.payload.conditionId).not.toBe(b.payload.conditionId);
    expect(a.payload).toMatchObject({officialCondition:true,mechanics:{runtimeConditionCandidate:'exhaustion',upstreamCondition:legacy}});
    expect(a.payload.effects).toBeUndefined();expect(a.payload.endConditions).toBeUndefined();
    expect(a.payload.mechanics.conditionReviewCandidate).toEqual({rulesEra:'2014',stackPolicy:'editionSpecificPending',effectPolicy:'unreviewed',endPolicy:'unreviewed',runtimeAlias:'unapproved'});
    expect(b.payload.mechanics.conditionReviewCandidate).toEqual({...a.payload.mechanics.conditionReviewCandidate,rulesEra:'2024'});
    expect(a.metadata.reviewCodes).toContain('stackedConditionEditionPolicyPending');
    expect(a.precedence.relation).toBe('unresolved');expect(a.metadata.upstreamReprintedAs).toEqual(['Exhaustion|XPHB']);
    expect(stageImportV3({...r.packs[0],items:[a,b]}).ok).toBe(true);
  });
  test('counts statuses, diseases and nonpilot conditions without emitting them',()=>{
    const r=buildPilot(fixture([condition('Blinded'),condition('Blinded','Other')],[condition('Concentration'),condition('Bloodied')],[condition('Blinded','DMG')]));
    expect(r.inventory.condition).toMatchObject({total:2,pilot:1,deferred:1});
    expect(r.inventory.status).toMatchObject({total:2,pilot:0,deferred:2});
    expect(r.inventory.disease).toMatchObject({total:1,pilot:0,deferred:1});
    expect(r.packs.flatMap((p:any)=>p.items)).toHaveLength(1);
    expect(stageImportV3(r.packs[1]).ok).toBe(true);
  });
  test('blocks ambiguous identity, unknown official classification, invalid entries and variants',()=>{
    const r=buildPilot(fixture([condition('Blinded'),condition('Blinded'),condition('Unknown'),condition('Prone','XPHB',{entries:[]}),condition('Charmed','XPHB',{_versions:[{}]})]),['XPHB']);
    expect(r.counts.XPHB).toMatchObject({total:5,converted:0,blocked:5,blockCodes:{ambiguousIdentity:2,conditionClassificationPending:1,invalidConditionEntries:1,unsupportedVariantOrTemplate:1}});
    expect(r.packs[0].items).toHaveLength(0);
  });
  test('registry covers exactly the 13 contract kinds and eight pilot stages',()=>{
    const kinds=new Set<string>(converters.flatMap((c:{kinds:string[]})=>c.kinds));
    expect([...kinds].sort()).toEqual([...COMPENDIUM_ENTITY_KINDS].sort());
    expect(new Set(converters.map((c:{stage:string})=>c.stage)).size).toBe(8);
  });
});
const snapshotPath=process.env.DND_UPSTREAM_CONDITION_SNAPSHOT;
(snapshotPath?test:test.skip)('real conditions validate jointly with no collisions and aggregate deferred families',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=buildPilot(openSnapshot(snapshotPath)),items=r.packs.flatMap((p:any)=>p.items),v=stageImportV3({...r.packs[0],items});
  const codes:Record<string,number>={};for(const issue of v.issues)codes[issue.code]=(codes[issue.code]||0)+1;
  const ids=new Set(items.map((i:any)=>i.payload.conditionId));
  console.log(JSON.stringify({commit:r.commit,counts:r.counts,inventory:r.inventory,validation:{ok:v.ok,items:items.length,uniqueConditionIds:ids.size,codes},activation:r.activation}));
  expect(v.ok).toBe(true);expect(ids.size).toBe(items.length);
  for(const i of items){
    expect(i.payload.mechanics.conditionReviewCandidate).toMatchObject({rulesEra:i.source.rulesEra,effectPolicy:'unreviewed',endPolicy:'unreviewed',runtimeAlias:'unapproved'});
    expect(i.payload.effects).toBeUndefined();
    expect(i.payload.endConditions).toBeUndefined();
  }
  expect(r.inventory.condition.total).toBe(r.inventory.condition.pilot+r.inventory.condition.deferred);
  for(const c of Object.values(r.counts) as {total:number;converted:number;blocked:number}[])expect(c.total).toBe(c.converted+c.blocked);
  expect(r.counts.PHB.converted).toBe(15);expect(r.counts.XPHB.converted).toBe(15);
  const mechanics=buildConditionMechanicsReport(r);
  expect(mechanics.byEra).toEqual({'2014':{total:15,editionModelCandidate:1,effectsReviewPending:14,indeterminate:0},
    '2024':{total:15,editionModelCandidate:1,effectsReviewPending:14,indeterminate:0}});
  expect(mechanics.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized)).toBe(true);
  expect(mechanics.mechanicalParityEstablished).toBe(0);
  const exhaustion=items.filter((i:any)=>i.name==='Exhaustion');
  expect(exhaustion.map((i:any)=>bindExhaustion(i).rulesEra).sort()).toEqual(['2014','2024']);
  for(const i of exhaustion){
    const changed={...i,payload:{...i.payload,mechanics:{...i.payload.mechanics,
      upstreamCondition:{...i.payload.mechanics.upstreamCondition,entries:['changed definition']}}}};
    expect(bindExhaustion(changed)).toMatchObject({status:'indeterminate',code:'definitionChanged'});
    expect(bindExhaustion({...i,source:{...i.source,rulesEra:i.source.rulesEra==='2014'?'2024':'2014'}})).toMatchObject({status:'indeterminate',code:'editionIdentityPending'});
  }
  console.log(JSON.stringify(conditionMechanicsSummary(mechanics)));
  const capabilities=buildCapabilityMatrix(r);
  expect(capabilities.byEra['2014']).toMatchObject({total:14,bound:14,indeterminate:0});
  expect(capabilities.byEra['2024']).toMatchObject({total:14,bound:14,indeterminate:0});
  expect(capabilities.byCoverage.directTargetHook).toBe(2);
  expect(capabilities.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized)).toBe(true);
  const obligations=(name:string,era:string)=>bindCondition(items.find((i:any)=>i.name===name&&i.source.rulesEra===era)).obligations.map((o:any)=>o.key);
  expect(obligations('Stunned','2014')).toContain('movementBlocked');
  expect(obligations('Stunned','2024')).not.toContain('movementBlocked');
  expect(obligations('Grappled','2014')).toContain('outsideGrapplerReachEnds');
  expect(obligations('Grappled','2024')).toContain('nonGrapplerAttackDisadvantage');
  expect(obligations('Unconscious','2024')).toContain('pronePersistsOnEnd');
  expect(obligations('Petrified','2024')).toContain('poisonedConditionImmunity');
  expect(obligations('Petrified','2024')).not.toContain('poisonDiseaseImmunity');
  const prone=items.find((i:any)=>i.name==='Prone'&&i.source.rulesEra==='2024');
  const modified={...prone,payload:{...prone.payload,mechanics:{...prone.payload.mechanics,
    upstreamCondition:{...prone.payload.mechanics.upstreamCondition,entries:['changed definition']}}}};
  expect(bindCondition(modified)).toMatchObject({status:'indeterminate',code:'definitionChanged'});
  expect(bindCondition({...prone,source:{...prone.source,rulesEra:'2014'}})).toMatchObject({status:'indeterminate',code:'editionIdentityPending'});
  console.log(JSON.stringify(capabilitySummary(capabilities)));
  for(const k of ['status','disease'])expect(r.inventory[k].total).toBe(r.inventory[k].deferred);
},120000);
(snapshotPath?test:test.skip)('all eight real pilots emit the 13 kinds, distinct physical IDs and review-required only',()=>{
  if(!snapshotPath)throw Error('missing snapshot');
  const r=summarizePilotCoverage(openSnapshot(snapshotPath));
  console.log(JSON.stringify(r));
  expect(Object.keys(r.totals).sort()).toEqual([...COMPENDIUM_ENTITY_KINDS].sort());
  expect(r.issues).toEqual({});expect(r.emitted).toBe(r.uniquePhysicalIds);
},240000);

describe('a8.5.4 edition-specific condition mechanics preview',()=>{
  test('2014 exhaustion is cumulative and uses the six distinct thresholds',()=>{
    const p=(level:number)=>previewExhaustion({rulesEra:'2014',level,baseSpeedFeet:30,baseHitPointMaximum:21});
    const expected=[[false,false,30,21],[true,false,30,21],[true,false,15,21],[true,true,15,21],[true,true,15,10],[true,true,0,10]];
    for(const [level,[checks,attacks,speed,hp]] of expected.entries()){
      expect(p(level)).toMatchObject({dead:false,disadvantage:{abilityChecks:checks,attackRolls:attacks,savingThrows:attacks},
        d20Modifier:0,speedFeet:speed,hitPointMaximum:hp,runtimeEligible:false});
    }
    expect(p(6)).toMatchObject({dead:true,level:6});
    expect(p(6)).not.toHaveProperty('speedFeet');
  });
  test('2024 exhaustion applies numeric D20 and speed penalties, no inherited 2014 penalties',()=>{
    for(let level=0;level<=5;level++){
      const r=previewExhaustion({rulesEra:'2024',level,baseSpeedFeet:15,baseHitPointMaximum:21});
      expect(r).toMatchObject({d20Modifier:level===0?0:-2*level,speedFeet:Math.max(0,15-5*level),hitPointMaximum:21,
        disadvantage:{abilityChecks:false,attackRolls:false,savingThrows:false},dead:false,writeAuthorized:false});
    }
    expect(previewExhaustion({rulesEra:'2024',level:6,baseSpeedFeet:30,baseHitPointMaximum:21})).toMatchObject({dead:true});
  });
  test('explicit transitions separate stacking, food/drink, one-level rests and terminal death',()=>{
    const p=(rulesEra:string,level:number,event:string,extra:Record<string,unknown>={})=>previewExhaustionTransition({rulesEra,level,event,...extra});
    expect(p('2014',2,'receive',{amount:3})).toMatchObject({level:5});
    expect(p('2014',2,'receive').status).toBe('indeterminate');
    expect(p('2024',2,'receive')).toMatchObject({level:3});
    expect(p('2024',2,'receive',{amount:2}).status).toBe('indeterminate');
    expect(p('2014',2,'longRest').status).toBe('indeterminate');
    expect(p('2014',2,'longRest',{foodAndDrinkConfirmed:false})).toMatchObject({level:2});
    expect(p('2014',2,'longRest',{foodAndDrinkConfirmed:true})).toMatchObject({level:1});
    expect(p('2024',1,'longRest')).toMatchObject({level:0,conditionEnded:true});
    expect(p('2024',0,'longRest')).toMatchObject({level:0});
    expect(p('2014',4,'explicitRemoval',{amount:6})).toMatchObject({level:0});
    expect(p('2024',5,'receive')).toMatchObject({level:6,dead:true});
    for(const era of ['2014','2024'])expect(p(era,6,'longRest').code).toBe('deathRequiresExternalResolution');
    expect(p('2014',6,'revival',{revivalConfirmed:true})).toMatchObject({level:5,dead:false});
    expect(p('2024',6,'revival',{revivalConfirmed:true}).status).toBe('indeterminate');
    expect(p('2014',6,'revival').status).toBe('indeterminate');
  });
  test('rejects unknown edition, invalid levels and unbound or changed definitions; no alias emitted',()=>{
    for(const level of [-1,7,1.5,NaN])expect(previewExhaustion({rulesEra:'2024',level,baseSpeedFeet:30,baseHitPointMaximum:20}).status).toBe('indeterminate');
    expect(previewExhaustion({rulesEra:'unknown',level:1,baseSpeedFeet:30,baseHitPointMaximum:20}).status).toBe('indeterminate');
    const r=buildPilot(fixture([condition('Exhaustion'),condition('Prone')]),['XPHB']);
    const evidence=buildConditionMechanicsReport(r);
    expect(evidence.byEra['2024']).toEqual({total:2,editionModelCandidate:0,effectsReviewPending:1,indeterminate:1});
    expect(evidence.rows.every((x:any)=>!x.runtimeEligible&&!x.retirementAuthorized)).toBe(true);
    expect(conditionMechanicsSummary(evidence)).not.toHaveProperty('rows');
    expect(JSON.stringify(conditionMechanicsSummary(evidence))).not.toContain('upstream:main:condition:');
    expect(bindExhaustion({}).status).toBe('indeterminate');
  });
});

describe('a8.5.5 condition capability boundary',()=>{
  test('synthetic text cannot inherit reviewed definition coverage; aggregate output redacts rows',()=>{
    const r=buildPilot(fixture([condition('Prone'),condition('Stunned'),condition('Exhaustion')]),['XPHB']);
    const matrix=buildCapabilityMatrix(r);
    expect(matrix.byEra['2024']).toEqual({total:2,bound:0,indeterminate:2,obligations:0});
    expect(matrix.rows.every((x:any)=>x.code==='definitionChanged'&&!x.runtimeEligible&&!x.writeAuthorized)).toBe(true);
    expect(capabilitySummary(matrix)).not.toHaveProperty('rows');
    expect(JSON.stringify(capabilitySummary(matrix))).not.toContain('upstream:main:condition:');
    expect(()=>buildCapabilityMatrix({...r,packs:[...r.packs,...r.packs]})).toThrow('conditionInventoryMismatch');
  });
});

describe('condition capabilities: observed runtime hooks, not activation',()=>{
  test('existing Prone target hook selects roll mode at the five-foot boundary and cancels opposing mode',()=>{
    const character=createEmptyCharacter('Fixture');
    const scenario=(distance:number,rollMode:'normal'|'advantage'|'disadvantage'='normal')=>({
      ...createCombatScenario({id:'fixture',characterId:character.id,name:'Fixture',combatState:{...defaultCombatState,rollMode}}),
      actorPositionFeet:0,targets:[createTacticalTarget({id:'target',positionFeet:distance,conditions:['prone']})]
    });
    expect(combatStateForTarget(scenario(5),'target').rollMode).toBe('advantage');
    expect(combatStateForTarget(scenario(6),'target').rollMode).toBe('disadvantage');
    expect(combatStateForTarget(scenario(5,'disadvantage'),'target').rollMode).toBe('normal');
    expect(combatStateForTarget(scenario(6,'advantage'),'target').rollMode).toBe('normal');
  });
  test('generic hit chance supports roll mode but guaranteed critical also guarantees hit',()=>{
    const p={attackBonus:5,targetAC:16};
    expect(calculateHitChance({...p,rollMode:'normal'}).hitChance).toBeCloseTo(0.5);
    expect(calculateHitChance({...p,rollMode:'advantage'}).hitChance).toBeCloseTo(0.75);
    expect(calculateHitChance({...p,rollMode:'disadvantage'}).hitChance).toBeCloseTo(0.25);
    // Paralyzed and Unconscious require critical ON HIT, not automatic hits.
    expect(calculateHitChance({...p,rollMode:'normal',criticalGuaranteed:true})).toEqual({hitChance:1,critChance:1,normalHitChance:0});
    const conditional=calculateHitChance({...p,rollMode:'normal',criticalOnHit:true});
    expect(conditional.hitChance).toBeCloseTo(0.5);
    expect(conditional.critChance).toBeCloseTo(0.5);
  });
  test('condition labels alone do not enforce speed locks, nested conditions or concentration ending',()=>{
    for(const condition of ['grappled','restrained','paralyzed','unconscious']){
      expect(effectiveTargetSpeed(createTacticalTarget({speedFeet:30,conditions:[condition]}))).toBe(30);
    }
    const character=createEmptyCharacter('Fixture');
    const effect:ActiveEffect={id:'concentration',name:'Fixture concentration',kind:'spell',sourceType:'spell',status:'active',concentration:true,conditionIds:[],
      duration:{unit:'manual'},createdAt:'2026-01-01T00:00:00.000Z'};
    const first=addActiveEffectToCharacter(character,effect);
    const second=addActiveEffectToCharacter(first,{...effect,id:'condition',name:'Fixture condition',kind:'condition',sourceType:'condition',concentration:false,conditionIds:['unconscious','unconscious']});
    expect(activeEffectConditionIds(second)).toEqual(['unconscious']);
    expect(getActiveConcentrationEffect(second)?.id).toBe('concentration');
    expect(getActiveConcentrationEffect(clearConcentration(second))).toBeUndefined();
    expect(getActiveConcentrationEffect(second)?.id).toBe('concentration');
  });
});
