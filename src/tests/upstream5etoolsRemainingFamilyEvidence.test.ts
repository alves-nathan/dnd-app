export {};
const {createHash}=require('node:crypto');
const {identity}=require('../../scripts/5etools/resolver');
const {digest}=require('../../scripts/5etools/integrated-review');
const {physicalId:equipmentId}=require('../../scripts/5etools/equipment-converter');
const {physicalId:creatureId}=require('../../scripts/5etools/creature-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {compareFields,buildRemainingFamilyEvidence,publicSummary}=require('../../scripts/5etools/remaining-family-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const build=(kind:string,rawKind:string,name:string,code:string,path:string,payload:Record<string,unknown>)=>{
  const raw={name,source:code,entries:[]},key=identity(rawKind,raw);
  const id=kind==='equipment'?equipmentId(code,kind,name):kind==='creatureStatBlock'?creatureId(code,name):
   'upstream:main:magicItem:'+createHash('sha256').update(JSON.stringify(['item',key])).digest('hex');
  return {id,kind,name,source:{id:'upstream:main:'+code,status:'needsReview',rulesEra:'2024'},provenance:{origin:'5etools',commit:commits.main,sourceCode:code,path,index:0,blob:'d'.repeat(40),entityKey:key},
   payload:{...payload,mechanics:{[kind==='creatureStatBlock'?'upstreamCreature':'upstreamItem']:raw}},metadata:{reviewCodes:['effectSemanticsPending']}};
 };
 const items=[build('equipment','baseitem','Private Gear','XPHB','data/items-base.json',{weight:1}),build('magicItem','item','Private Magic','XDMG','data/items.json',{attunement:false}),build('creatureStatBlock','monster','Private Monster','XMM','data/bestiary/bestiary-xmm.json',{armorClass:12})];
 const old=[{id:'old',kind:'equipment',name:'Private Gear',source:{id:'phb',rulesEra:'2024'},payload:{weight:2}},
  {id:'old',kind:'equipment',name:'Private Gear',source:{id:'phb',rulesEra:'2024'},payload:{weight:1}},
  {id:'magic',kind:'magicItem',name:'Private Magic',source:{id:'dmg-2024',rulesEra:'2024'},payload:{}},
  {id:'creature',kind:'creatureStatBlock',name:'Private Monster',source:{id:'mm-2025',rulesEra:'2024'},payload:{armorClass:12}},
  {id:'other',kind:'spell',name:'Unknown',source:{id:'phb',rulesEra:'2024'},payload:{}}];
 const rawHistorical=old.map((item,index)=>({item,path:'fixture',index}));
 const rows=rawHistorical.map(({item,path,index})=>({id:item.id,kind:item.kind,sourceId:item.source.id,rulesEra:item.source.rulesEra,path,index,itemHash:digest(item)}));
 const rt=[{entityId:'runtime',displayName:'Private Monster'},{entityId:'rule',displayName:'Private Rule'}];
 const entries=rt.map((x,index)=>({id:x.entityId,kind:index?'rule':'creatureStatBlock',book:'mm-2025',fingerprint:digest(x)}));
 const reconciliation=reconcile({historical:{rows,bootstrapRows:[]},runtime:{entries,dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:rt,items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.10.1 remaining family inventory',()=>{
 test('accounts for all occurrences, distinct variants and runtime-only contracts',()=>{
  const x=fixture(),r=buildRemainingFamilyEvidence(x);
  expect(r.totals).toEqual({historical:5,runtime:2,upstream:3});
  expect(r.coverage.historical.equipment).toMatchObject({occurrences:2,identityCandidates:2,coverage:'remainingFamilyEvidence'});
  expect(r.coverage.historical.spell).toMatchObject({identityPending:1,coverage:'priorScopedCheckpoint'});
  expect(r.coverage.runtime.rule).toMatchObject({coverage:'outsidePilotContract',identityPending:1});
  expect(r.remaining.equipment.historical.byField['/payload/weight']).toEqual({differentValue:1,exactValue:1});
  expect(r.rows[0].sourceFingerprint).not.toBe(r.rows[1].sourceFingerprint);
  expect(r.mechanicalParityEstablished).toBe(0);
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|upstream:main:/);
 });
 test('distinguishes missing fields from explicit false and does not infer mechanical equivalence',()=>{
  expect(compareFields('magicItem',{attunement:false},{attunement:true})).toContainEqual({field:'/payload/attunement',status:'differentValue'});
  expect(compareFields('magicItem',{attunement:false},{})).toContainEqual({field:'/payload/attunement',status:'missingCandidate'});
 });
 test('rejects missing occurrences, stale targets and invalid physical provenance',()=>{
  const a=fixture();a.reconciliation.historical.pop();expect(()=>buildRemainingFamilyEvidence(a)).toThrow('historicalCoverageMismatch');
  const b=fixture();b.items[0].provenance.entityKey='wrong';expect(()=>buildRemainingFamilyEvidence(b)).toThrow('equipmentIdentityMismatch');
  const c=fixture();c.reconciliation.historical[0].targetFingerprint='wrong';expect(()=>buildRemainingFamilyEvidence(c)).toThrow('remainingTargetMismatch');
 });
});
