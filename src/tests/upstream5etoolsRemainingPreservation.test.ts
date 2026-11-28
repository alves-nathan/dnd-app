import type { Character, CombatScenario } from '../types';
import {buildPersistedCompendiumImport} from '../compendium/importer';
import {applyCompendiumItemToCharacter} from '../compendium/mapper';
import {createEmptyCharacter,defaultCombatState} from '../data/mockData';
import {createCombatScenario} from '../rules-engine/turns/compareRotations';
import {createTacticalTarget} from '../rules-engine/turns/tacticalCombat';
import {reviewInventoryQuantityPreservation,reviewEncounterHpPreservation,type InventoryQuantityReviewContext,type EncounterHpReviewContext} from '../compendium/remainingPreservationPreview';
const source={id:'fixture',book:'Fixture',version:'2024',status:'active' as const,confidence:'exact' as const};
function fixture(){
 const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[
  {id:'gear',kind:'equipment',name:'Fixture Gear',source,payload:{quantity:3}},
  {id:'monster',kind:'creatureStatBlock',name:'Fixture Creature',source,payload:{size:'Medium',armorClass:12,hitPoints:{average:10},speed:{walk:30}}}
 ]});
 const gear=pack.items.find(i=>i.type==='equipment'),monster=pack.items.find(i=>i.type==='creatureStatBlock');
 if(!gear||!monster)throw Error('missing fixture');
 const applied=applyCompendiumItemToCharacter(createEmptyCharacter('Fixture'),gear);
 if(!applied.ok)throw Error('fixture application failed');
 const character:Character={...applied.character,resources:[{id:'pool',name:'Pool',max:3,current:1,recharge:'shortRest'}]};
 const e=character.equipment[0],link=character.compendiumLinks?.find(l=>l.appliedEntityId===e.id);
 if(!link)throw Error('missing link');
 const inventoryContext:InventoryQuantityReviewContext={rulesEra:'2024',entityId:e.id,linkId:link.id,quantity:2,snapshotContextConfirmed:true,otherDependenciesExcludedConfirmed:true};
 const inventoryAfter={...character,equipment:character.equipment.map(v=>v.id===e.id?{...v,quantity:2}:v)};
 // Disposable reviewed stored item; no approval of a real upstream record.
 const creature={...monster,status:'validated' as const};
 const target=createTacticalTarget({id:'target',name:creature.name,sourceCreatureItemId:creature.id,sourceCreatureImportItemId:creature.importItemId,hitPoints:{current:7,max:10,temporary:0}});
 const scenario:CombatScenario={...createCombatScenario({id:'scenario',characterId:character.id,name:'Fixture',combatState:defaultCombatState,now:'2026-01-01T00:00:00Z'}),targets:[target],round:2,
  tacticalLog:[{id:'log',round:1,kind:'damage',message:'Fixture',targetId:target.id,createdAt:'2026-01-01T00:00:00Z'}]};
 const encounterContext:EncounterHpReviewContext={rulesEra:'2024',targetId:target.id,currentHp:6,snapshotContextConfirmed:true,otherDependenciesExcludedConfirmed:true};
 const encounterAfter={...scenario,targets:[{...target,hitPoints:{current:6,max:10,temporary:0}}]};
 return {character,gear,creature,inventoryContext,inventoryAfter,scenario,encounterContext,encounterAfter,target};
}
describe('a8.10.4 remaining family preservation',()=>{
 test('preserves exact existing equipment link, order and unrelated character state',()=>{
  const f=fixture(),before=JSON.stringify(f.character);
  const review=(after:Character,ctx=f.inventoryContext,current=f.character)=>reviewInventoryQuantityPreservation(f.character,current,after,f.gear,ctx);
  expect(review(f.inventoryAfter)).toMatchObject({status:'inventoryQuantityOnlyPreservationCandidate',codes:[],writeAuthorized:false});
  expect(review({...f.inventoryAfter,resources:[],compendiumLinks:[]})).toMatchObject({status:'preservationBlocked',unexpectedPaths:['compendiumLinks','resources']});
  expect(review(f.inventoryAfter,{...f.inventoryContext,quantity:0}).codes).toContain('inventoryContextPending');
  expect(review(f.inventoryAfter,{...f.inventoryContext,linkId:'other'}).codes).toContain('inventoryLinkBindingPending');
  expect(review(f.inventoryAfter,f.inventoryContext,{...f.character,name:'Concurrent'}).codes).toContain('baseSnapshotMismatch');
  expect(JSON.stringify(f.character)).toBe(before);
 });
 test('rejects dependent or ambiguous equipment stacks',()=>{
  const f=fixture(),c={...f.character,equipment:f.character.equipment.map(e=>({...e,ammunitionType:'arrow'}))};
  expect(reviewInventoryQuantityPreservation(c,c,f.inventoryAfter,f.gear,f.inventoryContext).codes).toContain('inventoryQuantityPolicyPending');
  const d={...f.character,equipment:[...f.character.equipment,...f.character.equipment]};
  expect(reviewInventoryQuantityPreservation(d,d,f.inventoryAfter,f.gear,f.inventoryContext).codes).toContain('inventoryIdentityPending');
  expect(reviewInventoryQuantityPreservation(f.character,f.character,f.inventoryAfter,f.gear,{...f.inventoryContext,otherDependenciesExcludedConfirmed:false}).codes).toContain('inventoryContextPending');
 });
 test('preserves encounter history, actions, character and every other target field',()=>{
  const f=fixture(),before=JSON.stringify(f.scenario);
  const review=(after:CombatScenario,ctx=f.encounterContext,c=f.character)=>reviewEncounterHpPreservation(f.scenario,f.scenario,after,f.character,f.character,c,f.creature,ctx);
  expect(review(f.encounterAfter)).toMatchObject({status:'encounterHpOnlyPreservationCandidate',codes:[],executable:false});
  expect(review({...f.encounterAfter,tacticalLog:[],round:3})).toMatchObject({status:'preservationBlocked',unexpectedPaths:['round','tacticalLog']});
  expect(review(f.encounterAfter,f.encounterContext,{...f.character,resources:[]}).codes).toContain('unexpectedCharacterChanges');
  expect(review(f.encounterAfter,{...f.encounterContext,currentHp:0}).codes).toContain('encounterHpPolicyPending');
  expect(review(f.encounterAfter,{...f.encounterContext,targetId:'other'}).codes).toContain('encounterTargetBindingPending');
  expect(JSON.stringify(f.scenario)).toBe(before);
 });
 test('blocks temporary HP, stale snapshots and duplicate targets',()=>{
  const f=fixture(),c={...f.scenario,targets:[{...f.target,hitPoints:{current:7,max:10,temporary:2}}]};
  expect(reviewEncounterHpPreservation(c,c,f.encounterAfter,f.character,f.character,f.character,f.creature,f.encounterContext).codes).toContain('encounterHpPolicyPending');
  const d={...f.scenario,targets:[f.target,f.target]};
  expect(reviewEncounterHpPreservation(d,d,f.encounterAfter,f.character,f.character,f.character,f.creature,f.encounterContext).codes).toContain('encounterTargetBindingPending');
  expect(reviewEncounterHpPreservation(f.scenario,{...f.scenario,round:3},f.encounterAfter,f.character,f.character,f.character,f.creature,f.encounterContext).codes).toContain('baseSnapshotMismatch');
 });
});
