'use strict';
// a8.7.3: narrowly reviewed instantaneous spell effects, not a cast executor.
const {digest}=require('./integrated-review');
const {physicalId}=require('./spell-converter');
const {buildSpellCastingProjection}=require('./spell-casting-projection');
const {parseFormula,toDamageFormula,resolveSaveDamage}=require('./effect-damage-preview');
const commit='2512db75eb48ef06f6190b086a82430887906dca';
const definitions=[
 ['Cure Wounds','healing','e29ac1d11d4eea0955a447870af607091580f9d38cb9e20779c18fe10dce779b','105ce92b594b5003f5891c9a221707c08f206b9073fce85feea60344b0248749'],
 ['Eldritch Blast','beamAttack','14dcdcef59912edfe6bf9d346e93ed6503797cbb52205f504043452ac5231673','375232a3f26b8289739d5f2f0505721d6a8aa7f2c505140b981dae4adcc215c0'],
 ['Fire Bolt','singleAttack','a1d32a81f9429cd0c26564cf6160d1853de5a6896f1e137052a9a702188bce50','d176fba1db13920bfb4bc3c94478279c14f98c1eda8d28e79410154420183b30'],
 ['Fireball','areaSave','60e6d0380b225365fec2a8531ea904458427cffcbbcc55b830db201634f3d75d','0ad3119dea22bc1e910fa925c7d69fc2bd8f1d830441d872e2b08000631b06e3'],
 ['Magic Missile','projectile','60130994d2f5c097091549bbf3465da637b99be6a26c564ea7f98e3fd08614f7','30d5ec0bcd2f2d30046cfad72ce5ec92847000d8bf4da05dbd24804de7814800'],
 ['Sacred Flame','singleSave','fba348b9b54b342cf78adfbfb358b07fecc711cf3bb8f44333706a4938b5fd6b','4ec3571e395b243ab6fd0f044c70d0803f72a25d4b1e63efddccb7ca79f78af3']
];
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const int=x=>Number.isSafeInteger(x);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
function definitionFingerprint(i){
 const r=i.payload.mechanics.upstreamSpell;
 return digest({level:i.payload.level,entries:r.entries,entriesHigherLevel:r.entriesHigherLevel,scalingLevelDice:r.scalingLevelDice,damageTypes:r.damageTypes,
 spellAttack:r.spellAttack,savingThrow:r.savingThrow,duration:r.duration,range:r.range,time:r.time,components:r.components});
}
function buildSpellEffectProjection(input,casting){
 const actual=buildSpellCastingProjection(input);
 if(casting!==undefined&&digest(casting)!==digest(actual))throw Error('castingEvidenceMismatch');
 const byId=new Map(actual.rows.map(r=>[r.itemId,r])),items=new Map(input.items.map(i=>[i.id,i])),rows=[],counts={},byFamily={};
 for(const [name,family,legacy,revised] of definitions){
  for(const [source,era,expected] of [['PHB','2014',legacy],['XPHB','2024',revised]]){
   const itemId=physicalId(source,name),i=items.get(itemId),c=byId.get(itemId);
   const base={itemId,family,rulesEra:era,...flags()};
   let row;
   if(actual.commits.main!==commit)row={...base,status:'snapshotPending'};
   else if(!i||!c)row={...base,status:'identityPending'};
   else if(c.sourceFingerprint!==digest(i)||c.rulesEra!==era||i.provenance.sourceCode!==source||
    definitionFingerprint(i)!==expected)row={...base,status:'definitionPending'};
   else row={...base,status:'baseEffectCandidate',sourceFingerprint:c.sourceFingerprint,definitionFingerprint:expected,spellLevel:i.payload.level};
   rows.push(row);bump(counts,row.status);if(row.status==='baseEffectCandidate')bump(byFamily,family);
  }
 }
 const body={schemaVersion:'dnd-upstream-spell-effect-projection.v1',commits:actual.commits,castingFingerprint:actual.fingerprint,
  scope:'12 exact PHB/XPHB base effect definitions; other spells not assessed',upstreamSpells:actual.summary.items,
  counts,byFamily,rows,approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
// The following model is not a complete casting rule. The caller confirms
// target eligibility, geometry, access, base-only effects and exceptions.
function effectShape(row,characterLevel,slotLevel,abilityModifier){
 if(row.status!=='baseEffectCandidate'||!int(characterLevel)||characterLevel<1||characterLevel>20||!int(slotLevel)||slotLevel<row.spellLevel||slotLevel>9||
  (row.spellLevel===0&&slotLevel!==0))return null;
 const tier=characterLevel>=17?4:characterLevel>=11?3:characterLevel>=5?2:1;
 switch(row.family){
  case 'singleAttack':return {mode:'attack',count:1,dice:tier,sides:10,flat:0,damageType:'fire'};
  case 'beamAttack':return {mode:'attack',count:tier,dice:1,sides:10,flat:0,damageType:'force'};
  case 'singleSave':return {mode:'save',count:1,dice:tier,sides:8,flat:0,damageType:'radiant',saveAbility:'DEX',successPolicy:'none'};
  case 'areaSave':return {mode:'save',count:'perTarget',dice:8+slotLevel-3,sides:6,flat:0,damageType:'fire',saveAbility:'DEX',successPolicy:'half',sharedRoll:true};
  case 'projectile':return {mode:'guaranteed',count:2+slotLevel,dice:1,sides:4,flat:1,damageType:'force'};
  case 'healing':
   if(!int(abilityModifier)||abilityModifier < -5||abilityModifier>10)return null;
   return {mode:'healing',count:1,dice:slotLevel*(row.rulesEra==='2024'?2:1),sides:8,flat:abilityModifier};
  default:return null;
 }
}
// A numeric outcome uses actual supplied dice, not RNG or an expected DPR
// multiplier. Critical dice are doubled only on a confirmed attack critical.
function resolveEffectEvents(row,request){
 if(request.baseOnlyConfirmed!==true||request.castingContextConfirmed!==true||request.targetPolicyConfirmed!==true||
  request.exceptionsReviewedConfirmed!==true||!Array.isArray(request.targets)||!request.targets.length||!Array.isArray(request.events))return pending('explicitEffectContextRequired');
 const s=effectShape(row,request.characterLevel,request.slotLevel,request.spellcastingAbilityModifier);
 if(!s)return pending('levelSlotOrAbilityPending');
 const targets=new Map();
 for(const t of request.targets){
  if(!rec(t)||!id(t.id)||targets.has(t.id)||!['creature','object'].includes(t.kind)||t.eligibilityConfirmed!==true)return pending('targetBindingPending');
  const objectAllowed=row.family==='singleAttack'||(row.family==='beamAttack'&&row.rulesEra==='2024');
  if(t.kind==='object'&&!objectAllowed)return pending('targetKindNotSupported');
  if(row.family==='healing'&&row.rulesEra==='2014'){
   if(!id(t.creatureType))return pending('creatureTypePending');
   if(['undead','construct'].includes(t.creatureType.toLowerCase()))return pending('legacyHealingTargetExcluded');
  }
  targets.set(t.id,t);
 }
 const count=s.count==='perTarget'?targets.size:s.count;
 if(request.events.length!==count)return pending('eventCountMismatch');
 if(row.family==='projectile'&&(!['shared','independent'].includes(request.projectileRollPolicy)||request.projectileRollPolicyConfirmed!==true))return pending('projectileRollPolicyPending');
 const shared=s.sharedRoll===true||(row.family==='projectile'&&request.projectileRollPolicy==='shared');
 const seenTargets=new Set(),events=[];let commonRoll;
 const rawFormula=s.dice+'d'+s.sides+(s.flat>0?'+'+s.flat:s.flat<0?String(s.flat):'');
 const parsed=parseFormula(rawFormula);
 if(parsed.status!=='formulaCandidate')return pending('formulaPending');
 for(const [index,e] of request.events.entries()){
  if(!rec(e)||!targets.has(e.targetId)||!Array.isArray(e.rolls))return pending('eventTargetOrRollPending');
  if(s.count==='perTarget'&&seenTargets.has(e.targetId))return pending('duplicateAreaTarget');
  seenTargets.add(e.targetId);
  const valid=s.mode==='attack'?['hit','critical','miss']:s.mode==='save'?['success','failure']:s.mode==='healing'?['heal']:['guaranteed'];
  if(!valid.includes(e.outcome))return pending('effectOutcomeMismatch');
  const rollCount=e.outcome==='miss'?0:s.dice*(e.outcome==='critical'?2:1);
  if(e.rolls.length!==rollCount||!e.rolls.every(x=>int(x)&&x>=1&&x<=s.sides))return pending('diceRollMismatch');
  if(shared){
   const h=digest(e.rolls);
   if(commonRoll!==undefined&&commonRoll!==h)return pending('sharedRollMismatch');
   commonRoll=h;
  }
  const rolled=e.outcome==='miss'?0:e.rolls.reduce((a,b)=>a+b,0)+s.flat;
  if(!int(rolled)||rolled<0)return pending('negativeOrInvalidEffectTotal');
  let amount=rolled;
  if(s.mode==='save'){
   const result=resolveSaveDamage(rolled,e.outcome,s.successPolicy);
   if(result.status!=='damageEventCandidate')return pending('saveResolutionPending');
   amount=result.amount;
  }
  const formula=s.mode==='healing'?undefined:toDamageFormula(parsed,{bindingId:row.itemId+':'+index,sourceType:'spell',
   application:s.mode==='attack'?'onHit':s.mode==='save'?'onSaveFail':'guaranteed',criticalPolicy:s.mode==='attack'?'attack':'nonAttack'});
  if(formula&&formula.status!=='damageFormulaCandidate')return pending('formulaBindingPending');
  events.push({targetId:e.targetId,outcome:e.outcome,amount,...(s.mode==='healing'?{healing:true,formulaText:rawFormula}:{damageType:s.damageType,baseFormula:formula.formula})});
 }
 if(seenTargets.size!==targets.size)return pending('unusedTargetBinding');
 return {...flags(),status:'effectOutcomeCandidate',mode:s.mode,events,
  ...(s.saveAbility?{saveAbility:s.saveAbility,successPolicy:s.successPolicy}:{}),
  limitations:['preDefenseDamageOrUncappedHealing','noAttackOrSaveProbabilityInference','noHPOrResourceMutation','secondaryEffectsAndModifiersExcluded']};
}
function previewSpellEffects(input,request){
 try{
  if(!rec(request)||!['2014','2024'].includes(request.rulesEra))return pending('explicitEditionRequired');
  const r=buildSpellEffectProjection(input);
  if(request.projectionFingerprint!==r.fingerprint)return pending('projectionFingerprintMismatch');
  const row=r.rows.find(x=>x.itemId===request.spellId&&x.rulesEra===request.rulesEra);
  if(!row||row.status!=='baseEffectCandidate')return pending('spellDefinitionPending');
  return resolveEffectEvents(row,request);
 }catch{return pending('spellEffectProjectionFailed');}
}
module.exports={buildSpellEffectProjection,publicSummary,previewSpellEffects};
