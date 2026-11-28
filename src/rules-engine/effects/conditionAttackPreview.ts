import { calculateHitChance } from '../damage/hitChance';
import type { HitChanceResult, RollMode } from '../../types';

export const CONDITION_KINDS = ['blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious'] as const;
export type ConditionKind = typeof CONDITION_KINDS[number];
export type ConditionRulesEra = '2014' | '2024';

/** Explicit hypothetical state, not an imported/installed condition alias.
 * Multiple independent sources may impose the same non-level condition. */
export interface ConditionInstance {
  id: string;
  kind: ConditionKind;
  rulesEra: ConditionRulesEra;
  recipientId: string;
  sourceId?: string;
  status: 'active' | 'expired' | 'removed';
  level?: number;
}
export interface ConditionAttackContext {
  inventoryComplete: boolean;
  instances: readonly ConditionInstance[];
  attackerId: string;
  targetId: string;
  distanceFeet: number;
  attackCost: 'action' | 'bonusAction' | 'reaction';
  attackBonus: number;
  targetAC: number;
  critRange?: number;
  // Preserve BOTH base flags, even when they already cancel.
  baseAdvantage: boolean;
  baseDisadvantage: boolean;
  visibility: readonly {observerId:string;subjectId:string;visible:boolean}[];
}
interface ReviewFlags {
  activation: 'review-required';
  runtimeEligible: false;
  writeAuthorized: false;
  retirementAuthorized: false;
}
export type ConditionAttackPreview = ReviewFlags & (
  {status:'indeterminate'|'blocked'; codes:string[]} |
  {status:'attackPreviewCandidate'; codes:string[]; rollMode:RollMode; attackBonus:number; criticalOnHit:boolean; probabilities:HitChanceResult}
);
const flags: ReviewFlags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false};
const pending=(...codes:string[]):ConditionAttackPreview=>({...flags,status:'indeterminate',codes});
const blocked=(...codes:string[]):ConditionAttackPreview=>({...flags,status:'blocked',codes});
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.trim()===x;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const kinds=new Set<string>(CONDITION_KINDS);
const incap=new Set<ConditionKind>(['incapacitated','paralyzed','petrified','stunned','unconscious']);
const sourced=new Set<ConditionKind>(['charmed','frightened','grappled']);
const pair=(a:string,b:string)=>JSON.stringify([a,b]);

/** Validate exact instance identities and explicit edition; never infer level
 * from duplicate labels or combine same-recipient mixed-edition variants. */
export function validateConditionPreviewState(instances: readonly ConditionInstance[]): string[] {
  if(!Array.isArray(instances))return ['invalidConditionInventory'];
  const ids=new Set<string>(), active=new Map<string,ConditionInstance>();
  for(const x of instances){
    if(!x||!id(x.id)||!id(x.recipientId)||!kinds.has(x.kind)||!['2014','2024'].includes(x.rulesEra)||
      !['active','expired','removed'].includes(x.status)||ids.has(x.id)||
      (x.sourceId!==undefined&&!id(x.sourceId)))return ['invalidConditionInstance'];
    ids.add(x.id);
    if(x.kind==='exhaustion'){
      if(!Number.isInteger(x.level)||x.level!<1||x.level!>6)return ['invalidExhaustionLevel'];
    }else if(x.level!==undefined)return ['unexpectedConditionLevel'];
    if(x.status!=='active')continue;
    if(sourced.has(x.kind)&&(!x.sourceId||x.sourceId===x.recipientId))return ['conditionSourceRequired'];
    const key=pair(x.recipientId,x.kind),previous=active.get(key);
    if(previous&&previous.rulesEra!==x.rulesEra)return ['mixedEditionConditionPending'];
    if(previous&&x.kind==='exhaustion')return ['duplicateExhaustionState'];
    active.set(key,x);
  }
  return [];
}

/** Only an ordinary attack-roll preview against one explicit target.
 * No automatic grants, ending conditions, save/skill checks, movement,
 * immunity, damage resistance, spell targeting or character mutation.
 * Inputs are manually supplied hypothetical facts, not trusted V3 records. */
