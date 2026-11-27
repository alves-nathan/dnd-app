export {};
const {buildPilot:buildEquipment}=require('../../scripts/5etools/equipment-converter');
const {buildPilot:buildMagic}=require('../../scripts/5etools/magic-item-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildRemainingFamilyEvidence}=require('../../scripts/5etools/remaining-family-evidence');
const {buildItemMechanicsProjection,previewItemMechanics,publicSummary}=require('../../scripts/5etools/item-mechanics-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const base={name:'Private Blade',source:'XPHB',edition:'one',type:'M|XPHB',weapon:true,weaponCategory:'simple',dmg1:'1d6',dmgType:'S',value:1000,weight:3,rarity:'none'};
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'},{source:'XDMG',name:'Fixture',published:'2024-11-12'}]},
  'data/items-base.json':{baseitem:[base,{name:'Private Gear',source:'XPHB',type:'G|XPHB',rarity:'none',value:125,weight:2.5},
   {name:'Private Bundle',source:'XPHB',type:'G|XPHB',rarity:'none',value:125,weight:2,packContents:['unqualified']}],
   itemType:[{name:'Gear',abbreviation:'G',source:'XPHB'}]},
  'data/items.json':{item:[{name:'Private Charm',source:'XDMG',rarity:'rare',reqAttune:true,charges:3,recharge:'dawn',rechargeAmount:'1d3',bonusAc:'+1',attachedSpells:['Unknown|XPHB']},
   {name:'Private Conditional',source:'XDMG',rarity:'rare',reqAttune:'by a wizard',charges:'1d4'},
   {name:'Private Absent',source:'XDMG',rarity:'common'},{name:'Private False',source:'XDMG',rarity:'common',reqAttune:false}]},
  'data/magicvariants.json':{magicvariant:[{name:'Private Template',requires:[{weapon:true}],inherits:{source:'XDMG',nameSuffix:' +1',rarity:'uncommon',bonusWeapon:'+1',reqAttune:true}}]}
 };
 const snapshot={commit:commits.main,files:new Map(Object.keys(data).map(k=>[k,'d'.repeat(40)])),readJson:(p:string)=>data[p]};
 const items=[...buildEquipment(snapshot,['XPHB']).packs[0].items,...buildMagic(snapshot,['XDMG']).packs[0].items];
 const rawHistorical:any[]=[];
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[],items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.10.3 item mechanics projection',()=>{
 function context(x:ReturnType<typeof fixture>,name:string){
  const p=buildItemMechanicsProjection(x),i=x.items.find((i:any)=>i.name===name),r=p.rows.find((r:any)=>r.itemId===i.id);
  return {itemId:i.id,sourceFingerprint:r.sourceFingerprint,projectionFingerprint:p.fingerprint,rulesEra:r.rulesEra,contextConfirmed:true};
 }
 test('exact copper and weight arithmetic, no bundle expansion or inherited price',()=>{
  const x=fixture(),q={...context(x,'Private Gear'),domain:'quantity',quantityPolicyConfirmed:true,quantity:3};
  expect(previewItemMechanics(x,q)).toMatchObject({status:'quantityCandidate',copper:375,weightPounds:7.5,writeAuthorized:false});
  expect(previewItemMechanics(x,{...q,...context(x,'Private Bundle')}).status).toBe('indeterminate');
  const p=buildItemMechanicsProjection(x),v=p.rows.find((r:any)=>r.itemId===context(x,'Private Blade +1').itemId);
  expect(v.magic).toMatchObject({variant:{status:'variantBaseIdentityCandidate'},bonuses:{weapon:{status:'literalCandidate',value:1}}});
  expect(v.values.costCopper.status).toBe('notDeclared');
 });
 test('attunement requirement is distinct from state, conditional and absent',()=>{
  const x=fixture(),q={...context(x,'Private Charm'),domain:'attunement',slotPolicyConfirmed:true,otherRequirementsExcludedConfirmed:true,usedSlots:2,slotLimit:3,currentlyAttuned:false};
  expect(previewItemMechanics(x,q)).toMatchObject({status:'attunementRequirementCandidate',required:true,remainingSlots:0});
  expect(previewItemMechanics(x,{...q,usedSlots:3}).status).toBe('notSatisfied');
  for(const name of ['Private Conditional','Private Absent'])expect(previewItemMechanics(x,{...q,...context(x,name)}).status).toBe('indeterminate');
  expect(previewItemMechanics(x,{...q,...context(x,'Private False')}).required).toBe(false);
 });
 test('fixed charge limit, dawn and recovery dice remain independent of spending',()=>{
  const x=fixture(),q={...context(x,'Private Charm'),domain:'chargeArithmetic',resourceBindingConfirmed:true,spendPolicyConfirmed:true,otherChargeDependenciesExcludedConfirmed:true,
   instanceId:'instance',resourceId:'pool',current:2,amount:1};
  expect(previewItemMechanics(x,q)).toMatchObject({status:'chargeArithmeticCandidate',before:2,after:1,max:3,executable:false});
  expect(previewItemMechanics(x,{...q,amount:3}).status).toBe('notSatisfied');
  expect(previewItemMechanics(x,{...q,resourceBindingConfirmed:false}).status).toBe('indeterminate');
  const row=buildItemMechanicsProjection(x).rows.find((r:any)=>r.itemId===q.itemId);
  expect(row.magic.charges).toMatchObject({event:{event:'dawn'},recovery:{status:'diceAmountCandidate',min:1,max:3},sharing:'notEstablished'});
  expect(row.references.spells[0].status).toBe('endpointPending');
 });
 test('binds evidence, verifies raw-derived values and emits only aggregates',()=>{
  const x=fixture(),before=digest(x),r=buildItemMechanicsProjection(x);
  expect(r.summary.byKind).toEqual({equipment:2,magicItem:5});
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|upstream:main:/);
  expect(digest(x)).toBe(before);
  expect(()=>buildItemMechanicsProjection(x,{...buildRemainingFamilyEvidence(x),approvedMappings:1})).toThrow('remainingEvidenceMismatch');
  x.items.find((i:any)=>i.name==='Private Gear').payload.cost.amount=999;
  expect(()=>buildItemMechanicsProjection(x)).toThrow('itemValueBindingMismatch');
 });
});
