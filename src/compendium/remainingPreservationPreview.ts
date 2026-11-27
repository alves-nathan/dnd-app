import type { Character, CombatScenario } from '../types';
import type { StoredCompendiumItem } from './types';

const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false} as const;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const int=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
const text=(x:unknown):x is string=>typeof x==='string'&&x.trim()===x&&x.length>0;
const unique=(ids:unknown[])=>ids.every(text)&&new Set(ids).size===ids.length;
const diff=(expected:object,actual:object)=>{
 const a=expected as Record<string,unknown>,b=actual as Record<string,unknown>;
 return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>own(a,k)!==own(b,k)||!same(a[k],b[k])).sort();
};
function result(domain:'inventory'|'encounter',codes:string[],unexpectedPaths:string[]=[]){
 return {...flags,status:codes.length?'preservationBlocked' as const:domain==='inventory'?'inventoryQuantityOnlyPreservationCandidate' as const:'encounterHpOnlyPreservationCandidate' as const,
  codes,unexpectedPaths,blockers:['noV3MigrationOrLiveTransactionAuthorization','externalDependenciesNotProven']};
}
interface ReviewContext {
 rulesEra:'2014'|'2024';
 snapshotContextConfirmed:boolean;
 otherDependenciesExcludedConfirmed:boolean;
}
export interface InventoryQuantityReviewContext extends ReviewContext {
 entityId:string;
 linkId:string;
 quantity:number;
}
export interface EncounterHpReviewContext extends ReviewContext {
 targetId:string;
 currentHp:number;
}
function validItem(item:StoredCompendiumItem,kind:'equipment'|'creatureStatBlock',context:ReviewContext){
 return context.snapshotContextConfirmed===true&&context.otherDependenciesExcludedConfirmed===true&&['2014','2024'].includes(context.rulesEra)&&
  item.status==='validated'&&item.type===kind&&item.rawJson.kind===kind&&item.rawJson.source?.version===context.rulesEra&&
  text(item.id)&&text(item.importItemId)&&text(item.sourceId)&&text(item.packId)&&text(item.name);
}
/** Strict comparison of an existing mundane inventory stack. Not a purchase,
 * expenditure, equipment application, removal or quantity editor. */
export function reviewInventoryQuantityPreservation(base:Character,current:Character,after:Character,item:StoredCompendiumItem,context:InventoryQuantityReviewContext){
 try{
  const codes:string[]=[];
  if(!same(base,current))codes.push('baseSnapshotMismatch');
  if(!validItem(item,'equipment',context)||!text(context.entityId)||!text(context.linkId)||!int(context.quantity,1,1000000))
   return result('inventory',[...codes,'inventoryContextPending']);
  const inventory=[...current.equipment,...current.magicItems,...current.weapons];
  if(!unique(inventory.map(e=>e.id)))return result('inventory',[...codes,'inventoryIdentityPending']);
  const e=current.equipment.find(e=>e.id===context.entityId),links=current.compendiumLinks??[];
  const active=links.filter(l=>l.appliedEntityId===context.entityId&&l.status==='active'),link=active[0];
  if(!e||!unique(links.map(l=>l.id))||active.length!==1||!link||link.id!==context.linkId||link.characterId!==current.id||
   link.itemId!==item.id||link.importItemId!==item.importItemId||link.sourceId!==item.sourceId||link.packId!==item.packId||
   link.itemType!=='equipment'||link.appliedAs!=='equipment'||link.appliedEntityName!==e.name||e.name!==item.name||
   link.manualReviewRequired===true||!same(e.source,item.rawJson.source))
   return result('inventory',[...codes,'inventoryLinkBindingPending']);
  if(e.startingEquipmentSelectionId||e.ammunitionType||e.spellcastingFocus||e.spellcastingFocusKind||e.materialComponent||e.focusRequiresHand||
   !int(e.quantity,1,1000000)||context.quantity===e.quantity)
   return result('inventory',[...codes,'inventoryQuantityPolicyPending']);
  const p=item.normalizedJson;
  if(['packContents','containerCapacity','contents','grantsActions','effectTemplates','resources','resource','consumes','charges'].some(k=>own(p,k)||own(item.rawJson.payload??{},k)))
   return result('inventory',[...codes,'inventoryQuantityPolicyPending']);
  const expected={...current,equipment:current.equipment.map(v=>v.id===e.id?{...v,quantity:context.quantity}:v)};
  const unexpectedPaths=diff(expected,after);
  if(unexpectedPaths.length)codes.push('unexpectedCharacterChanges');
  return result('inventory',codes,unexpectedPaths);
 }catch{return result('inventory',['invalidInventoryReviewContext']);}
}
/** Strict comparison of a disposable encounter and its character. HP only,
 * no crossing zero, temporary HP, resource use, damage or healing transaction. */
export function reviewEncounterHpPreservation(base:CombatScenario,current:CombatScenario,after:CombatScenario,baseCharacter:Character,currentCharacter:Character,afterCharacter:Character,item:StoredCompendiumItem,context:EncounterHpReviewContext){
 try{
  const codes:string[]=[];
  if(!same(base,current)||!same(baseCharacter,currentCharacter))codes.push('baseSnapshotMismatch');
  if(!same(currentCharacter,afterCharacter))codes.push('unexpectedCharacterChanges');
  if(!validItem(item,'creatureStatBlock',context)||!text(context.targetId)||current.characterId!==currentCharacter.id||
   current.pendingReaction!==undefined||(current.readyActions??[]).length>0)
   return result('encounter',[...codes,'encounterContextPending']);
  const targets=current.targets??[],t=targets.find(t=>t.id===context.targetId);
  if(!unique(targets.map(v=>v.id))||!t||t.sourceCreatureItemId!==item.id||t.sourceCreatureImportItemId!==item.importItemId||t.name!==item.name)
   return result('encounter',[...codes,'encounterTargetBindingPending']);
  const hp=t.hitPoints;
  if(!hp||!int(hp.max,1,1000000)||!int(hp.current,1,hp.max)||!int(context.currentHp,1,hp.max)||hp.current===context.currentHp||
   (hp.temporary!==undefined&&hp.temporary!==0))
   return result('encounter',[...codes,'encounterHpPolicyPending']);
  const expected={...current,targets:targets.map(v=>v.id===t.id?{...v,hitPoints:{...hp,current:context.currentHp}}:v)};
  const unexpectedPaths=diff(expected,after);
  if(unexpectedPaths.length)codes.push('unexpectedEncounterChanges');
  return result('encounter',codes,unexpectedPaths);
 }catch{return result('encounter',['invalidEncounterReviewContext']);}
}
