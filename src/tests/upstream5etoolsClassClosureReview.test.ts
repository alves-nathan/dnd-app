import {createEmptyCharacter} from '../data/mockData';
import {buildPersistedCompendiumImport} from '../compendium/importer';
import {applyCompendiumItemToCharacter} from '../compendium/mapper';
import {applyAutomaticClassProgression} from '../compendium/classProgression';
import {createProgressionDraft,progressionOperation,commitProgressionDraft,rollbackProgressionAudit,progressionSnapshot,validateProgressionDraft} from '../characters/progressionTransaction';
import {reviewLevelOnlyPreservation} from '../compendium/levelUpPreservationPreview';
import type {Character} from '../types';
const {buildPilot}=require('../../scripts/5etools/class-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildClassProgressionEvidence}=require('../../scripts/5etools/class-progression-evidence');
const {buildClassMechanicsEvidence}=require('../../scripts/5etools/class-mechanics-evidence');
const {buildClassProjection}=require('../../scripts/5etools/class-projection-preview');
const {buildFeatureResourceEvidence}=require('../../scripts/5etools/feature-resource-evidence');
const {buildResourceProjection}=require('../../scripts/5etools/feature-resource-projection');
const {buildClassClosureReview,previewLevelGrantBoundary}=require('../../scripts/5etools/class-closure-review');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function evidenceFixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-01-01'}]},
  'data/class/class-fixture.json':{
   class:[{name:'Private Class',source:'XPHB',hd:{number:1,faces:8},proficiency:['int','wis'],
    optionalfeatureProgression:[{name:'Choice',featureType:['EI'],progression:{'1':1,'2':2}}],
    classFeatures:['Direct|Private Class|XPHB|2',{classFeature:'Annotated|Private Class|XPHB|2',gainSubclassFeature:true}]}],
   classFeature:['Direct','Annotated'].map(name=>({name,source:'XPHB',className:'Private Class',classSource:'XPHB',level:2,entries:['PRIVATE_TEXT']})),
   subclass:[{name:'Private Subclass',shortName:'Path',source:'XPHB',className:'Private Class',classSource:'XPHB',subclassFeatures:['Path Feature|Private Class|XPHB|Path|XPHB|2']}],
   subclassFeature:[{name:'Path Feature',source:'XPHB',className:'Private Class',classSource:'XPHB',subclassShortName:'Path',subclassSource:'XPHB',level:2,entries:['PRIVATE_TEXT']}]
  }};
 const items=buildPilot({commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]},['XPHB']).packs[0].items;
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={reconciliation,rawHistorical:[],items};
 const progression=buildClassProgressionEvidence(input),mechanics=buildClassMechanicsEvidence(input,progression),projection=buildClassProjection(items,commits.main),features=buildFeatureResourceEvidence(input),resources=buildResourceProjection(input);
 const classId=projection.rows.find((r:any)=>r.kind==='class').itemId,subclassId=projection.rows.find((r:any)=>r.kind==='subclass').itemId;
 const request={projectionFingerprint:projection.fingerprint,evidenceFingerprint:features.fingerprint,classId,rulesEra:'2024',beforeLevel:1,afterLevel:2,totalBefore:1,inventoryComplete:true,subclassSelectionComplete:true};
 return {reports:{progression,mechanics,projection,features,resources},request,subclassId};
}
function characterFixture(){
 const source={id:'fixture',book:'Fixture',version:'2024',status:'active' as const,confidence:'exact' as const};
 const pack=buildPersistedCompendiumImport({id:'fixture-pack',source,items:[
  {id:'fixture-class',kind:'class',name:'Fixture Class',source,payload:{level:1,progression:[{level:1,featureIds:['fixture-feature']},{level:2,featureIds:['fixture-next']}]}},
  {id:'fixture-feature',kind:'feature',name:'Existing Feature',source,payload:{classId:'fixture-class',sourceType:'classFeature',resource:{id:'existing-pool',max:3,recharge:'shortRest'}}},
  {id:'fixture-next',kind:'feature',name:'Next Feature',source,payload:{classId:'fixture-class',sourceType:'classFeature'}}
 ]});
 const cl=pack.items.find(i=>i.type==='class');if(!cl)throw Error('missing class fixture');
 const applied=applyCompendiumItemToCharacter(createEmptyCharacter('Fixture'),cl);
 if(!applied.ok||!applied.link)throw Error('missing class link');
 const classId=applied.link.appliedEntityId;
 const withFeature=applyAutomaticClassProgression(applied.character,pack.items).character;
 const published:Character={...withFeature,catalogSnapshotId:'fixture-catalog',resources:[{id:'manual-pool',name:'Manual',max:4,current:1,recharge:'manual'},...withFeature.resources.map(r=>({...r,current:0}))]};
 const working:Character={...published,level:published.level+1,classes:published.classes.map(c=>c.id===classId?{...c,level:c.level+1}:c)};
 const draft=createProgressionDraft({character:published,workingCharacter:working,kind:'levelUp',operations:[progressionOperation('levelUp','Fixture')]});
 return {published,working,classId,draft,items:pack.items};
}
describe('a8.6.6 class closure and level-up review',()=>{
 test('consolidates exact report bindings without approving parity',()=>{
  const f=evidenceFixture(),before=digest(f.reports),r=buildClassClosureReview(f.reports);
  expect(r).toMatchObject({grants:{directContextCandidate:2,grantOptionsPending:1},baseResources:{identityOrSnapshotPending:5},approvedMappings:0,mechanicalParityEstablished:0,executable:false});
  expect(JSON.stringify(r)).not.toMatch(/Private|PRIVATE_TEXT/);
  expect(digest(f.reports)).toBe(before);
  expect(()=>buildClassClosureReview({...f.reports,projection:{...f.reports.projection,fingerprint:'changed'}})).toThrow('reviewFingerprintMismatch');
  const {fingerprint,...body}=f.reports.mechanics;
  const changed={...body,progressionFingerprint:'wrong'};
  expect(()=>buildClassClosureReview({...f.reports,mechanics:{...changed,fingerprint:digest(changed)}})).toThrow('reviewReportBindingMismatch');
 });
 test('direct and annotated grants remain review-only; selected subclass owner and level are explicit',()=>{
  const f=evidenceFixture(),p=f.reports.projection,e=f.reports.features;
  const review=(extra:Record<string,unknown>={})=>previewLevelGrantBoundary(p,e,{...f.request,...extra});
  expect(review()).toMatchObject({status:'levelGrantReviewCandidate',byStatus:{mechanicalGrantReviewRequired:1,grantOptionsPending:1},choices:[{status:'choicePolicyPending'}],writeAuthorized:false});
  expect(review({subclassId:f.subclassId}).reason).toBe('subclassOwnerOrGrantPending');
  expect(review({subclassId:f.subclassId,subclassGrantConfirmed:true,subclassUnlockLevel:2})).toMatchObject({byStatus:{mechanicalGrantReviewRequired:2,grantOptionsPending:1}});
  expect(review({afterLevel:3}).reason).toBe('explicitOneLevelContextRequired');
  expect(review({projectionFingerprint:'stale'}).reason).toBe('evidenceBindingMismatch');
 });
 test('actual legacy draft commit and rollback preserve exact existing snapshot on a disposable level-only fixture',()=>{
  const f=characterFixture(),before=progressionSnapshot(f.published);
  expect(f.published.compendiumLinks?.length).toBeGreaterThan(1);
  const r=reviewLevelOnlyPreservation(f.published,f.draft,f.classId);
  expect(r).toMatchObject({status:'levelOnlyPreservationCandidate',codes:[],unexpectedPaths:[],executable:false,writeAuthorized:false});
  const result=commitProgressionDraft(f.published,f.draft);
  expect(result.ok).toBe(true);
  expect(result.character.resources).toEqual(f.published.resources);
  expect(result.character.compendiumLinks).toEqual(f.published.compendiumLinks);
  expect(progressionSnapshot(f.published)).toEqual(before);
  if(!result.auditEntry)throw Error('missing audit');
  expect(progressionSnapshot(rollbackProgressionAudit(result.character,result.auditEntry).character)).toEqual(before);
 });
 test('strict preview blocks resource refill, lost links, added grants and unrelated edits even if legacy draft validates',()=>{
  const f=characterFixture();
  const altered={...f.draft,workingCharacter:{...f.draft.workingCharacter,resources:f.working.resources.map(r=>({...r,current:r.max})),compendiumLinks:[],notes:'changed'}};
  expect(validateProgressionDraft(altered,f.published).ok).toBe(true);
  expect(reviewLevelOnlyPreservation(f.published,altered,f.classId)).toMatchObject({status:'preservationBlocked',unexpectedPaths:['compendiumLinks','notes','resources'],writeAuthorized:false});
  const automatic=applyAutomaticClassProgression(f.working,f.items).character;
  const withGrant={...f.draft,workingCharacter:progressionSnapshot(automatic)};
  expect(reviewLevelOnlyPreservation(f.published,withGrant,f.classId).unexpectedPaths).toContain('features');
  expect(reviewLevelOnlyPreservation(f.published,{...f.draft,workingCharacter:{...f.draft.workingCharacter,catalogSnapshotId:'other'}},f.classId).unexpectedPaths).toContain('catalogSnapshotId');
 });
 test('stale base and unresolved mandatory choices block preservation preview',()=>{
  const f=characterFixture();
  const changed={...f.published,notes:'concurrent edit'};
  expect(reviewLevelOnlyPreservation(changed,f.draft,f.classId)).toMatchObject({status:'preservationBlocked',codes:expect.arrayContaining(['baseSnapshotMismatch','existingTransactionValidationBlocked']),engineBlockingCodes:expect.arrayContaining(['PROGRESSION_TRANSACTION_CONFLICT'])});
  const pending={...f.draft,workingCharacter:{...f.draft.workingCharacter,pendingChoices:[{id:'choice',kind:'subclass' as const,title:'Choice',description:'Required',status:'pending' as const,createdAt:'2026-01-01T00:00:00Z'}]}};
  expect(reviewLevelOnlyPreservation(f.published,pending,f.classId)).toMatchObject({status:'preservationBlocked',unexpectedPaths:['pendingChoices'],engineBlockingCodes:expect.arrayContaining(['PROGRESSION_TRANSACTION_PENDING_CHOICES'])});
 });
});
