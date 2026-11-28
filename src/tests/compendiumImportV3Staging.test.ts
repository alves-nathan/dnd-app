import { compendiumImportV3Schema, IMPORT_V3_CONTRACT_REVISION } from '../compendium/importV3Schemas';
import { stageImportV3, validateV3Precedence, projectV3ToV2ForValidation } from '../compendium/importV3Staging';
import { analyzeCompendiumImportV2Semantics } from '../compendium/importSemanticValidation';
import { detectCompendiumImportVersion } from '../compendium/importVersion';
import { IMPORT_TEMPLATE_VERSION_V3 } from '../compendium/importVersions';

const source = {
  id:'fixture', status:'active', confidence:'exact', rulesEra:'2024', contentType:'official',
  precedenceScope:'official-dnd',publication:{precision:'day',date:'2024-09-17',year:2024,evidence:'fixture'}
};
const makeItem = (id='spell-a') => ({
  id,kind:'spell',name:'Fixture Spell',source,
  identity:{canonicalKey:'spell:fixture',precedenceScope:'official-dnd'},
  precedence:{relation:'original',supersedes:[],reprints:[],coexistsWith:[],basis:'fixture'},
  provenance:{origin:'5etools',repository:'fixture/repo',commit:'a'.repeat(40),blob:'b'.repeat(40),path:'data/spells/test.json',
    sourceCode:'Fixture',entityKey:'spell:fixture',index:0,resolverVersion:'a3',lineage:[]},
  payload:{level:0,classes:['Wizard'],castingTime:{kind:'action',actionCost:'action'},damageFormula:'1d6',damageType:'fire'}
});
const pack = (items:unknown[] = [makeItem()]) => ({
  templateVersion:IMPORT_TEMPLATE_VERSION_V3,contractRevision:IMPORT_V3_CONTRACT_REVISION,id:'fixture-pack',source,items
});
describe('canonical V3 staging', () => {
  test('retains typed mechanical payload and immutable origin while forcing review in projection', () => {
    const result = stageImportV3(pack());
    expect(result.ok).toBe(true);
    expect(result.activation).toBe('review-required');
    if (!('projection' in result) || !result.projection) throw Error('missing projection');
    expect(result.projection.items[0].payload).toEqual(makeItem().payload);
    expect(result.projection.items[0].source.status).toBe('needsReview');
    expect(result.projection.items[0].metadata?.v3).toMatchObject({provenance:makeItem().provenance,identity:makeItem().identity});
    expect(makeItem().source.status).toBe('active');
  });
  test('rejects old historical V3, invalid mechanical payloads and invalid publication dates', () => {
    const {contractRevision,...historical} = pack();
    expect(compendiumImportV3Schema.safeParse(historical).success).toBe(false);
    expect(stageImportV3(pack([{...makeItem(),payload:{level:10}}])).ok).toBe(false);
    expect(stageImportV3({...pack(),source:{...source,publication:{...source.publication,date:'2024-02-30'}}}).ok).toBe(false);
    expect(stageImportV3({...pack(),source:{...source,publication:{...source.publication,year:2025}}}).ok).toBe(false);
    expect(detectCompendiumImportVersion(pack())).toBe('unknown');
  });
  test('does not waive the runtime requirement for class access', () => {
    expect(stageImportV3(pack([{...makeItem(),payload:{...makeItem().payload,classes:[]}}])).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({code:'IMPORT_V2_SPELL_CLASSES_EMPTY'})]));
  });
  test('rejects invalid provenance and reserved metadata', () => {
    expect(stageImportV3(pack([{...makeItem(),provenance:{...makeItem().provenance,commit:'main'}}])).ok).toBe(false);
    expect(stageImportV3(pack([{...makeItem(),provenance:{...makeItem().provenance,path:'../escape.json'}}])).ok).toBe(false);
    expect(stageImportV3(pack([{...makeItem(),metadata:{v3:{}}}])).ok).toBe(false);
  });
  test('preserves editions and warns on unresolved external relations', () => {
    const legacy = {...makeItem(),source:{...source,rulesEra:'2014'},precedence:{...makeItem().precedence,relation:'reprint',reprints:['old-id']}};
    const result = stageImportV3(pack([legacy]));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'V3_EXTERNAL_PRECEDENCE'})]));
    if (!('projection' in result) || !result.projection) throw Error('missing projection');
    expect(result.projection.items[0].source.rulesEra).toBe('legacy');
  });
  test('blocks cross-edition supersedes, cross-scope and cycles', () => {
    const a = {...makeItem('a'),precedence:{...makeItem().precedence,relation:'supersedes',supersedes:['b']}};
    const b = {...makeItem('b'),source:{...source,rulesEra:'2014'}};
    expect(stageImportV3(pack([a,b])).issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'V3_CROSS_ERA_SUPERSEDES'})]));
    const cycle = {...makeItem('b'),precedence:{...makeItem().precedence,relation:'supersedes',supersedes:['a']}};
    const parsed = compendiumImportV3Schema.parse(pack([a,cycle]));
    expect(validateV3Precedence(parsed)).toEqual(expect.arrayContaining([expect.objectContaining({code:'V3_SUPERSEDES_CYCLE'})]));
    expect(stageImportV3(pack([a,{...makeItem('b'),source:{...source,precedenceScope:'other'},identity:{...makeItem().identity,precedenceScope:'other'}}])).ok).toBe(false);
  });
  test('rejects duplicate physical IDs and preserves disabled state', () => {
    expect(stageImportV3(pack([makeItem(),makeItem()])).ok).toBe(false);
    const result = stageImportV3(pack([{...makeItem(),source:{...source,status:'disabled'}}]));
    if (!('projection' in result) || !result.projection) throw Error('missing projection');
    expect(result.projection.items[0].source.status).toBe('disabled');
  });
});

