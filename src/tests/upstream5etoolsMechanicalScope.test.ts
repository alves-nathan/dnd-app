export {};
const {buildMechanicalScopeReview}=require('../../scripts/5etools/mechanical-scope-review');
const {digest}=require('../../scripts/5etools/integrated-review');
const {comparePayload}=require('../../scripts/5etools/historical-reconciliation');
function fixture(era='2024',targetEra='2024',changed=false){
 const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
 const raw={id:'private-old',kind:'spell',source:{rulesEra:era},payload:{level:1,mechanics:{old:1}}};
 const target={id:'private-new',kind:'spell',source:{rulesEra:targetEra},provenance:{origin:'5etools',commit:commits.main},payload:changed?{level:2,mechanics:{next:2}}:raw.payload};
 const runtime={entityId:'private-runtime',kind:'rule'};
 const historical={domain:'historical',id:raw.id,kind:'spell',path:'private-file',index:0,evidenceId:'private-historical',sourceFingerprint:digest(raw),targetId:target.id,targetFingerprint:digest(target),status:'identityCandidate',eraStatus:'sameKnownEra',comparison:comparePayload(raw.payload,target.payload),decision:'unreviewed',preservation:'required',activation:'review-required'};
 const rt={domain:'runtime',id:runtime.entityId,kind:'rule',evidenceId:'private-runtime-occurrence',sourceFingerprint:digest(runtime),status:'runtimeContractOutsideV3',decision:'unreviewed',preservation:'required',activation:'review-required'};
 const reconciliation={schemaVersion:'dnd-upstream-historical-reconciliation.v1',activation:'review-required',commits,summary:{issues:{},approvedMappings:0,mechanicalParityEstablished:0,retirementAuthorized:false,historicalOccurrences:1,runtime:1},historical:[historical],runtime:[rt]};
 return {reconciliation,rawHistorical:[{path:'private-file',index:0,item:raw}],items:[target],runtimeBundle:{runtimeIndex:{entries:[runtime]}}};
}
describe('a8.17.1 mechanical scope and occurrence dispositions',()=>{
 test('exact payload is not mechanical parity; runtime-only contracts remain separate',()=>{
  const f=fixture(),before=digest(f),r=buildMechanicalScopeReview(f);
  expect(r.byFamily.spell.historical.dispositions).toEqual({preserveExactPayloadPendingConsumer:1});
  expect(r.byFamily.outsideV3.runtime.dispositions).toEqual({preserveOutsideV3:1});
  expect(r).toMatchObject({mechanicalParityEstablished:0,approvedMappings:0,writeAuthorized:false,retirementAuthorized:false});
  expect(JSON.stringify(r)).not.toContain('private-old');
  expect(digest(f)).toBe(before);
 });
 test('separates cross-edition and legacy-label occurrences and retains nested field differences',()=>{
  expect(buildMechanicalScopeReview(fixture('2014','2024')).byFamily.spell.historical.dispositions).toEqual({preserveEditionConflict:1});
  expect(buildMechanicalScopeReview(fixture('legacy','2014')).byFamily.spell.historical.dispositions).toEqual({preserveEditionUnverified:1});
  const r=buildMechanicalScopeReview(fixture('2024','2024',true));
  expect(r.byFamily.spell.historical).toMatchObject({dispositions:{preservePayloadDifferences:1},fields:{different:2},mechanicsFields:{legacyOnly:1,candidateOnly:1}});
 });
 test('rejects stale raw data, target substitutions and invented field comparison',()=>{
  const f=fixture();f.rawHistorical[0].item.payload.level=2;
  expect(()=>buildMechanicalScopeReview(f)).toThrow('mechanicalSourceBindingMismatch');
  const t=fixture();t.items[0].id='wrong';
  expect(()=>buildMechanicalScopeReview(t)).toThrow('mechanicalTargetBindingMismatch');
  const c=fixture();c.reconciliation.historical[0].comparison.status='forged';
  expect(()=>buildMechanicalScopeReview(c)).toThrow('mechanicalPayloadComparisonMismatch');
 });
});