export function previewConditionAttack(input:ConditionAttackContext):ConditionAttackPreview {
  try{
    if(!input||input.inventoryComplete!==true)return pending('completeConditionInventoryRequired');
    if(!id(input.attackerId)||!id(input.targetId)||input.attackerId===input.targetId||
      !finite(input.distanceFeet)||input.distanceFeet<0||!finite(input.attackBonus)||!finite(input.targetAC)||input.targetAC<0||
      !['action','bonusAction','reaction'].includes(input.attackCost)||
      typeof input.baseAdvantage!=='boolean'||typeof input.baseDisadvantage!=='boolean'||
      (input.critRange!==undefined&&(!Number.isInteger(input.critRange)||input.critRange<2||input.critRange>20))||
      !Array.isArray(input.visibility))return pending('invalidAttackContext');
    const errors=validateConditionPreviewState(input.instances);
    if(errors.length)return pending(...errors);
    const seen=new Map<string,boolean>();
    for(const v of input.visibility){
      if(!v||!id(v.observerId)||!id(v.subjectId)||v.observerId===v.subjectId||typeof v.visible!=='boolean'||
        seen.has(pair(v.observerId,v.subjectId)))return pending('invalidVisibilityContext');
      seen.set(pair(v.observerId,v.subjectId),v.visible);
    }
    const attacker=input.instances.filter(x=>x.status==='active'&&x.recipientId===input.attackerId);
    const target=input.instances.filter(x=>x.status==='active'&&x.recipientId===input.targetId);
    if([...attacker,...target].some(x=>x.kind==='exhaustion'&&x.level===6))return blocked('terminalExhaustion');
    if(attacker.some(x=>incap.has(x.kind)))return blocked('attackerIncapacitated');
    if(attacker.some(x=>x.kind==='charmed'&&x.sourceId===input.targetId))return blocked('attackAgainstCharmer');
    let advantage=input.baseAdvantage,disadvantage=input.baseDisadvantage,bonus=input.attackBonus,criticalOnHit=false;
    const missing=new Set<string>();
    const visible=(observer:string,subject:string)=>{
      const value=seen.get(pair(observer,subject));
      if(value===undefined)missing.add('conditionVisibilityRequired');
      return value;
    };
    for(const x of attacker){
      if(['blinded','poisoned','prone','restrained'].includes(x.kind))disadvantage=true;
      if(x.kind==='frightened'&&visible(input.attackerId,x.sourceId!)===true)disadvantage=true;
      if(x.kind==='grappled'&&x.rulesEra==='2024'&&x.sourceId!==input.targetId)disadvantage=true;
      if(x.kind==='invisible'&&(x.rulesEra==='2014'||visible(input.targetId,input.attackerId)===false))advantage=true;
      if(x.kind==='exhaustion'){
        if(x.rulesEra==='2014'&&x.level!>=3)disadvantage=true;
        if(x.rulesEra==='2024')bonus-=2*x.level!;
      }
    }
    for(const x of target){
      if(['blinded','restrained','paralyzed','petrified','stunned','unconscious'].includes(x.kind))advantage=true;
      if(x.kind==='invisible'&&(x.rulesEra==='2014'||visible(input.attackerId,input.targetId)===false))disadvantage=true;
      // Unconscious entails prone (or falling prone). The hypothetical state
      // assumes the condition's stated immediate consequences have occurred.
      if(x.kind==='prone'||x.kind==='unconscious'){
        if(input.distanceFeet<=5)advantage=true;
        else disadvantage=true;
      }
      if((x.kind==='paralyzed'||x.kind==='unconscious')&&input.distanceFeet<=5)criticalOnHit=true;
    }
    if(missing.size)return pending(...missing);
    const rollMode:RollMode=advantage===disadvantage?'normal':advantage?'advantage':'disadvantage';
    return {...flags,status:'attackPreviewCandidate',codes:[],rollMode,attackBonus:bonus,criticalOnHit,
      probabilities:calculateHitChance({attackBonus:bonus,targetAC:input.targetAC,rollMode,critRange:input.critRange,criticalOnHit})};
  }catch{return pending('conditionPreviewFailed');}
}
