import type {Character} from '../types';
import {buildPersistedCompendiumImport} from '../compendium/importer';
import {applyCompendiumItemToCharacter} from '../compendium/mapper';
import {createEmptyCharacter} from '../data/mockData';
import {sanitizeCharacterCreationDraft} from '../characters/creationDraft';
import {getSpeciesChoiceRequirements,setSpeciesChoiceOption,applyDirectSpeciesChoiceEffects} from '../characters/speciesChoiceRules';
import {normalizeCharacterChoiceReference} from '../catalog/characterChoiceBridge';
import {reviewCreationOriginSizePreservation,reviewCharacterOriginSizePreservation,type OriginSizeReviewContext} from '../compendium/originPreservationPreview';
const {buildOriginParityEvidence}=require('../../scripts/5etools/origin-parity-evidence');
const {buildOriginClosureReview}=require('../../scripts/5etools/origin-closure-review');
const {buildPilot:buildOrigins}=require('../../scripts/5etools/origin-converter');
const {buildPilot:buildSpells}=require('../../scripts/5etools/spell-converter');
const {buildPilot:buildFeatures}=require('../../scripts/5etools/feature-converter');
const {buildPilot:buildEquipment}=require('../../scripts/5etools/equipment-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildOriginChassisProjection}=require('../../scripts/5etools/origin-chassis-projection');
const {buildOriginGrantEvidence,publicSummary,previewOriginGrantSelection}=require('../../scripts/5etools/origin-grant-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const base={name:'Private Base',source:'PHB',size:['M'],speed:30,entries:[{name:'Private Original',entries:['PRIVATE_ORIGINAL']},{name:'Private Retained',entries:['PRIVATE_RETAINED']}]};
 const revised={name:'Private Revised',source:'XPHB',size:['S','M'],creatureTypes:['humanoid'],speed:30,entries:[{name:'Private Trait',entries:['PRIVATE_TEXT']}]};
 const spell={source:'XPHB',school:'V',time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},duration:[{type:'instant'}],components:{v:true},entries:['PRIVATE_TEXT']};
 const spells=[{...spell,name:'Private Light',level:0},{...spell,name:'Private Mist',level:2}];
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'PHB',name:'Classic Fixture',published:'2014-08-19'},{source:'XPHB',name:'Revised Fixture',published:'2024-09-17'}]},
  'data/races.json':{race:[base,{...revised,additionalSpells:[
    {name:'Private Lineage',ability:{choose:['int','wis','cha']},known:{'1':['Private Light|XPHB#c']},innate:{'3':{daily:{'1':['Private Mist|XPHB']}},'5':{daily:{pb:['Private Mist|XPHB']}}}},
    {name:'Private Other',ability:'cha',known:{'1':['Private Light']},expanded:{'3':['Private Mist|XPHB']}}
   ]}],
   subrace:[{name:'Hill',source:'PHB',raceName:base.name,raceSource:'PHB',entries:[{name:'Private Replacement',data:{overwrite:'Private Original'},entries:['PRIVATE_REPLACEMENT']},{name:'Private Added',entries:['PRIVATE_ADDED']}]}]},
  'data/backgrounds.json':{background:[{name:'Private Background',source:'XPHB',feats:[{'Private Feat|XPHB':true},{anyFromCategory:{category:['O'],count:1}}],
   startingEquipment:[{_:[{item:'Private Gear|XPHB',quantity:2}]},{A:['Private Gear|XPHB',{value:500}],B:[{value:5000}],C:[{equipmentType:'toolArtisan'}]}],entries:[]}]},
  'data/feats.json':{feat:[{name:'Private Feat',source:'XPHB',category:'O',entries:['PRIVATE_TEXT']}]},
  'data/optionalfeatures.json':{optionalfeature:[]},
  'data/spells/index.json':{XPHB:'spells-fixture.json'},'data/spells/spells-fixture.json':{spell:spells},
  'data/generated/gendata-spell-source-lookup.json':{xphb:Object.fromEntries(spells.map(s=>[s.name.toLowerCase(),{class:{XPHB:{Wizard:true}}}]))},
  'data/items-base.json':{baseitem:[{name:'Private Gear',source:'XPHB',edition:'one',type:'G|XPHB',rarity:'none',value:100,weight:1}],itemProperty:[],itemMastery:[],itemType:[{name:'Adventuring Gear',abbreviation:'G',source:'XPHB'}]},
  'data/items.json':{item:[]}
 };
 const snapshot={commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]};
 const items=[...buildOrigins(snapshot,['PHB','XPHB']).packs.flatMap((p:any)=>p.items),...buildFeatures(snapshot,['XPHB']).packs.flatMap((p:any)=>p.items),
  ...buildSpells(snapshot,['XPHB']).packs.flatMap((p:any)=>p.items),...buildEquipment(snapshot,['XPHB']).packs.flatMap((p:any)=>p.items)];
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={items,reconciliation,rawHistorical:[]},chassis=buildOriginChassisProjection(input),projection=buildOriginGrantEvidence(input,chassis);
 const row=(name:string)=>{const i=items.find((x:any)=>x.name==='Private '+name);if(!i)throw Error('missing fixture');return projection.rows.find((r:any)=>r.itemId===i.id);};
 const preview=(name:string,extra:Record<string,unknown>)=>{const r=row(name);return previewOriginGrantSelection(input,{originId:r.itemId,sourceFingerprint:r.sourceFingerprint,rulesEra:r.rulesEra,projectionFingerprint:projection.fingerprint,
  contextComplete:true,originPolicyConfirmed:true,...extra});};
 return {input,chassis,projection,row,preview};
}
describe('a8.8.3 origin trait and grant evidence',()=>{
 test('binds inherited, replaced and added traits to the exact parent and child, not executable effects',()=>{
  const f=fixture(),r=f.row('Base (Hill)');
  expect(r.traits.parent.status).toBe('parentIdentityCandidate');
  expect(r.traits.rows.map((x:any)=>x.status)).toEqual(['replacementTraitReviewRequired','inheritedTraitReviewRequired','addedTraitReviewRequired']);
  expect(r.traits.rows[0].replacedFingerprint).toBe(f.row('Base').traits.rows[0].fingerprint);
  expect(r.traits.omittedParentEntries).toEqual([expect.objectContaining({status:'parentTraitReplacementObserved',fingerprint:f.row('Base').traits.rows[0].fingerprint})]);
  expect(r).toMatchObject({variantReviewRequired:true,writeAuthorized:false,runtimeEligible:false});
 });
 test('explicit feat alternatives remain separate and reject unresolved choice or duplicate grants',()=>{
  const f=fixture(),base={domain:'feat',group:0,groupPolicyConfirmed:true,featEligibilityConfirmed:true,existingFeatInventoryComplete:true,existingFeatIds:[]};
  const r=f.preview('Background',base);
  expect(r).toMatchObject({status:'originFeatReviewCandidate',targetIds:[expect.any(String)],writeAuthorized:false});
  expect(f.preview('Background',{...base,group:1}).reason).toBe('featGrantPending');
  expect(f.preview('Background',{...base,existingFeatIds:r.targetIds}).reason).toBe('featRepeatabilityPending');
  expect(f.preview('Background',{...base,featEligibilityConfirmed:false}).reason).toBe('featSelectionContextPending');
 });
 test('spell groups preserve level, ability and usage without conflating list access or recovery',()=>{
  const f=fixture(),base={domain:'spell',group:0,groupPolicyConfirmed:true,characterLevel:1,spellcastingAbility:'WIS'};
  expect(f.preview('Revised',base)).toMatchObject({status:'originSpellReviewCandidate',entries:[{mode:'known',level:1,spellLevel:0,cantripMarked:true,usage:{status:'usageNotDeclared'}}]});
  expect(f.preview('Revised',{...base,characterLevel:3})).toMatchObject({entries:[{mode:'known'},{mode:'innate',level:3,spellLevel:2,usage:{status:'dailyCountCandidate',count:1,recovery:'pending',sharing:'pending'}}]});
  expect(f.preview('Revised',{...base,characterLevel:5}).entries[2]).toMatchObject({usage:{status:'usageFormulaOrSharingPending'}});
  expect(f.preview('Revised',{...base,spellcastingAbility:'STR'}).reason).toBe('spellGroupOrAbilityPending');
  expect(f.preview('Revised',{...base,group:1,spellcastingAbility:'CHA'}).reason).toBe('spellGrantPending');
  expect(f.row('Revised').spells[1].entries[1]).toMatchObject({mode:'expanded',status:'identityCandidate'});
 });
 test('equipment mandatory and alternative groups are selected explicitly; currency and items remain candidates',()=>{
  const f=fixture(),base={domain:'equipment',equipmentPolicyConfirmed:true,existingInventoryComplete:true,selections:[{group:0,key:'_'},{group:1,key:'A'}]};
  expect(f.preview('Background',base)).toMatchObject({status:'originEquipmentReviewCandidate',entries:[{status:'identityCandidate',quantity:2},{status:'identityCandidate',quantity:1},{status:'copperValueCandidate',copper:500}]});
  expect(f.preview('Background',{...base,selections:[{group:0,key:'_'},{group:1,key:'B'}]})).toMatchObject({entries:[{quantity:2},{status:'copperValueCandidate',copper:5000}]});
  expect(f.preview('Background',{...base,selections:[{group:0,key:'_'},{group:1,key:'C'}]}).reason).toBe('equipmentOptionPending');
  expect(f.preview('Background',{...base,selections:[{group:1,key:'A'}]}).reason).toBe('equipmentSelectionPending');
  expect(f.preview('Background',{...base,selections:[{group:0,key:'_'},{group:0,key:'A'}]}).reason).toBe('equipmentSelectionPending');
 });
 test('exact reports, stale context and aggregate privacy; inputs remain unchanged',()=>{
  const f=fixture(),before=digest(f.input);
  expect(f.projection.summary).toMatchObject({species:3,background:1,featEdges:{featIdentityCandidate:1,featSelectionPending:1},spellGroups:2,equipmentGroups:2});
  expect(f.projection.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(f.projection))).not.toMatch(/Private|PRIVATE_|upstream:main:/);
  expect(()=>buildOriginGrantEvidence(f.input,{...f.chassis,fingerprint:'stale'})).toThrow('originChassisEvidenceMismatch');
  expect(f.preview('Revised',{domain:'spell',projectionFingerprint:'stale'}).reason).toBe('projectionFingerprintMismatch');
  expect(f.preview('Revised',{domain:'spell',rulesEra:'2014'}).reason).toBe('originIdentityOrEditionPending');
  expect(f.preview('Base (Hill)',{domain:'spell'}).reason).toBe('variantPolicyPending');
  expect(digest(f.input)).toBe(before);
 });
});

