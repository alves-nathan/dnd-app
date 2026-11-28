export {};
const {buildPilot}=require('../../scripts/5etools/class-converter');
const {digest}=require('../../scripts/5etools/integrated-review');
const {flatSkillCandidate,buildClassProjection,publicSummary,atLevel,previewClassBuild}=require('../../scripts/5etools/class-projection-preview');
const commit='a'.repeat(40);
const counts=Array(20).fill(2);
const slots=(n:number)=>[{colLabels:['{@filter 1st|spells|level=1}'],rowsSpellProgression:Array.from({length:20},()=>[n])}];
function fixture(era:'2014'|'2024'='2024'){
 const source=era==='2014'?'PHB':'XPHB',artSource=era==='2014'?'TCE':'EFA';
 const cl=(name:string,extra:Record<string,unknown>={},s=source)=>({name,source:s,hd:{number:1,faces:8},proficiency:['int','wis'],classFeatures:[],...extra});
 const classes=[
  cl('Synthetic Full',{spellcastingAbility:'int',casterProgression:'full',classTableGroups:slots(3),
    cantripProgression:counts,spellsKnownProgression:counts,preparedSpells:'formula',
    startingProficiencies:{skills:[{choose:{from:['arcana','history'],count:2}}]}}),
  cl('Synthetic Half',{spellcastingAbility:'wis',casterProgression:'1/2',classTableGroups:slots(2),preparedSpellsProgression:counts}),
  cl('Synthetic Artificer',{spellcastingAbility:'int',casterProgression:'artificer',classTableGroups:slots(2)},artSource),
  cl('Synthetic Pact',{spellcastingAbility:'cha',casterProgression:'pact',classTableGroups:[{colLabels:['Spell Slots','Slot Level'],rows:Array.from({length:20},()=>[2,1])}]}),
  cl('Synthetic Martial'),cl('Synthetic Other')
 ];
 const sub={name:'Synthetic Third',shortName:'Third',source,className:'Synthetic Martial',classSource:source,subclassFeatures:[],
  casterProgression:'1/3',spellcastingAbility:'int',subclassTableGroups:slots(1)};
 const data:Record<string,unknown>={'data/books.json':{book:[source,artSource].map(s=>({source:s,name:'Synthetic '+s,published:'2024-01-01'}))},
  'data/class/class-fixture.json':{class:classes,subclass:[sub]}};
 const items=buildPilot({commit,files:new Map(Object.keys(data).map(p=>[p,'b'.repeat(40)])),readJson:(p:string)=>data[p]},[source,artSource]).packs.flatMap((p:any)=>p.items);
 const report=buildClassProjection(items,commit);
 const row=(name:string)=>{const i=items.find((x:any)=>x.name==='Synthetic '+name);if(!i)throw Error('missing fixture');const r=report.rows.find((x:any)=>x.itemId===i.id);if(!r)throw Error('missing projection');return r;};
 const binding=(name:string,level:number,extra:Record<string,unknown>={})=>({classId:row(name).itemId,classInstanceId:name,level,subclassSelectionComplete:true,spellcastingActive:true,...extra});
 const request=(classes:unknown[],extra:Record<string,unknown>={})=>({inventoryComplete:true,rulesEra:era,projectionFingerprint:report.fingerprint,classes,...extra});
 const preview=(classes:unknown[],extra:Record<string,unknown>={})=>previewClassBuild(items,commit,request(classes,extra));
 return {items,report,row,binding,request,preview};
}
describe('a8.6.3 qualified class projection preview',()=>{
 test('projects only literal skill choices and preserves source-qualified numeric limits independently',()=>{
  const f=fixture(),r=f.row('Full');
  expect(r.chassis).toMatchObject({hitDie:8,savingThrowProficiencies:['INT','WIS'],skillChoiceCount:2,skillProficienciesChoice:['Arcana','History']});
  expect(atLevel(r,3)).toMatchObject({status:'levelProjectionCandidate',slots:{'1':3},limits:{cantripsKnownByLevel:2,spellsKnownByLevel:2},preparation:{knownTable:true,preparedTable:false,formulaPending:true},runtimeEligible:false});
  expect(atLevel(r,3).limits).not.toHaveProperty('preparedSpellsByLevel');
  expect(atLevel(f.row('Half'),3).limits).toEqual({preparedSpellsByLevel:2});
  expect(atLevel(r,21).status).toBe('indeterminate');
  expect(flatSkillCandidate({skillChoiceCount:1,skillProficienciesChoice:{from:'skills',count:1,options:['arcana','Arcana']}}).status).toBe('choiceShapePending');
  expect(flatSkillCandidate({skillChoiceCount:1,skillProficienciesChoice:{from:'skills',count:1,options:['unknown']}}).status).toBe('choiceShapePending');
 });
 test('source identity, raw projection, fingerprint and edition are bound; never approve activation',()=>{
  const f=fixture(),r=f.row('Full'),before=digest(f.items);
  expect(f.report.byKind.class).toMatchObject({total:6,'profile:tableCandidate':4,'artificerProgression':1});
  expect(f.report.byKind.subclass).toMatchObject({total:1,'profile:tableCandidate':1});
  expect(f.report.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized)).toBe(true);
  expect(JSON.stringify(publicSummary(f.report))).not.toMatch(/Synthetic|upstream:main:class:/);
  const changed=f.items.map((i:any)=>i.id===r.itemId?{...i,payload:{...i.payload,hitDie:12}}:i);
  expect(()=>buildClassProjection(changed,commit)).toThrow('classProjectionPayloadMismatch');
  const wrongEra=f.items.map((i:any)=>i.id===r.itemId?{...i,source:{...i.source,rulesEra:'2014'}}:i);
  expect(()=>buildClassProjection(wrongEra,commit)).toThrow('classProjectionIdentityMismatch');
  expect(f.preview([f.binding('Full',3)],{projectionFingerprint:'changed'}).reason).toBe('projectionFingerprintMismatch');
  expect(f.preview([f.binding('Full',3)],{rulesEra:'2014'}).reason).toBe('classEditionOrIdentityPending');
  expect(digest(f.items)).toBe(before);
 });
 test('explicit edition policy separates half-caster rounding and Artificer exception, keeps Pact independent',()=>{
  for(const era of ['2014','2024'] as const){
   const f=fixture(era),base=[f.binding('Full',2),f.binding('Half',3),f.binding('Artificer',3),f.binding('Pact',2)];
   expect(f.preview(base).reason).toBe('multiclassPolicyReviewRequired');
   expect(f.preview(base,{multiclassPolicyConfirmed:true}).reason).toBe('qualifiedReferenceTableRequired');
   const result=f.preview(base,{multiclassPolicyConfirmed:true,referenceClassId:f.row('Full').itemId});
   expect(result).toMatchObject({status:'buildProjectionCandidate',totalLevel:10,effectiveCasterLevel:era==='2014'?5:6,writeAuthorized:false});
   expect(result.pools).toEqual(expect.arrayContaining([expect.objectContaining({poolKind:'spellcasting',level:1,max:3,recharge:'longRest'}),expect.objectContaining({poolKind:'pactMagic',level:1,max:2,sourceClassId:'Pact',recharge:'shortRest'})]));
  }
 });
 test('subclass tables require exact owner and externally confirmed unlock, not an inferred name',()=>{
  const f=fixture(),subclassId=f.row('Third').itemId;
  expect(f.preview([f.binding('Martial',3,{subclassId})]).reason).toBe('subclassOwnerOrGrantPending');
  const flags={subclassId,subclassGrantConfirmed:true,subclassUnlockLevel:3};
  expect(f.preview([f.binding('Other',3,flags)]).reason).toBe('subclassOwnerOrGrantPending');
  expect(f.preview([f.binding('Martial',2,flags)]).reason).toBe('subclassOwnerOrGrantPending');
  expect(f.preview([f.binding('Martial',3,flags)])).toMatchObject({status:'buildProjectionCandidate',profiles:[{sourceItemId:subclassId,progression:'thirdCaster'}],pools:[{level:1,max:1,poolKind:'spellcasting'}]});
 });
 test('does not assume absent progression means no spellcasting, and rejects duplicate classes or overlevel builds',()=>{
  const f=fixture();
  expect(f.preview([f.binding('Martial',3)]).reason).toBe('noDeclaredSpellcastingNotConfirmed');
  expect(f.preview([f.binding('Martial',3,{spellcastingActive:false,noDeclaredSpellcastingConfirmed:true})])).toMatchObject({status:'buildProjectionCandidate',pools:[]});
  expect(f.preview([f.binding('Full',3,{spellcastingActive:false})]).reason).toBe('inactiveProfileHasSlots');
  expect(f.preview([f.binding('Full',3),f.binding('Full',4,{classInstanceId:'other'})]).reason).toBe('classBindingPending');
  expect(f.preview([f.binding('Full',20),f.binding('Martial',1,{spellcastingActive:false,noDeclaredSpellcastingConfirmed:true})]).reason).toBe('totalLevelOutOfScope');
  expect(f.preview([f.binding('Full',3)],{inventoryComplete:false}).reason).toBe('explicitBuildContextRequired');
 });
});
