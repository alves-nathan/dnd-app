import type {Character} from '../types';
import {buildPersistedCompendiumImport} from '../compendium/importer';
import {applyCompendiumItemToCharacter} from '../compendium/mapper';
import {createEmptyCharacter} from '../data/mockData';
import {emptyFeatChoice,recalculateCharacterAbilities} from '../characters/featChoiceRules';
import {reviewCharacterFeatAsiPreservation,type FeatAsiReviewContext} from '../compendium/featPreservationPreview';
const source={id:'fixture',book:'Fixture',version:'2024',status:'active' as const,confidence:'exact' as const};
function fixture(){
 const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[{id:'fixture-feat',kind:'feat',name:'Fixture Ability',source,payload:{category:'general',abilityScoreIncrease:[{abilities:['STR','DEX'],amount:1,max:20}]}}]});
 const item=pack.items[0];if(!item)throw Error('missing fixture');
 const applied=applyCompendiumItemToCharacter(createEmptyCharacter('Fixture'),item);
 if(!applied.ok)throw Error('fixture application failed');
 const feat=applied.character.feats[0];if(!feat)throw Error('missing feat');
 const choice={...emptyFeatChoice(item.id,feat.id),abilityScoreIncreases:{STR:1}};
 const current:Character=recalculateCharacterAbilities({...applied.character,abilityGeneration:{method:'manual',generatedValues:[18,18,12,10,10,10]},featChoices:[choice],resources:[{id:'pool',name:'Pool',max:3,current:1,recharge:'shortRest'}]});
 const after=recalculateCharacterAbilities({...current,featChoices:[{...choice,abilityScoreIncreases:{DEX:1}}]});
 const context:FeatAsiReviewContext={rulesEra:'2024',featEntityId:feat.id,choiceId:choice.id,selectedAbility:'DEX',selectionPolicyConfirmed:true,otherFeatDependenciesExcludedConfirmed:true,abilityDerivedDependenciesExcludedConfirmed:true};
 return {item,current,after,context,choice};
}
describe('isolated existing feat ASI preservation',()=>{
 test('only the bound choice and derived ability scores change',()=>{
  const f=fixture(),before=JSON.stringify(f.current);
  expect(reviewCharacterFeatAsiPreservation(f.current,f.current,f.after,f.item,f.context)).toMatchObject({status:'featAsiOnlyPreservationCandidate',codes:[],unexpectedPaths:[],writeAuthorized:false});
  expect(f.after.abilities).toMatchObject({STR:18,DEX:19});
  expect(JSON.stringify(f.current)).toBe(before);
  expect(reviewCharacterFeatAsiPreservation(f.current,f.current,{...f.after,resources:[],compendiumLinks:[],feats:[]},f.item,f.context)).toMatchObject({status:'preservationBlocked',unexpectedPaths:['compendiumLinks','feats','resources']});
 });
 test('rejects concurrent snapshots, incomplete context and identity mismatches',()=>{
  const f=fixture();
  expect(reviewCharacterFeatAsiPreservation(f.current,{...f.current,notes:'changed'},f.after,f.item,f.context).codes).toContain('baseSnapshotMismatch');
  expect(reviewCharacterFeatAsiPreservation(f.current,f.current,f.after,f.item,{...f.context,abilityDerivedDependenciesExcludedConfirmed:false}).codes).toContain('featAsiContextPending');
  expect(reviewCharacterFeatAsiPreservation(f.current,f.current,f.after,{...f.item,id:'other'},f.context).codes).toContain('featLinkBindingPending');
  const duplicate={...f.current,featChoices:[f.choice,f.choice]};
  expect(reviewCharacterFeatAsiPreservation(duplicate,duplicate,f.after,f.item,f.context).codes).toContain('featChoiceBindingPending');
  const stale={...f.current,abilities:{...f.current.abilities,STR:20}};
  expect(reviewCharacterFeatAsiPreservation(stale,stale,f.after,f.item,f.context).codes).toContain('featAbilityBaseMismatch');
 });
});
