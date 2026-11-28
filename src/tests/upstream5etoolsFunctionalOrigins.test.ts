import {stageImportV3} from '../compendium/importV3Staging';
const {buildFunctionalOriginFeatures}=require('../../scripts/5etools/functional-origin-feature-converter');
const source='NEW',blob='b'.repeat(40);
function fixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source,name:'Fixture',published:'2025-01-01'}]},
  'data/races.json':{race:[{name:'Fixture Species',source,edition:'classic',size:['M'],speed:30,creatureTypes:['humanoid'],entries:[{name:'Trait',entries:['Fixture']}],_versions:[{name:'Unexpanded'}]}],subrace:[{name:'Branch',source,raceName:'Fixture Species',raceSource:source,edition:'classic',entries:[{name:'Branch Trait',entries:['Fixture']}]}]},
  'data/backgrounds.json':{background:[{name:'Fixture Background',source,edition:'one',ability:[{choose:{weighted:{from:['str','dex','con'],weights:[2,1]}}},{choose:{weighted:{from:['str','dex','con'],weights:[1,1,1]}}}],feats:{},skillProficiencies:[{athletics:true}]}]},
  'data/feats.json':{feat:[{name:'Fixture Feat',source,edition:'one',category:'G',entries:['Fixture'],prerequisite:[{level:4,ability:[{str:13}]}]}]},
  'data/optionalfeatures.json':{optionalfeature:[{name:'Fixture Invocation',source,featureType:['EI'],entries:['Fixture'],additionalSpells:[{known:['fixture|new']}]},{name:'Broken',source,entries:['Fixture']}]},
  'data/conditionsdiseases.json':{condition:[{name:'Fixture Condition',source,entries:['Fixture']},{name:'Exhaustion',source:'XPHB',entries:['Fixture']}],status:[{name:'Fixture Status',source,entries:['Fixture']}],disease:[{name:'Fixture Disease',source,entries:['Fixture']}]}
 };
 return {commit:'a'.repeat(40),files:new Map(Object.keys(data).map(p=>[p,blob])),readJson:(p:string)=>data[p]};
}
const pick=(path:string,kind:string,index=0,code=source)=>({path,kind,index,sourceId:JSON.stringify(['main',code])});
const selections=()=>[pick('data/races.json','race'),pick('data/races.json','subrace'),pick('data/backgrounds.json','background'),pick('data/feats.json','feat'),pick('data/optionalfeatures.json','optionalfeature'),pick('data/optionalfeatures.json','optionalfeature',1),pick('data/conditionsdiseases.json','condition'),pick('data/conditionsdiseases.json','condition',1,'XPHB')];
describe('functional Main origins, feats, optional features and conditions',()=>{
 test('converts non-pilot sources, retains grants and edition distinctions, preserves root denominator',()=>{
  const r=buildFunctionalOriginFeatures(fixture(),selections());
  expect(r.origins.counts.NEW).toMatchObject({total:3,converted:3,blocked:0});
  expect(r.features.counts.NEW).toMatchObject({total:3,converted:2,blocked:1,blockCodes:{invalidFeatureType:1}});
  expect(r.conditions.counts.NEW).toMatchObject({total:1,converted:1,blocked:0});
  const origins=r.origins.packs[0].items,features=r.features.packs[0].items;
  const species=origins.find((i:any)=>i.name==='Fixture Species'),branch=origins.find((i:any)=>i.name==='Fixture Species (Branch)'),background=origins.find((i:any)=>i.kind==='background');
  expect(species.payload.mechanics.versions).toHaveLength(1);
  expect(branch.payload.mechanics.parent).toMatchObject({source:'NEW',index:0,blob});
  expect(background.payload.abilityScoreOptions).toEqual(['STR','DEX','CON']);
  expect(background.source.rulesEra).toBe('2024');
  expect(features.find((i:any)=>i.kind==='feat').payload.prerequisite).toMatchObject({level:4,abilities:{STR:13}});
  expect(features.find((i:any)=>i.kind==='feature').payload.sourceType).toBe('eldritchInvocation');
  const custom=r.conditions.packs.find((p:any)=>p.source.id==='upstream:main:NEW').items[0];
  expect(custom.payload.officialCondition).toBeUndefined();
  expect(custom.payload.mechanics.runtimeConditionCandidate).toBeUndefined();
  expect(custom.metadata.reviewCodes).toContain('conditionClassificationPending');
  const core=r.conditions.packs.find((p:any)=>p.source.id==='upstream:main:XPHB').items[0];
  expect(core.payload.officialCondition).toBe(true);
  expect(core.payload.mechanics.conditionReviewCandidate.stackPolicy).toBe('editionSpecificPending');
  for(const group of [r.origins,r.features,r.conditions])for(const p of group.packs)expect(stageImportV3(p).ok).toBe(true);
  expect(buildFunctionalOriginFeatures(fixture(),selections())).toEqual(r);
 });
 test('does not emit unselected parent or treat status/disease as conditions',()=>{
  const r=buildFunctionalOriginFeatures(fixture(),[pick('data/races.json','subrace')]);
  expect(r.origins.packs[0].items).toHaveLength(1);
  expect(r.origins.packs[0].items[0].metadata.reviewCodes).toContain('subraceParentNotSelected');
  expect(r.conditions.packs).toEqual([]);
  expect(()=>buildFunctionalOriginFeatures(fixture(),[pick('data/conditionsdiseases.json','status')])).toThrow('functionalOriginSelectionInvalid');
  expect(()=>buildFunctionalOriginFeatures(fixture(),[pick('data/feats.json','feat',0,'OTHER')])).toThrow('functionalOriginSelectionSourceMismatch');
  expect(()=>buildFunctionalOriginFeatures(fixture(),[pick('data/feats.json','feat',2)])).toThrow('functionalOriginSelectionCoordinateMissing');
 });
});
