import { calculateHitChance } from '../rules-engine/damage/hitChance';
import { previewConditionAttack, validateConditionPreviewState, type ConditionInstance, type ConditionAttackContext } from '../rules-engine/effects/conditionAttackPreview';

const instance=(kind:ConditionInstance['kind'],extra:Partial<ConditionInstance>={}):ConditionInstance=>({
  id:kind,kind,rulesEra:'2024',recipientId:'actor',status:'active',...extra
});
const context=(instances:ConditionInstance[]=[],extra:Partial<ConditionAttackContext>={}):ConditionAttackContext=>({
  inventoryComplete:true,instances,attackerId:'actor',targetId:'target',distanceFeet:5,attackCost:'action',
  attackBonus:5,targetAC:16,baseAdvantage:false,baseDisadvantage:false,visibility:[],...extra
});
const preview=(instances:ConditionInstance[],extra:Partial<ConditionAttackContext>={})=>previewConditionAttack(context(instances,extra));

describe('condition attack review preview',()=>{
  test('critical on hit preserves hit probability and natural misses for all roll modes',()=>{
    for(const rollMode of ['normal','advantage','disadvantage'] as const){
      const p={attackBonus:5,targetAC:16,rollMode};
      const baseline=calculateHitChance(p),critical=calculateHitChance({...p,criticalOnHit:true});
      expect(critical.hitChance).toBeCloseTo(baseline.hitChance);
      expect(critical.critChance).toBeCloseTo(baseline.hitChance);
      expect(critical.normalHitChance).toBe(0);
      expect(critical.hitChance).toBeLessThan(1);
      expect(calculateHitChance({...p,criticalGuaranteed:true,criticalOnHit:true})).toEqual({hitChance:1,critChance:1,normalHitChance:0});
    }
    expect(calculateHitChance({attackBonus:100,targetAC:1,rollMode:'normal',criticalOnHit:true}).hitChance).toBeCloseTo(0.95);
  });
  test('paralysis and unconscious use actual hit probability within five feet, no forced critical beyond',()=>{
    for(const rulesEra of ['2014','2024'] as const){
      for(const kind of ['paralyzed','unconscious'] as const){
        const target=instance(kind,{rulesEra,recipientId:'target'});
        const near=preview([target]);
        expect(near).toMatchObject({status:'attackPreviewCandidate',rollMode:'advantage',criticalOnHit:true,
          probabilities:{normalHitChance:0},runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
        if(near.status!=='attackPreviewCandidate')throw Error('missing preview');
        expect(near.probabilities.hitChance).toBeCloseTo(0.75);
        expect(near.probabilities.critChance).toBeCloseTo(0.75);
        const far=preview([target],{distanceFeet:6});
        expect(far).toMatchObject({criticalOnHit:false,rollMode:kind==='unconscious'?'normal':'advantage'});
      }
    }
  });
  test('advantage and disadvantage cancel globally, including already opposed base flags',()=>{
    const target=instance('prone',{recipientId:'target'});
    expect(preview([target],{distanceFeet:6})).toMatchObject({rollMode:'disadvantage'});
    expect(preview([target],{baseAdvantage:true,baseDisadvantage:true})).toMatchObject({rollMode:'normal'});
    expect(preview([instance('poisoned'),target])).toMatchObject({rollMode:'normal'});
    expect(preview([instance('blinded'),instance('poisoned'),target])).toMatchObject({rollMode:'normal'});
  });
  test('source and visibility determine contextual frightened, grappled and invisible rolls',()=>{
    const fear=instance('frightened',{sourceId:'fear-source'});
    expect(preview([fear])).toMatchObject({status:'indeterminate',codes:['conditionVisibilityRequired']});
    for(const visible of [true,false]){
      expect(preview([fear],{visibility:[{observerId:'actor',subjectId:'fear-source',visible}]})).toMatchObject({rollMode:visible?'disadvantage':'normal'});
    }
    expect(preview([instance('grappled',{sourceId:'target'})])).toMatchObject({rollMode:'normal'});
    expect(preview([instance('grappled',{sourceId:'other'})])).toMatchObject({rollMode:'disadvantage'});
    expect(preview([instance('grappled',{sourceId:'other',rulesEra:'2014'})])).toMatchObject({rollMode:'normal'});
    const invisible=instance('invisible',{recipientId:'target'});
    expect(preview([invisible])).toMatchObject({status:'indeterminate'});
    expect(preview([invisible],{visibility:[{observerId:'actor',subjectId:'target',visible:false}]})).toMatchObject({rollMode:'disadvantage'});
    expect(preview([invisible],{visibility:[{observerId:'actor',subjectId:'target',visible:true}]})).toMatchObject({rollMode:'normal'});
    expect(preview([{...invisible,rulesEra:'2014'}])).toMatchObject({rollMode:'disadvantage'});
    expect(preview([instance('invisible')],{visibility:[{observerId:'target',subjectId:'actor',visible:false}]})).toMatchObject({rollMode:'advantage'});
  });
  test('incapacitation and charmer attack are blocked only on relevant participant',()=>{
    for(const kind of ['incapacitated','paralyzed','petrified','stunned','unconscious'] as const){
      for(const attackCost of ['action','bonusAction','reaction'] as const){
        expect(preview([instance(kind)],{attackCost})).toMatchObject({status:'blocked',codes:['attackerIncapacitated']});
      }
    }
    expect(preview([instance('charmed',{sourceId:'target'})])).toMatchObject({status:'blocked',codes:['attackAgainstCharmer']});
    expect(preview([instance('charmed',{sourceId:'other'})])).toMatchObject({status:'attackPreviewCandidate'});
    expect(preview([instance('stunned',{recipientId:'other'})])).toMatchObject({rollMode:'normal'});
  });
  test('explicit exhaustion levels separate editions without deriving levels from duplicate labels',()=>{
    expect(preview([instance('exhaustion',{rulesEra:'2014',level:2})])).toMatchObject({rollMode:'normal',attackBonus:5});
    expect(preview([instance('exhaustion',{rulesEra:'2014',level:3})])).toMatchObject({rollMode:'disadvantage',attackBonus:5});
    expect(preview([instance('exhaustion',{level:3})])).toMatchObject({rollMode:'normal',attackBonus:-1});
    expect(preview([instance('exhaustion',{level:6})])).toMatchObject({status:'blocked',codes:['terminalExhaustion']});
    expect(preview([instance('exhaustion',{level:6,recipientId:'target'})])).toMatchObject({status:'blocked',codes:['terminalExhaustion']});
    expect(validateConditionPreviewState([instance('exhaustion',{level:1}),instance('exhaustion',{id:'second',level:1})])).toEqual(['duplicateExhaustionState']);
    expect(validateConditionPreviewState([instance('exhaustion',{level:0})])).toEqual(['invalidExhaustionLevel']);
  });
  test('independent instances retain identity; inactive and unrelated instances do not affect output',()=>{
    const a=instance('poisoned',{id:'one',sourceId:'source1',status:'expired'});
    const b=instance('poisoned',{id:'two',sourceId:'source2'});
    const input=context([a,b,instance('restrained',{recipientId:'third'})]),before=JSON.stringify(input);
    expect(previewConditionAttack(input)).toMatchObject({rollMode:'disadvantage'});
    expect(preview([{...b,status:'removed'},a])).toMatchObject({rollMode:'normal'});
    expect(JSON.stringify(input)).toBe(before);
  });
  test('fails closed for ambiguous edition, duplicate instance, missing context and bad visibility',()=>{
    const a=instance('poisoned');
    expect(preview([a,{...a,id:'second',rulesEra:'2014'}])).toMatchObject({codes:['mixedEditionConditionPending']});
    expect(preview([a,a])).toMatchObject({codes:['invalidConditionInstance']});
    expect(preview([instance('frightened')])).toMatchObject({codes:['conditionSourceRequired']});
    expect(preview([],{inventoryComplete:false})).toMatchObject({codes:['completeConditionInventoryRequired']});
    expect(preview([],{distanceFeet:-1})).toMatchObject({codes:['invalidAttackContext']});
    const v={observerId:'actor',subjectId:'target',visible:true};
    expect(preview([],{visibility:[v,{...v,visible:false}]})).toMatchObject({codes:['invalidVisibilityContext']});
  });
});
