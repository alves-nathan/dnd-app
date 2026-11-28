export {};
const {buildPilot}=require('../../scripts/5etools/spell-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildSpellParityEvidence}=require('../../scripts/5etools/spell-parity-evidence');
const {buildSpellLifecycleProjection,publicSummary,concentrationDC,previewSpellLifecycle}=require('../../scripts/5etools/spell-lifecycle-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(rulesEra:'2014'|'2024'='2024'){
 const source=rulesEra==='2024'?'XPHB':'PHB';
 const base={name:'Private Focus',source,level:1,school:'V',time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},duration:[{type:'timed',duration:{type:'minute',amount:10},concentration:true}],components:{v:true,s:true},entries:['PRIVATE_TEXT']};
 const spells=[base,{...base,name:'Private Second'},{...base,name:'Private Fixed',duration:[{type:'timed',duration:{type:'hour',amount:1}}]},
  {...base,name:'Private Instant',duration:[{type:'instant'}]},{...base,name:'Private Permanent',duration:[{type:'permanent',ends:['dispel']}]}];
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source,name:'Fixture',published:'2024-09-17'}]},
  'data/spells/index.json':{[source]:'spells-fixture.json'},'data/spells/spells-fixture.json':{spell:spells},
  'data/generated/gendata-spell-source-lookup.json':{[source.toLowerCase()]:Object.fromEntries(spells.map(s=>[s.name.toLowerCase(),{class:{[source]:{Wizard:true}}}]))}
 };
 const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},[source]).packs[0].items;
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={items,rawHistorical:[],reconciliation},evidence=buildSpellParityEvidence(input),projection=buildSpellLifecycleProjection(input,evidence);
 const row=(name:string)=>{const i=items.find((x:any)=>x.name==='Private '+name);if(!i)throw Error('missing item');return projection.rows.find((r:any)=>r.itemId===i.id);};
 const group=(name:string,castId:string,casterId:string,extra:Record<string,unknown>={})=>{
  const r=row(name);return {castId,casterId,spellId:r.itemId,sourceFingerprint:r.sourceFingerprint,rulesEra,status:'active',concentration:r.concentration==='required',unit:r.duration.unit,remaining:r.duration.maximum,
   recipients:[{effectId:castId+'-a',recipientId:'a'},{effectId:castId+'-b',recipientId:'b'}],...extra};
 };
 const groups=[group('Focus','first','caster'),group('Focus','other','other-caster'),group('Fixed','fixed','caster')];
 const preview=(event:Record<string,unknown>,extra:Record<string,unknown>={})=>previewSpellLifecycle(input,{inventoryComplete:true,dependenciesComplete:true,baseRulesConfirmed:true,projectionFingerprint:projection.fingerprint,groups,event:{confirmed:true,...event},...extra});
 const start=(name:string)=>{const r=row(name);return {kind:'start',castId:'new',casterId:'caster',spellId:r.itemId,sourceFingerprint:r.sourceFingerprint,rulesEra,
  recipients:[{effectId:'new-a',recipientId:'a'}],castCompletedConfirmed:true,stackingConfirmed:true,recipientMembershipConfirmed:true,casterCanMaintainConfirmed:true};};
 return {input,evidence,projection,row,groups,group,preview,start,rulesEra};
}
describe('a8.7.4 spell lifecycle projection',()=>{
 test('source duration and concentration evidence is exact; instantaneous and permanent are not finite effects',()=>{
  const f=fixture(),before=digest(f.input);
  expect(f.projection.summary).toEqual({items:5,duration:{durationCandidate:3,instantaneous:1,terminationPending:1},concentration:{required:2,notRequired:2,pending:1}});
  expect(f.row('Focus').duration).toMatchObject({unit:'minute',maximum:10,concentration:true,upTo:true});
  expect(f.preview(f.start('Instant')).reason).toBe('finiteDurationDefinitionRequired');
  expect(f.preview(f.start('Permanent')).reason).toBe('finiteDurationDefinitionRequired');
  expect(()=>buildSpellLifecycleProjection(f.input,{...f.evidence,fingerprint:'changed'})).toThrow('spellEvidenceMismatch');
  expect(JSON.stringify(publicSummary(f.projection))).not.toMatch(/Private|PRIVATE_TEXT|upstream:main:spell:/);
  expect(digest(f.input)).toBe(before);
 });
 test('concentration DC uses floor and edition-specific cap, zero damage needs no check',()=>{
  for(const rulesEra of ['2014','2024']){
   expect(concentrationDC(rulesEra,0).status).toBe('noCheckRequired');
   expect(concentrationDC(rulesEra,1)).toMatchObject({status:'checkRequired',ability:'CON',dc:10});
   expect(concentrationDC(rulesEra,25).dc).toBe(12);
  }
  expect(concentrationDC('2014',81).dc).toBe(40);
  expect(concentrationDC('2024',81).dc).toBe(30);
  for(const v of [-1,1.5,NaN])expect(concentrationDC('2024',v).status).toBe('indeterminate');
  expect(concentrationDC('unknown',10).status).toBe('indeterminate');
 });
 test('replacement ends the entire old cast group, not unrelated caster or nonconcentration effects',()=>{
  const f=fixture(),before=digest(f.groups);
  expect(f.preview(f.start('Second')).reason).toBe('concentrationReplacementBoundaryPending');
  const r=f.preview({...f.start('Second'),replacementBoundaryConfirmed:true});
  expect(r).toMatchObject({status:'lifecycleCandidate',writeAuthorized:false,changes:[{castId:'first',status:'ended',reason:'concentrationReplaced',effectIds:['first-a','first-b']},{castId:'new',status:'active'}]});
  expect(r.groups.slice(1,3)).toEqual(f.groups.slice(1,3));
  expect(r.groups[3]).toMatchObject({castId:'new',remaining:10,concentration:true});
  expect(f.preview(f.start('Fixed')).changes).toEqual([expect.objectContaining({castId:'new',status:'active'})]);
  expect(digest(f.groups)).toBe(before);
 });
 test('elapsed time is explicit and unit scoped; rest defaults and implicit ticks are prohibited',()=>{
  const f=fixture();
  expect(f.preview({kind:'elapsed',castId:'first',unit:'round',amount:1,clockConfirmed:true}).reason).toBe('explicitClockPending');
  const r=f.preview({kind:'elapsed',castId:'first',unit:'minute',amount:4,clockConfirmed:true});
  expect(r.groups[0]).toMatchObject({remaining:6,status:'active'});
  expect(f.preview({kind:'elapsed',castId:'first',unit:'minute',amount:10,clockConfirmed:true})).toMatchObject({changes:[{castId:'first',status:'expired',effectIds:['first-a','first-b']}]});
  expect(f.preview({kind:'longRest',casterId:'caster',rulesEra:'2024'}).reason).toBe('unsupportedLifecycleEvent');
  expect(f.preview({kind:'end',castId:'fixed'}).reason).toBe('terminationPolicyPending');
  expect(f.preview({kind:'end',castId:'fixed',terminationPolicyConfirmed:true}).groups[2].status).toBe('ended');
 });
 test('one confirmed damage event requests a CON save; failure, death and incapacity end only relevant concentration',()=>{
  for(const rulesEra of ['2014','2024'] as const){
   const f=fixture(rulesEra),base={kind:'damage',casterId:'caster',rulesEra,damage:81,damageTakenConfirmed:true,singleDamageEventConfirmed:true};
   const dc=rulesEra==='2014'?40:30;
   expect(f.preview(base)).toMatchObject({status:'concentrationSaveRequired',castId:'first',check:{dc,ability:'CON'}});
   expect(f.preview({...base,saveTotal:dc,saveTotalConfirmed:true})).toMatchObject({concentrationStatus:'maintained',changes:[]});
   expect(f.preview({...base,saveTotal:dc-1,saveTotalConfirmed:true})).toMatchObject({concentrationStatus:'ended',changes:[{castId:'first',reason:'concentrationSaveFailed',effectIds:['first-a','first-b']}]});
   expect(f.preview({...base,damage:0})).toMatchObject({concentrationStatus:'maintained',changes:[]});
   expect(f.preview({...base,singleDamageEventConfirmed:false}).reason).toBe('damageEventPending');
   for(const kind of ['incapacitated','death','dropConcentration'])expect(f.preview({kind,casterId:'caster',rulesEra})).toMatchObject({concentrationStatus:'ended',changes:[{castId:'first',reason:kind}]});
   expect(f.preview({kind:'externalSave',casterId:'caster',rulesEra,dc:10}).reason).toBe('externalSavePolicyPending');
  }
 });
 test('rejects duplicate concentration, effect identity collisions, stale evidence and unknown context',()=>{
  const f=fixture(),event={kind:'death',casterId:'caster',rulesEra:'2024'};
  expect(f.preview(event,{groups:[...f.groups,f.group('Second','duplicate','caster')]}).reason).toBe('castInventoryBindingPending');
  expect(f.preview(event,{groups:[...f.groups,f.group('Second','duplicate','new-caster',{recipients:[{effectId:'first-a',recipientId:'x'}]})]}).reason).toBe('castInventoryBindingPending');
  expect(f.preview(event,{projectionFingerprint:'stale'}).reason).toBe('projectionFingerprintMismatch');
  expect(f.preview(event,{dependenciesComplete:false}).reason).toBe('explicitLifecycleContextRequired');
  expect(f.preview({...event,rulesEra:'2014'}).reason).toBe('concentrationEditionPending');
  expect(f.preview(event,{groups:[{...f.groups[0],remaining:11}]}).reason).toBe('castInventoryBindingPending');
 });
});
