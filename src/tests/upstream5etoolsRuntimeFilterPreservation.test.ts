import type {RuntimeCatalogBundle,CatalogFilterState} from '../catalog/types';
import {reviewRuntimeFilterPreservation} from '../compendium/runtimeFilterPreservationPreview';
function fixture(){
 const entry=(entityId:string,categoryIds:string[]=[])=>({entityId,kind:'rule',displayName:entityId,displayContext:[],sourceBookId:'phb-2024',sourceFile:'fixture',categoryIds,
  status:'active',defaultEnabled:true,manualReviewRequired:false,dependencyCounts:{outgoing:0,incoming:0},searchKey:entityId});
 const entries=[entry('owner'),entry('required'),entry('free'),entry('protected',['protected-category'])];
 const category={id:'protected-category',kind:'contentCategory',key:'protected',name:{en:'Protected'},sourceBookId:'phb-2024',memberCount:1,memberEntityIds:['protected'],defaultEnabled:true,canDisable:false,activationScopes:[],availabilityClasses:[],status:'active'};
 const bundle:RuntimeCatalogBundle={
  schemaVersion:'dnd-combat-runtime-bundle.v1',catalogVersion:'fixture',generatedAt:'2026-01-01',
  sourcePackage:{packageId:'fixture',version:'fixture',ruleset:'fixture',sourceBooks:['phb-2024'],zipSha256:'a'.repeat(64)},sourceFiles:{},sourceChecksums:{},
  manifest:{packageId:'fixture',version:'fixture',ruleset:'fixture',sourceBooks:['phb-2024']},
  runtimeIndex:{lotId:'fixture',version:'fixture',entryCount:4,entries},
  entityRegistry:{id:'registry',kind:'registry',generatedFromVersion:'fixture',entries:entries.map(e=>({...e}))},
  dependencyGraph:{id:'graph',kind:'graph',generatedFromVersion:'fixture',nodeCount:4,edgeCount:1,edges:[{id:'edge',fromId:'owner',toId:'required',relation:'requires',strength:'hard',resolutionPolicy:'requireEnabled',crossBook:false,status:'active'}]},
  aliases:{lotId:'alias',entities:[]},contentCategories:{lotId:'categories',version:'fixture',entities:[category]},
  contentFilterPolicy:{id:'policy',kind:'policy',version:'fixture',precedence:[],rules:[],profiles:[],status:'active'},readinessProfile:{},
  integrationContract:{},runtimeOperations:{},runtimeErrors:{},snapshotMigrationPolicy:{},activationPolicy:{},selectionContracts:{},providerCollections:{}
 };
 const state:CatalogFilterState={bookStates:{'phb-2024':true},categoryStates:{},entityStates:{}};
 const context={domain:'entityStates' as const,id:'free',value:'disabled' as const,snapshotContextConfirmed:true,otherDependenciesExcludedConfirmed:true};
 return {bundle,state,context};
}
describe('runtime filter preservation preview',()=>{
 test('isolated filter override without catalog or state mutation',()=>{
  const {bundle,state,context}=fixture(),before=JSON.stringify({bundle,state}),after:CatalogFilterState={...state,entityStates:{free:'disabled'}};
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,state,after,context)).toMatchObject({status:'filterOnlyPreservationCandidate',codes:[],writeAuthorized:false,impact:{beforeEnabled:4,afterEnabled:3,disabled:1,introducedHardDependencyBreaks:0}});
  expect(JSON.stringify({bundle,state})).toBe(before);
  expect(Object.isFrozen(bundle.runtimeIndex.entries[0].categoryIds)).toBe(false);
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,state,{...after,entityStates:{free:'disabled',owner:'disabled'}},context).codes).toContain('unexpectedFilterChanges');
 });
 test('rejects new hard breaks and protected entity/category overrides',()=>{
  const {bundle,state,context}=fixture();
  const after:CatalogFilterState={...state,entityStates:{required:'disabled'}};
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,state,after,{...context,id:'required'})).toMatchObject({status:'preservationBlocked',codes:['newHardDependencyBreaks'],impact:{introducedHardDependencyBreaks:1}});
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,state,{...state,entityStates:{protected:'disabled'}},{...context,id:'protected'}).codes).toContain('protectedEntity');
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,state,{...state,categoryStates:{'protected-category':false}},{...context,domain:'categoryStates',id:'protected-category',value:false}).codes).toContain('protectedCategory');
 });
 test('rejects stale snapshots, unknown overrides and changed policies',()=>{
  const {bundle,state,context}=fixture(),after:CatalogFilterState={...state,entityStates:{free:'disabled'}};
  expect(reviewRuntimeFilterPreservation(bundle,bundle,{...bundle,selectionContracts:{changed:true}},state,state,after,context).codes).toContain('runtimeBundleChanged');
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,{...state,entityStates:{owner:'disabled'}},after,context).codes).toContain('baseFilterMismatch');
  expect(reviewRuntimeFilterPreservation(bundle,bundle,bundle,state,state,{...state,entityStates:{unknown:'disabled'}},{...context,id:'unknown'}).codes).toContain('filterInventoryInvalid');
 });
});
