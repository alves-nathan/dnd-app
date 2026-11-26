'use strict';
// Offline semantic candidates. A numeric tag is not a rule for applying damage.
const {createHash}=require('node:crypto');
const {collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {createReferenceIndex,extractReferences}=require('./reference-index');
const {inlineEdges}=require('./tag-uid-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const int=x=>Number.isSafeInteger(x);
const positive=x=>int(x)&&x>0;
const text=x=>typeof x==='string'&&!!x.trim();
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const result=(status,extra={})=>({status,...extra,activation:'review-required'});
const pending=reason=>result('indeterminate',{reason});
const damageTypes=new Set('acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(' '));
const applications=new Set(['onHit','guaranteed','onSaveFail','onSaveSuccessHalf','conditional']);
const sourceTypes=new Set(['weapon','spell','classFeature','speciesFeature','feat','magicItem','manual']);
const abilities=new Set(['STR','DEX','CON','INT','WIS','CHA']);
const conditionNames=new Set('blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious'.split(' '));
// Strict subset: additive positive dice and signed integer flats; no eval, variable
// guessing, reroll, multiplication or negative dice (runtime min/max need repair).
function parseFormula(raw){
  if(typeof raw!=='string'||raw.length>256)return pending('formulaSyntaxPending');
  const s=raw.trim().replace(/−/g,'-').replace(/\s*([+-])\s*/g,'$1');
  if(!/^(?:[+-]?(?:[1-9]\d*d(?:4|6|8|10|12|20|100)|\d+))(?:[+-](?:[1-9]\d*d(?:4|6|8|10|12|20|100)|\d+))*$/i.test(s))return pending('formulaSyntaxPending');
  const terms=[];
  for(const m of s.matchAll(/([+-]?)([^+-]+)/g)){
    const sign=m[1]==='-'?-1:1,d=/^(\d+)d(\d+)$/i.exec(m[2]);
    if(d){
      const count=Number(d[1]),sides=Number(d[2]);
      if(sign<0||count>1000)return pending('diceOperationPending');
      terms.push({kind:'dice',count,sides});
    }else{
      const value=Number(m[2])*sign;
      if(!int(value)||Math.abs(value)>1000000)return pending('flatValuePending');
      terms.push({kind:'flat',value});
    }
  }
  return terms.length?result('formulaCandidate',{raw,terms}):pending('formulaSyntaxPending');
}
function toDamageFormula(parsed,spec){
  if(parsed?.status!=='formulaCandidate'||!rec(spec)||!applications.has(spec.application)||!sourceTypes.has(spec.sourceType)||
    !text(spec.bindingId)||!['attack','nonAttack'].includes(spec.criticalPolicy))return pending('damageContextPending');
  // Conditional applicability must be separately established, never assumed.
  if(spec.application==='conditional')return pending('conditionBindingPending');
  if(spec.criticalPolicy==='attack'&&spec.application!=='onHit')return pending('criticalContextPending');
  const verified=parseFormula(parsed.raw);
  if(verified.status!=='formulaCandidate'||JSON.stringify(verified.terms)!==JSON.stringify(parsed.terms))return pending('formulaIntegrityPending');
  const components=verified.terms.map((t,i)=>({
    id:'upstream-preview:'+createHash('sha256').update(JSON.stringify([spec.bindingId,i])).digest('hex'),
    kind:t.kind,operation:t.kind==='flat'&&t.value<0?'subtract':'add',
    ...(t.kind==='dice'?{dice:{count:t.count,sides:t.sides}}:{value:Math.abs(t.value)}),
    sourceType:spec.sourceType,application:spec.application,
    criticalBehavior:t.kind==='dice'&&spec.criticalPolicy==='attack'?'doubleDice':'notDoubled'
  }));
  return result('damageFormulaCandidate',{formula:{raw:parsed.raw,components}});
}
// Scan the already validated inline ledger. Formula tags only record lexical candidates.
function formulaObservations(item,index){
  return inlineEdges(item,index).filter(e=>e.category==='formula').map(e=>{
    const base={itemId:item.id,path:e.path,start:e.start,end:e.end,tag:e.tag};
    // No display/roll modifiers silently discarded.
    if(['damage','dice'].includes(e.tag)){
      const m=/^\{@(?:damage|dice) ([^{}|]+)\}$/.exec(e.raw);
      const p=m?parseFormula(m[1]):pending('formulaTagArgumentsPending');
      return result(p.status==='formulaCandidate'?'numericFormulaCandidate':'formulaExpressionPending',{...base,...(p.terms?{terms:p.terms,raw:p.raw}:{reason:p.reason})});
    }
    if(['hit','dc'].includes(e.tag)){
      const m=/^\{@(?:hit|dc) ([+-]?\d+)\}$/.exec(e.raw),value=m?Number(m[1]):NaN;
      if(int(value)&&Math.abs(value)<=1000&&(e.tag!=='dc'||value>=0))return result('numericRollParameter',{...base,value});
    }
    return result('tagSemanticsPending',base);
  });
}
// Only reuse the narrow projections of a5.1/a5.2; do not infer from prose tags.
function directDamage(item){
  const p=item.payload||{},rows=[];
  function add(a,path,sourceType){
    if(a.damageFormula===undefined)return;
    const parsed=parseFormula(a.damageFormula);
    const spec={bindingId:item.id+path,application:'onHit',criticalPolicy:'attack',sourceType};
    const out=damageTypes.has(norm(a.damageType))?toDamageFormula(parsed,spec):pending('damageTypePending');
    rows.push(result(out.status,{itemId:item.id,path,...(out.formula?{formula:out.formula,damageType:norm(a.damageType)}:{reason:out.reason})}));
  }
  if(item.kind==='spell'&&p.requiresAttackRoll===true)add(p,'/payload','spell');
  if(item.kind==='creatureStatBlock')for(const k of ['actions','bonusActions','reactions']){
    if(Array.isArray(p[k]))p[k].forEach((a,i)=>{if(a.type==='attack')add(a,'/payload/'+k+'/'+i,'manual');});
  }
  return rows;
}
function compileScaling(item){
  const p=item.payload||{},s=p.mechanics?.upstreamSpell;
  if(item.kind!=='spell'||!rec(s))return [];
  const rows=[];
  if(s.scalingLevelDice!=null){
    const raw=s.scalingLevelDice;
    // Explicit scalar table is evidence for dice scaling, NOT per-hit/beam/target application.
    const scaling=rec(raw)&&rec(raw.scaling)?raw.scaling:null;
    const keys=scaling?Object.keys(scaling).sort((a,b)=>Number(a)-Number(b)):[];
    const parsed=keys.map(k=>parseFormula(scaling[k]));
    const valid=p.level===0&&keys.join(',')==='1,5,11,17'&&parsed.every(v=>v.status==='formulaCandidate'&&v.terms.length===1&&v.terms[0].kind==='dice');
    rows.push(result(valid?'scalingTableCandidate':'scalingStructurePending',{itemId:item.id,kind:'characterLevel',
      ...(valid?{steps:keys.map((k,i)=>({minCharacterLevel:Number(k),formula:parsed[i]}))}:{raw}),applicationPending:true}));
  }
  if(Array.isArray(s.entriesHigherLevel)&&s.entriesHigherLevel.length)rows.push(result('upcastSemanticsPending',{itemId:item.id,kind:'slotLevel',path:'/payload/mechanics/upstreamSpell/entriesHigherLevel'}));
  return rows;
}
// Explicitly confirmed application policy supplied by reviewer; no promotion from mere table.
function bindScaling(row,spec){
  if(row?.status!=='scalingTableCandidate'||row.kind!=='characterLevel'||spec?.sameSingleDamageApplicationConfirmed!==true||
    !Array.isArray(row.steps)||row.steps.map(s=>s.minCharacterLevel).join(',')!=='1,5,11,17')return pending('scalingApplicationPending');
  const steps=[];
  for(const s of row.steps){
    const out=toDamageFormula(s.formula,{...spec,bindingId:spec.bindingId+':'+s.minCharacterLevel});
    if(out.status!=='damageFormulaCandidate')return out;
    steps.push({minCharacterLevel:s.minCharacterLevel,formula:out.formula});
  }
  return result('scalingCandidate',{scaling:{kind:'characterLevel',steps,requiresReview:true}});
}
function compileDuration(item){
  const raw=item.payload?.mechanics?.upstreamSpell?.duration;
  if(!Array.isArray(raw)||raw.length!==1||!rec(raw[0]))return pending('durationAlternativesPending');
  const d=raw[0],v=d.duration;
  if(d.type==='instant'&&Object.keys(d).every(k=>k==='type'))return result('instantaneous');
  if(d.type==='timed'&&rec(v)&&positive(v.amount)&&['round','minute','hour','day'].includes(v.type)&&
    Object.keys(d).every(k=>['type','duration','concentration'].includes(k))&&Object.keys(v).every(k=>['type','amount','upTo'].includes(k))&&
    (d.concentration===undefined||typeof d.concentration==='boolean')&&(v.upTo===undefined||typeof v.upTo==='boolean'))
    return result('durationCandidate',{unit:v.type,maximum:v.amount,concentration:d.concentration===true,upTo:v.upTo===true||d.concentration===true});
  if(d.type==='permanent'&&Array.isArray(d.ends)&&d.ends.every(text))return result('terminationPending',{ends:d.ends});
  return pending('durationSemanticsPending');
}
function compileConditionEvidence(item,index){
  return extractReferences(item,index).filter(e=>['spellConditionInflict','spellConditionImmunity','creatureConditionImmunity','speciesConditionImmunity'].includes(e.relation))
    .map(e=>result(e.status==='resolvedIdentity'?'conditionIdentityCandidate':e.status,{itemId:item.id,relation:e.relation,path:e.path,targetId:e.targetId,
      crossEra:e.crossEra===true,applicationPending:true}));
}
function compileDefenses(item){
  const raw=item.payload?.mechanics?.upstreamCreature;
  if(!rec(raw))return pending('defenseSourcePending');
  const lists={};let conditional=false;
  for(const field of ['resist','immune','vulnerable']){
    const v=raw[field];
    if(v===undefined){lists[field]=[];continue;}
    if(!Array.isArray(v))return pending('defenseStructurePending');
    lists[field]=[];
    for(const entry of v){
      if(typeof entry==='string'&&damageTypes.has(norm(entry)))lists[field].push(norm(entry));else conditional=true;
    }
    lists[field]=[...new Set(lists[field])];
  }
  // Presence of any conditional group prevents claiming a complete defense set.
  return result(conditional?'conditionalDefensePending':'plainDefenseCandidate',{lists,complete:!conditional});
}
// Exact integer damage event per type. Not an expected-DPR multiplier or a global factor.
function applyTypedDamage(amount,type,defense){
  if(!int(amount)||amount<0||!damageTypes.has(type)||!rec(defense)||!rec(defense.lists))return pending('damageEventPending');
  const {immune,resist,vulnerable}=defense.lists;
  if(![immune,resist,vulnerable].every(a=>Array.isArray(a)&&a.every(x=>damageTypes.has(x))))return pending('defenseStructurePending');
  if(immune.includes(type))return result('damageEventCandidate',{amount:0,reason:'immune'});
  if(defense.status!=='plainDefenseCandidate'||defense.complete!==true)return pending('conditionalDefensePending');
  // Resistance first (floor), then vulnerability; do not cancel before integer rounding.
  let adjusted=resist.includes(type)?Math.floor(amount/2):amount;
  if(vulnerable.includes(type))adjusted*=2;
  return int(adjusted)?result('damageEventCandidate',{amount:adjusted}):pending('damageOverflow');
}
// Saving-throw outcome is a supplied fact, not an inferred probability or automatic save.
function resolveSaveDamage(amount,outcome,successPolicy){
  if(!int(amount)||amount<0||!['success','failure'].includes(outcome)||!['none','half','full'].includes(successPolicy))return pending('saveOutcomePending');
  return result('damageEventCandidate',{amount:outcome==='failure'||successPolicy==='full'?amount:successPolicy==='half'?Math.floor(amount/2):0});
}
// Manual reviewed bridge into existing effect templates. No assumed timing/stack behavior.
function effectTemplate(spec){
  if(!rec(spec)||!text(spec.id)||!text(spec.name)||!['spell','condition','buff','debuff','feature','item','manual'].includes(spec.kind)||
    !sourceTypes.has(spec.sourceType)&&spec.sourceType!=='condition'||typeof spec.concentration!=='boolean'||
    typeof spec.endsOnShortRest!=='boolean'||typeof spec.endsOnLongRest!=='boolean'||!Array.isArray(spec.conditionIds)||
    !spec.conditionIds.every(text)||new Set(spec.conditionIds).size!==spec.conditionIds.length||spec.conditionAliasesConfirmed!==true)
    return pending('effectBindingPending');
  const d=spec.duration;
  // Existing clock ticks turn/round at boundaries; minute/hour are not safely auto-clocked.
  if(!rec(d)||!(d.unit==='manual'&&d.remaining===undefined&&d.expiresOn==='manual'||
    ['turn','round'].includes(d.unit)&&positive(d.remaining)&&['turnStart','turnEnd'].includes(d.expiresOn)&&spec.clockConfirmed===true))
    return pending('effectClockPending');
  if(spec.stackPolicy!=='independentConfirmed')return pending('stackPolicyPending');
  return result('effectTemplateCandidate',{template:{id:spec.id,name:spec.name,kind:spec.kind,sourceType:spec.sourceType,
    concentration:spec.concentration,conditionIds:[...spec.conditionIds],duration:{...d},endsOnShortRest:spec.endsOnShortRest,endsOnLongRest:spec.endsOnLongRest,requiresReview:true}});
}
function buildEffectReport(main,homebrew){
  const {records}=collect(main,homebrew),items=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const index=createReferenceIndex(records,items),formulas=[],damage=[],scaling=[],durations=[],conditions=[],defenses=[],conditionDefinitions=[],saves=[];
  for(const item of items){
    formulas.push(...formulaObservations(item,index));damage.push(...directDamage(item));scaling.push(...compileScaling(item));
    conditions.push(...compileConditionEvidence(item,index));
    if(item.kind==='spell'){
      durations.push({itemId:item.id,...compileDuration(item)});
      const raw=item.payload?.mechanics?.upstreamSpell?.savingThrow;
      if(Array.isArray(raw)&&raw.length)saves.push(result('saveOutcomeSemanticsPending',{itemId:item.id,abilities:raw}));
    }
    if(item.kind==='creatureStatBlock')defenses.push({itemId:item.id,...compileDefenses(item)});
    if(item.kind==='condition')conditionDefinitions.push(result(norm(item.name)==='exhaustion'?'stackEditionPolicyPending':'conditionEffectsPending',{itemId:item.id,conditionId:item.payload.conditionId}));
  }
  const count=rows=>rows.reduce((a,x)=>(bump(a,x.status),a),dict());
  return {schemaVersion:'dnd-upstream-effect-damage-preview.v1',commits:{main:main.commit,homebrew:homebrew.commit},items:items.length,
    formulas,damage,scaling,durations,conditions,defenses,conditionDefinitions,saves,
    summary:{formulas:count(formulas),damage:count(damage),scaling:count(scaling),durations:count(durations),conditions:count(conditions),defenses:count(defenses),conditionDefinitions:count(conditionDefinitions),saves:count(saves)},
    activation:'review-required',scope:'numeric and explicit-context semantic candidates; no implicit triggers, runtime effects, stacking or character writes'};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,items:r.items,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={parseFormula,toDamageFormula,formulaObservations,directDamage,compileScaling,bindScaling,compileDuration,compileConditionEvidence,compileDefenses,applyTypedDamage,resolveSaveDamage,effectTemplate,buildEffectReport,publicSummary};
