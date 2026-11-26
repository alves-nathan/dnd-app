const {buildClassProjection,publicSummary:classProjectionSummary}=require('../../scripts/5etools/class-projection-preview');
const {buildClassMechanicsEvidence,publicSummary:classMechanicsSummary}=require('../../scripts/5etools/class-mechanics-evidence');
const {buildClassProgressionEvidence,publicSummary:classProgressionSummary}=require('../../scripts/5etools/class-progression-evidence');
const {buildEquipmentParityEvidence,publicSummary:equipmentParitySummary}=require('../../scripts/5etools/equipment-parity-evidence');
import * as fs from 'node:fs';
import { BUNDLED_COMPENDIUM_PACKS } from '../compendium/bundledCompendium';
import { parseImportPack } from '../compendium/parseImportPack';
import { detectCompendiumImportVersion } from '../compendium/importVersion';
import { CatalogLoader } from '../catalog/catalogLoader';
import type { RuntimeCatalogBundle } from '../catalog/types';
const {openSnapshot}=require('../../scripts/5etools/inventory');
const {openHistoricalSnapshot}=require('../../scripts/5etools/historical-baseline');
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildIndex,comparePayload,matchIdentity,reconcile,buildReconciliation,publicSummary}=require('../../scripts/5etools/historical-reconciliation');
const target=(id:string,kind:string,name:string,sourceCode='XPHB',payload:Record<string,unknown>={})=>({id,kind,name,payload,source:{rulesEra:sourceCode==='PHB'?'2014':'2024'},provenance:{origin:'5etools',sourceCode}});
describe('a7.2 reconciliation candidates',()=>{
  test('exact name, source, kind and era only; no fuzzy or reprint fallback',()=>{
    const t=target('new','spell','Fixture');
    const index=buildIndex([t,target('old','spell','Fixture','PHB')],[]);
    expect(matchIdentity({kind:'spell',name:' fixture ',sourceId:'phb',rulesEra:'2024'},index)).toMatchObject({status:'identityCandidate',targetId:'new'});
    expect(matchIdentity({kind:'spell',name:'Fixture',sourceId:'phb',rulesEra:'2014'},index).status).toBe('eraMismatch');
    expect(matchIdentity({kind:'spell',name:'Fixtures',sourceId:'phb'},index).status).toBe('noQualifiedNameCandidate');
    expect(matchIdentity({kind:'spell',name:'Fixture',sourceId:'unknown'},index).status).toBe('sourceMappingPending');
    expect(matchIdentity({kind:'rule',name:'Fixture',sourceId:'phb-2024'},index,{runtime:true}).status).toBe('runtimeContractOutsideV3');
  });
  test('ambiguous name and observed raw record remain distinct from emitted candidate',()=>{
    const index=buildIndex([target('a','spell','Fixture'),target('b','spell','Fixture')],[{origin:'main',kind:'spell',entity:{source:'XPHB',name:'Raw only'}}]);
    expect(matchIdentity({kind:'spell',name:'Fixture',sourceId:'phb'},index).status).toBe('ambiguousIdentity');
    expect(matchIdentity({kind:'spell',name:'Raw only',sourceId:'phb'},index).status).toBe('rawNameCandidateNotEmitted');
  });
  test('feature ownership and level must be explicit; runtime feature names are not sufficient',()=>{
    const index=buildIndex([target('a','feature','Grant','XPHB',{classId:'class-a',levelGained:3}),target('b','feature','Grant','XPHB',{classId:'class-b',levelGained:3})],[]);
    const r={kind:'feature',name:'Grant',sourceId:'phb',payload:{classId:'legacy',levelGained:3}};
    expect(matchIdentity(r,index).status).toBe('ownerMappingPending');
    expect(matchIdentity(r,index,{ownerTargets:new Map([['legacy','class-b']])})).toMatchObject({status:'identityCandidate',targetId:'b'});
    expect(matchIdentity({...r,payload:{...r.payload,levelGained:5}},index,{ownerTargets:new Map([['legacy','class-b']])}).status).toBe('ownerOrLevelMismatch');
    expect(matchIdentity({...r,kind:'classFeature',sourceId:'phb-2024'},index,{runtime:true}).status).toBe('runtimeOwnerContextPending');
  });
  test('payload comparison preserves changed/missing/added fields even when identity matches',()=>{
    expect(comparePayload({a:1,b:2,c:3},{a:1,b:4,d:5})).toMatchObject({status:'payloadDifferences',same:['a'],changed:['b'],missing:['c'],added:['d']});
    expect(comparePayload({a:1},{a:1}).status).toBe('exactPayloadFingerprint');
    expect(comparePayload(undefined,{}).status).toBe('payloadNotAvailable');
  });
  test('every legacy occurrence and runtime dependency remains a preservation obligation',()=>{
    const i={id:'legacy',name:'Fixture',payload:{weight:1}},row={id:i.id,kind:'equipment',sourceId:'phb',path:'fixture',index:0,itemHash:digest(i)};
    const rt={entityId:'runtime',displayName:'Fixture'};
    const r=reconcile({historical:{rows:[row],bootstrapRows:[row]},runtime:{entries:[{id:'runtime',kind:'equipment',book:'phb-2024',fingerprint:digest(rt)}],dependencies:[{id:'edge',fromId:'runtime',toId:'missing'}],aliases:[{id:'alias',from:'runtime',to:'missing'}],categories:[{id:'cat',memberIds:['runtime','missing']}]},
      rawHistorical:[{path:'fixture',index:0,item:i}],rawRuntime:[rt],items:[target('new','equipment','Fixture','XPHB',{weight:1})],records:[],commits:{application:'a',main:'b',homebrew:'c'}});
    expect(r.summary.issues).toEqual({});
    expect(r.summary.historicalStatus.identityCandidate).toBe(1);
    expect(r.summary.runtimeStatus.identityCandidate).toBe(1);
    expect(r.dependencies[0].mappingStatus).toBe('endpointMappingPending');
    expect(r.categories[0].mappedMembers).toBe(1);
    expect(r.historical[0].preservation).toBe('required');
    expect(r.summary.retirementAuthorized).toBe(false);
  });
});
const mainPath=process.env.DND_UPSTREAM_RECONCILE_MAIN,brewPath=process.env.DND_UPSTREAM_RECONCILE_BREW;
(mainPath&&brewPath?test:test.skip)('real historical reconciliation preserves all occurrences and runtime contracts',()=>{
  if(!mainPath||!brewPath)throw Error('missing snapshots');
  const r=buildReconciliation(openSnapshot(mainPath),openSnapshot(brewPath),openHistoricalSnapshot(process.cwd()),{
    bundled:BUNDLED_COMPENDIUM_PACKS,parse:parseImportPack,detect:detectCompendiumImportVersion,
    loadRuntime:(b:RuntimeCatalogBundle)=>new CatalogLoader().initializeFromBundle(b),
    onEvidenceInputs:(input:any)=>{
      const report=buildEquipmentParityEvidence(input);
      expect(report.byKind.weapon).toMatchObject({occurrences:114,identityCandidates:114});
      expect(report.byKind.armor).toMatchObject({occurrences:39,identityCandidates:39});
      expect(report.mechanicalParityEstablished).toBe(0);
      expect(report.rows.every((row:any)=>!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      console.log(JSON.stringify(equipmentParitySummary(report)));
      const classes=buildClassProgressionEvidence(input);
      expect(classes.byKind.class).toMatchObject({occurrences:50,identityCandidates:35,identityPending:15});
      expect(classes.byKind.subclass).toMatchObject({occurrences:251,identityCandidates:143,identityPending:108});
      expect(classes.byKind.feature).toMatchObject({occurrences:3192,identityCandidates:1170,identityPending:2022});
      expect(classes.graph.class.items).toBe(27);
      expect(classes.graph.subclass.items).toBe(146);
      expect(classes.graph.classFeature.items).toBe(605);
      expect(classes.graph.subclassFeature.items).toBe(1031);
      expect(classes.graph.otherFeature.items).toBe(233);
      expect(classes.rows.every((row:any)=>!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      expect(classes.mechanicalParityEstablished).toBe(0);
      console.log(JSON.stringify(classProgressionSummary(classes)));
      const mechanics=buildClassMechanicsEvidence(input,classes);
      expect(mechanics.historical.class).toMatchObject({occurrences:50,candidates:35,chassis:{hitDie:{exactValue:35},savingThrowProficiencies:{exactValue:35}}});
      expect(mechanics.historical.subclass).toMatchObject({occurrences:251,candidates:143});
      expect(mechanics.upstream.class.tableCandidate).toBeGreaterThan(0);
      expect(mechanics.upstream.class['progression:pactMagic']).toBeGreaterThan(0);
      expect(mechanics.contract.structuredSkillChoice).toBeGreaterThan(0);
      expect(mechanics.mechanicalParityEstablished).toBe(0);
      expect(mechanics.rows.every((row:any)=>!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      console.log(JSON.stringify(classMechanicsSummary(mechanics)));
      const projection=buildClassProjection(input.items,input.reconciliation.commits.main);
      expect(projection.byKind.class).toMatchObject({total:27,'profile:tableCandidate':17,'profile:noDeclaredProgression':9,'profile:indeterminate':1,'progression:pactMagic':2});
      expect(projection.byKind.subclass).toMatchObject({total:146,'profile:tableCandidate':4,'profile:noDeclaredProgression':142});
      expect(projection.rows.every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      expect(projection.mechanicalParityEstablished).toBe(0);
      console.log(JSON.stringify(classProjectionSummary(projection)));
    }
  });
  console.log(JSON.stringify(publicSummary(r)));
  expect(r.summary.issues).toEqual({});
  expect(r.summary.historicalOccurrences).toBe(6335);
  expect(r.summary.historicalIds).toBe(2199);
  expect(r.summary.bootstrap).toBe(1997);
  expect(r.summary.runtime).toBe(5841);
  expect(r.summary.runtimeDependencies).toBe(15385);
  expect(r.summary.runtimeAliases).toBe(127);
  expect(r.summary.runtimeCategories).toBe(57);
  expect(r.summary.historicalStatus.identityCandidate||0).toBeGreaterThan(0);
  expect(r.summary.runtimeStatus.runtimeContractOutsideV3||0).toBeGreaterThan(0);
  expect(r.summary.approvedMappings).toBe(0);
  expect(r.summary.retirementAuthorized).toBe(false);
  const out=process.env.DND_UPSTREAM_RECONCILE_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});
},360000);
