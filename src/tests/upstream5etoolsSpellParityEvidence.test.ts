import {buildPersistedCompendiumImport} from '../compendium/importer';
import {applyCompendiumItemToCharacter} from '../compendium/mapper';
import {createEmptyCharacter} from '../data/mockData';
const {buildPilot}=require('../../scripts/5etools/spell-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {compareSpellFields,buildSpellParityEvidence,publicSummary,spellContractEvidence}=require('../../scripts/5etools/spell-parity-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const base={name:'Private Ray',source:'XPHB',level:0,school:'V',time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},
  duration:[{type:'instant'}],components:{v:true,s:true},entries:['Make a ranged spell attack against the target. On a hit, the target takes {@damage 1d6} Fire damage.'],damageInflict:['fire'],spellAttack:['R']};
 const other={...base,name:'Private Ritual',level:1,time:[{number:10,unit:'minute'}],meta:{ritual:true},range:{type:'emanation',distance:{type:'feet',amount:10}},
  duration:[{type:'timed',duration:{type:'minute',amount:1},concentration:true}],components:{v:true,m:{text:'PRIVATE_MATERIAL',cost:100,consume:true}},
  entries:['PRIVATE_TEXT {@damage 2d6}'],spellAttack:[],savingThrow:['dexterity'],conditionInflict:['prone'],entriesHigherLevel:[{entries:['PRIVATE_SCALE']}]};
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'}]},
  'data/spells/index.json':{XPHB:'spells-xphb.json'},'data/spells/spells-xphb.json':{spell:[base,other]},
  'data/generated/gendata-spell-source-lookup.json':{xphb:{'private ray':{class:{XPHB:{Wizard:true}}},'private ritual':{class:{XPHB:{Wizard:true}}}}}
 };
 const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
 const old=[
  {id:'old-ray',kind:'spell',name:'Private Ray',payload:{level:0,school:'evocation',classes:['wizard'],castingTime:{kind:'action',actionCost:'action',ritualAlternative:false},range:'60 feet',damageFormula:'1d6',damageType:'Fire',targets:1,requiresAttackRoll:true}},
  {id:'old-ray',kind:'spell',name:'Private Ray',payload:{level:0,classes:['Wizard'],castingTime:{kind:'action',actionCost:'action'},damageFormula:'2d6'}},
  {id:'old-unknown',kind:'spell',name:'Private Unknown',payload:{level:1,classes:['Wizard'],castingTime:{kind:'action',actionCost:'action'}}}
 ];
 const rawHistorical=old.map((item,index)=>({path:'PRIVATE_PATH',index,item}));
 const rows=rawHistorical.map(({item,path,index})=>({id:item.id,kind:item.kind,sourceId:'phb',rulesEra:'2024',path,index,itemHash:digest(item)}));
 const reconciliation=reconcile({historical:{rows,bootstrapRows:rows},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[],items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.7.1 spell parity and runtime contract evidence',()=>{
 test('normalizes only explicit scalar and set representations; never defaults missing fields',()=>{
  const compare=(a:Record<string,unknown>,b:Record<string,unknown>)=>Object.fromEntries(compareSpellFields(a,b).map((x:any)=>[x.field,x.status]));
  expect(compare({level:0,classes:['Wizard','Bard'],range:'60 feet',school:'Evocation',damageType:'FIRE',saveAbility:'DEX',targets:1},
   {level:0,classes:['bard','wizard'],range:'60 ft',school:'evocation',damageType:'fire',saveAbility:'dex'})).toMatchObject({
   level:'exactValue',classes:'representationOnlyCandidate',range:'representationOnlyCandidate',school:'representationOnlyCandidate',damageType:'representationOnlyCandidate',saveAbility:'representationOnlyCandidate',targets:'missingCandidate',castingTime:'requiredAbsentBoth'});
  expect(compare({range:'Touch',classes:['Wizard','wizard'],concentration:false},{range:'5 ft',classes:['wizard']})).toMatchObject({range:'differentValue',classes:'differentValue',concentration:'missingCandidate'});
  expect(compare({range:'Self (10 ft cone)',damageFormula:'1d6 + 1'},{range:'10 ft',damageFormula:'1d6+1'})).toMatchObject({range:'differentValue',damageFormula:'differentValue'});
 });
 test('observes duration, scaling and direct damage separately from execution gaps',()=>{
  const f=fixture(),ray=f.items.find((i:any)=>i.name==='Private Ray'),ritual=f.items.find((i:any)=>i.name==='Private Ritual');
  expect(spellContractEvidence(ray)).toMatchObject({durationStatus:'instantaneous',damageStatuses:['damageFormulaCandidate'],codes:expect.arrayContaining(['defaultTargetCountNotEstablished','qualifiedClassAccessPending'])});
  const r=spellContractEvidence(ritual);
  expect(r).toMatchObject({durationStatus:'durationCandidate',scalingStatuses:['upcastSemanticsPending'],damageStatuses:[],codes:expect.arrayContaining([
   'castingTimeActionFallbackReview','ritualTimingAndSlotPolicyPending','areaGeometryAndOriginPending','materialCostOrConsumptionPending','damageApplicationPending','saveSuccessOutcomePending','conditionApplicationPending','concentrationLifecyclePending','slotConsumptionPolicyPending'])});
 });
 test('binds all occurrences, preserves conflicting historical variants and emits aggregate only',()=>{
  const f=fixture(),before=digest(f),r=buildSpellParityEvidence(f);
  expect(r.historical).toMatchObject({occurrences:3,identityCandidates:2,identityPending:1,byField:{damageFormula:{exactValue:1,differentValue:1}}});
  expect(r.upstream).toMatchObject({items:2,bySource:{XPHB:2},contractCodes:{qualifiedClassAccessPending:2}});
  expect(r).toMatchObject({mechanicalParityEstablished:0,approvedMappings:0,executable:false,writeAuthorized:false});
  expect(r.rows.every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|PRIVATE_|old-ray/);
  expect(digest(f)).toBe(before);
 });
 test('fails closed for changed source, candidate fingerprint and incomplete inventory',()=>{
  const f=fixture();
  expect(()=>buildSpellParityEvidence({...f,rawHistorical:f.rawHistorical.map(x=>({...x,item:{...x.item,name:'changed'}}))})).toThrow('historicalBindingMismatch');
  expect(()=>buildSpellParityEvidence({...f,items:f.items.map((x:any)=>x.name==='Private Ray'?{...x,payload:{...x.payload,damageFormula:'2d6'}}:x)})).toThrow('targetBindingMismatch');
  expect(()=>buildSpellParityEvidence({...f,items:f.items.map((x:any)=>({...x,provenance:{...x.provenance,commit:'c'.repeat(40)}}))})).toThrow('spellSourceBindingMismatch');
  expect(()=>buildSpellParityEvidence({...f,reconciliation:{...f.reconciliation,historical:f.reconciliation.historical.slice(1)}})).toThrow('historicalCoverageMismatch');
 });
 test('actual legacy mapper falls back to action and one target for a duration-casting fixture',()=>{
  const source={id:'fixture',book:'Fixture',version:'2024',status:'active' as const,confidence:'exact' as const};
  const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[{id:'fixture-spell',kind:'spell',name:'Synthetic Ritual',source,payload:{level:1,classes:['Wizard'],castingTime:{kind:'duration',amount:10,unit:'minute'},ritual:true,range:'Touch',healingFormula:'1d8'}}]});
  const item=pack.items[0];if(!item)throw Error('missing fixture');
  const base=createEmptyCharacter('Fixture'),before=JSON.stringify(base);
  const result=applyCompendiumItemToCharacter(base,item);
  expect(result.ok).toBe(true);
  expect(result.character.spells[0]).toMatchObject({castingTime:'action',targeting:{targets:1}});
  expect(result.character.spells[0]?.damage).toBeUndefined();
  expect(JSON.stringify(base)).toBe(before);
 });
});
