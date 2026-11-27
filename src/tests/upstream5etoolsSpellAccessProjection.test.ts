import type {Character} from '../types';
import {reviewSpellSlotOnlyPreservation} from '../compendium/spellSlotPreservationPreview';
const {buildSpellClosureReview,previewInstantSlotBoundary}=require('../../scripts/5etools/spell-closure-review');
const {buildSpellCastingProjection}=require('../../scripts/5etools/spell-casting-projection');
const {buildSpellEffectProjection}=require('../../scripts/5etools/spell-effect-projection');
const {buildSpellLifecycleProjection}=require('../../scripts/5etools/spell-lifecycle-projection');
import {createEmptyCharacter} from '../data/mockData';
import {spendSpellSlots,applySpellSlotRest} from '../rules-engine/resources/spellSlotManager';
const {buildPilot:buildClasses}=require('../../scripts/5etools/class-converter');
const {buildPilot:buildSpells}=require('../../scripts/5etools/spell-converter');
const {buildClassProjection,previewClassBuild}=require('../../scripts/5etools/class-projection-preview');
const {buildSpellParityEvidence}=require('../../scripts/5etools/spell-parity-evidence');
const {buildSpellAccessProjection,publicSummary,previewSpellAccessAndSlot}=require('../../scripts/5etools/spell-access-projection');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
const counts=Array(20).fill(2);
function fixture(){
 const source='XPHB';
 const cl=(name:string,extra:Record<string,unknown>={})=>({name,source,hd:{number:1,faces:8},proficiency:['int','wis'],classFeatures:[],...extra});
 const table=[{colLabels:['{@filter 1st|spells|level=1}','{@filter 2nd|spells|level=2}'],rowsSpellProgression:Array.from({length:20},()=>[3,1])}];
 const base={source,level:1,school:'V',time:[{number:1,unit:'action'}],range:{type:'point',distance:{type:'feet',amount:60}},duration:[{type:'instant'}],components:{v:true},entries:['PRIVATE_TEXT']};
 const spells=[{...base,name:'Private Prepared'},{...base,name:'Private Ritual',meta:{ritual:true}},{...base,name:'Private Cantrip',level:0},{...base,name:'Private Known'},{...base,name:'Private Conditional'},{...base,name:'Private Higher',level:2},{...base,name:'Private Missing'}];
 const access:Record<string,unknown>=Object.fromEntries(spells.map(s=>[s.name.toLowerCase(),{class:{XPHB:s.name==='Private Missing'?{'Absent':true}:s.name==='Private Conditional'?{'Private Full':{definedInSource:'XPHB'}}:s.name==='Private Known'?{'Private Pact':true}:{'Private Full':true}}}]));
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source,name:'Fixture',published:'2024-09-17'}]},
  'data/class/class-fixture.json':{class:[
   cl('Private Full',{spellcastingAbility:'int',casterProgression:'full',classTableGroups:table,preparedSpellsProgression:counts,cantripProgression:counts}),
   cl('Private Pact',{spellcastingAbility:'cha',casterProgression:'pact',classTableGroups:[{colLabels:['Spell Slots','Slot Level'],rows:Array.from({length:20},()=>[2,2])}],spellsKnownProgression:counts,cantripProgression:counts}),cl('Private Martial')
  ],subclass:[{name:'Private Third',shortName:'Third',source,className:'Private Martial',classSource:source,subclassFeatures:[],casterProgression:'1/3',spellcastingAbility:'int',subclassTableGroups:table,preparedSpellsProgression:counts,cantripProgression:counts}]},
  'data/spells/index.json':{XPHB:'spells-fixture.json'},'data/spells/spells-fixture.json':{spell:spells},
  'data/generated/gendata-spell-source-lookup.json':{xphb:access}
 };
 const snapshot={commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]};
 const items=[...buildClasses(snapshot,[source]).packs[0].items,...buildSpells(snapshot,[source]).packs[0].items];
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={items,reconciliation,rawHistorical:[]},evidence=buildSpellParityEvidence(input),classes=buildClassProjection(items,commits.main),projection=buildSpellAccessProjection(input,evidence,classes);
 const item=(name:string)=>{const i=items.find((x:any)=>x.name==='Private '+name);if(!i)throw Error('missing fixture');return i;};
 const row=(name:string)=>projection.rows.find((r:any)=>r.spellId===item(name).id);
 const build={inventoryComplete:true,rulesEra:'2024',projectionFingerprint:classes.fingerprint,classes:['Full','Pact'].map(name=>({classId:item(name).id,classInstanceId:name,level:3,subclassSelectionComplete:true,spellcastingActive:true}))};
 const pools=previewClassBuild(items,commits.main,build).pools.map((p:any)=>({...p,current:1}));
 const assignment=(name:string,mode:string,classInstanceId='Full',extra:Record<string,unknown>={})=>({assignmentId:name,spellId:row(name).spellId,sourceFingerprint:row(name).sourceFingerprint,classInstanceId,mode,castAvailableConfirmed:true,...extra});
 const assignments=[assignment('Prepared','prepared'),assignment('Ritual','prepared'),assignment('Cantrip','cantrip'),assignment('Known','known','Pact')];
 const request={rulesEra:'2024',assignmentInventoryComplete:true,accessPolicyConfirmed:true,castingRequirementsConfirmed:true,classInstanceId:'Full',projectionFingerprint:projection.fingerprint,build,assignments,poolInventoryComplete:true,pools,cast:{assignmentId:'Prepared',mode:'normal',poolId:'spellcasting-shared-1',poolEligibilityConfirmed:true}};
 const preview=(extra:Record<string,unknown>={})=>previewSpellAccessAndSlot(input,{...request,...extra});
 return {input,evidence,classes,projection,row,assignment,request,preview};
}
describe('a8.7.5 spell access and slot transaction preview',()=>{
 test('binds literal direct list edges, leaves missing or conditional endpoints pending',()=>{
  const f=fixture();
  expect(f.projection.summary).toMatchObject({items:7,directEdges:7,edgeStatus:{directListCandidate:5,conditionalAccessPending:1,classEndpointPending:1}});
  expect(f.projection.rows.every((r:any)=>!r.runtimeEligible&&!r.writeAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(f.projection))).not.toMatch(/Private|PRIVATE_TEXT|upstream:main:spell:/);
  expect(()=>buildSpellAccessProjection(f.input,{...f.evidence,fingerprint:'stale'})).toThrow('spellEvidenceMismatch');
  expect(()=>buildSpellAccessProjection(f.input,f.evidence,{...f.classes,fingerprint:'stale'})).toThrow('classEvidenceMismatch');
 });
 test('separates list membership, availability and numeric preparation limits',()=>{
  const f=fixture();
  expect(f.preview()).toMatchObject({status:'spellSlotTransactionCandidate',counts:{cantrip:1,known:0,prepared:2},slotCosts:[{slotLevel:1,amount:1,poolKind:'spellcasting'}],writeAuthorized:false});
  expect(f.preview({assignments:f.request.assignments.map(a=>a.assignmentId==='Prepared'?{...a,castAvailableConfirmed:false}:a)}).reason).toBe('castAssignmentAvailabilityPending');
  expect(f.preview({assignments:[...f.request.assignments,f.assignment('Higher','prepared')]}).reason).toBe('preparationLimitExceeded');
  expect(f.preview({assignments:[f.assignment('Prepared','known')]}).reason).toBe('preparationLimitPending');
  expect(f.preview({assignments:[f.assignment('Conditional','prepared')]}).reason).toBe('qualifiedListAccessPending');
  expect(f.preview({assignments:[f.assignment('Missing','prepared')]}).reason).toBe('qualifiedListAccessPending');
 });
 test('regular and Pact pools are selected explicitly and match the existing disposable engine',()=>{
  const f=fixture(),before=digest(f.request),r=f.preview();
  const character={...createEmptyCharacter('Fixture'),spellSlots:f.request.pools};
  const spent=spendSpellSlots({character,costs:r.slotCosts});
  expect(spent.transactions).toHaveLength(1);
  expect(spent.character.spellSlots.find(p=>p.id==='spellcasting-shared-1')?.current).toBe(0);
  expect(spent.character.spellSlots.find(p=>p.id==='pact-Pact-2')?.current).toBe(1);
  const pact=f.preview({cast:{assignmentId:'Prepared',mode:'normal',poolId:'pact-Pact-2',poolEligibilityConfirmed:true}});
  expect(pact.slotCosts).toEqual([expect.objectContaining({slotLevel:2,poolKind:'pactMagic',sourceClassId:'Pact'})]);
  const p=spendSpellSlots({character,costs:pact.slotCosts}).character;
  expect(p.spellSlots.find(s=>s.id==='pact-Pact-2')?.current).toBe(0);
  expect(applySpellSlotRest(p,'shortRest').character.spellSlots.find(s=>s.id==='pact-Pact-2')?.current).toBe(2);
  expect(f.preview({classInstanceId:'Pact',cast:{assignmentId:'Known',mode:'normal',poolId:'spellcasting-shared-2',poolEligibilityConfirmed:true}})).toMatchObject({status:'spellSlotTransactionCandidate',counts:{known:1},slotCosts:[{poolKind:'spellcasting',slotLevel:2}]});
  expect(digest(f.request)).toBe(before);
  expect(r.assignments).toEqual(f.request.assignments);
 });
 test('cantrips and confirmed rituals do not spend slots; free grants remain resource-pending',()=>{
  const f=fixture();
  expect(f.preview({cast:{assignmentId:'Cantrip',mode:'normal'}})).toMatchObject({status:'spellSlotTransactionCandidate',slotCosts:[],pools:f.request.pools});
  expect(f.preview({cast:{assignmentId:'Ritual',mode:'ritual'}}).reason).toBe('ritualPolicyPending');
  expect(f.preview({cast:{assignmentId:'Ritual',mode:'ritual',ritualEligibilityConfirmed:true,ritualTimingConfirmed:true}})).toMatchObject({status:'spellSlotTransactionCandidate',slotCosts:[],pools:f.request.pools});
  expect(f.preview({cast:{assignmentId:'Prepared',mode:'ritual'}}).reason).toBe('ritualNotDeclared');
  const grant=f.assignment('Prepared','granted','Full',{grantConfirmed:true,grantId:'grant',grantEligibilityConfirmed:true});
  expect(f.preview({assignments:[grant],cast:{assignmentId:'Prepared',mode:'free',freeCastPolicyConfirmed:true}}).reason).toBe('freeCastResourceTransactionPending');
 });
 test('borrowed subclass list requires exact owner, selected subclass and explicit list policy',()=>{
  const f=fixture(),find=(kind:string)=>{const r=f.classes.rows.find((x:any)=>x.kind===kind&&(kind==='subclass'||x.profile.status==='noDeclaredProgression'));if(!r)throw Error('missing class fixture');return r;};
  const martial=find('class'),sub=find('subclass');
  const build={...f.request.build,classes:[{classId:martial.itemId,classInstanceId:'Martial',level:3,subclassSelectionComplete:true,spellcastingActive:true,subclassId:sub.itemId,subclassGrantConfirmed:true,subclassUnlockLevel:3}]};
  const pools=previewClassBuild(f.input.items,commits.main,build).pools;
  const owner=f.classes.rows.find((r:any)=>r.kind==='class'&&r.profile.progression==='fullCaster');
  const a=f.assignment('Prepared','prepared','Martial',{listOwnerClassId:owner.itemId,subclassId:sub.itemId,borrowedListConfirmed:true});
  const context={build,pools,classInstanceId:'Martial',assignments:[a]};
  expect(f.preview(context)).toMatchObject({status:'spellSlotTransactionCandidate',counts:{prepared:1}});
  expect(f.preview({...context,assignments:[{...a,borrowedListConfirmed:false}]}).reason).toBe('subclassListPolicyPending');
  expect(f.preview({...context,build:{...build,classes:[{...build.classes[0],subclassGrantConfirmed:false}]}}).reason).toBe('classBuildPending');
 });
 test('rejects insufficient and malformed pools without fallback, stale or incomplete context',()=>{
  const f=fixture();
  expect(f.preview({pools:f.request.pools.map((p:any)=>p.id==='spellcasting-shared-1'?{...p,current:0}:p)}).reason).toBe('slotUnavailable');
  expect(f.preview({pools:f.request.pools.slice(1)}).reason).toBe('slotInventoryPending');
  expect(f.preview({pools:[...f.request.pools,f.request.pools[0]]}).reason).toBe('slotPoolBindingPending');
  expect(f.preview({assignments:[f.assignment('Higher','prepared')],cast:{assignmentId:'Higher',mode:'normal',poolId:'spellcasting-shared-1',poolEligibilityConfirmed:true}}).reason).toBe('slotTooLow');
  expect(f.preview({projectionFingerprint:'stale'}).reason).toBe('projectionFingerprintMismatch');
  expect(f.preview({assignmentInventoryComplete:false}).reason).toBe('explicitSpellAccessContextRequired');
 });
});

