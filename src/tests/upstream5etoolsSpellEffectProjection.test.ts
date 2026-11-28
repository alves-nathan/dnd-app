export {};
const {buildPilot}=require('../../scripts/5etools/spell-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildSpellCastingProjection}=require('../../scripts/5etools/spell-casting-projection');
const {buildSpellEffectProjection,publicSummary,previewSpellEffects}=require('../../scripts/5etools/spell-effect-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'}]},
  'data/spells/index.json':{XPHB:'spells-xphb.json'},
  'data/spells/spells-xphb.json':{spell:[{name:'Fire Bolt',source:'XPHB',level:0,school:'V',time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},duration:[{type:'instant'}],components:{v:true,s:true},entries:['PRIVATE_SYNTHETIC_RULE'],damageInflict:['fire'],spellAttack:['R']}]},
  'data/generated/gendata-spell-source-lookup.json':{xphb:{'fire bolt':{class:{XPHB:{Wizard:true}}}}}
 };
 const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={items,reconciliation,rawHistorical:[]},casting=buildSpellCastingProjection(input),report=buildSpellEffectProjection(input,casting);
 return {input,casting,report};
}
describe('a8.7.3 source-bound spell effect projection',()=>{
 test('same spell name on an unreviewed snapshot never inherits mechanics',()=>{
  const f=fixture(),before=digest(f.input);
  expect(f.report).toMatchObject({counts:{snapshotPending:12},upstreamSpells:1,mechanicalParityEstablished:0,approvedMappings:0,executable:false});
  expect(f.report.rows.every((r:any)=>!r.runtimeEligible&&!r.writeAuthorized&&!r.retirementAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(f.report))).not.toMatch(/Fire Bolt|PRIVATE_SYNTHETIC_RULE|upstream:main:spell:/);
  expect(previewSpellEffects(f.input,{rulesEra:'2024',spellId:f.input.items[0].id,projectionFingerprint:f.report.fingerprint})).toMatchObject({status:'indeterminate',reason:'spellDefinitionPending'});
  expect(digest(f.input)).toBe(before);
 });
 test('rejects stale casting reports, stale projection and unknown editions',()=>{
  const f=fixture();
  expect(()=>buildSpellEffectProjection(f.input,{...f.casting,fingerprint:'stale'})).toThrow('castingEvidenceMismatch');
  expect(previewSpellEffects(f.input,{rulesEra:'2024',projectionFingerprint:'stale'}).reason).toBe('projectionFingerprintMismatch');
  expect(previewSpellEffects(f.input,{rulesEra:'unknown'}).reason).toBe('explicitEditionRequired');
 });
 test('revised snapshot identity alone cannot approve altered spell definitions',()=>{
  const f=fixture(),main='2512db75eb48ef06f6190b086a82430887906dca';
  const input={...f.input,reconciliation:{...f.input.reconciliation,commits:{...commits,main}},items:f.input.items.map((i:any)=>({...i,provenance:{...i.provenance,commit:main}}))};
  const r=buildSpellEffectProjection(input);
  expect(r.counts).toEqual({identityPending:11,definitionPending:1});
  expect(r.rows.every((x:any)=>x.status!=='baseEffectCandidate')).toBe(true);
 });
});
