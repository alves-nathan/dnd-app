import { describe, expect, test } from '@jest/globals';
const {convert}=require('../../scripts/5etools/feature-converter');
const {reconcile}=require('../../scripts/5etools/historical-reconciliation');
const {digest}=require('../../scripts/5etools/integrated-review');
const {compareFeatFields,featContractEvidence,buildFeatParityEvidence,publicSummary}=require('../../scripts/5etools/feat-parity-evidence');
const commits={application:'a'.repeat(40),main:'b'.repeat(40),homebrew:'c'.repeat(40)};
function feat(name:string,code='XPHB',extra:Record<string,unknown>={}){
 const entity={name,source:code,entries:[],...extra};
 return convert({kind:'feat',blob:'d'.repeat(40),path:'data/feats.json',key:name,index:0},{entity,lineage:[]},
  {id:'upstream:main:'+code,rulesEra:code==='PHB'?'2014':'2024',precedenceScope:'official-dnd'},commits.main);
}
function input(){
 const items=[feat('Fixture','XPHB',{category:'G',repeatable:false,ability:[{str:1}]}),feat('Fixture','PHB',{repeatable:true})];
 const a={id:'old',kind:'feat',name:'Fixture',source:{id:'phb',rulesEra:'2024'},payload:{repeatable:false,mechanics:{skillProficiencyChoice:1}}};
 const b={...a,payload:{repeatable:true}};
 const c={...a,id:'unresolved',name:'Other'};
 const rawHistorical=[a,b,c].map((item,index)=>({path:'fixture',index,item}));
 const rows=rawHistorical.map(({item,path,index})=>({path,index,id:item.id,kind:item.kind,sourceId:item.source.id,rulesEra:item.source.rulesEra,itemHash:digest(item)}));
 const rt={entityId:'runtime',displayName:'Fixture'};
 const reconciliation=reconcile({historical:{rows,bootstrapRows:[]},runtime:{entries:[{id:'runtime',kind:'feat',book:'phb-2024',rulesEra:'2024',fingerprint:digest(rt)}],dependencies:[],aliases:[],categories:[]},rawHistorical,rawRuntime:[rt],items,records:[],commits});
 return {items,rawHistorical,reconciliation};
}
describe('a8.9.1 feat parity evidence',()=>{
 test('does not conflate absent with false or grant semantics with exact values',()=>{
  expect(compareFeatFields({repeatable:false,mechanics:{skillProficiencyChoice:1}},{mechanics:{skillProficiencyChoice:1}})).toEqual(expect.arrayContaining([
   {field:'/payload/repeatable',status:'missingCandidate'},{field:'/payload/mechanics/skillProficiencyChoice',status:'exactValue'}]));
  const c=featContractEvidence(feat('Fixture','XPHB',{category:'G',repeatable:true,repeatableNote:'different choice',ability:[{str:1}],additionalSpells:[]}),commits.main);
  expect(c).toMatchObject({repeatability:'conditionalPending',category:'mappedCategoryCandidate',asi:'simpleShapeCandidate',declarations:[{field:'additionalSpells',status:'semanticsPending'}]});
  expect(featContractEvidence(feat('Fixture'),commits.main).repeatability).toBe('notDeclared');
 });
 test('preserves distinct historical occurrences and source-qualified identities; emits aggregate only',()=>{
  const x=input(),r=buildFeatParityEvidence(x);
  expect(r.historical).toMatchObject({occurrences:3,identityCandidates:2,identityPending:1,eraPending:0});
  expect(r.runtime).toMatchObject({occurrences:1,identityCandidates:1});
  expect(r.rows.slice(0,2).map((row:any)=>row.targetId)).toEqual([x.items[0].id,x.items[0].id]);
  expect(r.rows[0].sourceFingerprint).not.toBe(r.rows[1].sourceFingerprint);
  expect(r.upstream.items).toBe(2);
  expect([...r.rows,...r.upstreamRows,...r.runtimeRows].every((row:any)=>!row.runtimeEligible&&!row.writeAuthorized&&!row.retirementAuthorized)).toBe(true);
  expect(r.mechanicalParityEstablished).toBe(0);
  const summary=publicSummary(r);
  expect(summary.rows).toBeUndefined();expect(summary.upstreamRows).toBeUndefined();expect(summary.runtimeRows).toBeUndefined();
  expect(buildFeatParityEvidence(x).fingerprint).toBe(r.fingerprint);
 });
 test('rejects tampered source, wrong edition target even with matching digest, and missing occurrences',()=>{
  const x=input();x.items[0].provenance.sourceCode='PHB';
  expect(()=>buildFeatParityEvidence(x)).toThrow('featSourceMismatch');
  const y=input();y.reconciliation.historical[0].targetId=y.items[1].id;y.reconciliation.historical[0].targetFingerprint=digest(y.items[1]);
  expect(()=>buildFeatParityEvidence(y)).toThrow('targetBindingMismatch');
  const z=input();z.reconciliation.historical.pop();
  expect(()=>buildFeatParityEvidence(z)).toThrow('historicalCoverageMismatch');
 });
});
