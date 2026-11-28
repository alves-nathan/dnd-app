import type {Character,CombatScenario,BuildHistorySnapshot,ActionSourceRef,ResourceCost} from '../types';
import type {BuildPresetSnapshot} from '../presets/buildPresets';

type Status='present'|'missing'|'ambiguous'|'ownerMismatch'|'unqualified';
export interface InstanceReference {path:readonly (string|number)[];value:unknown;status:Status}
type Owner=Character|BuildPresetSnapshot;
type Identity={id?:string};
const collection=(rows:readonly Identity[]|undefined,id:unknown):Status=>{
 if(typeof id!=='string'||!id.trim())return 'unqualified';
 const n=(rows??[]).filter(row=>row.id===id).length;
 return n===1?'present':n>1?'ambiguous':'missing';
};
const combine=(a:Status,b:Status):Status=>a==='ambiguous'||b==='ambiguous'||a==='present'&&b==='present'?'ambiguous':a==='present'||b==='present'?'present':'missing';
function ownerCollections(owner:Owner,type:ActionSourceRef['entityType']):readonly Identity[]{
 switch(type){
  case 'class':return owner.classes;
  case 'subclass':return owner.subclasses;
  case 'species':return owner.species?[owner.species]:[];
  case 'background':return owner.background?[owner.background]:[];
  case 'feat':return owner.feats;
  case 'weapon':return owner.weapons;
  case 'armor':return [...new Set([...(owner.armor?[owner.armor]:[]),...('armors' in owner?owner.armors??[]:[]),...('armorAccessories' in owner?owner.armorAccessories??[]:[])])];
  case 'equipment':return owner.equipment;
  case 'magicItem':return owner.magicItems;
  case 'spell':return owner.spells;
  case 'feature':return owner.features;
  default:return [];
 }
}
const collector=()=>{
 const rows:InstanceReference[]=[];
 const add=(path:readonly (string|number)[],value:unknown,status:Status)=>{if(value!==undefined&&value!==null)rows.push({path,value,status});};
 const ref=(path:readonly (string|number)[],value:unknown,targets:readonly Identity[]|undefined)=>add(path,value,collection(targets,value));
 return {rows,add,ref};
};
/** Exact instance IDs, scoped to their owner. No cross-character fallback,
 * no alias resolution, and no guessing generated action/provider IDs. */