describe('a8.8.4 origin closure and preservation',()=>{
 test('binds three reports, exact coverage and parent lineage without promoting any grants',()=>{
  const f=fixture(),parity=buildOriginParityEvidence(f.input),reports={parity,chassis:f.chassis,grants:f.projection},before=digest(reports);
  const r=buildOriginClosureReview(reports);
  expect(r).toMatchObject({origins:{species:3,background:1},grants:{parents:{notSubrace:3,parentIdentityCandidate:1},spellGroups:2,equipmentGroups:2},
   approvedMappings:0,mechanicalParityEstablished:0,writeAuthorized:false});
  expect(JSON.stringify(r)).not.toMatch(/Private|PRIVATE_|upstream:main:/);
  expect(digest(reports)).toBe(before);
  expect(()=>buildOriginClosureReview({...reports,grants:{...f.projection,fingerprint:'stale'}})).toThrow('originReviewFingerprintMismatch');
  const {fingerprint,...body}=f.projection;
  const missing={...body,rows:body.rows.slice(1)};
  expect(()=>buildOriginClosureReview({...reports,grants:{...missing,fingerprint:digest(missing)}})).toThrow('originReviewCoverageMismatch');
  const altered={...body,rows:body.rows.map((x:any)=>x.traits.parent.status==='parentIdentityCandidate'?{...x,traits:{...x.traits,parent:{...x.traits.parent,parentFingerprint:'wrong'}}}:x)};
  expect(()=>buildOriginClosureReview({...reports,grants:{...altered,fingerprint:digest(altered)}})).toThrow('originParentReviewBindingMismatch');
 });
 const ctx:OriginSizeReviewContext={rulesEra:'2024',selectedSize:'Small',selectionPolicyConfirmed:true,otherOriginDependenciesExcludedConfirmed:true};
 function disposable(){
  const source={id:'fixture',book:'Fixture',version:'2024',status:'active' as const,confidence:'exact' as const};
  const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[
   {id:'fixture-species',kind:'species',name:'Fixture Species',source,payload:{sizeOptions:['Small','Medium']}},
   {id:'fixture-bg',kind:'background',name:'Fixture Background',source,payload:{}},
   {id:'fixture-feat',kind:'feat',name:'Fixture Feat',source,payload:{category:'origin'}},
   {id:'fixture-spell',kind:'spell',name:'Fixture Spell',source,payload:{level:1,classes:['Wizard'],castingTime:{kind:'action',actionCost:'action'}}},
   {id:'fixture-gear',kind:'equipment',name:'Fixture Gear',source,payload:{weight:1}}
  ]});
  const item=pack.items.find(i=>i.type==='species');if(!item)throw Error('missing fixture');
  const requirement=getSpeciesChoiceRequirements(item,pack.items,1).find(r=>r.kind==='size');if(!requirement)throw Error('missing size requirement');
  let character=createEmptyCharacter('Fixture');
  for(const i of pack.items){const result=applyCompendiumItemToCharacter(character,i);if(!result.ok)throw Error('fixture application failed '+i.type);character=result.character;}
  if(!character.species||!character.buildChoices)throw Error('missing species or choices');
  const old=setSpeciesChoiceOption([],requirement,'Medium'),next=setSpeciesChoiceOption(old,requirement,'Small');
  const current:Character={...character,species:{...character.species,size:'Medium'},buildChoices:{...character.buildChoices,speciesChoices:old},
   resources:[{id:'pool',name:'Pool',max:3,current:1,recharge:'shortRest'}],
   activeEffects:[{id:'effect',name:'Effect',kind:'spell',sourceType:'spell',status:'active',concentration:true,duration:{unit:'round',remaining:2},createdAt:'2026-01-01T00:00:00Z'}],
   proficiencies:{...character.proficiencies,skills:['Arcana'],languages:['Common']},abilityScoreBonuses:{DEX:2}};
  const after=applyDirectSpeciesChoiceEffects({...current,buildChoices:{...current.buildChoices!,speciesChoices:next}},item,[requirement],next);
  return {item,requirement,current,after,old};
 }
 test('preserves the complete existing character except an explicit size choice and size field',()=>{
  const f=disposable(),before=digest(f.current);
  expect(reviewCharacterOriginSizePreservation(f.current,f.current,f.after,f.item,ctx)).toMatchObject({status:'originSizeOnlyPreservationCandidate',codes:[],unexpectedPaths:[],writeAuthorized:false});
  expect(f.after.compendiumLinks).toEqual(f.current.compendiumLinks);
  expect(f.after.spells).toEqual(f.current.spells);
  expect(digest(f.current)).toBe(before);
  const changed={...f.after,abilities:{...f.after.abilities,DEX:20},proficiencies:{...f.after.proficiencies,skills:[]},feats:[],spells:[],equipment:[],resources:[],activeEffects:[],compendiumLinks:[]};
  expect(reviewCharacterOriginSizePreservation(f.current,f.current,changed,f.item,ctx)).toMatchObject({status:'preservationBlocked',unexpectedPaths:['abilities','activeEffects','compendiumLinks','equipment','feats','proficiencies','resources','spells']});
  expect(reviewCharacterOriginSizePreservation(f.current,{...f.current,notes:'changed'},f.after,f.item,ctx).codes).toContain('baseSnapshotMismatch');
  expect(reviewCharacterOriginSizePreservation(f.current,f.current,f.after,f.item,{...ctx,rulesEra:'2014'}).codes).toContain('originChoiceBindingPending');
  expect(reviewCharacterOriginSizePreservation(f.current,f.current,f.after,{...f.item,id:'other'},ctx).codes).toContain('originLinkBindingPending');
 });
 test('rejects unresolved dependencies, unsupported size and duplicate or stale origin choices',()=>{
  const f=disposable();
  for(const c of [{...ctx,otherOriginDependenciesExcludedConfirmed:false},{...ctx,selectedSize:'Large' as const},{...ctx,selectionPolicyConfirmed:false}]){
   expect(reviewCharacterOriginSizePreservation(f.current,f.current,f.after,f.item,c).codes).toContain('originChoiceBindingPending');
  }
  const duplicate={...f.current,buildChoices:{...f.current.buildChoices!,speciesChoices:[...f.old,...f.old]}};
  expect(reviewCharacterOriginSizePreservation(duplicate,duplicate,f.after,f.item,ctx).codes).toContain('originChoiceBindingPending');
  const wrong={...f.current,species:{...f.current.species!,size:'Large' as const}};
  expect(reviewCharacterOriginSizePreservation(wrong,wrong,f.after,f.item,ctx).codes).toContain('originChoiceBindingPending');
 });
 test('creation draft preserves canonical choice references and rejects unrelated selection changes',()=>{
  const f=disposable(),base=sanitizeCharacterCreationDraft({name:'Fixture',targetLevel:'1',selectedSpeciesId:f.item.id,speciesChoices:f.old,
   selectedBackgroundId:'background',selectedFeatCounts:{feat:1},spellAssignments:{spell:'class'},bonusAbilities:['STR','DEX'],classSkillChoices:['Arcana']});
  if(!base)throw Error('missing creation draft');
  const requirement={...f.requirement,speciesItemId:normalizeCharacterChoiceReference(f.requirement.speciesItemId),featureItemId:normalizeCharacterChoiceReference(f.requirement.featureItemId)};
  const after={...base,speciesChoices:setSpeciesChoiceOption(base.speciesChoices,requirement,'Small')};
  expect(reviewCreationOriginSizePreservation(base,base,after,f.item,ctx)).toMatchObject({status:'originSizeOnlyPreservationCandidate',codes:[]});
  expect(reviewCreationOriginSizePreservation(base,base,{...after,selectedFeatCounts:{},spellAssignments:{},classSkillChoices:[],bonusAbilities:[]},f.item,ctx)).toMatchObject({status:'preservationBlocked',unexpectedPaths:['bonusAbilities','classSkillChoices','selectedFeatCounts','spellAssignments']});
  expect(reviewCreationOriginSizePreservation(base,{...base,name:'concurrent'},after,f.item,ctx).codes).toContain('baseSnapshotMismatch');
  expect(reviewCreationOriginSizePreservation(base,base,after,f.item,{...ctx,selectionPolicyConfirmed:false}).codes).toContain('originChoiceBindingPending');
 });
});