test('accepts explicit alternative-only spell grants solely in a V3 upstream review pack',()=>{
  const reviewSource={...source,status:'needsReview'};
  const item={...makeItem(),source:reviewSource,
    provenance:{...makeItem().provenance,repository:'5etools-mirror-3/5etools-src'},
    metadata:{reviewCodes:['alternativeSpellAccessPending']},
    payload:{...makeItem().payload,classes:[],mechanics:{upstreamSpell:{
      selectedClassAccess:[],access:{subclass:{PHB:{Fixture:true}},feat:{NEW:{Fixture:true}}},
      accessPolicy:{status:'alternativeGrantReviewPending',directClassAccess:'notObserved',alternativeKinds:['feat','subclass']}
    }}}};
  const reviewPack={...pack([item]),source:reviewSource,metadata:{activation:'review-required'}};
  const result=stageImportV3(reviewPack);
  expect(result.ok).toBe(true);
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({severity:'warning',code:'V3_ALTERNATIVE_SPELL_ACCESS_REVIEW_REQUIRED'})]));
  expect(result.activation).toBe('review-required');
  const projection=projectV3ToV2ForValidation(compendiumImportV3Schema.parse(reviewPack));
  expect(analyzeCompendiumImportV2Semantics(projection).valid).toBe(false);
  expect(stageImportV3({...reviewPack,source}).ok).toBe(false);
  expect(stageImportV3({...reviewPack,metadata:{}}).ok).toBe(false);
  expect(stageImportV3({...reviewPack,items:[{...item,source}]}).ok).toBe(false);
  expect(stageImportV3({...reviewPack,items:[{...item,provenance:{origin:'manual',reference:'fixture'}}]}).ok).toBe(false);
  expect(stageImportV3({...reviewPack,items:[{...item,payload:{...item.payload,classIds:['invented']}}]}).ok).toBe(false);
  expect(stageImportV3({...reviewPack,items:[{...item,metadata:{reviewCodes:[]}}]}).ok).toBe(false);
  const upstream=item.payload.mechanics.upstreamSpell;
  for(const access of [{},{feat:{}},{feat:{NEW:{Fixture:true}}},{...upstream.access,class:{PHB:{Wizard:true}}}]){
    expect(stageImportV3({...reviewPack,items:[{...item,payload:{...item.payload,mechanics:{upstreamSpell:{...upstream,access}}}}]}).ok).toBe(false);
  }
  expect(stageImportV3({...reviewPack,items:[{...item,payload:{...item.payload,level:0,consumesSpellSlot:true}}]}).ok).toBe(false);
});
