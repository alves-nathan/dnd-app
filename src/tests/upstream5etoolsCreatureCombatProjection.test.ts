export {};
const {identity}=require('../../scripts/5etools/resolver');
const {convertCreature}=require('../../scripts/5etools/creature-converter');
const {digest}=require('../../scripts/5etools/integrated-review');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {buildRemainingFamilyEvidence}=require('../../scripts/5etools/remaining-family-evidence');
const {buildCreatureCombatProjection,previewCreatureCombat,publicSummary}=require('../../scripts/5etools/creature-combat-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const build=(name:string,extra:Record<string,unknown>={})=>{
  const raw={name,source:'XMM',size:['M'],type:'beast',ac:[13],hp:{average:11,formula:'2d8 + 2'},speed:{walk:40},cr:'1/4',
   str:12,dex:14,con:12,int:3,wis:10,cha:6,resist:['fire'],
   action:[{name:'Private Bite',entries:['{@atkr m} {@hit 4}, reach 5 ft. {@h}5 ({@damage 1d6 + 2}) Piercing damage.']},
    {name:'Private Shot',entries:['{@atk rw} {@hit 4} to hit, range 30/120 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage.']},
    {name:'Multiattack',entries:['Fixture only.']}],...extra};
  return convertCreature({blob:'d'.repeat(40),path:'data/bestiary/bestiary-xmm.json',key:identity('monster',raw),index:0},
   {entity:raw,lineage:[]},{id:'upstream:main:XMM',status:'needsReview',rulesEra:'2024',precedenceScope:'official-dnd'},commits.main).item;
 };
 const items=[build('Private Static'),build('Private Dynamic',{ac:[12,{ac:15,condition:'shield'}],hp:{special:'dynamic'},speed:{fly:40,canHover:true},size:['S','M'],resist:[{resist:['fire'],note:'conditional'}]}),
  build('Private Overlap',{immune:['fire']})];
 const rawHistorical:any[]=[];
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[],items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.10.2 creature combat projection',()=>{
 function context(x:ReturnType<typeof fixture>,name:string){
  const p=buildCreatureCombatProjection(x),i=x.items.find((i:any)=>i.name===name),r=p.rows.find((r:any)=>r.creatureId===i.id);
  return {creatureId:i.id,sourceFingerprint:r.sourceFingerprint,rulesEra:r.rulesEra,projectionFingerprint:p.fingerprint,contextConfirmed:true};
 }
 test('exact static chassis only; no inferred defaults or HP mutation',()=>{
  const x=fixture(),q={...context(x,'Private Static'),domain:'chassis',staticStatsPolicyConfirmed:true,currentHp:7,positionFeet:10};
  expect(previewCreatureCombat(x,q)).toMatchObject({status:'chassisCandidate',armorClass:13,hitPoints:{current:7,max:11},speedFeet:40,writeAuthorized:false});
  expect(previewCreatureCombat(x,{...q,currentHp:12}).status).toBe('notSatisfied');
  expect(previewCreatureCombat(x,{...q,...context(x,'Private Dynamic')}).reason).toBe('staticChassisPending');
 });
 test('exact attack identity, distance bands and bounded dice; multiattack remains pending',()=>{
  const x=fixture(),p=buildCreatureCombatProjection(x),r=p.rows[0],q={...context(x,'Private Static'),domain:'attack',section:'action',index:1,actionFingerprint:r.actions[1].sourceFingerprint,
   targetingPolicyConfirmed:true,otherActionDependenciesExcludedConfirmed:true,distanceFeet:60};
  expect(previewCreatureCombat(x,q)).toMatchObject({status:'attackCandidate',rangeBand:'long',damageBounds:{min:3,max:8,average:5.5},executable:false});
  expect(previewCreatureCombat(x,{...q,distanceFeet:121}).status).toBe('notSatisfied');
  expect(previewCreatureCombat(x,{...q,index:2,actionFingerprint:r.actions[2].sourceFingerprint}).reason).toBe('actionContextPending');
  expect(previewCreatureCombat(x,{...q,actionFingerprint:'stale'}).status).toBe('indeterminate');
 });
 test('conditional and combined defenses are not flattened; no damage applied',()=>{
  const x=fixture(),q={...context(x,'Private Static'),domain:'defense',damageType:'fire',defenseInventoryCompleteConfirmed:true,otherDefenseDependenciesExcludedConfirmed:true};
  expect(previewCreatureCombat(x,q)).toMatchObject({status:'defenseCandidate',membership:'resistance'});
  expect(previewCreatureCombat(x,{...q,damageType:'cold'})).toMatchObject({membership:'noneDeclared'});
  expect(previewCreatureCombat(x,{...q,...context(x,'Private Dynamic')}).reason).toBe('conditionalDefensePending');
  expect(previewCreatureCombat(x,{...q,...context(x,'Private Overlap')}).reason).toBe('combinedDefensePolicyPending');
 });
 test('binds evidence and rederived payload; aggregates only',()=>{
  const x=fixture(),before=digest(x),p=buildCreatureCombatProjection(x);
  expect(p.summary.items).toBe(3);
  expect(JSON.stringify(publicSummary(p))).not.toMatch(/Private|upstream:main:/);
  expect(digest(x)).toBe(before);
  expect(()=>buildCreatureCombatProjection(x,{...buildRemainingFamilyEvidence(x),approvedMappings:1})).toThrow('remainingEvidenceMismatch');
  x.items[0].payload.armorClass=99;
  expect(()=>buildCreatureCombatProjection(x)).toThrow('creatureProjectionBindingMismatch');
 });
});
