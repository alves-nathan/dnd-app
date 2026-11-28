export {};
const {digest}=require('../../scripts/5etools/integrated-review');
const {buildRelationshipIdentityReview}=require('../../scripts/5etools/relationship-identity-review');
function fixture(repeated=false,editionPending=false){
 const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
 const target=(id:string,kind:string,payload:Record<string,unknown>)=>({id,kind,payload,source:{rulesEra:'2024'},provenance:{origin:'5etools',commit:commits.main,sourceCode:'FIX'}});
 const owner=target('new-owner','class',{featureIds:['new-feature'],progression:[{level:3,featureIds:['new-feature']}]});
 const feature=target('new-feature','feature',{classId:owner.id});
 const oldOwner={id:'old-owner',kind:'class',payload:{featureIds:repeated?['old-feature','old-feature']:['old-feature'],progression:[{level:3,featureIds:['old-feature']}]}};
 const oldFeature={id:'old-feature',kind:'feature',payload:{classId:'old-owner'}};
 const rt=[{entityId:'rt-owner'},{entityId:'rt-feature'}];
 const edge={id:'edge',fromId:rt[0].entityId,toId:rt[1].entityId,relation:'grant',strength:'hard',status:'active',resolutionPolicy:'requireEnabled'};
 const base={status:'identityCandidate',eraStatus:'sameKnownEra',preservation:'required',decision:'unreviewed',activation:'review-required'};
 const historical=[oldOwner,oldFeature].map((item,index)=>({...base,domain:'historical',id:item.id,kind:item.kind,path:'fixture',index,evidenceId:'h'+index,sourceFingerprint:digest(item),targetId:[owner,feature][index].id,targetFingerprint:digest([owner,feature][index]),eraStatus:editionPending&&index===1?'editionReviewRequired':'sameKnownEra'}));
 const runtime=rt.map((item,index)=>({...base,domain:'runtime',id:item.entityId,kind:[owner,feature][index].kind,evidenceId:'r'+index,sourceFingerprint:digest(item),targetId:[owner,feature][index].id,targetFingerprint:digest([owner,feature][index]),eraStatus:editionPending&&index===1?'editionReviewRequired':'sameKnownEra'}));
 const link=(index:number,field:string,toId:string)=>({fromId:[oldOwner,oldFeature][index].id,path:'fixture',index,field,toId,status:'historicalEndpointObserved',preservation:'required'});
 const legacyLinks=[link(0,'featureIds','old-feature'),...(repeated?[link(0,'featureIds','old-feature')]:[]),link(0,'progression.featureIds','old-feature'),link(1,'classId','old-owner')];
 const reconciliation={schemaVersion:'dnd-upstream-historical-reconciliation.v1',activation:'review-required',commits,summary:{issues:{},approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false,legacyLinks:legacyLinks.length,runtimeDependencies:1},historical,runtime,legacyLinks,dependencies:[{...edge,fingerprint:digest(edge),statusOriginal:edge.status,preservation:'required',mappingStatus:'bothEndpointsCandidate',fromCandidate:owner.id,toCandidate:feature.id}]};
 return {reconciliation,rawHistorical:[oldOwner,oldFeature].map((item,index)=>({path:'fixture',index,item})),items:[owner,feature],runtimeBundle:{runtimeIndex:{entries:rt},dependencyGraph:{edges:[edge]}}};
}
describe('a8.18.1 relationship identity and occurrence preservation',()=>{
 test('observes physical owner/grant/progression candidates but does not infer runtime relation parity',()=>{
  const f=fixture(),before=digest(f),r=buildRelationshipIdentityReview(f);
  expect(r.legacy).toMatchObject({occurrences:3,byDisposition:{explicitPhysicalRelationCandidate:3}});
  expect(r.dependencies).toMatchObject({occurrences:1,requiredByCurrentFilter:1,byDisposition:{qualifiedEndpointsRelationSemanticsPending:1}});
  expect(r).toMatchObject({relationshipParityEstablished:0,approvedMappings:0,writeAuthorized:false,readiness:'blocked'});
  expect(JSON.stringify(r)).not.toContain('old-owner');
  expect(digest(f)).toBe(before);
 });
 test('preserves repeated references rather than using one match twice; unknown edition is not qualified',()=>{
  const r=buildRelationshipIdentityReview(fixture(true));
  expect(r.legacy).toMatchObject({occurrences:4,repeatedDeclarations:1,byDisposition:{explicitPhysicalRelationCandidate:3,relationLevelOrMultiplicityPending:1}});
  const pending=buildRelationshipIdentityReview(fixture(false,true));
  expect(pending.legacy.byDisposition).toEqual({targetEditionPending:2,ownerEditionPending:1});
  expect(pending.dependencies.byDisposition).toEqual({endpointEditionPending:1});
 });
 test('rejects missing declarations, stale source and invented dependency mapping',()=>{
  const f=fixture();f.reconciliation.legacyLinks.pop();
  expect(()=>buildRelationshipIdentityReview(f)).toThrow('relationshipLegacyDeclarationMismatch');
  const s=fixture(),payload=s.rawHistorical[0].item.payload;
  if(!('featureIds' in payload)||!Array.isArray(payload.featureIds))throw Error('invalid fixture owner');
  payload.featureIds.push('missing');
  expect(()=>buildRelationshipIdentityReview(s)).toThrow('relationshipOccurrenceBindingMismatch');
  const t=fixture();t.reconciliation.dependencies[0].toCandidate='wrong';
  expect(()=>buildRelationshipIdentityReview(t)).toThrow('relationshipDependencyMappingMismatch');
 });
});