describe('a8.7.6 spell closure and transaction preservation boundary',()=>{
 test('consolidates five reports with exact coverage, no promoted effects',()=>{
  const f=fixture(),casting=buildSpellCastingProjection(f.input,f.evidence),effects=buildSpellEffectProjection(f.input,casting),
   lifecycle=buildSpellLifecycleProjection(f.input,f.evidence),reports={parity:f.evidence,casting,effects,lifecycle,access:f.projection};
  const before=digest(reports),r=buildSpellClosureReview(reports);
  expect(r).toMatchObject({upstreamSpells:7,effectCoverage:{reviewedDefinitionCandidates:0,withoutBaseEffectCandidate:7},
   access:{directEdges:7},mechanicalParityEstablished:0,approvedMappings:0,executable:false});
  expect(JSON.stringify(r)).not.toMatch(/Private|PRIVATE_TEXT|upstream:main:spell:/);
  expect(digest(reports)).toBe(before);
  expect(()=>buildSpellClosureReview({...reports,casting:{...casting,fingerprint:'stale'}})).toThrow('spellReviewFingerprintMismatch');
  const {fingerprint,...body}=lifecycle;
  const missing={...body,rows:body.rows.slice(1)};
  expect(()=>buildSpellClosureReview({...reports,lifecycle:{...missing,fingerprint:digest(missing)}})).toThrow('spellReviewCoverageMismatch');
  const mismatched={...body,evidenceFingerprint:'other'};
  expect(()=>buildSpellClosureReview({...reports,lifecycle:{...mismatched,fingerprint:digest(mismatched)}})).toThrow('spellReviewBindingMismatch');
 });
 test('composes casting and access for the same physical spell, without claiming a complete cast',()=>{
  const f=fixture(),casting=buildSpellCastingProjection(f.input,f.evidence);
  const c={contextComplete:true,casterId:'caster',rulesEra:'2024',spellId:f.row('Prepared').spellId,projectionFingerprint:casting.fingerprint,
   timeAlternativeIndex:0,ritual:false,timingAvailableConfirmed:true,anchor:{id:'target',kind:'creature',distanceFeet:30},anchorEligibilityConfirmed:true,
   targeting:{policyConfirmed:true,membershipComplete:true,eligibilityConfirmed:true,min:1,max:1,ids:['target']},components:{verbalAvailableConfirmed:true}};
  const request={contextComplete:true,otherCostsAndEffectsExcludedConfirmed:true,casting:c,access:f.request},before=digest(request);
  const r=previewInstantSlotBoundary(f.input,request);
  expect(r).toMatchObject({status:'instantSlotBoundaryCandidate',slotCosts:[{amount:1,slotLevel:1,poolKind:'spellcasting'}],writeAuthorized:false,executable:false});
  expect(r.assignments).toEqual(f.request.assignments);
  expect(digest(request)).toBe(before);
  expect(previewInstantSlotBoundary(f.input,{...request,casting:{...c,spellId:f.row('Ritual').spellId}}).reason).toBe('castSpellBindingMismatch');
  expect(previewInstantSlotBoundary(f.input,{...request,casting:{...c,ritual:true}}).reason).toBe('castModeOrEditionMismatch');
  expect(previewInstantSlotBoundary(f.input,{...request,casting:{...c,anchor:{...c.anchor,distanceFeet:61}}}).reason).toBe('castingRequirementsPending');
  expect(previewInstantSlotBoundary(f.input,{...request,access:{...f.request,pools:f.request.pools.map((p:any)=>({...p,current:0}))}}).reason).toBe('slotOrAccessPending');
 });
 function disposable(){
  const f=fixture(),base=createEmptyCharacter('Fixture');
  const character:Character={...base,spellSlots:f.request.pools,spells:[{id:'existing-spell',name:'Existing',level:1,castingTime:'action'}],
   activeEffects:[{id:'existing-effect',name:'Existing effect',kind:'spell',sourceType:'spell',status:'active',concentration:true,duration:{unit:'round',remaining:2},createdAt:'2026-01-01T00:00:00Z'}],
   compendiumLinks:[{id:'existing-link',characterId:base.id,itemId:'stored',importItemId:'imported',packId:'pack',sourceId:'source',itemType:'spell',appliedAs:'spell',appliedEntityId:'existing-spell',appliedEntityName:'Existing',status:'active',addedAt:'2026-01-01T00:00:00Z'}],
   resources:[{id:'existing-resource',name:'Existing resource',max:3,current:1,recharge:'shortRest'}]};
  return {f,character};
 }
 test('disposable slot spend preserves spells, effects, resources, links and prior state',()=>{
  const {f,character}=disposable(),before=digest(character),plan=f.preview();
  const spent=spendSpellSlots({character,costs:plan.slotCosts});
  expect(reviewSpellSlotOnlyPreservation(character,character,spent.character,'spellcasting-shared-1')).toMatchObject({status:'slotOnlyPreservationCandidate',codes:[],unexpectedPaths:[],writeAuthorized:false});
  expect(reviewSpellSlotOnlyPreservation(character,character,character,null)).toMatchObject({status:'slotOnlyPreservationCandidate',codes:[]});
  expect(digest(character)).toBe(before);
  expect(spent.character.compendiumLinks).toEqual(character.compendiumLinks);
  expect(spent.character.activeEffects).toEqual(character.activeEffects);
 });
 test('strict preservation detects concurrent changes, unrelated mutation, wrong pool and forged transaction',()=>{
  const {f,character}=disposable(),spent=spendSpellSlots({character,costs:f.preview().slotCosts}).character;
  const altered={...spent,spells:[],activeEffects:[],compendiumLinks:[],resources:[]};
  expect(reviewSpellSlotOnlyPreservation(character,character,altered,'spellcasting-shared-1')).toMatchObject({status:'preservationBlocked',unexpectedPaths:['activeEffects','compendiumLinks','resources','spells']});
  expect(reviewSpellSlotOnlyPreservation(character,{...character,notes:'concurrent edit'},spent,'spellcasting-shared-1').codes).toContain('baseSnapshotMismatch');
  expect(reviewSpellSlotOnlyPreservation(character,character,spent,'pact-Pact-2').codes).toContain('unexpectedSlotChanges');
  expect(reviewSpellSlotOnlyPreservation(character,character,{...spent,spellSlotTransactions:[]},'spellcasting-shared-1').codes).toContain('slotHistoryMismatch');
  expect(reviewSpellSlotOnlyPreservation(character,character,{...spent,spellSlotTransactions:spent.spellSlotTransactions?.map(tx=>({...tx,amount:-2}))},'spellcasting-shared-1').codes).toContain('slotTransactionMismatch');
  const duplicate={...character,spellSlots:[...character.spellSlots,character.spellSlots[0]]};
  expect(reviewSpellSlotOnlyPreservation(duplicate,duplicate,duplicate,null).codes).toContain('invalidSlotInventory');
 });
});
