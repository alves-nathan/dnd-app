import type { Character, SpellSlotPool } from '../types';
import { isSpellSlotLevel, spellSlotPoolKey } from '../rules-engine/resources/spellSlotManager';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const validPool=(p:SpellSlotPool)=>typeof p.id==='string'&&p.id.length>0&&isSpellSlotLevel(p.level)&&
 Number.isSafeInteger(p.max)&&p.max>=0&&Number.isSafeInteger(p.current)&&p.current>=0&&p.current<=p.max&&
 ((p.poolKind==='spellcasting'&&p.sourceClassId===undefined&&p.recharge==='longRest')||
 (p.poolKind==='pactMagic'&&typeof p.sourceClassId==='string'&&p.sourceClassId.length>0&&p.recharge==='shortRest'));
const sorted=(p:SpellSlotPool[])=>[...p].sort((a,b)=>(a.id??'').localeCompare(b.id??''));

/** Disposable slot-only comparison. Exact base and unchanged remaining
 * character fields; never a live spell-cast validator or commit gate. */
export function reviewSpellSlotOnlyPreservation(base:Character,current:Character,after:Character,selectedPoolId:string|null){
 const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false} as const;
 const codes:string[]=[];
 try{
  if(!same(base,current))codes.push('baseSnapshotMismatch');
  const pools=current.spellSlots;
  if(!pools.every(validPool)||new Set(pools.map(p=>p.id)).size!==pools.length||new Set(pools.map(spellSlotPoolKey)).size!==pools.length)
   codes.push('invalidSlotInventory');
  const target=selectedPoolId===null?undefined:pools.find(p=>p.id===selectedPoolId);
  if(selectedPoolId!==null&&(!target||target.current<1))codes.push('selectedPoolUnavailable');
  const expected=pools.map(p=>p.id===selectedPoolId?{...p,current:p.current-1}:p);
  if(!same(sorted(expected),sorted(after.spellSlots)))codes.push('unexpectedSlotChanges');
  const keys=new Set([...Object.keys(current),...Object.keys(after)]);
  const unexpectedPaths=[...keys].filter(k=>!['spellSlots','spellSlotTransactions'].includes(k)&&
   !same((current as unknown as Record<string,unknown>)[k],(after as unknown as Record<string,unknown>)[k])).sort();
  if(unexpectedPaths.length)codes.push('unexpectedCharacterChanges');
  const previous=current.spellSlotTransactions??[],next=after.spellSlotTransactions??[];
  if(!same(previous,next.slice(0,previous.length))||next.length!==previous.length+(selectedPoolId===null?0:1))
   codes.push('slotHistoryMismatch');
  else if(target){
   const tx=next[previous.length];
   if(!tx||!tx.id||previous.some(t=>t.id===tx.id)||tx.characterId!==current.id||tx.poolId!==target.id||
    tx.poolKind!==target.poolKind||tx.sourceClassId!==target.sourceClassId||tx.slotLevel!==target.level||
    tx.amount!==-1||tx.before!==target.current||tx.after!==target.current-1||tx.restType!==undefined)
    codes.push('slotTransactionMismatch');
  }
  return {...flags,status:codes.length?'preservationBlocked' as const:'slotOnlyPreservationCandidate' as const,codes,unexpectedPaths,
   blockers:['spellEffectsAndOtherCostsNotApplied','noV3CastAuthorization']};
 }catch{return {...flags,status:'preservationBlocked' as const,codes:['invalidSlotReviewContext'],unexpectedPaths:[]};}
}
