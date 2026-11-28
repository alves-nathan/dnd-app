import type { Character, CharacterSpeciesChoice, CreatureSize } from '../types';
import type { StoredCompendiumItem } from './types';
import { CHARACTER_CREATION_DRAFT_VERSION, type CharacterCreationDraft } from '../characters/creationDraft';
import { getSpeciesChoiceRequirements, setSpeciesChoiceOption } from '../characters/speciesChoiceRules';

import { normalizeCharacterChoiceReference } from '../catalog/characterChoiceBridge';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false} as const;
const sizes=new Set<CreatureSize>(['Tiny','Small','Medium','Large','Huge','Gargantuan']);
export interface OriginSizeReviewContext {
  rulesEra:'2014'|'2024';
  selectedSize:CreatureSize;
  selectionPolicyConfirmed:boolean;
  otherOriginDependenciesExcludedConfirmed:boolean;
}
function choiceTransition(item:StoredCompendiumItem,choices:CharacterSpeciesChoice[],level:number,context:OriginSizeReviewContext,canonical=false){
 if(context.selectionPolicyConfirmed!==true||context.otherOriginDependenciesExcludedConfirmed!==true||
    item.type!=='species'||item.status!=='validated'||item.rawJson.source?.version!==context.rulesEra||
    !Number.isInteger(level)||level<1||level>20)return undefined;
 const raw=item.normalizedJson.sizeOptions;
 if(!Array.isArray(raw)||raw.length<2||!raw.every(s=>sizes.has(s))||new Set(raw).size!==raw.length||!raw.includes(context.selectedSize))return undefined;
 const requirements=getSpeciesChoiceRequirements(item,[item],level).filter(r=>r.kind==='size');
 const requirement=requirements[0];
 if(requirements.length!==1||!requirement||requirement.speciesItemId!==item.id||
    !same(requirement.options.map(o=>o.id),raw))return undefined;
 const bound=canonical?{...requirement,speciesItemId:normalizeCharacterChoiceReference(requirement.speciesItemId),featureItemId:normalizeCharacterChoiceReference(requirement.featureItemId)}:requirement;
 const existing=choices.filter(c=>c.choiceKind==='size');
 const old=existing[0];
 if(existing.length!==1||!old||old.speciesItemId!==bound.speciesItemId||old.featureItemId!==bound.featureItemId||
   !raw.includes(old.optionId)||old.optionId===context.selectedSize||
   !same(old,{speciesItemId:old.speciesItemId,featureItemId:old.featureItemId,choiceKind:'size',optionId:old.optionId}))return undefined;
 return {old,next:setSpeciesChoiceOption(choices,bound,context.selectedSize)};
}
function diff(expected:object,actual:object){
 const a=expected as Record<string,unknown>,b=actual as Record<string,unknown>;
 return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!same(a[k],b[k])).sort();
}
function result(codes:string[],unexpectedPaths:string[]){
 return {...flags,status:codes.length?'preservationBlocked' as const:'originSizeOnlyPreservationCandidate' as const,codes,unexpectedPaths,
  blockers:['originTraitAndGrantApplicationNotApproved','noV3CreationOrReconfigurationAuthorization']};
}
/** Compare a disposable legacy creation draft, not a full creation validator.
 * Only an existing size choice may change. No draft save or import. */
export function reviewCreationOriginSizePreservation(base:CharacterCreationDraft,current:CharacterCreationDraft,after:CharacterCreationDraft,item:StoredCompendiumItem,context:OriginSizeReviewContext){
 try{
  const codes:string[]=[];
  if(!same(base,current))codes.push('baseSnapshotMismatch');
  const change=choiceTransition(item,current.speciesChoices,Number(current.targetLevel),context,true);
  if(current.version!==CHARACTER_CREATION_DRAFT_VERSION||current.selectedSpeciesId!==normalizeCharacterChoiceReference(item.id)||!change)
    return result([...codes,'originChoiceBindingPending'],[]);
  const unexpectedPaths=diff({...current,speciesChoices:change.next},after);
  if(unexpectedPaths.length)codes.push('unexpectedDraftChanges');
  return result(codes,unexpectedPaths);
 }catch{return result(['invalidOriginReviewContext'],[]);}
}
/** Compare a disposable existing character. Exact active stored link, one
 * size choice and species size only; all other fields and history preserved. */
export function reviewCharacterOriginSizePreservation(base:Character,current:Character,after:Character,item:StoredCompendiumItem,context:OriginSizeReviewContext){
 try{
  const codes:string[]=[];
  if(!same(base,current))codes.push('baseSnapshotMismatch');
  const species=current.species,build=current.buildChoices;
  const links=(current.compendiumLinks??[]).filter(l=>l.status==='active'&&l.appliedAs==='species');
  const link=links[0];
  if(!species||!build||links.length!==1||!link||link.characterId!==current.id||
    link.itemType!=='species'||link.appliedEntityId!==species.id||link.itemId!==item.id||link.importItemId!==item.importItemId||
    link.sourceId!==item.sourceId||link.packId!==item.packId||link.manualReviewRequired===true||
    !same(species.source,item.rawJson.source))return result([...codes,'originLinkBindingPending'],[]);
  const change=choiceTransition(item,build.speciesChoices,current.level,context);
  if(!change||species.size!==change.old.optionId)return result([...codes,'originChoiceBindingPending'],[]);
  const expected={...current,species:{...species,size:context.selectedSize},buildChoices:{...build,speciesChoices:change.next}};
  const unexpectedPaths=diff(expected,after);
  if(unexpectedPaths.length)codes.push('unexpectedCharacterChanges');
  return result(codes,unexpectedPaths);
 }catch{return result(['invalidOriginReviewContext'],[]);}
}
