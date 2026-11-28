'use strict';
// Scoped, manually reviewed numeric model of two observed Exhaustion definitions.
// This is an audit/preview only, not a runtime effect, condition alias or migration.
const {digest}=require('./integrated-review');
const {physicalId,stagingConditionId}=require('./condition-converter');
const definitions=Object.freeze({
  PHB:{era:'2014',entriesFingerprint:'1ee3ce9f7a52282e835709c6569f98bd1caf07394526e2311477e987060b16b6'},
  XPHB:{era:'2024',entriesFingerprint:'2b34f04458aa1ecb57a6b05d2adffff68f87f56208cf40d533a5f279a5cc865e'}
});
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const natural=n=>Number.isSafeInteger(n)&&n>=0;
const validEra=era=>era==='2014'||era==='2024';
const validLevel=n=>natural(n)&&n<=6;
const base=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const pending=code=>({...base(),status:'indeterminate',code});
function bindExhaustion(item){
  try {
    const p=item.provenance,raw=item.payload.mechanics.upstreamCondition,def=own(definitions,p.sourceCode)?definitions[p.sourceCode]:null;
    if(!def||item.kind!=='condition'||item.name!=='Exhaustion'||raw.name!==item.name||raw.source!==p.sourceCode||
        p.origin!=='5etools'||p.repository!=='5etools-mirror-3/5etools-src'||p.path!=='data/conditionsdiseases.json'||
        !/^[a-f0-9]{40}$/.test(p.commit)||!/^[a-f0-9]{40}$/.test(p.blob)||
        item.id!==physicalId(raw)||item.payload.conditionId!==stagingConditionId(raw)||
        item.source.rulesEra!==def.era||item.source.id!=='upstream:main:'+p.sourceCode||
        item.source.status!=='needsReview'||item.identity.canonicalKey!=='condition:exhaustion')
      return pending('editionIdentityPending');
    if(digest(raw.entries)!==def.entriesFingerprint)return pending('definitionChanged');
    return {...base(),status:'editionModelCandidate',rulesEra:def.era,definitionFingerprint:def.entriesFingerprint,
      itemFingerprint:digest(item)};
  } catch {return pending('invalidConditionEvidence');}
}
/** Explicit hypothetical level and unmodified bases. No inference from an
 * ActiveEffect count, no combination with other effects, no HP mutation.
 * At level 6 death is terminal; do not compute a live creature's statistics. */
function previewExhaustion({rulesEra,level,baseSpeedFeet,baseHitPointMaximum}={}){
  if(!validEra(rulesEra)||!validLevel(level)||!natural(baseSpeedFeet)||!natural(baseHitPointMaximum)||baseHitPointMaximum<1)
    return pending('explicitEditionLevelAndBasesRequired');
  const common={...base(),status:'mechanicalPreviewCandidate',rulesEra,level,dead:level===6};
  if(level===6)return common;
  const legacy=rulesEra==='2014';
  return {...common,
    disadvantage:{abilityChecks:legacy&&level>=1,attackRolls:legacy&&level>=3,savingThrows:legacy&&level>=3},
    d20Modifier:legacy||level===0?0:-2*level,
    speedFeet:legacy?(level>=5?0:level>=2?Math.floor(baseSpeedFeet/2):baseSpeedFeet):Math.max(0,baseSpeedFeet-5*level),
    hitPointMaximum:legacy&&level>=4?Math.floor(baseHitPointMaximum/2):baseHitPointMaximum};
}
/** Hypothetical single transition. Death is not automatically reversed.
 * 2014 resurrection needs an explicit external confirmation. 2024 revival
 * handling is outside the observed definition and stays pending. */
function previewExhaustionTransition({rulesEra,level,event,amount,foodAndDrinkConfirmed,revivalConfirmed}={}){
  if(!validEra(rulesEra)||!validLevel(level))return pending('explicitEditionAndLevelRequired');
  let next=level;
  if(event==='revival'){
    if(rulesEra!=='2014'||level!==6||revivalConfirmed!==true)return pending('revivalPolicyPending');
    next=5;
  }else{
    if(level===6)return pending('deathRequiresExternalResolution');
    if(event==='receive'){
      if(rulesEra==='2024'){
        if(amount!==undefined&&amount!==1)return pending('multipleLevelsNeedSeparateEvidence');
        next=level+1;
      }else{
        if(!natural(amount)||amount<1||amount>6)return pending('explicitGrantAmountRequired');
        next=level+amount;
      }
    }else if(event==='longRest'){
      if(rulesEra==='2014'){
        if(typeof foodAndDrinkConfirmed!=='boolean')return pending('foodAndDrinkContextRequired');
        next=level-(foodAndDrinkConfirmed?1:0);
      }else next=level-1;
    }else if(event==='explicitRemoval'){
      if(!natural(amount)||amount<1||amount>6)return pending('explicitRemovalAmountRequired');
      next=level-amount;
    }else return pending('unsupportedTransition');
  }
  next=Math.min(6,Math.max(0,next));
  return {...base(),status:'transitionCandidate',rulesEra,previousLevel:level,level:next,dead:next===6,conditionEnded:next===0};
}
function buildConditionMechanicsReport(pilot){
  const rows=[],byEra={},seen=new Set();
  for(const pack of pilot.packs)for(const item of pack.items){
    if(seen.has(item.id)||item.kind!=='condition'||item.source.status!=='needsReview'||item.provenance.commit!==pilot.commit)
      throw Error('conditionInventoryMismatch');
    seen.add(item.id);
    const era=item.source.rulesEra;
    if(!validEra(era))throw Error('conditionEditionMismatch');
    const bound=item.name==='Exhaustion'?bindExhaustion(item):{...base(),status:'effectsReviewPending'};
    rows.push({itemId:item.id,rulesEra:era,...bound});
    const s=byEra[era]??={total:0,editionModelCandidate:0,effectsReviewPending:0,indeterminate:0};
    s.total++;s[bound.status]++;
  }
  const body={schemaVersion:'dnd-upstream-condition-mechanics.v1',commit:pilot.commit,byEra,rows,
    limitations:['runtimeConditionIdsDoNotRepresentLevels','restEngineDoesNotDecrementConditionLevels','otherConditionEffectsUnreviewed',
      'otherModifierAndRoundingInteractionsUnreviewed','noRuntimeAliasOrActivation'],
    approvedMappings:0,mechanicalParityEstablished:0,...base()};
  return {...body,fingerprint:digest(body)};
}
function publicSummary(report){const {rows,...summary}=report;return summary;}
module.exports={bindExhaustion,previewExhaustion,previewExhaustionTransition,buildConditionMechanicsReport,publicSummary};
