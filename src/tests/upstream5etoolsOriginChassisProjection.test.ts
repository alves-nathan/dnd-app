export {};
const {buildPilot}=require('../../scripts/5etools/origin-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildOriginParityEvidence}=require('../../scripts/5etools/origin-parity-evidence');
const {proficiencyPlan,chassis,buildOriginChassisProjection,publicSummary,previewOriginSelection}=require('../../scripts/5etools/origin-chassis-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
const scores={STR:10,DEX:12,CON:14,INT:10,WIS:10,CHA:10};
const weighted=[{choose:{weighted:{from:['str','dex','con'],weights:[2,1]}}},{choose:{weighted:{from:['str','dex','con'],weights:[1,1,1]}}}];
function fixture(){
 const base={name:'Private Classic',source:'PHB',size:['M'],creatureTypes:['humanoid'],speed:30,ability:[{con:2,choose:{from:['str','dex'],amount:1,count:1}}],entries:[]};
 const revised={name:'Private Revised',source:'XPHB',size:['S','M'],creatureTypes:['humanoid'],speed:{walk:30,swim:20},darkvision:60,entries:[]};
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'PHB',name:'Classic Fixture',published:'2014-08-19'},{source:'XPHB',name:'Revised Fixture',published:'2024-09-17'}]},
  'data/races.json':{race:[base,revised,{...revised,name:'Private Conditional',speed:{walk:30,fly:true},ability:[{str:2}]}],
   subrace:[{name:'Hill',source:'PHB',raceName:base.name,raceSource:'PHB',entries:[]}]},
  'data/backgrounds.json':{background:[{name:'Private Background',source:'XPHB',ability:weighted,
   skillProficiencies:[{athletics:true,choose:{from:['arcana','perception'],count:1}}],
   toolProficiencies:[{"smith's tools":true}],languageProficiencies:[{choose:{from:['common','elvish'],count:1}}],entries:[]},
   {name:'Private Legacy',source:'PHB',skillProficiencies:[{any:2}],entries:[]}]},
  'data/feats.json':{feat:[]}
 };
 const snapshot={commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]};
 const items=buildPilot(snapshot,['PHB','XPHB']).packs.flatMap((p:any)=>p.items);
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={items,reconciliation,rawHistorical:[]},evidence=buildOriginParityEvidence(input),projection=buildOriginChassisProjection(input,evidence);
 const row=(name:string)=>{const i=items.find((x:any)=>x.name==='Private '+name);if(!i)throw Error('missing item');return projection.rows.find((x:any)=>x.itemId===i.id);};
 const preview=(name:string,extra:Record<string,unknown>)=>{const r=row(name);return previewOriginSelection(input,{originId:r.itemId,sourceFingerprint:r.sourceFingerprint,rulesEra:r.rulesEra,projectionFingerprint:projection.fingerprint,
  contextComplete:true,originPolicyConfirmed:true,...extra});};
 return {input,evidence,projection,row,preview};
}
describe('a8.8.2 origin chassis and selection projection',()=>{
 test('literal proficiencies do not collapse alternatives, category selectors, overlap or unsupported references',()=>{
  expect(proficiencyPlan([{athletics:true,choose:{from:['arcana','perception'],count:1}}],'skill')).toEqual({status:'literalProficiencyCandidate',fixed:['athletics'],choices:[{options:['arcana','perception'],count:1}]});
  expect(proficiencyPlan(undefined,'skill')).toEqual({status:'notDeclared'});
  expect(proficiencyPlan([{athletics:true},{arcana:true}],'skill').status).toBe('shapePending');
  expect(proficiencyPlan([{any:2}],'skill').status).toBe('selectorPending');
  expect(proficiencyPlan([{anyStandard:true}],'language').status).toBe('selectorPending');
  expect(proficiencyPlan([{choose:{from:['Arcana','arcana'],count:1}}],'skill').status).toBe('selectorPending');
  expect(proficiencyPlan([{athletics:true,choose:{from:['athletics','arcana'],count:1}}],'skill').status).toBe('overlapPending');
  expect(proficiencyPlan([{'tool|PHB':true}],'tool').status).toBe('selectorPending');
 });
 test('size options and fixed movement stay separate from missing creature type and conditional speeds',()=>{
  expect(chassis({size:['S','M'],creatureTypes:['humanoid'],speed:{walk:30,swim:20},darkvision:60})).toMatchObject({
   size:{status:'sizeCandidate',options:['Small','Medium']},creatureType:{status:'typeCandidate',value:'humanoid'},
   movement:{status:'movementCandidate',feet:{walk:30,swim:20}},senses:{darkvision:{status:'senseCandidate',feet:60},blindsight:{status:'notDeclared'}}});
  expect(chassis({size:['M','M'],speed:{walk:30,fly:true}})).toMatchObject({size:{status:'sizePending'},creatureType:{status:'typePending'},movement:{status:'movementPending'}});
  expect(chassis({speed:30.5,darkvision:-1}).senses.darkvision.status).toBe('sensePending');
 });
 test('2024 weighted allocations validate both alternatives, cap, and unmodified base',()=>{
  const f=fixture(),base={domain:'ability',scores,baseScoresConfirmed:true,originIncreasesNotAppliedConfirmed:true};
  expect(f.preview('Background',{...base,increases:{STR:2,DEX:1}})).toMatchObject({status:'originAbilityCandidate',scores:{STR:12,DEX:13,CON:14},writeAuthorized:false});
  expect(f.preview('Background',{...base,increases:{STR:1,DEX:1,CON:1}})).toMatchObject({status:'originAbilityCandidate',scores:{STR:11,DEX:13,CON:15}});
  for(const increases of [{STR:3},{STR:2,CHA:1},{STR:1,DEX:1}])expect(f.preview('Background',{...base,increases}).reason).toBe('allocationInvalid');
  expect(f.preview('Background',{...base,scores:{...scores,STR:19},increases:{STR:2,DEX:1}}).reason).toBe('allocationInvalid');
  expect(f.preview('Background',{...base,originIncreasesNotAppliedConfirmed:false,increases:{STR:2,DEX:1}}).reason).toBe('baseAbilityContextPending');
 });
 test('legacy species allocation and subrace require independent explicit policies; no revised species ASI',()=>{
  const f=fixture(),base={domain:'ability',scores,baseScoresConfirmed:true,originIncreasesNotAppliedConfirmed:true,alternativeIndex:0,selectedAbilities:['DEX']};
  expect(f.preview('Classic',base).reason).toBe('legacyAllocationPolicyPending');
  expect(f.preview('Classic',{...base,legacySpeciesPolicyConfirmed:true})).toMatchObject({status:'originAbilityCandidate',increases:{CON:2,DEX:1},scores:{CON:16,DEX:13}});
  expect(f.preview('Classic',{...base,legacySpeciesPolicyConfirmed:true,selectedAbilities:['CHA']}).reason).toBe('allocationInvalid');
  expect(f.preview('Classic (Hill)',{...base,legacySpeciesPolicyConfirmed:true}).reason).toBe('variantPolicyPending');
  expect(f.preview('Conditional',{...base,legacySpeciesPolicyConfirmed:true}).reason).toBe('abilityPolicyPending');
  expect(f.preview('Legacy',base).reason).toBe('abilityPolicyPending');
  expect(f.preview('Classic',{...base,rulesEra:'2024'}).reason).toBe('originIdentityOrEditionPending');
 });
 test('chassis and proficiency selections are isolated, explicit and nonmutating',()=>{
  const f=fixture(),before=digest(f.input);
  expect(f.preview('Revised',{domain:'chassis',selectedSize:'Small',baseMovementAndSensePolicyConfirmed:true})).toMatchObject({status:'originChassisCandidate',size:'Small',movement:{walk:30,swim:20}});
  expect(f.preview('Revised',{domain:'chassis',selectedSize:'Large',baseMovementAndSensePolicyConfirmed:true}).reason).toBe('sizeSelectionInvalid');
  expect(f.preview('Conditional',{domain:'chassis',selectedSize:'Small',baseMovementAndSensePolicyConfirmed:true}).reason).toBe('chassisFieldsPending');
  const base={domain:'proficiency',category:'skill',literalIdentityConfirmed:true,existingInventoryComplete:true,existing:['history'],selected:['arcana']};
  expect(f.preview('Background',base)).toMatchObject({status:'originProficiencyCandidate',grants:['athletics','arcana'],combined:['history','athletics','arcana']});
  expect(f.preview('Background',{...base,existing:['athletics']}).reason).toBe('duplicateProficiencyPolicyPending');
  expect(f.preview('Background',{...base,selected:['history']}).reason).toBe('proficiencySelectionInvalid');
  expect(f.preview('Background',{...base,category:'language',selected:['elvish'],existing:['common']})).toMatchObject({status:'originProficiencyCandidate',grants:['elvish']});
  expect(f.preview('Background',{...base,category:'tool',selected:[],existing:[]})).toMatchObject({status:'originProficiencyCandidate',grants:["smith's tools"]});
  expect(f.preview('Legacy',base).reason).toBe('proficiencyPolicyPending');
  expect(digest(f.input)).toBe(before);
 });
 test('binds exact prior evidence and aggregates without identity rows',()=>{
  const f=fixture();
  expect(f.projection.summary).toMatchObject({species:4,background:2,ability:{backgroundAllocationCandidate:1,legacyAllocationCandidate:2,editionPolicyPending:1}});
  expect(f.projection.rows.every((r:any)=>!r.runtimeEligible&&!r.writeAuthorized&&!r.retirementAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(f.projection))).not.toMatch(/Private|upstream:main:/);
  expect(()=>buildOriginChassisProjection(f.input,{...f.evidence,fingerprint:'stale'})).toThrow('originEvidenceMismatch');
  expect(f.preview('Revised',{domain:'chassis',projectionFingerprint:'stale'}).reason).toBe('projectionFingerprintMismatch');
  expect(f.preview('Revised',{domain:'chassis',sourceFingerprint:'stale'}).reason).toBe('originIdentityOrEditionPending');
 });
});
