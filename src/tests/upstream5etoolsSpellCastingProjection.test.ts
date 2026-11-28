export {};
const {buildPilot}=require('../../scripts/5etools/spell-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildSpellParityEvidence}=require('../../scripts/5etools/spell-parity-evidence');
const {timing,range,components,buildSpellCastingProjection,publicSummary,previewCastingRequirements}=require('../../scripts/5etools/spell-casting-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const base={name:'Private Ray',source:'XPHB',level:1,school:'V',time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},duration:[{type:'instant'}],components:{v:true,s:true},entries:['PRIVATE_TEXT']};
 const spells=[base,
  {...base,name:'Private Ritual',time:[{number:10,unit:'minute'}],meta:{ritual:true},range:{type:'point',distance:{type:'touch'}},components:{v:true,m:{text:'PRIVATE_MATERIAL',cost:2500,consume:true}}},
  {...base,name:'Private Area',range:{type:'cone',distance:{type:'feet',amount:15}},components:{s:true,m:'PRIVATE_FOCUS'}},
  {...base,name:'Private Reaction',time:[{number:1,unit:'reaction',condition:'PRIVATE_TRIGGER'},{number:1,unit:'action'}]},
  {...base,name:'Private Optional',components:{m:{text:'PRIVATE_MATERIAL',cost:100,consume:'optional'}}}];
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-09-17'}]},
  'data/spells/index.json':{XPHB:'spells-xphb.json'},'data/spells/spells-xphb.json':{spell:spells},
  'data/generated/gendata-spell-source-lookup.json':{xphb:Object.fromEntries(spells.map(s=>[s.name.toLowerCase(),{class:{XPHB:{Wizard:true}}}]))}
 };
 const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={items,rawHistorical:[],reconciliation},evidence=buildSpellParityEvidence(input),projection=buildSpellCastingProjection(input,evidence);
 const row=(name:string)=>{const item=items.find((i:any)=>i.name==='Private '+name);if(!item)throw Error('fixture item missing');const r=projection.rows.find((x:any)=>x.itemId===item.id);if(!r)throw Error('fixture row missing');return r;};
 const request=(name:string,extra:Record<string,unknown>={})=>({contextComplete:true,casterId:'caster',rulesEra:'2024',spellId:row(name).itemId,
  projectionFingerprint:projection.fingerprint,timeAlternativeIndex:0,ritual:false,timingAvailableConfirmed:true,
  anchor:{id:'origin',kind:'point',distanceFeet:30},anchorEligibilityConfirmed:true,
  targeting:{policyConfirmed:true,membershipComplete:true,eligibilityConfirmed:true,min:0,max:3,ids:['target']},
  components:{verbalAvailableConfirmed:true,somaticAvailableConfirmed:true},...extra});
 const preview=(name:string,extra:Record<string,unknown>={})=>previewCastingRequirements(input,request(name,extra));
 return {input,evidence,projection,row,request,preview};
}
describe('a8.7.2 spell casting requirements projection',()=>{
 test('retains explicit action and duration alternatives and rejects unsupported timing detail',()=>{
  expect(timing([{number:1,unit:'reaction',condition:'trigger'},{number:10,unit:'minute'}],true)).toMatchObject({status:'timingCandidates',ritual:true,alternatives:[{actionCost:'reaction',triggerRequired:true},{status:'durationCandidate',amount:10,unit:'minute'}]});
  expect(timing([{number:1,unit:'bonus',condition:'trigger'}],false).alternatives[0]).toMatchObject({actionCost:'bonusAction',triggerRequired:true});
  for(const t of [{number:1,unit:'reaction'},{number:2,unit:'action'},{number:1,unit:'action',note:'exception'}])expect(timing([t],false).status).toBe('timingAlternativesPending');
 });
 test('distinguishes exact point distance, self area and context-only ranges',()=>{
  expect(range({type:'point',distance:{type:'miles',amount:2}})).toEqual({status:'pointDistanceCandidate',feet:10560});
  expect(range({type:'sphere',distance:{type:'feet',amount:15}})).toMatchObject({status:'selfAreaCandidate',extentFeet:15,geometryPending:true});
  expect(range({type:'point',distance:{type:'touch'}})).toEqual({status:'pointContextCandidate',kind:'touch'});
  expect(range({type:'special'}).status).toBe('specialRangePending');
  expect(range({type:'point',distance:{type:'feet',amount:-1}}).status).toBe('rangePending');
 });
 test('material cost and consumption are separate; absent metadata is not false',()=>{
  expect(components({v:true,m:{text:'material',cost:2500,consume:true}})).toMatchObject({status:'componentCandidate',verbal:true,somatic:false,material:true,materialRequirement:{costStatus:'explicitCopperCandidate',costCopper:2500,consumption:'required'}});
  expect(components({m:'material'}).materialRequirement).toMatchObject({costStatus:'notDeclared',consumption:'notDeclared'});
  expect(components({m:{text:'material',consume:false}}).materialRequirement.consumption).toBe('explicitFalse');
  expect(components({m:{text:'material',consume:'optional'}}).materialRequirement.consumption).toBe('optionalPending');
  for(const c of [{v:'true'},{m:{text:'material',cost:-1}},{m:{text:'material',consume:2}},{m:{text:'material',extra:true}}])expect(components(c).status).toBe('componentsPending');
 });
 test('checks explicit trigger and timing policy, never converts duration to an action',()=>{
  const f=fixture();
  expect(f.preview('Reaction').reason).toBe('castingTriggerPending');
  expect(f.preview('Reaction',{triggerConfirmed:true})).toMatchObject({status:'castingRequirementsCandidate',timing:{actionCost:'reaction',triggerRequired:true},writeAuthorized:false});
  expect(f.preview('Reaction',{timeAlternativeIndex:1})).toMatchObject({status:'castingRequirementsCandidate',timing:{actionCost:'action'}});
  expect(f.preview('Ray',{ritual:true,ritualPolicyConfirmed:true}).reason).toBe('ritualNotDeclared');
  expect(f.preview('Ritual',{ritual:true}).reason).toBe('ritualTimingAndAccessPending');
  const m=f.row('Ritual').components.materialRequirement;
  const extra={ritual:true,ritualPolicyConfirmed:true,anchor:{id:'target',kind:'creature',touchConfirmed:true},components:{verbalAvailableConfirmed:true,material:{kind:'specific',requirementFingerprint:m.fingerprint,accessibleConfirmed:true,inventoryItemId:'material',identityConfirmed:true,valuationConfirmed:true,valueCopper:2500,consumptionAvailabilityConfirmed:true}}};
  expect(f.preview('Ritual',extra)).toMatchObject({status:'castingRequirementsCandidate',timing:{status:'durationCandidate',amount:10,unit:'minute',additionalMinutesCandidate:10},material:{kind:'specific',requiredValueCopper:2500,consumption:'required'}});
  expect(f.preview('Ritual',{...extra,anchor:{id:'target',kind:'creature'}}).reason).toBe('touchContextRequired');
  expect(f.preview('Ritual',{...extra,components:{...extra.components,material:{...extra.components.material,valueCopper:2499}}}).reason).toBe('materialValueInsufficient');
  expect(f.preview('Ritual',{...extra,components:{...extra.components,material:{...extra.components.material,kind:'focus',focusId:'focus'}}}).reason).toBe('specificMaterialRequired');
  expect(f.preview('Ritual',{...extra,components:{...extra.components,material:{...extra.components.material,consumptionAvailabilityConfirmed:false}}}).reason).toBe('materialConsumptionAvailabilityPending');
 });
 test('checks anchor independently of target membership, never assumes one target or area geometry',()=>{
  const f=fixture();
  expect(f.preview('Ray',{anchor:{id:'point',kind:'point',distanceFeet:61}}).reason).toBe('anchorOutOfRange');
  expect(f.preview('Ray',{targeting:undefined}).reason).toBe('targetPolicyAndMembershipRequired');
  const target={policyConfirmed:true,membershipComplete:true,eligibilityConfirmed:true,min:0,max:3,ids:[]};
  expect(f.preview('Ray',{targeting:target})).toMatchObject({status:'castingRequirementsCandidate',targetCount:0});
  expect(f.preview('Ray',{targeting:{...target,min:1}}).reason).toBe('targetCountOutsideConfirmedPolicy');
  expect(f.preview('Ray',{targeting:{...target,ids:['x','x']}}).reason).toBe('targetPolicyAndMembershipRequired');
  expect(f.preview('Area').reason).toBe('selfOriginRequired');
  const anchor={id:'caster',kind:'caster'};
  expect(f.preview('Area',{anchor}).reason).toBe('areaGeometryPending');
  const m=f.row('Area').components.materialRequirement;
  const extra={anchor,targeting:{...target,geometryConfirmed:true,ids:['a','b']},components:{somaticAvailableConfirmed:true,material:{kind:'focus',focusId:'focus',accessibleConfirmed:true,requirementFingerprint:m.fingerprint,substitutionPolicyConfirmed:true}}};
  expect(f.preview('Area',extra)).toMatchObject({status:'castingRequirementsCandidate',targetCount:2,material:{kind:'focus'}});
  expect(f.preview('Area',{...extra,components:{...extra.components,material:{...extra.components.material,substitutionPolicyConfirmed:false}}}).reason).toBe('focusSubstitutionPolicyPending');
 });
 test('binds complete evidence and returns aggregate only, rejects stale or incomplete context',()=>{
  const f=fixture(),before=digest(f.input);
  expect(f.projection.summary.items).toBe(5);
  expect(f.projection.rows.every((r:any)=>!r.runtimeEligible&&!r.writeAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(f.projection))).not.toMatch(/Private|PRIVATE_|upstream:main:spell:/);
  expect(()=>buildSpellCastingProjection(f.input,{...f.evidence,fingerprint:'stale'})).toThrow('spellEvidenceMismatch');
  expect(f.preview('Ray',{projectionFingerprint:'stale'}).reason).toBe('projectionFingerprintMismatch');
  expect(f.preview('Ray',{rulesEra:'2014'}).reason).toBe('spellIdentityOrEditionPending');
  expect(f.preview('Ray',{components:{verbalAvailableConfirmed:false,somaticAvailableConfirmed:true}}).reason).toBe('verbalAvailabilityPending');
  const m=f.row('Optional').components.materialRequirement;
  expect(f.preview('Optional',{components:{material:{kind:'specific',requirementFingerprint:m.fingerprint,accessibleConfirmed:true}}}).reason).toBe('optionalConsumptionSemanticsPending');
  expect(digest(f.input)).toBe(before);
 });
});
