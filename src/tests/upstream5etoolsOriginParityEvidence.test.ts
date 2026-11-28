import {buildPersistedCompendiumImport} from '../compendium/importer';
import {getBackgroundAbilityOptions,backgroundSuggestions} from '../characters/creationData';
import {getBackgroundProficiencyRequirement} from '../characters/proficiencyRules';
import {getSpeciesFeatureItems,getSpeciesChoiceRequirements} from '../characters/speciesChoiceRules';
import {applyCompendiumItemToCharacter} from '../compendium/mapper';
import {createEmptyCharacter} from '../data/mockData';
const {buildPilot}=require('../../scripts/5etools/origin-converter');
const {buildPilot:buildFeatures}=require('../../scripts/5etools/feature-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {compareOriginFields,buildOriginParityEvidence,publicSummary}=require('../../scripts/5etools/origin-parity-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
const weighted=[{choose:{weighted:{from:['str','dex','con'],weights:[2,1]}}},{choose:{weighted:{from:['str','dex','con'],weights:[1,1,1]}}}];
function fixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture Revised',published:'2024-09-17'},{source:'PHB',name:'Fixture Classic',published:'2014-08-19'}]},
  'data/races.json':{race:[
   {name:'Private Species',source:'XPHB',size:['S','M'],creatureTypes:['humanoid'],speed:{walk:30,fly:true},darkvision:60,languageProficiencies:[{common:true}],resist:[{choose:{from:['fire','cold']}}],entries:[{name:'Private Trait',entries:['PRIVATE_TEXT']}],additionalSpells:[{innate:{'1':['fixture|xphb']}}]},
   {name:'Private Base',source:'PHB',size:['M'],speed:30,ability:[{con:2}],entries:[]}],
   subrace:[{name:'Hill',source:'PHB',raceName:'Private Base',raceSource:'PHB',ability:[{wis:1}],entries:[]}]},
  'data/backgrounds.json':{background:[
   {name:'Private Background',source:'XPHB',ability:weighted,skillProficiencies:[{athletics:true,perception:true}],languageProficiencies:[{common:true}],feats:[{'Private Feat|XPHB':true},{anyFromCategory:{category:['O'],count:1}}],startingEquipment:[{A:[{value:500}],B:[{value:5000}]}],entries:[]},
   {name:'Private Legacy',source:'PHB',skillProficiencies:[{arcana:true},{history:true}],entries:[]}]},
  'data/feats.json':{feat:[{name:'Private Feat',source:'XPHB',category:'O',entries:['PRIVATE_TEXT']}]},
  'data/optionalfeatures.json':{optionalfeature:[]}
 };
 const snapshot={commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]};
 const items=[...buildPilot(snapshot,['PHB','XPHB']).packs.flatMap((p:any)=>p.items),...buildFeatures(snapshot,['XPHB']).packs.flatMap((p:any)=>p.items)];
 const old=[
  {id:'old-species',kind:'species',name:'Private Species',payload:{sizeOptions:['Small','Medium'],speed:{walk:30},languages:['Common'],featureIds:['old-trait']}},
  {id:'old-bg',kind:'background',name:'Private Background',payload:{abilityScoreOptions:['CON','STR','DEX'],skillProficiencies:['perception','athletics'],featIds:['old-feat']}},
  {id:'old-bg',kind:'background',name:'Private Background',payload:{abilityScoreOptions:['INT','WIS','CHA'],skillProficiencies:['History']}},
  {id:'old-missing',kind:'background',name:'Private Missing',payload:{skillProficiencies:['History']}}
 ];
 const rawHistorical=old.map((item,index)=>({path:'PRIVATE_PATH',index,item}));
 const rows=rawHistorical.map(({item,path,index})=>({path,index,id:item.id,kind:item.kind,sourceId:'phb',rulesEra:'2024',itemHash:digest(item)}));
 const reconciliation=reconcile({historical:{rows,bootstrapRows:rows},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[],items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.8.1 origin parity evidence',()=>{
 test('compares only selected fields and safe literal sets, never aliases different fields',()=>{
  const result=(kind:string,a:Record<string,unknown>,b:Record<string,unknown>)=>Object.fromEntries(compareOriginFields(kind,a,b).map((r:any)=>[r.field,r.status]));
  expect(result('background',{abilityScoreOptions:['STR','CON','DEX'],skillProficiencies:['Athletics','Perception'],languages:['Common'],featIds:['feat-1']},
   {abilityScoreOptions:['CON','DEX','STR'],skillProficiencies:['perception','athletics'],languageProficiencies:['Common']})).toMatchObject({
   abilityScoreOptions:'representationOnlyCandidate',skillProficiencies:'representationOnlyCandidate',languages:'missingCandidate',languageProficiencies:'addedCandidate',featIds:'missingCandidate'});
  expect(result('species',{sizeOptions:['Small','Medium'],speed:30,resistances:['fire','Fire']},{size:['Small','Medium'],speed:{walk:30},resistances:['fire']})).toMatchObject({
   sizeOptions:'missingCandidate',size:'addedCandidate',speed:'differentValue',resistances:'differentValue'});
 });
 test('binds exact origins, preserves variants and records grants as pending or identity candidates only',()=>{
  const f=fixture(),before=digest(f),r=buildOriginParityEvidence(f);
  expect(r.historical.species).toMatchObject({occurrences:1,identityCandidates:1,byField:{featureIds:{missingCandidate:1}}});
  expect(r.historical.background).toMatchObject({occurrences:3,identityCandidates:2,identityPending:1,byField:{abilityScoreOptions:{representationOnlyCandidate:1,differentValue:1}}});
  expect(r.upstream.species).toMatchObject({items:3,contractCodes:{sizeOptionsContractPending:1,traitFeatureLinksPending:1,spellGrantSemanticsPending:1,variantAndInheritancePending:1}});
  expect(r.upstream.background).toMatchObject({items:2,contractCodes:{standardBackgroundAbilityCandidate:1,backgroundAbilityFallbackReview:1},featEdges:{featIdentityCandidate:1,featSelectionPending:1}});
  expect(r.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
  expect(r).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
  expect(JSON.stringify(publicSummary(r))).not.toMatch(/Private|PRIVATE_|old-bg/);
  expect(digest(f)).toBe(before);
 });
 test('fails closed on stale historical records, missing coverage and altered origin identity',()=>{
  const f=fixture();
  expect(()=>buildOriginParityEvidence({...f,rawHistorical:f.rawHistorical.map(x=>({...x,item:{...x.item,name:'changed'}}))})).toThrow('historicalBindingMismatch');
  expect(()=>buildOriginParityEvidence({...f,reconciliation:{...f.reconciliation,historical:f.reconciliation.historical.slice(1)}})).toThrow('historicalCoverageMismatch');
  expect(()=>buildOriginParityEvidence({...f,items:f.items.map((x:any)=>x.name==='Private Species'?{...x,provenance:{...x.provenance,commit:'c'.repeat(40)}}:x)})).toThrow('originSourceBindingMismatch');
  expect(()=>buildOriginParityEvidence({...f,items:f.items.map((x:any)=>x.name==='Private Species'?{...x,payload:{...x.payload,speed:40}}:x)})).toThrow('targetBindingMismatch');
 });
 test('actual legacy readers expose fallback and field contract gaps on disposable imports',()=>{
  const source={id:'fixture',book:'Fixture',version:'2024',status:'active' as const,confidence:'exact' as const};
  const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[
   {id:'fixture-bg',kind:'background',name:'Fixture Background',source,payload:{languageProficiencies:['Common']}},
   {id:'fixture-species',kind:'species',name:'Fixture Species',source,payload:{size:['Small','Medium'],speed:30,abilityScoreIncrease:[{abilities:['STR'],amount:2}],mechanics:{namedTraits:[{name:'Fixture Trait',entry:{name:'Fixture Trait',entries:['fixture']}}]}}}
  ]});
  const bg=pack.items.find(i=>i.type==='background'),species=pack.items.find(i=>i.type==='species');
  if(!bg||!species)throw Error('missing fixture');
  expect(getBackgroundAbilityOptions(bg)).toHaveLength(6);
  expect(getBackgroundProficiencyRequirement(bg)?.toolChoiceCount).toBe(1);
  expect(backgroundSuggestions(bg).proficiencies.languages).toEqual([]);
  expect(getSpeciesFeatureItems(species,pack.items)).toEqual([]);
  expect(getSpeciesChoiceRequirements(species,pack.items,1).some(r=>r.kind==='size')).toBe(false);
  const original=createEmptyCharacter('Fixture'),before=digest(original);
  const result=applyCompendiumItemToCharacter(original,species);
  expect(result.ok).toBe(true);
  expect(result.character.abilities).toEqual(original.abilities);
  expect(digest(original)).toBe(before);
 });
});
