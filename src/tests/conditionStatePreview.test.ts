import {previewConditionImplications,previewConditionMovement,previewConditionSave,previewConditionLifecycle,type ConditionRecipientContext} from '../rules-engine/effects/conditionStatePreview';
import type {ConditionInstance} from '../rules-engine/effects/conditionAttackPreview';
import type {AbilityScore} from '../types';

const instance=(kind:ConditionInstance['kind'],extra:Partial<ConditionInstance>={}):ConditionInstance=>({
  id:kind,kind,rulesEra:'2024',recipientId:'actor',status:'active',...extra
});
const ctx=(instances:ConditionInstance[]=[],extra:Partial<ConditionRecipientContext>={}):ConditionRecipientContext=>({
  inventoryComplete:true,instances,recipientId:'actor',...extra
});
const movement=(instances:ConditionInstance[],baseSpeedFeet=30)=>previewConditionMovement({...ctx(instances),baseSpeedFeet});
const save=(instances:ConditionInstance[],ability:AbilityScore,baseAdvantage=false,baseDisadvantage=false)=>
  previewConditionSave({...ctx(instances),ability,baseBonus:5,baseAdvantage,baseDisadvantage});

describe('edition-aware condition state review preview',()=>{
  test('tracks explicit and implied conditions separately without duplicate grants',()=>{
    const input=ctx([instance('unconscious'),instance('incapacitated'),instance('paralyzed'),
      instance('prone',{id:'other-prone',recipientId:'other'})]);
    const before=JSON.stringify(input);
    const r=previewConditionImplications(input);
    expect(r).toMatchObject({status:'implicationsPreviewCandidate',concentration:'breakRequired',
      runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
    if(r.status!=='implicationsPreviewCandidate')throw Error('missing implications');
    expect(r.effective.find(x=>x.kind==='incapacitated')).toEqual({kind:'incapacitated',rulesEra:'2024',instanceIds:['incapacitated'],impliedByIds:['unconscious','paralyzed']});
    expect(r.effective.find(x=>x.kind==='prone')).toEqual({kind:'prone',rulesEra:'2024',instanceIds:[],impliedByIds:['unconscious']});
    expect(JSON.stringify(input)).toBe(before);
    expect(previewConditionImplications(ctx([instance('stunned',{rulesEra:'2014'})]))).toMatchObject({concentration:'crossRuleReview'});
    expect(previewConditionImplications(ctx([instance('stunned',{rulesEra:'2014'}),instance('incapacitated')]))).toMatchObject({status:'indeterminate',codes:['mixedEditionImplicationPending']});
  });
  test('locks speed without inheriting 2014 stunned movement restriction into 2024',()=>{
    for(const kind of ['grappled','restrained','paralyzed','petrified','unconscious'] as const){
      expect(movement([instance(kind,{...(kind==='grappled'?{sourceId:'grappler'}:{})})])).toMatchObject({speedFeet:0,speedLockedZero:true,movementBlocked:true});
    }
    expect(movement([instance('stunned',{rulesEra:'2014'})])).toMatchObject({speedFeet:30,speedLockedZero:false,movementBlocked:true});
    expect(movement([instance('stunned')])).toMatchObject({speedFeet:30,speedLockedZero:false,movementBlocked:false});
    expect(movement([instance('exhaustion',{rulesEra:'2014',level:2})],31)).toMatchObject({speedFeet:15});
    expect(movement([instance('exhaustion',{rulesEra:'2014',level:5})])).toMatchObject({speedFeet:0,movementBlocked:true});
    expect(movement([instance('exhaustion',{level:3})])).toMatchObject({speedFeet:15});
    expect(movement([instance('exhaustion',{level:5})],20)).toMatchObject({speedFeet:0,movementBlocked:true});
    expect(movement([instance('exhaustion',{level:3}),instance('restrained')])).toMatchObject({speedFeet:0,speedLockedZero:true});
  });
  test('reports standing costs and contextual fear/dragging requirements without spending movement',()=>{
    expect(movement([instance('prone')],31)).toMatchObject({crawlOnly:true,standing:'halfSpeedCostCandidate',standCostFeet:15});
    expect(movement([instance('prone',{rulesEra:'2014'})])).toMatchObject({standing:'crossRuleReview'});
    expect(movement([instance('prone'),instance('restrained')])).toMatchObject({standing:'blocked'});
    expect(movement([instance('unconscious')])).toMatchObject({crawlOnly:true,standing:'blocked'});
    expect(movement([instance('frightened',{sourceId:'fear'}),instance('grappled',{sourceId:'grappler'})])).toMatchObject({fearSourceIds:['fear'],draggingReviewRequired:true});
  });
  test('ordinary saves distinguish automatic failure, DEX disadvantage and edition-specific exhaustion',()=>{
    for(const rulesEra of ['2014','2024'] as const){
      for(const kind of ['paralyzed','petrified','stunned','unconscious'] as const){
        expect(save([instance(kind,{rulesEra})],'STR',true)).toMatchObject({autoFail:true,outcome:'failure'});
        expect(save([instance(kind,{rulesEra})],'DEX')).toMatchObject({autoFail:true,outcome:'failure'});
        expect(save([instance(kind,{rulesEra})],'WIS')).toMatchObject({autoFail:false,outcome:'rollRequired'});
      }
    }
    expect(save([instance('incapacitated')],'STR')).toMatchObject({autoFail:false});
    expect(save([instance('restrained')],'DEX')).toMatchObject({rollMode:'disadvantage',autoFail:false});
    expect(save([instance('restrained')],'DEX',true)).toMatchObject({rollMode:'normal'});
    expect(save([instance('restrained')],'CON')).toMatchObject({rollMode:'normal'});
    expect(save([instance('exhaustion',{rulesEra:'2014',level:3})],'WIS')).toMatchObject({rollMode:'disadvantage',bonus:5});
    expect(save([instance('exhaustion',{level:3})],'WIS')).toMatchObject({rollMode:'normal',bonus:-1});
    expect(save([instance('poisoned')],'CON')).toMatchObject({rollMode:'normal'});
  });
  test('ending one independent grant never removes another grant or unrelated participant',()=>{
    const a=instance('poisoned',{id:'a',sourceId:'one'}),b=instance('poisoned',{id:'b',sourceId:'two'});
    const other=instance('prone',{recipientId:'other'}),input=ctx([a,b,other]),before=JSON.stringify(input);
    const r=previewConditionLifecycle(input,{kind:'end',instanceId:'a',endConfirmed:true,status:'expired'});
    expect(r).toMatchObject({status:'lifecyclePreviewCandidate',instances:[{...a,status:'expired'},b,other],
      effective:[{kind:'poisoned',instanceIds:['b']}],writeAuthorized:false});
    expect(JSON.stringify(input)).toBe(before);
    expect(previewConditionLifecycle(input,{kind:'end',instanceId:'prone',endConfirmed:true,status:'removed'})).toMatchObject({codes:['activeInstanceRequired']});
  });
  test('unconscious lifecycle preserves prone and independent incapacitation',()=>{
    const revised=instance('unconscious'),incap=instance('incapacitated');
    const input=ctx([revised,incap]);
    expect(previewConditionLifecycle(input,{kind:'end',instanceId:revised.id,endConfirmed:true,status:'removed'})).toMatchObject({codes:['explicitUniqueProneInstanceIdRequired']});
    const r=previewConditionLifecycle(input,{kind:'end',instanceId:revised.id,endConfirmed:true,status:'removed',proneInstanceId:'fall'});
    expect(r).toMatchObject({status:'lifecyclePreviewCandidate',instances:[{...revised,status:'removed'},incap,{id:'fall',kind:'prone',status:'active'}],
      effective:[{kind:'incapacitated',instanceIds:['incapacitated'],impliedByIds:[]},{kind:'prone',instanceIds:['fall']}],concentration:'breakRequired'});
    const legacy=instance('unconscious',{rulesEra:'2014'});
    const granted=previewConditionLifecycle(ctx([]),{kind:'grant',instance:legacy,grantConfirmed:true,proneInstanceId:'legacy-fall'});
    if(granted.status!=='lifecyclePreviewCandidate')throw Error('missing grant');
    expect(granted.instances).toMatchObject([legacy,{id:'legacy-fall',kind:'prone',rulesEra:'2014',status:'active'}]);
    const ended=previewConditionLifecycle(ctx(granted.instances),{kind:'end',instanceId:legacy.id,endConfirmed:true,status:'expired'});
    expect(ended).toMatchObject({effective:[{kind:'prone',instanceIds:['legacy-fall']}],concentration:'unchangedByReviewedConditions'});
  });
  test('fails closed for incomplete state, mixed implications, duplicate grants and exhaustion transitions',()=>{
    expect(previewConditionImplications(ctx([],{inventoryComplete:false}))).toMatchObject({codes:['completeConditionInventoryRequired']});
    expect(movement([], -1)).toMatchObject({codes:['unmodifiedSpeedRequired']});
    expect(save([instance('exhaustion',{level:6})],'STR')).toMatchObject({status:'blocked',codes:['terminalExhaustion']});
    expect(movement([instance('exhaustion',{level:6})])).toMatchObject({status:'blocked',codes:['terminalExhaustion']});
    expect(previewConditionLifecycle(ctx([]),{kind:'grant',instance:instance('exhaustion',{level:1}),grantConfirmed:true})).toMatchObject({codes:['exhaustionLevelTransitionRequired']});
    expect(previewConditionLifecycle(ctx([instance('prone')]),{kind:'grant',instance:instance('prone'),grantConfirmed:true})).toMatchObject({codes:['invalidConditionInstance']});
    expect(previewConditionLifecycle(ctx([instance('prone',{rulesEra:'2014'})]),{kind:'grant',instance:instance('unconscious'),grantConfirmed:true})).toMatchObject({codes:['mixedEditionImplicationPending']});
  });
});
