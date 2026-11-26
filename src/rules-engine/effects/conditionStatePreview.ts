import { validateConditionPreviewState, type ConditionInstance, type ConditionKind } from './conditionAttackPreview';
import type { AbilityScore, RollMode } from '../../types';

const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false} as const;
const pending=(...codes:string[])=>({...flags,status:'indeterminate' as const,codes});
const blocked=(...codes:string[])=>({...flags,status:'blocked' as const,codes});
const validId=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.trim()===x;
const natural=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const incapacitating=new Set<ConditionKind>(['paralyzed','petrified','stunned','unconscious']);
const legacyImmobile=new Set<ConditionKind>(['paralyzed','petrified','stunned','unconscious']);
const revisedZeroSpeed=new Set<ConditionKind>(['paralyzed','petrified','unconscious']);
export interface ConditionRecipientContext {
  inventoryComplete:boolean;
  instances:readonly ConditionInstance[];
  recipientId:string;
}
function validateContext(input:ConditionRecipientContext):string[]{
  if(!input||input.inventoryComplete!==true)return ['completeConditionInventoryRequired'];
  if(!validId(input.recipientId))return ['recipientRequired'];
  return validateConditionPreviewState(input.instances);
}
const relevant=(input:ConditionRecipientContext)=>input.instances.filter(x=>x.status==='active'&&x.recipientId===input.recipientId);

interface EffectiveCondition {
  kind:ConditionKind;
  rulesEra:ConditionInstance['rulesEra'];
  instanceIds:string[];
  impliedByIds:string[];
}

/** Derivation is a view, not a grant. Never delete independently granted
 * conditions when the parent condition ends. */
export function previewConditionImplications(input:ConditionRecipientContext){
  const errors=validateContext(input);
  if(errors.length)return pending(...errors);
  const active=relevant(input);
  const groups=new Map<ConditionKind,EffectiveCondition>();
  let conflict=false;
  const add=(kind:ConditionKind,x:ConditionInstance,implied:boolean)=>{
    let g=groups.get(kind);
    if(g&&g.rulesEra!==x.rulesEra){conflict=true;return;}
    if(!g){g={kind,rulesEra:x.rulesEra,instanceIds:[],impliedByIds:[]};groups.set(kind,g);}
    (implied?g.impliedByIds:g.instanceIds).push(x.id);
  };
  for(const x of active){
    add(x.kind,x,false);
    if(incapacitating.has(x.kind))add('incapacitated',x,true);
    // 2024 Unconscious entails Prone. 2014 falling prone is an immediate
    // grant, not a continuous implied condition; see lifecycle below.
    if(x.kind==='unconscious'&&x.rulesEra==='2024')add('prone',x,true);
  }
  if(conflict)return pending('mixedEditionImplicationPending');
  const effective=[...groups.values()].sort((a,b)=>a.kind.localeCompare(b.kind));
  const incap=groups.get('incapacitated');
  return {...flags,status:'implicationsPreviewCandidate' as const,codes:[],effective,
    concentration:incap?.rulesEra==='2024'?'breakRequired' as const:incap?'crossRuleReview' as const:'unchangedByReviewedConditions' as const,
    terminalExhaustion:active.some(x=>x.kind==='exhaustion'&&x.level===6)};
}

export interface ConditionMovementContext extends ConditionRecipientContext {
  baseSpeedFeet:number;
}
/** Unmodified speed and scoped condition restrictions. Does not resolve
 * terrain, dragging, forced movement, available movement or path geometry. */
export function previewConditionMovement(input:ConditionMovementContext){
  const implications=previewConditionImplications(input);
  if(implications.status!=='implicationsPreviewCandidate')return implications;
  if(!natural(input.baseSpeedFeet))return pending('unmodifiedSpeedRequired');
  if(implications.terminalExhaustion)return blocked('terminalExhaustion');
  const active=relevant(input);
  const exhaustion=active.find(x=>x.kind==='exhaustion');
  let speedFeet=input.baseSpeedFeet;
  if(exhaustion){
    const level=exhaustion.level!;
    if(exhaustion.rulesEra==='2014')speedFeet=level>=5?0:level>=2?Math.floor(speedFeet/2):speedFeet;
    else speedFeet=Math.max(0,speedFeet-5*level);
  }
  const speedLockedZero=active.some(x=>x.kind==='grappled'||x.kind==='restrained'||
    (x.rulesEra==='2024'&&revisedZeroSpeed.has(x.kind)));
  if(speedLockedZero)speedFeet=0;
  const legacyMovementBlocked=active.some(x=>x.rulesEra==='2014'&&legacyImmobile.has(x.kind));
  const prone=implications.effective.find(x=>x.kind==='prone');
  const movementBlocked=legacyMovementBlocked||speedFeet===0;
  // No standing transaction: multiple grants, source effects and budgets
  // are not silently consumed. 2014 stand cost is a separate cross-rule.
  const standing=!prone?'notProne':movementBlocked?'blocked':
    prone.rulesEra==='2024'?'halfSpeedCostCandidate':'crossRuleReview';
  return {...flags,status:'movementPreviewCandidate' as const,codes:[],speedFeet,speedLockedZero,movementBlocked,
    crawlOnly:Boolean(prone),standing,...(standing==='halfSpeedCostCandidate'?{standCostFeet:Math.floor(speedFeet/2)}:{}),
    fearSourceIds:[...new Set(active.filter(x=>x.kind==='frightened').map(x=>x.sourceId!))].sort(),
    draggingReviewRequired:active.some(x=>x.kind==='grappled'&&x.rulesEra==='2024')};
}

