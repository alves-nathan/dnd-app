import { buildPersistedCompendiumImport } from '../compendium/importer';
import { getClassProficiencyRequirement } from '../characters/proficiencyRules';
import { getClassSpellcastingProfile } from '../characters/spellcastingRules';
import { deriveCharacterSpellSlots } from '../characters/spellSlotProgression';
import { applyCompendiumItemToCharacter } from '../compendium/mapper';
import { createEmptyCharacter } from '../data/mockData';
const {compareChassis,compareSkillChoices,compareSpellcasting,slotRows,buildClassMechanicsEvidence,publicSummary}=require('../../scripts/5etools/class-mechanics-evidence');
const {buildClassProgressionEvidence}=require('../../scripts/5etools/class-progression-evidence');
const {buildPilot}=require('../../scripts/5etools/class-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {compileProfile}=require('../../scripts/5etools/resource-spellcasting-preview');
const source={id:'fixture',book:'Synthetic',version:'2024',status:'active' as const,confidence:'exact' as const};
const dense=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+1),{'1':2,'2':i<2?0:1}]));
const sparse=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+1),i<2?{'1':2}:{'1':2,'2':1}]));
const counts=Array(20).fill(2);
const pactLevels=Array(20).fill(1);
const stored=(payload:Record<string,unknown>)=>{
 const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[{id:'fixture-class',kind:'class',name:'Synthetic Caster',source,payload}]});
 const item=pack.items[0];
 if(!item)throw Error('missing synthetic class');
 return item;
};
describe('a8.6.2 class chassis and spellcasting evidence',()=>{
 test('distinguishes literal sets from choice structure and does not infer defaults or synonyms',()=>{
  const a={hitDie:8,primaryAbilities:['INT'],armorTraining:['Light','Shields'],weaponProficiencies:['Simple'],skillChoiceCount:2,skillProficienciesChoice:['History','Arcana']};
  const b={hitDie:8,primaryAbilities:['INT'],armorTraining:['shields','light'],weaponProficiencies:['simple'],skillProficienciesChoice:{from:'skills',count:2,options:['arcana','history']}};
  expect(compareChassis(a,b)).toMatchObject({hitDie:'exactValue',armorTraining:'representationOnlyCandidate',weaponProficiencies:'representationOnlyCandidate',skillChoice:'choiceShapeCandidate'});
  expect(compareChassis({armorTraining:['shield']},{armorTraining:['shields']}).armorTraining).toBe('differentValue');
  expect(compareChassis({armorTraining:['light','light']},{armorTraining:['light']}).armorTraining).toBe('differentValue');
  expect(compareSkillChoices({...a,skillChoiceCount:undefined},b)).toBe('shapeOrCountPending');
  expect(compareSkillChoices(a,{...b,skillChoiceCount:1})).toBe('shapeOrCountPending');
  expect(compareSkillChoices(a,{...b,skillProficienciesChoice:{...b.skillProficienciesChoice,count:1}})).toBe('choiceDifferences');
  expect(compareSkillChoices(a,{...b,skillProficienciesChoice:{...b.skillProficienciesChoice,exclude:['History']}})).toBe('shapeOrCountPending');
 });
 test('compares all 20 slot rows and never fills an absent class level',()=>{
  const compare=(a:unknown,b:unknown)=>compareSpellcasting({slotsByLevel:a},{slotsByLevel:b}).slotsByLevel;
  expect(compare(dense,sparse)).toEqual({status:'numericTableCandidate',comparedLevels:20,differentLevels:0});
  expect(compare(dense,dense)).toEqual({status:'exactTable',comparedLevels:20,differentLevels:0});
  expect(compare(dense,{...dense,'3':{'1':3,'2':1}})).toMatchObject({status:'tableDifferences',differentLevels:1});
  expect(compare(dense,{'1':{'1':2}})).toMatchObject({status:'tableShapePending'});
  expect(compare(dense,undefined)).toEqual({status:'missingCandidate'});
  expect(slotRows({...dense,'20':{'10':1}})).toBeUndefined();
  expect(slotRows({...dense,'20':{'1':-1}})).toBeUndefined();
 });
 test('keeps Pact slots, known and prepared counts independent',()=>{
  const record=Object.fromEntries(counts.map((n:number,i:number)=>[String(i+1),n]));
  const a={pactSlotsByLevel:record,pactSlotLevelByLevel:pactLevels,spellsKnownByLevel:counts,progression:'pactMagic'};
  const b={pactSlotsByLevel:counts,pactSlotLevelByLevel:pactLevels,preparedSpellsByLevel:counts};
  expect(compareSpellcasting(a,b)).toMatchObject({pactSlotsByLevel:{status:'numericTableCandidate'},pactSlotLevelByLevel:{status:'exactTable'},spellsKnownByLevel:{status:'missingCandidate'},preparedSpellsByLevel:{status:'addedCandidate'},progression:{status:'missingCandidate'}});
  expect(compareSpellcasting(a,{...b,pactSlotLevelByLevel:Array(20).fill(0)}).pactSlotLevelByLevel.status).toBe('tableShapePending');
 });
 test('actual proficiency reader ignores structured choice options until explicitly adapted',()=>{
  const payload={hitDie:8,savingThrowProficiencies:['INT','WIS'],skillChoiceCount:2,skillProficienciesChoice:{from:'skills',count:2,options:['Arcana','History']}};
  const raw=stored(payload),adapted=stored({...payload,skillProficienciesChoice:['Arcana','History']});
  expect(getClassProficiencyRequirement(raw,1,[raw])).toMatchObject({skillChoiceCount:2,skillOptions:[]});
  expect(getClassProficiencyRequirement(adapted,1,[adapted])).toMatchObject({skillChoiceCount:2,skillOptions:['Arcana','History'],savingThrows:['INT','WIS']});
 });
 test('actual profile and pool readers need an explicit Pact progression code and separate preparation limits',()=>{
  const spellcasting={ability:'CHA',pactSlotsByLevel:counts,pactSlotLevelByLevel:pactLevels,spellsKnownByLevel:counts};
  const raw=stored({spellcasting}),adapted=stored({spellcasting:{...spellcasting,progression:'pactMagic'}});
  expect(getClassSpellcastingProfile(raw,1)).toMatchObject({maxSpellLevel:1,preparedSpellLimit:0});
  expect(getClassSpellcastingProfile(raw,1)?.progression).toBeUndefined();
  for(const item of [raw,adapted]){
   const applied=applyCompendiumItemToCharacter(createEmptyCharacter('Fixture'),item);
   expect(applied.ok).toBe(true);
   const result=deriveCharacterSpellSlots(applied.character,[item]);
   expect(result.pools.filter(p=>p.poolKind==='pactMagic')).toHaveLength(item===raw?0:1);
   if(item===adapted)expect(result.pools[0]).toMatchObject({poolKind:'pactMagic',max:2,level:1,recharge:'shortRest'});
  }
  const prepared=stored({spellcasting:{...spellcasting,preparedSpellsByLevel:counts}});
  expect(getClassSpellcastingProfile(prepared,1)?.preparedSpellLimit).toBe(2);
 });
 test('binds the report to exact historical occurrences and staging evidence, aggregate only',()=>{
  const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
  const data:Record<string,unknown>={
   'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-01-01'}]},
   'data/class/class-fixture.json':{class:[{name:'Private Caster',source:'XPHB',hd:{number:1,faces:8},proficiency:['int','wis'],spellcastingAbility:'int',casterProgression:'full',cantripProgression:counts,
    startingProficiencies:{skills:[{choose:{from:['Arcana','History'],count:2}}]},
    classTableGroups:[{colLabels:['{@filter 1st|spells|level=1}'],rowsSpellProgression:Array.from({length:20},()=>[2])}],classFeatures:[]}]}
  };
  const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
  expect(items).toHaveLength(1);
  expect(compileProfile(items[0]).status).toBe('tableCandidate');
  const item={id:'old-class',kind:'class',name:'Private Caster',payload:{hitDie:8,skillChoiceCount:2,skillProficienciesChoice:['Arcana','History'],spellcasting:{ability:'INT',slotsByLevel:Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+1),{'1':2}]))},featureIds:[],progression:[]}};
  const rawHistorical=[{path:'PRIVATE_PATH',index:0,item}];
  const rows=[{path:'PRIVATE_PATH',index:0,id:item.id,kind:item.kind,sourceId:'phb',rulesEra:'2024',itemHash:digest(item)}];
  const reconciliation=reconcile({historical:{rows,bootstrapRows:rows},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[],items,records:[],commits});
  const input={reconciliation,rawHistorical,items},progression=buildClassProgressionEvidence(input);
  const report=buildClassMechanicsEvidence(input,progression);
  expect(report.historical.class).toMatchObject({occurrences:1,candidates:1,chassis:{hitDie:{exactValue:1},skillChoice:{choiceShapeCandidate:1}},spellcasting:{slotsByLevel:{exactTable:1}}});
  expect(report.contract).toMatchObject({structuredSkillChoice:1,declaredProfileWithoutRuntimeProgression:1});
  expect(report).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false,retirementAuthorized:false});
  expect(JSON.stringify(publicSummary(report))).not.toMatch(/Private|PRIVATE_|old-class/);
  expect(()=>buildClassMechanicsEvidence(input,{...progression,fingerprint:'invalid'})).toThrow('invalidProgressionEvidence');
  expect(()=>buildClassMechanicsEvidence({...input,rawHistorical:[{...rawHistorical[0],item:{...item,name:'changed'}}]},progression)).toThrow('historicalEvidenceMismatch');
 });
});
