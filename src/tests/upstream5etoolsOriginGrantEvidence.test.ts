export {};
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