export interface ConditionSaveContext extends ConditionRecipientContext {
  ability:AbilityScore;
  baseBonus:number;
  baseAdvantage:boolean;
  baseDisadvantage:boolean;
}
/** Ordinary ability saving throws only. Not death saves or concentration
 * transactions; no probability or natural-20 override on automatic failure. */
export function previewConditionSave(input:ConditionSaveContext){
  const implications=previewConditionImplications(input);
  if(implications.status!=='implicationsPreviewCandidate')return implications;
  if(!['STR','DEX','CON','INT','WIS','CHA'].includes(input.ability)||!Number.isFinite(input.baseBonus)||
    typeof input.baseAdvantage!=='boolean'||typeof input.baseDisadvantage!=='boolean')return pending('invalidSavingThrowContext');
  if(implications.terminalExhaustion)return blocked('terminalExhaustion');
  const active=relevant(input);
  let disadvantage=input.baseDisadvantage,bonus=input.baseBonus;
  const autoFail=(input.ability==='STR'||input.ability==='DEX')&&active.some(x=>incapacitating.has(x.kind));
  if(input.ability==='DEX'&&active.some(x=>x.kind==='restrained'))disadvantage=true;
  for(const x of active){
    if(x.kind==='exhaustion'){
      if(x.rulesEra==='2014'&&x.level!>=3)disadvantage=true;
      if(x.rulesEra==='2024')bonus-=2*x.level!;
    }
  }
  const rollMode:RollMode=input.baseAdvantage===disadvantage?'normal':input.baseAdvantage?'advantage':'disadvantage';
  return {...flags,status:'savingThrowPreviewCandidate' as const,codes:[],ability:input.ability,autoFail,
    rollMode,bonus,...(autoFail?{outcome:'failure' as const}:{outcome:'rollRequired' as const})};
}

export type ConditionLifecycleEvent =
  | {kind:'grant';instance:ConditionInstance;grantConfirmed:true;proneInstanceId?:string}
  | {kind:'end';instanceId:string;endConfirmed:true;status:'expired'|'removed';proneInstanceId?:string};

/** Explicit confirmed hypothetical grant/end, never a clock, save, immunity
 * resolver or persistence transaction. Exhaustion uses its separate level model. */
export function previewConditionLifecycle(input:ConditionRecipientContext,event:ConditionLifecycleEvent){
  const errors=validateContext(input);
  if(errors.length)return pending(...errors);
  if(!event||!['grant','end'].includes(event.kind))return pending('unsupportedLifecycleEvent');
  const initial=previewConditionImplications(input);
  if(initial.status!=='implicationsPreviewCandidate')return initial;
  if(initial.terminalExhaustion)return blocked('terminalExhaustion');
  let next=input.instances.map(x=>({...x}));
  const addProne=(x:ConditionInstance,newId:string|undefined):string|undefined=>{
    // Independent explicit Prone already preserves the state; do not create
    // a duplicate merely because the same condition is implied.
    const existing=next.filter(p=>p.status==='active'&&p.recipientId===x.recipientId&&p.kind==='prone');
    if(existing.some(p=>p.rulesEra!==x.rulesEra))return 'mixedEditionImplicationPending';
    if(existing.length)return undefined;
    if(!validId(newId)||next.some(p=>p.id===newId))return 'explicitUniqueProneInstanceIdRequired';
    next.push({id:newId,kind:'prone',rulesEra:x.rulesEra,recipientId:x.recipientId,status:'active'});
    return undefined;
  };
  if(event.kind==='grant'){
    const x=event.instance;
    if(event.grantConfirmed!==true||!x||x.recipientId!==input.recipientId||x.status!=='active')return pending('confirmedGrantRequired');
    if(x.kind==='exhaustion')return pending('exhaustionLevelTransitionRequired');
    next.push({...x});
    // 2014 explicitly falls prone; 2024 has Prone as a continuous implication.
    if(x.kind==='unconscious'&&x.rulesEra==='2014'){
      const error=addProne(x,event.proneInstanceId);if(error)return pending(error);
    }
  }else{
    if(event.endConfirmed!==true||!['expired','removed'].includes(event.status))return pending('confirmedEndRequired');
    const x=next.find(p=>p.id===event.instanceId&&p.recipientId===input.recipientId&&p.status==='active');
    if(!x)return pending('activeInstanceRequired');
    if(x.kind==='exhaustion')return pending('exhaustionLevelTransitionRequired');
    next=next.map(p=>p.id===x.id?{...p,status:event.status}:p);
    // Revised Unconscious explicitly leaves Prone when it ends. If another
    // Unconscious grant remains, preserve the independent prone consequence
    // now rather than losing it when that grant later ends.
    if(x.kind==='unconscious'&&x.rulesEra==='2024'){
      const error=addProne(x,event.proneInstanceId);if(error)return pending(error);
    }
  }
  const nextInput={...input,instances:next};
  const result=previewConditionImplications(nextInput);
  if(result.status!=='implicationsPreviewCandidate')return result;
  return {...flags,status:'lifecyclePreviewCandidate' as const,codes:[],instances:next,
    effective:result.effective,concentration:result.concentration};
}
