'use strict';
// Review-only inventory of obligations in the 28 non-Exhaustion PHB/XPHB
// definitions. Definitions are bound by exact canonical entries SHA-256.
const {digest}=require('./integrated-review');
const {physicalId,stagingConditionId}=require('./condition-converter');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const definitions={
 Blinded:['fcc0b8cf512da4ef13b1b6063f02fd116d05f13cbe6189969e81a4bdc5a3699b','9c5eeb9227c8d1120f7fbdd4a442cb2bb97af92d5ac21db5ec190c0307155586','sightBlocked sightCheckAutoFail outgoingAttackDisadvantage incomingAttackAdvantage',''],
 Charmed:['d9f98dc737a78de5016f1acb2e26801fc49bd6f4e090aaafa38643f8ed8dc6ca','829b5819fadf69d2d6c03a7c8b8549a95c04039b7dc09a8d56e123d278c7054b','charmerAttackBlocked charmerSocialAdvantage','harmfulTargetingBlocked','damagingTargetingBlocked'],
 Deafened:['40cf65c5f8af6e80f58ba1b976676fb7032257b6692387a69893a5aa6a7cfdff','b8a4a99641e25c199d94fb44457dc9869cafcfdcf9830e637e1d4449d9c8acc6','hearingBlocked hearingCheckAutoFail',''],
 Frightened:['b505be4746e9fee220870d35ed51f17f9341fbe4f9a74c5a1eeb1597cf49596e','726df590c1c3fe3ca1937879a51a28091a3dd50d239cbd1281f77e58cd995898','fearSourceVisibleCheckDisadvantage fearSourceVisibleAttackDisadvantage voluntaryApproachBlocked',''],
 Grappled:['e5386a47cda11a470e02d347ecc48f0be333340935a9047f4de12a306e0fe26a','85b76f38ce949e7843ef5e6989daf580cf62a67e3be4eebbc123f425d73a03d9','speedLockedZero','grapplerIncapacitatedEnds outsideGrapplerReachEnds','nonGrapplerAttackDisadvantage grapplerDragCarrySizeCost'],
 Incapacitated:['823be72a2045eb0ae599d3498a129f19cc08434da5eba3bb2ad87d146313e88f','48ab3478d114ab5d215fbf66395ddf3a1ce25a3f7052a4d6f2b2517cd83ccd48','actionBlocked reactionBlocked','bonusActionCrossRuleReview','bonusActionBlocked concentrationBroken speechBlocked initiativeDisadvantage'],
 Invisible:['08ab7bc3389cb7ba0c79dfb043f570892b38bbebd02b7023906d7a9147ad7fd5','ff37bc653da873d2d2aa63906648afc9fc95b83f2614326b9cd225f81be3119b','','sightSpecialSenseException heavilyObscuredForHiding noiseTracksReveal outgoingAttackAdvantage incomingAttackDisadvantage','initiativeAdvantage seenTargetEffectException carriedEquipmentConcealed visibleOpponentAttackException'],
 Paralyzed:['1c28c85db4c72b9703ed46d7cedc78e6972c2773b5f43f89e61b65fc2ae08c7f','53904d5aed3c4b480a35c224542dc65006c10f5b7e930618f7f37491f4407e5c','impliesIncapacitated strDexSaveAutoFail incomingAttackAdvantage hitWithinFiveFeetCritical','movementBlocked speechBlocked','speedLockedZero'],
 Petrified:['a4b3f820a4cb9ded4ebd283d9a36ee596bd64fb3e7355cb67203eadf5532ee28','f54f4bbfcd001f5f9f73ed20e3f5fc12aba362e79d944eb282141e0fa0b2825d','inanimateTransformation weightTimesTen agingStopped impliesIncapacitated incomingAttackAdvantage strDexSaveAutoFail allDamageResistance','movementBlocked speechBlocked surroundingsUnaware poisonDiseaseImmunity poisonDiseaseSuspended','speedLockedZero poisonedConditionImmunity'],
 Poisoned:['5b561a26a1fe8043a7c5000b2a5cd60e72574950b65f90e34165159fd3111ee0','c5e25330d01d1dd4b4f24d12ead52165f2d2dd8095837c419084cf9a50c8cebc','outgoingAttackDisadvantage abilityCheckDisadvantage',''],
 Prone:['62044064ec69628e9d5ca19beae313a1f7ecdacaf693a0b24a1536cf49443b33','10835a68cf953de96c1268e6ea6dc59f5efeb95c50d814e83cd37fefc7933ed4','crawlOnly standEnds outgoingAttackDisadvantage incomingProneDistanceRoll','standCostCrossRuleReview','standHalfSpeedFloor standBlockedAtZeroSpeed'],
 Restrained:['03dd1921c603732e63bb6ba9b5e4f1a96753ba0fe820d37e28b5329cf4148282','4a224f249f1406c2e494d8b36dc56f2a3ad56fbb3a77d70eb498732203be9790','speedLockedZero incomingAttackAdvantage outgoingAttackDisadvantage dexSaveDisadvantage',''],
 Stunned:['cbb5f364239d013f08fed529c7d9e5ca96e68d63cc2b60867e31c1cc6f8148b2','af2a07f96387c7191ed5365c4f3cc2234b235ddf34232bbc0e65c8af30a1616d','impliesIncapacitated strDexSaveAutoFail incomingAttackAdvantage','movementBlocked falteringSpeech'],
 Unconscious:['712e4170e531e04741f98d203870fea542a94b270eed7f356dc9c2813957cac2','1fdb1971c7b92febe2f0109f308227db8f88217e93f38092689fd2b237790fa2','impliesIncapacitated impliesProne heldItemsDropped surroundingsUnaware strDexSaveAutoFail incomingAttackAdvantage hitWithinFiveFeetCritical','movementBlocked speechBlocked','speedLockedZero pronePersistsOnEnd']
};
// A capability is not a full condition implementation. Only the named Prone
// target roll hook is directly demonstrated; other generic primitives require
// explicit context and orchestration. No capability implies an approved alias.
const hooks={
 incomingProneDistanceRoll:['directTargetHook','combatStateForTarget'],
 incomingAttackAdvantage:['primitiveOnly','calculateHitChance'],
 incomingAttackDisadvantage:['primitiveOnly','calculateHitChance'],
 outgoingAttackAdvantage:['primitiveOnly','calculateHitChance'],
 outgoingAttackDisadvantage:['primitiveOnly','calculateHitChance'],
 fearSourceVisibleAttackDisadvantage:['primitiveOnly','calculateHitChance'],
 nonGrapplerAttackDisadvantage:['primitiveOnly','calculateHitChance'],
 visibleOpponentAttackException:['primitiveOnly','calculateHitChance'],
 concentrationBroken:['previewOnly','previewConditionImplications'],
 speedLockedZero:['previewOnly','previewConditionMovement'],
 movementBlocked:['previewOnly','previewConditionMovement'],
 actionBlocked:['primitiveOnly','validateTurnRotation'],
 reactionBlocked:['primitiveOnly','validateTurnRotation'],
 bonusActionBlocked:['primitiveOnly','validateTurnRotation'],
 impliesIncapacitated:['previewOnly','previewConditionImplications'],
 impliesProne:['previewOnly','previewConditionImplications/previewConditionLifecycle'],
 standEnds:['primitiveOnly','removeActiveEffectFromCharacter'],
 strDexSaveAutoFail:['previewOnly','previewConditionSave'],
 dexSaveDisadvantage:['previewOnly','previewConditionSave'],
 standHalfSpeedFloor:['previewOnly','previewConditionMovement'],
 standBlockedAtZeroSpeed:['previewOnly','previewConditionMovement'],
 pronePersistsOnEnd:['previewOnly','previewConditionLifecycle'],
 hitWithinFiveFeetCritical:['primitiveOnly','calculateHitChance.criticalOnHit'],
 bonusActionCrossRuleReview:['crossRuleReview',''],
 standCostCrossRuleReview:['crossRuleReview','']
};
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const words=s=>s?s.split(' '):[];
function bindCondition(item){
 try{
  const p=item.provenance,raw=item.payload.mechanics.upstreamCondition,era=p.sourceCode==='PHB'?'2014':p.sourceCode==='XPHB'?'2024':null;
  const def=own(definitions,item.name)?definitions[item.name]:null;
  if(!def||!era||item.kind!=='condition'||raw.name!==item.name||raw.source!==p.sourceCode||
    p.origin!=='5etools'||p.repository!=='5etools-mirror-3/5etools-src'||p.path!=='data/conditionsdiseases.json'||
    !/^[a-f0-9]{40}$/.test(p.commit)||!/^[a-f0-9]{40}$/.test(p.blob)||
    item.source.status!=='needsReview'||item.source.rulesEra!==era||item.source.id!=='upstream:main:'+p.sourceCode||
    item.identity.canonicalKey!=='condition:'+item.name.toLowerCase()||item.id!==physicalId(raw)||item.payload.conditionId!==stagingConditionId(raw))
    return {...flags(),status:'indeterminate',code:'editionIdentityPending'};
  const fp=def[era==='2014'?0:1];
  if(digest(raw.entries)!==fp)return {...flags(),status:'indeterminate',code:'definitionChanged'};
  const obligations=[...words(def[2]),...words(def[era==='2014'?3:4])].map(key=>{
    const [coverage,hook]=hooks[key]||['notDemonstrated',''];
    return {key,coverage,...(hook?{hook}:{}),...flags()};
  });
  return {...flags(),status:'capabilityReviewCandidate',rulesEra:era,definitionFingerprint:fp,itemFingerprint:digest(item),obligations};
 }catch{return {...flags(),status:'indeterminate',code:'invalidConditionEvidence'};}
}
function buildCapabilityMatrix(pilot){
 const rows=[],seen=new Set(),byEra={},byCoverage={};
 for(const pack of pilot.packs)for(const item of pack.items){
  if(item.name==='Exhaustion')continue;
  if(seen.has(item.id)||item.kind!=='condition'||item.provenance.commit!==pilot.commit)throw Error('conditionInventoryMismatch');
  seen.add(item.id);
  const era=item.source.rulesEra;
  if(!['2014','2024'].includes(era))throw Error('conditionEditionMismatch');
  const r=bindCondition(item),s=byEra[era]??={total:0,bound:0,indeterminate:0,obligations:0};
  s.total++;
  if(r.status==='capabilityReviewCandidate'){
    s.bound++;s.obligations+=r.obligations.length;
    for(const o of r.obligations)byCoverage[o.coverage]=(byCoverage[o.coverage]||0)+1;
  }else s.indeterminate++;
  rows.push({itemId:item.id,rulesEra:era,...r});
 }
 const body={schemaVersion:'dnd-upstream-condition-capabilities.v1',commit:pilot.commit,byEra,byCoverage,rows,
   scope:'condition definition clauses only; cross-rule mechanics and full runtime coverage not established',
   mechanicalParityEstablished:0,approvedMappings:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(report){const {rows,...summary}=report;return summary;}
module.exports={bindCondition,buildCapabilityMatrix,publicSummary};
