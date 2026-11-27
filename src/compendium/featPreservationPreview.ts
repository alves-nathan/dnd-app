import type { AbilityScore, Character, CharacterFeatChoice } from '../types';
import type { StoredCompendiumItem } from './types';
import { ABILITY_ORDER, abilityScoresFromValues } from '../characters/abilityGeneration';
import { getFeatChoiceSchema, recalculateCharacterAbilities, validateFeatChoice } from '../characters/featChoiceRules';

const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false} as const;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const rec=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const int=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const validAbility=(x:unknown):x is AbilityScore=>typeof x==='string'&&ABILITY_ORDER.some(a=>a===x);
export interface FeatAsiReviewContext {
 rulesEra:'2014'|'2024';
 featEntityId:string;
 choiceId:string;
 selectedAbility:AbilityScore;
 selectionPolicyConfirmed:boolean;
 otherFeatDependenciesExcludedConfirmed:boolean;
 abilityDerivedDependenciesExcludedConfirmed:boolean;
}
function result(codes:string[],unexpectedPaths:string[]=[]){
 return {...flags,status:codes.length?'preservationBlocked' as const:'featAsiOnlyPreservationCandidate' as const,codes,unexpectedPaths,
  blockers:['noFeatAcquisitionRemovalOrMigrationAuthorization','derivedEffectsAndDependenciesNotApproved']};
}
function isolatedChoice(c:CharacterFeatChoice){
 const emptyArrays=['skills','expertiseSkills','tools','languages','spellItemIds','weaponItemIds','weaponMasterySelections','metamagicOptionIds','maneuverOptionIds'];
 return Object.entries(c).every(([k,v])=>['id','featEntityId','featItemId','instanceIndex','abilityScoreIncreases','notes'].includes(k)||
  v===undefined||emptyArrays.includes(k)&&Array.isArray(v)&&v.length===0);
}
/** Disposable comparison only. Restrict to a single explicit simple ASI
 * contribution with stable generated scores; no save, reapply or respec. */
