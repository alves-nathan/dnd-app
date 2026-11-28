// Explicit occurrence walker. No name matching, alias traversal, inference
// from option labels or automatic repair. Entity instance IDs are not
// catalog item IDs; their separate relationship review follows.
type RecordValue=Record<string,unknown>;
const record=(v:unknown):RecordValue|undefined=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:undefined;
export interface BuildReferenceOccurrence {path:readonly (string|number)[];value:unknown}
export function collectBuildReferenceOccurrences(value:unknown,kind:'character'|'preset'){
 const rows:BuildReferenceOccurrence[]=[];
 const root=record(value);
 if(!root)throw Error('invalidBuildReferenceOwner');
 const add=(path:readonly (string|number)[],v:unknown)=>{if(v!==undefined&&v!==null)rows.push({path,value:v});};
 const fields=(obj:unknown,path:readonly (string|number)[],keys:readonly string[])=>{
  const r=record(obj);if(!r)return;
  for(const key of keys)add([...path,key],r[key]);
 };
 const array=(obj:unknown,path:readonly (string|number)[],fn:(r:RecordValue,p:readonly (string|number)[])=>void)=>{
  if(obj===undefined||obj===null)return;
  if(!Array.isArray(obj))throw Error('invalidBuildReferenceCollection');
  obj.forEach((v,i)=>{const r=record(v);if(!r)throw Error('invalidBuildReferenceRow');fn(r,[...path,i]);});
 };
 const list=(r:RecordValue,p:readonly (string|number)[],key:string)=>{
  if(r[key]===undefined||r[key]===null)return;
  if(!Array.isArray(r[key]))throw Error('invalidBuildReferenceList');
  (r[key] as unknown[]).forEach((v,i)=>add([...p,key,i],v));
 };
 const invocation=(r:RecordValue,p:readonly (string|number)[])=>{
  fields(r,p,['invocationItemId','targetCantripItemId','originFeatItemId','familiarCreatureItemId']);
  list(r,p,'cantripItemIds');list(r,p,'ritualSpellItemIds');
 };
 const mastery=(r:RecordValue,p:readonly (string|number)[])=>fields(r,p,['sourceItemId','weaponItemId']);
 // Materialized entities shared by character and preset snapshots.
 array(root.weapons,['weapons'],(r,p)=>fields(r,p,['pactWeaponSourceItemId']));
 array(root.spells,['spells'],(r,p)=>fields(r,p,['grantedByInvocationItemId']));
 array(root.feats,['feats'],(r,p)=>fields(r,p,['grantedByInvocationItemId']));
 array(root.resources,['resources'],(r,p)=>fields(r,p,['sourceInvocationItemId']));
 if(kind==='preset')return rows;
 fields(root,[],['originFeatId']);
 const b=record(root.buildChoices);
 if(b){
  const p=['buildChoices'];
  fields(b,p,['startingClassItemId','speciesFeatItemId']);
  for(const [key,keys] of [
   ['speciesChoices',['speciesItemId','featureItemId','replacementSpellItemId']],
   ['backgroundChoices',['backgroundItemId']],['subclassChoices',['subclassItemId']],
   ['classFeatureChoices',['classItemId','featureItemId']],['classMetamagicChoices',['classItemId','featureItemId']],
   ['mysticArcanumChoices',['classItemId','featureItemId','spellItemId']]
  ] as const)array(b[key],[...p,key],(r,q)=>fields(r,q,keys));
  for(const key of ['bonusSpellChoices','spellbookFeatureChoices'])array(b[key],[...p,key],(r,q)=>{fields(r,q,['classItemId','featureItemId']);list(r,q,'spellItemIds');});
  for(const key of ['spellAssignments','spellbookAssignments']){
   const assignments=b[key];if(assignments===undefined)continue;
   const r=record(assignments);if(!r)throw Error('invalidBuildAssignment');
   Object.entries(r).forEach(([source,target],i)=>{add([...p,key,i,'key'],source);add([...p,key,i,'value'],target);});
  }
  array(b.equipmentSelections,[...p,'equipmentSelections'],(r,q)=>{
   fields(r,q,['sourceItemId']);array(r.items,[...q,'items'],(item,t)=>fields(item,t,['compendiumItemId']));
  });
  array(b.eldritchInvocationChoices,[...p,'eldritchInvocationChoices'],invocation);
  fields(b.pactWeapon,[...p,'pactWeapon'],['sourceWeaponItemId']);
  for(const key of ['gazeOfTwoMinds','giftOfProtectors','oneWithShadows'])fields(b[key],[...p,key],['invocationItemId']);
 }
 array(root.featChoices,['featChoices'],(r,p)=>{
  fields(r,p,['featItemId','fightingStyleItemId','eldritchInvocationItemId']);
  list(r,p,'spellItemIds');list(r,p,'weaponItemIds');
  array(r.weaponMasterySelections,[...p,'weaponMasterySelections'],mastery);
  const nested=record(r.eldritchInvocationChoice);if(nested)invocation(nested,[...p,'eldritchInvocationChoice']);
 });
 array(root.spellbookEntries,['spellbookEntries'],(r,p)=>fields(r,p,['classItemId','spellItemId']));
 array(root.weaponMasteries,['weaponMasteries'],mastery);
 // Retain resolved/removed history as occurrences too, not only pending.
 array(root.pendingChoices,['pendingChoices'],(r,p)=>fields(r,p,['sourceItemId']));
 return rows;
}
