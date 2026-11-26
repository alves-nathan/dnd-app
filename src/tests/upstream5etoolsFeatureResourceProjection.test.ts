export {};
const {buildPilot:buildClasses}=require('../../scripts/5etools/class-converter');
const {buildPilot:buildFeatures}=require('../../scripts/5etools/feature-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildFeatureResourceEvidence}=require('../../scripts/5etools/feature-resource-evidence');
const {buildResourceProjection,publicSummary,previewResourceEvent,previewSelectionChange}=require('../../scripts/5etools/feature-resource-projection');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function fixture(){
 const data:Record<string,unknown>={
  'data/books.json':{book:[{source:'XPHB',name:'Fixture',published:'2024-01-01'}]},
  'data/class/class-fixture.json':{class:[{name:'Private Class',source:'XPHB',hd:{number:1,faces:8},proficiency:['int','wis'],classFeatures:[],
    optionalfeatureProgression:[{name:'Private Choices',featureType:['EI'],progression:{'1':1,'3':2,'4':2}}]}]},
  'data/feats.json':{feat:[]},
  'data/optionalfeatures.json':{optionalfeature:['One','Two','Three','Wrong'].map(name=>({name:'Private '+name,source:'XPHB',entries:['PRIVATE_TEXT'],featureType:[name==='Wrong'?'MM':'EI']}))}
 };
 const snapshot={commit:commits.main,files:new Map(Object.keys(data).map(p=>[p,'d'.repeat(40)])),readJson:(p:string)=>data[p]};
 const items=[...buildClasses(snapshot,['XPHB']).packs[0].items,...buildFeatures(snapshot,['XPHB']).packs[0].items];
 const reconciliation=reconcile({historical:{rows:[],bootstrapRows:[]},runtime:{entries:[],dependencies:[],aliases:[],categories:[]},rawHistorical:[],rawRuntime:[],items,records:[],commits});
 const input={reconciliation,rawHistorical:[],items};
 const evidence=buildFeatureResourceEvidence(input);
 const byName=(name:string)=>{const i=items.find((x:any)=>x.name==='Private '+name);if(!i)throw Error('missing fixture');return i.id;};
 const one=byName('One'),two=byName('Two'),three=byName('Three'),wrong=byName('Wrong'),ownerId=byName('Class');
 const choicePath=evidence.rows.find((x:any)=>x.itemId===ownerId).choices[0].path;
 const request={inventoryComplete:true,totalDistinctLimitConfirmed:true,eligibilityConfirmed:true,dependenciesConfirmed:true,
  ownerId,choicePath,rulesEra:'2024',evidenceFingerprint:evidence.fingerprint,beforeLevel:1,afterLevel:3,
  eligibleIds:[one,two,three],beforeIds:[one],afterIds:[one,two]};
 return {input,evidence,request,one,two,three,wrong};
}
describe('a8.6.5 feature resource and selection projection',()=>{
 test('unreviewed snapshots never inherit base resource policies',()=>{
  const f=fixture(),r=buildResourceProjection(f.input);
  expect(r.counts).toEqual({identityOrSnapshotPending:5});
  expect(r.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized)).toBe(true);
  expect(publicSummary(r)).not.toHaveProperty('rows');
  expect(previewResourceEvent(f.input,{contextConfirmed:true,baseFeatureOnlyConfirmed:true,classInstanceId:'fixture',resourceId:'pool',level:1,current:0,projectionFingerprint:r.fingerprint,classId:'missing',featureId:'missing',rulesEra:'2024'}).reason).toBe('resourceIdentityPending');
 });
 test('explicit distinct selection growth preserves existing membership, no automatic grant',()=>{
  const f=fixture(),before=digest(f.input);
  expect(previewSelectionChange(f.input,f.request)).toMatchObject({status:'selectionChangeCandidate',beforeCount:1,afterCount:2,removed:[],added:[f.two],writeAuthorized:false});
  expect(digest(f.input)).toBe(before);
  expect(previewSelectionChange(f.input,{...f.request,afterIds:[f.one,f.one]}).reason).toBe('selectionCountOrMembershipInvalid');
  expect(previewSelectionChange(f.input,{...f.request,afterIds:[f.one,f.wrong],eligibleIds:[...f.request.eligibleIds,f.wrong]}).reason).toBe('selectionFamilyOrEditionPending');
  expect(previewSelectionChange(f.input,{...f.request,afterLevel:2}).reason).toBe('checkpointNotPresent');
 });
 test('replacement permission and count are independent of schedule growth',()=>{
  const f=fixture(),request={...f.request,beforeLevel:3,afterLevel:4,beforeIds:[f.one,f.two],afterIds:[f.two,f.three]};
  expect(previewSelectionChange(f.input,request).reason).toBe('replacementPolicyRequired');
  expect(previewSelectionChange(f.input,{...request,replacementConfirmed:true,maxReplacements:0}).reason).toBe('replacementLimitExceeded');
  expect(previewSelectionChange(f.input,{...request,replacementConfirmed:true,maxReplacements:1})).toMatchObject({status:'selectionChangeCandidate',removed:[f.one],added:[f.three],beforeCount:2,afterCount:2});
 });
 test('selection rejects unconfirmed eligibility, incomplete context, stale evidence and edition mismatch',()=>{
  const f=fixture();
  for(const key of ['inventoryComplete','totalDistinctLimitConfirmed','eligibilityConfirmed','dependenciesConfirmed'])expect(previewSelectionChange(f.input,{...f.request,[key]:false}).reason).toBe('explicitSelectionContextRequired');
  expect(previewSelectionChange(f.input,{...f.request,evidenceFingerprint:'stale'}).reason).toBe('evidenceFingerprintMismatch');
  expect(previewSelectionChange(f.input,{...f.request,rulesEra:'2014'}).reason).toBe('selectionScopePending');
 });
});