export function reviewCharacterFeatAsiPreservation(base:Character,current:Character,after:Character,item:StoredCompendiumItem,context:FeatAsiReviewContext){
 try{
  const codes:string[]=[];
  if(!same(base,current))codes.push('baseSnapshotMismatch');
  if(context.selectionPolicyConfirmed!==true||context.otherFeatDependenciesExcludedConfirmed!==true||context.abilityDerivedDependenciesExcludedConfirmed!==true||
   !['2014','2024'].includes(context.rulesEra)||!validAbility(context.selectedAbility)||!int(current.level,1,20)||
   item.type!=='feat'||item.status!=='validated'||item.rawJson.source?.version!==context.rulesEra)return result([...codes,'featAsiContextPending']);
  const feats=current.feats.filter(f=>f.id===context.featEntityId),feat=feats[0];
  const links=(current.compendiumLinks??[]).filter(l=>l.appliedEntityId===context.featEntityId&&l.status==='active');
  const link=links[0];
  if(feats.length!==1||!feat||feat.custom||feat.grantedByFeatEntityId||feat.grantedByInvocationItemId||feat.features?.length||
   feat.name!==item.name||!same(feat.source,item.rawJson.source)||links.length!==1||!link||link.characterId!==current.id||
   link.itemType!=='feat'||link.appliedAs!=='feat'||link.itemId!==item.id||link.importItemId!==item.importItemId||
   link.packId!==item.packId||link.sourceId!==item.sourceId||link.appliedEntityName!==feat.name||link.manualReviewRequired===true)
   return result([...codes,'featLinkBindingPending']);
  const choices=current.featChoices??[],matches=choices.filter(c=>c.featEntityId===feat.id),choice=matches[0];
  if(matches.length!==1||!choice||choice.id!==context.choiceId||choice.featItemId!==item.id||!int(choice.instanceIndex,0,Number.MAX_SAFE_INTEGER)||
   new Set(choices.map(c=>c.id)).size!==choices.length||new Set(choices.map(c=>JSON.stringify([c.featItemId,c.instanceIndex]))).size!==choices.length||
   choices.some(c=>c!==choice&&Object.keys(c.abilityScoreIncreases??{}).length!==0)||!isolatedChoice(choice))
   return result([...codes,'featChoiceBindingPending']);
  const p=item.normalizedJson,raw=p.abilityScoreIncrease;
  if(!rec(item.rawJson.payload)||!same(raw,item.rawJson.payload.abilityScoreIncrease)||p.id!==item.importItemId||p.name!==item.name||p.type!=='feat'||p.sourceId!==item.rawJson.source.id||p.requiresReview===true)return result([...codes,'featAsiShapePending']);
  // Exclude unknown mechanical keys rather than infer from name or narrative.
  if(Object.keys(p).some(k=>!['abilityScoreIncrease','category','repeatable','prerequisite','mechanics','description','summary','id','name','type','sourceId','sourceStatus','sourceConfidence','requiresReview'].includes(k))||
   (p.mechanics!==undefined&&(!rec(p.mechanics)||Object.keys(p.mechanics).length!==0))||
   !Array.isArray(raw)||raw.length!==1||!rec(raw[0]))return result([...codes,'featAsiShapePending']);
  const spec=raw[0],opts=spec.abilities,amount=spec.amount,max=spec.max;
  if(Object.keys(spec).some(k=>!['abilities','amount','max'].includes(k))||!Array.isArray(opts)||opts.length<2||!opts.every(validAbility)||
   new Set(opts).size!==opts.length||!int(amount,1,30)||!int(max,1,30)||!opts.includes(context.selectedAbility))
   return result([...codes,'featAsiShapePending']);
  const schema=getFeatChoiceSchema(item);
  if(!same(schema.kinds,['abilityScoreIncrease'])||schema.unsupportedChoiceTypes.length||!same(schema.abilityOptions,opts)||
   schema.abilityIncreaseAmount!==amount||schema.abilityMaximum!==max)return result([...codes,'featAsiShapePending']);
  const prior=Object.entries(choice.abilityScoreIncreases??{}),old=prior[0];
  if(prior.length!==1||!old||!validAbility(old[0])||!opts.includes(old[0])||old[1]!==amount||old[0]===context.selectedAbility)
   return result([...codes,'featAsiChoicePending']);
  const generated=current.abilityGeneration?.generatedValues,bonuses=current.abilityScoreBonuses??{};
  if(!Array.isArray(generated)||generated.length!==6||!generated.every(v=>int(v,1,30))||
   Object.entries(bonuses).some(([k,v])=>!validAbility(k)||!int(v,0,30)))return result([...codes,'featAbilityBasePending']);
  const scores=abilityScoresFromValues(generated);
  for(const a of ABILITY_ORDER){scores[a]+=bonuses[a]??0;if(!int(scores[a],1,30))return result([...codes,'featAbilityBasePending']);}
  const oldChoice=choice,newChoice={...choice,abilityScoreIncreases:{[context.selectedAbility]:amount}};
  if(validateFeatChoice(item,oldChoice,scores,[item],current).length||validateFeatChoice(item,newChoice,scores,[item],current).length||
   scores[old[0]]+amount>max||scores[context.selectedAbility]+amount>max)return result([...codes,'featAsiMaximumOrValidationPending']);
  const previous=recalculateCharacterAbilities(current);
  if(!same(previous.abilities,current.abilities))return result([...codes,'featAbilityBaseMismatch']);
  const next=recalculateCharacterAbilities({...current,featChoices:choices.map(c=>c===choice?newChoice:c)});
  const a=next as unknown as Record<string,unknown>,b=after as unknown as Record<string,unknown>;
  const unexpectedPaths=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>own(a,k)!==own(b,k)||!same(a[k],b[k])).sort();
  if(unexpectedPaths.length)codes.push('unexpectedCharacterChanges');
  return result(codes,unexpectedPaths);
 }catch{return result(['invalidFeatReviewContext']);}
}