export function collectOwnerInstanceReferences(owner:Owner,characterId?:string){
 const {rows,add,ref}=collector();
 const character=characterId===undefined?undefined:owner as Character;
 const costs=(p:readonly (string|number)[],values?:ResourceCost[])=>values?.forEach((v,i)=>ref([...p,i,'resourceId'],v.resourceId,owner.resources));
 const source=(p:readonly (string|number)[],v?:ActionSourceRef)=>{
  if(!v)return;
  if(v.entityId!==undefined)add([...p,'entityId'],v.entityId,v.entityType&&v.kind!=='manual'?collection(ownerCollections(owner,v.entityType),v.entityId):'unqualified');
  ref([...p,'linkId'],v.linkId,owner.compendiumLinks);
  ref([...p,'parentFeatureId'],v.parentFeatureId,owner.features);
  // itemId is a persisted item reference, not an entity instance ID.
  add([...p,'itemId'],v.itemId,'unqualified');
 };
 const armor=ownerCollections(owner,'armor');
 owner.subclasses.forEach((v,i)=>ref(['subclasses',i,'classId'],v.classId,owner.classes));
 owner.spells.forEach((v,i)=>{
  ref(['spells',i,'spellcastingClassId'],v.spellcastingClassId,owner.classes);
  ref(['spells',i,'grantedByFeatEntityId'],v.grantedByFeatEntityId,owner.feats);
  ref(['spells',i,'grantedByFeatureEntityId'],v.grantedByFeatureEntityId,owner.features);
  costs(['spells',i,'consumes'],v.consumes);
 });
 owner.feats.forEach((v,i)=>ref(['feats',i,'grantedByFeatEntityId'],v.grantedByFeatEntityId,owner.feats));
 owner.resources.forEach((v,i)=>ref(['resources',i,'sourceFeatEntityId'],v.sourceFeatEntityId,owner.feats));
 owner.weapons.forEach((v,i)=>costs(['weapons',i,'consumes'],v.consumes));
 (owner.spellSlots??[]).forEach((v,i)=>ref(['spellSlots',i,'sourceClassId'],v.sourceClassId,owner.classes));
 (owner.compendiumLinks??[]).forEach((v,i)=>{if(v.status!=='removed')ref(['compendiumLinks',i,'appliedEntityId'],v.appliedEntityId,ownerCollections(owner,v.appliedAs));});
 owner.rotations.forEach((r,i)=>{
  const p=['rotations',i];
  if(characterId!==undefined)add([...p,'characterId'],r.characterId,r.characterId===characterId?'present':'ownerMismatch');
  else add([...p,'characterId'],r.characterId,'unqualified'); // preset carries source owner, not current character
  r.actions.forEach((a,j)=>{
   const q=[...p,'actions',j],v=a.action;
   source([...q,'actionRef'],a.actionRef);source([...q,'action','origin'],v.origin);
   if(v.type==='attack'){
    ref([...q,'action','weaponId'],v.weaponId,owner.weapons);
    if(v.companionId!==undefined)add([...q,'action','companionId'],v.companionId,character?collection(character.companions,v.companionId):'unqualified');
   }else ref([...q,'action','spellId'],v.spellId,owner.spells);
   costs([...q,'action','consumes'],v.consumes);
   ref([...q,'weaponOperation','weaponId'],a.weaponOperation?.weaponId,owner.weapons);
   ref([...q,'weaponOperation','offHandWeaponId'],a.weaponOperation?.offHandWeaponId,owner.weapons);
   add([...q,'targetId'],a.targetId,'unqualified'); // rotation has no single scenario
   add([...q,'movement','targetId'],a.movement?.targetId,'unqualified');
  });
  (r.activations??[]).forEach((a,j)=>{
   const q=[...p,'activations',j];
   ref([...q,'sourceFeatureId'],a.sourceFeatureId,owner.features);
   ref([...q,'sourceFeatEntityId'],a.sourceFeatEntityId,owner.feats);
   ref([...q,'targetActionId'],a.targetActionId,r.actions);
   add([...q,'sourceItemId'],a.sourceItemId,'unqualified');
   costs([...q,'consumes'],a.consumes);
  });
 });
 if(character){
  const b=character.buildChoices,l=b?.activeLoadout;
  ref(['buildChoices','activeLoadout','mainHandWeaponId'],l?.mainHandWeaponId,owner.weapons);
  ref(['buildChoices','activeLoadout','offHandWeaponId'],l?.offHandWeaponId,owner.weapons);
  if(l?.heldFocusEquipmentId!==undefined)add(['buildChoices','activeLoadout','heldFocusEquipmentId'],l.heldFocusEquipmentId,combine(collection(owner.equipment,l.heldFocusEquipmentId),collection(owner.magicItems,l.heldFocusEquipmentId)));
  ref(['buildChoices','activeLoadout','armorId'],l?.armorId,armor);
  l?.armorAccessoryIds.forEach((id,i)=>ref(['buildChoices','activeLoadout','armorAccessoryIds',i],id,armor));
  ref(['buildChoices','pactWeapon','weaponEntityId'],b?.pactWeapon?.weaponEntityId,owner.weapons);
  ref(['buildChoices','gazeOfTwoMinds','targetCompanionId'],b?.gazeOfTwoMinds?.targetCompanionId,character.companions);
  ref(['buildChoices','giftOfProtectors','resourceId'],b?.giftOfProtectors?.resourceId,owner.resources);
  ref(['buildChoices','oneWithShadows','activeEffectId'],b?.oneWithShadows?.activeEffectId,character.activeEffects);
  (character.featChoices??[]).forEach((v,i)=>ref(['featChoices',i,'featEntityId'],v.featEntityId,owner.feats));
  (character.spellbookEntries??[]).forEach((v,i)=>ref(['spellbookEntries',i,'classEntityId'],v.classEntityId,owner.classes));
  (character.hitDice??[]).forEach((v,i)=>ref(['hitDice',i,'classEntityId'],v.classEntityId,owner.classes));
  character.activeEffects.forEach((v,i)=>source(['activeEffects',i,'sourceRef'],v.sourceRef));
  (character.companions??[]).forEach((v,i)=>{
   ref(['companions',i,'grantedByFeatEntityId'],v.grantedByFeatEntityId,owner.feats);
   v.actions.forEach((a,j)=>ref(['companions',i,'actions',j,'resourceId'],a.resourceId,v.resources));
   v.resources.forEach((r,j)=>ref(['companions',i,'resources',j,'sourceActionId'],r.sourceActionId,v.actions));
   v.transactions.forEach((t,j)=>add(['companions',i,'transactions',j,'companionId'],t.companionId,t.companionId===v.id?'present':'ownerMismatch'));
  });
 }
 return rows;
}
export function collectScenarioInstanceReferences(s:CombatScenario,characters:readonly Character[]){
 const {rows,add,ref}=collector();
 const owner=characters.find(c=>c.id===s.characterId);
 const targets=s.targets??[],participants=s.participants??[],ready=s.readyActions??[];
 ref(['activeParticipantId'],s.activeParticipantId,participants);
 participants.forEach((v,i)=>ref(['participants',i,'targetId'],v.targetId,targets));
 ready.forEach((v,i)=>{
  ref(['readyActions',i,'participantId'],v.participantId,participants);
  ref(['readyActions',i,'targetId'],v.targetId,targets);
  add(['readyActions',i,'actionId'],v.actionId,'unqualified'); // generated action ID
  if(v.heldEffectId!==undefined)add(['readyActions',i,'heldEffectId'],v.heldEffectId,owner?collection(owner.activeEffects,v.heldEffectId):'unqualified');
 });
 const reaction=s.pendingReaction;
 if(reaction){
  ref(['pendingReaction','reactorParticipantId'],reaction.reactorParticipantId,participants);
  ref(['pendingReaction','provokingTargetId'],reaction.provokingTargetId,targets);
  ref(['pendingReaction','targetId'],reaction.targetId,targets);
  ref(['pendingReaction','readyActionId'],reaction.readyActionId,ready);
 }
 targets.forEach((t,i)=>{
  (t.statBlockActions??[]).forEach((a,j)=>ref(['targets',i,'statBlockActions',j,'resourceId'],a.resourceId,t.statBlockResources));
  (t.statBlockResources??[]).forEach((v,j)=>ref(['targets',i,'statBlockResources',j,'sourceActionId'],v.sourceActionId,t.statBlockActions));
  t.effects.forEach((e,j)=>{
   const p=['targets',i,'effects',j],source=characters.find(c=>c.id===e.sourceCharacterId);
   ref([...p,'sourceCharacterId'],e.sourceCharacterId,characters);
   if(e.sourceRotationId!==undefined)add([...p,'sourceRotationId'],e.sourceRotationId,source?collection(source.rotations,e.sourceRotationId):'unqualified');
   add([...p,'sourceActionId'],e.sourceActionId,'unqualified');
  });
 });
 (s.battlefieldItems??[]).forEach((v,i)=>{if(v.weaponId!==undefined)add(['battlefieldItems',i,'weaponId'],v.weaponId,owner?collection(owner.weapons,v.weaponId):'unqualified');});
 (s.tacticalLog??[]).forEach((v,i)=>{ref(['tacticalLog',i,'targetId'],v.targetId,targets);add(['tacticalLog',i,'actionId'],v.actionId,'unqualified');});
 (s.combatState.consumedResourceIds??[]).forEach((v,i)=>add(['combatState','consumedResourceIds',i],v,owner?collection(owner.resources,v):'unqualified'));
 Object.keys(s.combatState.availableResourceOverrides??{}).sort().forEach((v,i)=>add(['combatState','availableResourceOverrides',i],v,owner?collection(owner.resources,v):'unqualified'));
 return rows;
}
/** History is a snapshot, not a requirement that all original rotations
 * still exist in the current character. Winners refer to snapshot rows. */
export function collectHistoryInstanceReferences(h:BuildHistorySnapshot){
 const {rows,add}=collector();
 const rotations=h.rows.map(r=>({id:r.rotationId}));
 for(const key of ['bestByAverageRotationId','bestByWeightedAverageRotationId','bestByGuaranteedRotationId'] as const)add(['winners',key],h.winners[key],collection(rotations,h.winners[key]));
 return rows;
}
