const {buildOriginClosureReview}=require('../../scripts/5etools/origin-closure-review');
const {buildOriginGrantEvidence,publicSummary:originGrantSummary}=require('../../scripts/5etools/origin-grant-evidence');
const {buildOriginChassisProjection,publicSummary:originChassisSummary}=require('../../scripts/5etools/origin-chassis-projection');
const {buildOriginParityEvidence,publicSummary:originParitySummary}=require('../../scripts/5etools/origin-parity-evidence');
const {buildSpellClosureReview}=require('../../scripts/5etools/spell-closure-review');
const {buildSpellAccessProjection,publicSummary:spellAccessSummary}=require('../../scripts/5etools/spell-access-projection');
const {buildSpellLifecycleProjection,publicSummary:spellLifecycleSummary}=require('../../scripts/5etools/spell-lifecycle-projection');
const {buildSpellEffectProjection,publicSummary:spellEffectSummary,previewSpellEffects}=require('../../scripts/5etools/spell-effect-projection');
const {buildSpellCastingProjection,publicSummary:spellCastingSummary}=require('../../scripts/5etools/spell-casting-projection');
const {buildSpellParityEvidence,publicSummary:spellParitySummary}=require('../../scripts/5etools/spell-parity-evidence');
const {buildClassClosureReview,previewLevelGrantBoundary}=require('../../scripts/5etools/class-closure-review');
import {createEmptyCharacter} from '../data/mockData';
import {applyRest,spendResources} from '../rules-engine/resources/resourceManager';
const {buildResourceProjection,previewResourceEvent,publicSummary:baseResourceSummary}=require('../../scripts/5etools/feature-resource-projection');
const {buildFeatureResourceEvidence,publicSummary:featureResourceSummary}=require('../../scripts/5etools/feature-resource-evidence');
const {buildClassProjection,publicSummary:classProjectionSummary}=require('../../scripts/5etools/class-projection-preview');
const {buildClassMechanicsEvidence,publicSummary:classMechanicsSummary}=require('../../scripts/5etools/class-mechanics-evidence');
const {buildClassProgressionEvidence,publicSummary:classProgressionSummary}=require('../../scripts/5etools/class-progression-evidence');
const {buildFeatClosureReview}=require('../../scripts/5etools/feat-closure-review');
const {buildFeatGrantEvidence,publicSummary:featGrantSummary}=require('../../scripts/5etools/feat-grant-evidence');
const {buildFeatAllocationProjection,publicSummary:featAllocationSummary}=require('../../scripts/5etools/feat-allocation-projection');
const {buildFeatRequirementProjection,publicSummary:featRequirementSummary}=require('../../scripts/5etools/feat-requirement-projection');
const {buildFeatParityEvidence,publicSummary:featParitySummary}=require('../../scripts/5etools/feat-parity-evidence');
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
      const feats=buildFeatParityEvidence(input);
      expect(feats.historical.occurrences).toBe(input.rawHistorical.filter((x:any)=>x.item.kind==='feat').length);
      expect(feats.historical.identityCandidates+feats.historical.identityPending).toBe(feats.historical.occurrences);
      expect(feats.runtime.occurrences).toBe(input.reconciliation.runtime.filter((x:any)=>x.kind==='feat').length);
      expect(feats.upstream.items).toBe(input.items.filter((x:any)=>x.kind==='feat').length);
      expect(feats.upstream.items).toBeGreaterThan(0);
      expect(feats.mechanicalParityEstablished).toBe(0);
      expect([...feats.rows,...feats.upstreamRows,...feats.runtimeRows].every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      console.log(JSON.stringify(featParitySummary(feats)));
      const featRequirements=buildFeatRequirementProjection(input,feats);
      expect(featRequirements.summary.items).toBe(feats.upstream.items);
      expect(featRequirements.evidenceFingerprint).toBe(feats.fingerprint);
      expect(featRequirements.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized&&!x.executable)).toBe(true);
      expect(featRequirements.mechanicalParityEstablished).toBe(0);
      console.log(JSON.stringify(featRequirementSummary(featRequirements)));
      const featAllocations=buildFeatAllocationProjection(input,featRequirements);
      expect(featAllocations.summary.items).toBe(feats.upstream.items);
      expect(featAllocations.requirementFingerprint).toBe(featRequirements.fingerprint);
      expect(featAllocations.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized&&!x.executable)).toBe(true);
      expect(featAllocations.mechanicalParityEstablished).toBe(0);
      console.log(JSON.stringify(featAllocationSummary(featAllocations)));
      const featGrants=buildFeatGrantEvidence(input,featAllocations);
      expect(featGrants.summary.items).toBe(feats.upstream.items);
      expect(featGrants.allocationFingerprint).toBe(featAllocations.fingerprint);
      expect(featGrants.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized&&!x.executable)).toBe(true);
      expect(featGrants.mechanicalParityEstablished).toBe(0);
      console.log(JSON.stringify(featGrantSummary(featGrants)));
      const featClosure=buildFeatClosureReview(input,{parity:feats,requirements:featRequirements,allocation:featAllocations,grants:featGrants});
      expect(featClosure.upstream.items).toBe(feats.upstream.items);
      expect(featClosure.mechanicalParityEstablished).toBe(0);
      expect(featClosure.writeAuthorized).toBe(false);
      console.log(JSON.stringify(featClosure));
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
      const featureResources=buildFeatureResourceEvidence(input);
      expect(featureResources.byScope.class).toMatchObject({items:27,grants:{directContextCandidate:474,grantOptionsPending:99}});
      expect(featureResources.byScope.subclass).toMatchObject({items:146,grants:{directContextCandidate:623}});
      expect(featureResources.byScope.classFeature.items).toBe(605);
      expect(featureResources.byScope.subclassFeature.items).toBe(1031);
      expect(featureResources.byScope.optionalFeature.items).toBe(233);
      expect(featureResources.historical.feature).toMatchObject({occurrences:3192,identityCandidates:1170,identityPending:2022});
      expect(featureResources.rows.every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      expect(featureResources.mechanicalParityEstablished).toBe(0);
      console.log(JSON.stringify(featureResourceSummary(featureResources)));
      const resourceProjection=buildResourceProjection(input);
      // XPHB Barbarian is not emitted: its grant list includes a WoW feature,
      // outside the class pilot sources. Preserve that closed-graph boundary.
      const {physicalId:classPhysicalId}=require('../../scripts/5etools/class-converter');
      const revisedRageClassId=classPhysicalId('class',{name:'Barbarian',source:'XPHB'});
      const revisedRageFeatureId=classPhysicalId('classFeature',{name:'Rage',source:'XPHB',className:'Barbarian',classSource:'XPHB',level:1});
      expect(input.items.some((i:any)=>i.id===revisedRageClassId||i.id===revisedRageFeatureId)).toBe(false);
      expect(resourceProjection.counts).toEqual({baseResourceCandidate:4,identityOrSnapshotPending:1});
      const revisedRage=resourceProjection.rows.find((x:any)=>x.classId===revisedRageClassId&&x.featureId===revisedRageFeatureId);
      expect(revisedRage).toMatchObject({status:'identityOrSnapshotPending',reason:'classNotEmitted',rulesEra:'2024',runtimeEligible:false});
      expect(resourceProjection.rows.filter((x:any)=>x.status==='baseResourceCandidate').map((x:any)=>x.name).sort()).toEqual(['Focus Points','Ki Points','Rages','Second Wind']);
      expect(resourceProjection.rows.every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      expect(resourceProjection.mechanicalParityEstablished).toBe(0);
      // Use actual source-bound pools with the existing engine in disposable characters.
      const resourceEvent=(row:any,level:number,current:number,event:Record<string,unknown>)=>previewResourceEvent(input,{
        contextConfirmed:true,baseFeatureOnlyConfirmed:true,classInstanceId:'fixture',resourceId:'fixture-pool',
        classId:row.classId,featureId:row.featureId,rulesEra:row.rulesEra,level,current,
        projectionFingerprint:resourceProjection.fingerprint,event:{confirmed:true,...event}});
      const fighter=resourceProjection.rows.find((x:any)=>x.name==='Second Wind');
      const legacyRage=resourceProjection.rows.find((x:any)=>x.name==='Rages'&&x.rulesEra==='2014');
      const ki=resourceProjection.rows.find((x:any)=>x.name==='Ki Points');
      const focus=resourceProjection.rows.find((x:any)=>x.name==='Focus Points');
      const restore=(row:any,level:number,current:number,rest:'shortRest'|'longRest',expected:number,extra:Record<string,unknown>={})=>{
        const event=resourceEvent(row,level,current,{kind:rest,...extra});
        expect(event).toMatchObject({status:'resourceEventCandidate',writeAuthorized:false});
        const character={...createEmptyCharacter('Fixture'),resources:[event.pool]};
        expect(applyRest(character,rest).character.resources[0]?.current).toBe(expected);
        expect(character.resources[0]?.current).toBe(current);
      };
      restore(fighter,10,1,'shortRest',2);
      restore(fighter,10,0,'longRest',4);
      expect(resourceEvent(revisedRage,10,0,{kind:'longRest'})).toMatchObject({status:'indeterminate',reason:'resourceIdentityPending',writeAuthorized:false});
      restore(legacyRage,10,0,'shortRest',0);
      restore(focus,5,0,'shortRest',5);
      restore(ki,5,0,'shortRest',5,{meditationConfirmed:true});
      expect(resourceEvent(ki,5,0,{kind:'shortRest'}).reason).toBe('meditationContextRequired');
      expect(resourceEvent(legacyRage,20,0,{kind:'longRest'}).reason).toBe('finiteCapacityPending');
      const spend=resourceEvent(fighter,10,2,{kind:'spend',consumerFeatureId:fighter.featureId});
      expect(spend).toMatchObject({status:'resourceEventCandidate',cost:{amount:1}});
      const character={...createEmptyCharacter('Fixture'),resources:[spend.pool]};
      expect(spendResources({character,costs:[spend.cost]}).character.resources[0]?.current).toBe(1);
      expect(character.resources[0]?.current).toBe(2);
      expect(resourceEvent(fighter,10,0,{kind:'spend',consumerFeatureId:fighter.featureId}).reason).toBe('insufficientResource');
      console.log(JSON.stringify(baseResourceSummary(resourceProjection)));
      const closure=buildClassClosureReview({progression:classes,mechanics,projection,features:featureResources,resources:resourceProjection});
      expect(closure.historical.feature).toMatchObject({occurrences:3192,identityCandidates:1170,identityPending:2022});
      expect(closure.grants).toEqual({directContextCandidate:1097,grantOptionsPending:99});
      expect(closure.resourceCosts).toEqual({amountNotExplicit:165,explicitAmountCandidate:34,consumptionShapePending:2});
      expect(closure.baseResources).toEqual({baseResourceCandidate:4,identityOrSnapshotPending:1});
      expect(closure).toMatchObject({mechanicalParityEstablished:0,executable:false,writeAuthorized:false});
      const preview=previewLevelGrantBoundary(projection,featureResources,{
        projectionFingerprint:projection.fingerprint,evidenceFingerprint:featureResources.fingerprint,
        classId:fighter.classId,rulesEra:'2024',beforeLevel:1,afterLevel:2,totalBefore:1,
        inventoryComplete:true,subclassSelectionComplete:true});
      expect(preview).toMatchObject({status:'levelGrantReviewCandidate',runtimeEligible:false,writeAuthorized:false});
      expect(preview.grants.length).toBeGreaterThan(0);
      console.log(JSON.stringify(closure));
      const spells=buildSpellParityEvidence(input);
      expect(spells.historical).toMatchObject({occurrences:1236,identityCandidates:1173,identityPending:63});
      expect(spells.upstream.items).toBe(854);
      expect(spells.runtime.occurrences).toBe(378);
      expect(spells.upstream.contractCodes.qualifiedClassAccessPending).toBeGreaterThan(0);
      expect(spells.rows.every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      expect(spells).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(spellParitySummary(spells)));
      const casting=buildSpellCastingProjection(input,spells);
      expect(casting.summary.items).toBe(854);
      expect(casting.summary.timeAlternatives.actionCandidate).toBeGreaterThan(0);
      expect(casting.summary.timeAlternatives.durationCandidate).toBeGreaterThan(0);
      expect(casting.summary.range.selfAreaCandidate).toBeGreaterThan(0);
      expect(casting.summary.materials.explicitCopperCandidate).toBeGreaterThan(0);
      expect(casting.rows.every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
      expect(casting).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(spellCastingSummary(casting)));
      const effects=buildSpellEffectProjection(input,casting);
      expect(effects.counts).toEqual({baseEffectCandidate:12});
      expect(effects.byFamily).toEqual({healing:2,beamAttack:2,singleAttack:2,areaSave:2,projectile:2,singleSave:2});
      expect(effects).toMatchObject({upstreamSpells:854,approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      expect(effects.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      const {physicalId:spellPhysicalId}=require('../../scripts/5etools/spell-converter');
      const effect=(name:string,source:string,characterLevel:number,slotLevel:number,events:unknown[],extra:Record<string,unknown>={})=>previewSpellEffects(input,{
        rulesEra:source==='PHB'?'2014':'2024',spellId:spellPhysicalId(source,name),projectionFingerprint:effects.fingerprint,
        baseOnlyConfirmed:true,castingContextConfirmed:true,targetPolicyConfirmed:true,exceptionsReviewedConfirmed:true,
        characterLevel,slotLevel,targets:[{id:'a',kind:'creature',creatureType:'humanoid',eligibilityConfirmed:true}],events,...extra});
      const hit=(rolls:number[],outcome='hit',targetId='a')=>({targetId,outcome,rolls});
      expect(effect('Fire Bolt','XPHB',11,0,[hit([10,10,10,10,10,10],'critical')])).toMatchObject({status:'effectOutcomeCandidate',events:[{amount:60,damageType:'fire'}]});
      expect(effect('Eldritch Blast','PHB',11,0,[hit([10]),hit([],'miss'),hit([1,2],'critical')])).toMatchObject({status:'effectOutcomeCandidate',events:[{amount:10},{amount:0},{amount:3}]});
      expect(effect('Sacred Flame','XPHB',5,0,[hit([8,8],'success')])).toMatchObject({status:'effectOutcomeCandidate',events:[{amount:0}]});
      const targets=[{id:'a',kind:'creature',eligibilityConfirmed:true},{id:'b',kind:'creature',eligibilityConfirmed:true}];
      const dice=[1,2,3,4,5,6,1,2,3];
      expect(effect('Fireball','PHB',7,4,[hit(dice,'failure'),hit(dice,'success','b')],{targets})).toMatchObject({status:'effectOutcomeCandidate',events:[{amount:27},{amount:13}]});
      expect(effect('Fireball','PHB',7,4,[hit(dice,'failure'),hit([...dice.slice(0,8),4],'success','b')],{targets}).reason).toBe('sharedRollMismatch');
      const missiles=Array.from({length:4},()=>hit([4],'guaranteed'));
      expect(effect('Magic Missile','XPHB',3,2,missiles).reason).toBe('projectileRollPolicyPending');
      expect(effect('Magic Missile','XPHB',3,2,missiles,{projectileRollPolicy:'shared',projectileRollPolicyConfirmed:true})).toMatchObject({status:'effectOutcomeCandidate',events:Array.from({length:4},()=>expect.objectContaining({amount:5}))});
      expect(effect('Cure Wounds','PHB',3,2,[hit([8,8],'heal')],{spellcastingAbilityModifier:3})).toMatchObject({status:'effectOutcomeCandidate',events:[{amount:19,healing:true}]});
      expect(effect('Cure Wounds','XPHB',3,2,[hit([8,8,8,8],'heal')],{spellcastingAbilityModifier:3})).toMatchObject({status:'effectOutcomeCandidate',events:[{amount:35,healing:true}]});
      console.log(JSON.stringify(spellEffectSummary(effects)));
      const lifecycle=buildSpellLifecycleProjection(input,spells);
      expect(lifecycle.summary.items).toBe(854);
      expect(lifecycle.summary.duration).toEqual({durationCandidate:572,instantaneous:253,terminationPending:26,indeterminate:3});
      expect(lifecycle.summary.concentration.required).toBeGreaterThan(0);
      expect(lifecycle.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      expect(lifecycle).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(spellLifecycleSummary(lifecycle)));
      const access=buildSpellAccessProjection(input,spells,projection);
      expect(access.summary.items).toBe(854);
      expect(access.summary.directEdges).toBeGreaterThan(854);
      expect(access.summary.edgeStatus.directListCandidate).toBeGreaterThan(0);
      expect(access.summary.edgeStatus.classEndpointPending).toBeGreaterThan(0);
      expect(access.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      expect(access).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(spellAccessSummary(access)));
      const spellClosure=buildSpellClosureReview({parity:spells,casting,effects,lifecycle,access});
      expect(spellClosure).toMatchObject({upstreamSpells:854,historical:{occurrences:1236,identityCandidates:1173,identityPending:63,eraPending:782},
        runtime:{occurrences:378},access:{directEdges:2202,edgeStatus:{directListCandidate:1924,classEndpointPending:135,conditionalAccessPending:100,editionPending:43}},
        effectCoverage:{reviewedDefinitionCandidates:12,withoutBaseEffectCandidate:842},lifecycle:{concentration:{required:348,notRequired:477,pending:29}},
        approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(spellClosure));
      const origins=buildOriginParityEvidence(input);
      expect(origins.historical.species).toMatchObject({occurrences:70,identityCandidates:70,identityPending:0});
      expect(origins.historical.background).toMatchObject({occurrences:105,identityCandidates:105,identityPending:0});
      expect(origins.upstream.species.items).toBe(166);
      expect(origins.upstream.background.items).toBe(81);
      expect(origins.runtime.species.occurrences).toBe(10);
      expect(origins.runtime.background.occurrences).toBe(16);
      expect(origins.upstream.background.contractCodes.standardBackgroundAbilityCandidate).toBeGreaterThan(0);
      expect(origins.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      expect(origins).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(originParitySummary(origins)));
      const originChassis=buildOriginChassisProjection(input,origins);
      expect(originChassis.summary).toMatchObject({species:166,background:81,ability:{backgroundAllocationCandidate:43}});
      expect(originChassis.summary.size.sizeCandidate).toBeGreaterThan(0);
      expect(originChassis.summary.movement.movementCandidate).toBeGreaterThan(0);
      expect(originChassis.summary.proficiencies.skill.literalProficiencyCandidate).toBeGreaterThan(0);
      expect(originChassis.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      expect(originChassis).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(originChassisSummary(originChassis)));
      const originGrants=buildOriginGrantEvidence(input,originChassis);
      expect(originGrants.summary).toMatchObject({species:166,background:81,featEdges:{featIdentityCandidate:42,featEndpointPending:3,featSelectionPending:4}});
      expect(originGrants.summary.spellGroups).toBeGreaterThan(0);
      expect(originGrants.summary.equipmentEntries.copperValueCandidate).toBeGreaterThan(0);
      expect(originGrants.summary.traits.localTraitReviewRequired).toBeGreaterThan(0);
      expect(originGrants.rows.every((x:any)=>!x.runtimeEligible&&!x.writeAuthorized&&!x.retirementAuthorized)).toBe(true);
      expect(originGrants).toMatchObject({approvedMappings:0,mechanicalParityEstablished:0,executable:false});
      console.log(JSON.stringify(originGrantSummary(originGrants)));
      const originClosure=buildOriginClosureReview({parity:origins,chassis:originChassis,grants:originGrants});
      expect(originClosure).toMatchObject({origins:{species:166,background:81},historicalIdentity:{identityCandidate:175},
        historical:{species:{occurrences:70,eraPending:60},background:{occurrences:105,eraPending:89}},
        grants:{parents:{notSubrace:187,parentIdentityCandidate:60},versions:60,spellGroups:81,equipmentGroups:87,
          featEdges:{featIdentityCandidate:42,featEndpointPending:3,featSelectionPending:4},spellEntries:{identityCandidate:25},equipmentOptions:{equipmentOptionCandidate:70,equipmentOptionPending:69}},
        approvedMappings:0,mechanicalParityEstablished:0,executable:false,writeAuthorized:false});
      console.log(JSON.stringify(originClosure));
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
