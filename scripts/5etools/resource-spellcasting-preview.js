'use strict';
// Offline compilation into runtime-compatible shapes. Never writes a character or activates a grant.
const {collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {projectSpellcasting}=require('./class-converter');
const {createReferenceIndex}=require('./reference-index');
const {spellLists}=require('./tag-uid-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>integer(x)&&x>0;
const level=x=>positive(x)&&x<=20;
const circle=x=>positive(x)&&x<=9;
const text=x=>typeof x==='string'&&!!x.trim();
const clone=x=>JSON.parse(JSON.stringify(x));
const result=(status,extra={})=>({status,...extra,activation:'review-required'});
const pending=reason=>result('indeterminate',{reason});
const eraKnown=x=>['2014','2024'].includes(x);
const progressions={full:'fullCaster','1/2':'halfCaster',artificer:'halfCaster','1/3':'thirdCaster',pact:'pactMagic'};
function validSlotTable(t){
  return rec(t)&&Object.keys(t).length===20&&Array.from({length:20},(_,i)=>String(i+1)).every(k=>
    own(t,k)&&rec(t[k])&&Object.keys(t[k]).length>0&&Object.entries(t[k]).every(([n,v])=>/^[1-9]$/.test(n)&&integer(v)));
}
function validPact(p){
  return Array.isArray(p.pactSlotsByLevel)&&p.pactSlotsByLevel.length===20&&p.pactSlotsByLevel.every(integer)&&
    Array.isArray(p.pactSlotLevelByLevel)&&p.pactSlotLevelByLevel.length===20&&p.pactSlotLevelByLevel.every(circle);
}
function compileProfile(item){
  const raw=item.payload?.mechanics?.upstreamClassRecord;
  if(!['class','subclass'].includes(item.kind)||!rec(raw))return pending('profileSourcePending');
  const base={itemId:item.id,kind:item.kind,classId:item.kind==='class'?item.id:item.payload.classId,
    rulesEra:item.source.rulesEra,sourceCode:item.provenance.sourceCode,upstreamProgression:raw.casterProgression};
  if(raw.casterProgression===undefined){
    return result('noDeclaredProgression',{...base,reason:'notProofOfNoSpellcasting'});
  }
  if(!own(progressions,raw.casterProgression))return result('indeterminate',{...base,reason:'casterProgressionPending'});
  // Reuse the a5.7 table parser for subclasses, whose tables have a different field name.
  const p=item.kind==='class'?item.payload.spellcasting:projectSpellcasting({...raw,classTableGroups:raw.subclassTableGroups},new Set());
  if(!rec(p))return result('indeterminate',{...base,reason:'spellcastingTablePending'});
  const progression=progressions[raw.casterProgression];
  const slotFields=progression==='pactMagic'?validPact(p)?{pactSlotsByLevel:p.pactSlotsByLevel,pactSlotLevelByLevel:p.pactSlotLevelByLevel}:null:
    validSlotTable(p.slotsByLevel)?{slotsByLevel:p.slotsByLevel}:null;
  if(!slotFields)return result('indeterminate',{...base,progression,reason:'spellcastingTablePending'});
  const limits={};
  for(const k of ['cantripsKnownByLevel','spellsKnownByLevel','preparedSpellsByLevel']){
    if(Array.isArray(p[k])&&p[k].length===20&&p[k].every(integer))limits[k]=clone(p[k]);
  }
  return result('tableCandidate',{...base,progression,...slotFields,limits,
    ability:p.ability,preparationFormulaPending:raw.preparedSpells!==undefined,
    preparationChangesPending:raw.preparedSpellsChange!==undefined||raw.spellsKnownProgressionFixedByLevel!==undefined,
    subclassActivationPending:item.kind==='subclass'});
}
function profileAtLevel(p,n){
  if(p?.status!=='tableCandidate'||!level(n))return pending('profileOrLevelPending');
  const limits=dict();for(const [k,v] of Object.entries(p.limits||{}))limits[k]=v[n-1];
  if(p.progression==='pactMagic'){
    if(!validPact(p))return pending('invalidPactTable');
    return result('tableCandidate',{slots:{[p.pactSlotLevelByLevel[n-1]]:p.pactSlotsByLevel[n-1]},limits});
  }
  if(!validSlotTable(p.slotsByLevel))return pending('invalidSlotTable');
  return result('tableCandidate',{slots:{...p.slotsByLevel[String(n)]},limits});
}
// No implicit selection of class, subclass, edition, or a full-caster reference table.
// Binding classInstanceId is the runtime character class ID, not the compendium item ID.
function derivePools(bindings,{multiclassPolicy,referenceProfile}={}){
  if(!Array.isArray(bindings)||bindings.some(b=>!rec(b)||!text(b.classInstanceId)||!level(b.level)||b.profile?.status!=='tableCandidate'||
    b.profile.kind==='subclass'&&b.subclassConfirmed!==true)||new Set(bindings.map(b=>b.classInstanceId)).size!==bindings.length)
    return pending('bindingOrSubclassPending');
  if(bindings.reduce((n,b)=>n+b.level,0)>20)return pending('totalLevelOutOfScope');
  const regular=bindings.filter(b=>b.profile.progression!=='pactMagic'),pact=bindings.filter(b=>b.profile.progression==='pactMagic');
  const pools=[];let slots={},effectiveCasterLevel;
  if(regular.length===1){
    const p=profileAtLevel(regular[0].profile,regular[0].level);
    if(p.status!=='tableCandidate')return p;
    slots=p.slots;
  }else if(regular.length>1){
    const era=regular[0].profile.rulesEra;
    if(!eraKnown(era)||regular.some(b=>b.profile.rulesEra!==era))return pending('multiclassEditionPending');
    // Explicitly supplied reviewed rounding policy per upstream progression code.
    if(!rec(multiclassPolicy)||multiclassPolicy.rulesEra!==era||!rec(multiclassPolicy.rounding))return pending('multiclassPolicyRequired');
    effectiveCasterLevel=0;
    for(const b of regular){
      const code=b.profile.upstreamProgression,rule=own(multiclassPolicy.rounding,code)?multiclassPolicy.rounding[code]:undefined;
      const denominator={full:1,'1/2':2,artificer:2,'1/3':3}[code];
      if(!denominator||!['floor','ceil'].includes(rule))return pending('multiclassRoundingPending');
      effectiveCasterLevel+=Math[rule](b.level/denominator);
    }
    if(!referenceProfile||referenceProfile.status!=='tableCandidate'||referenceProfile.progression!=='fullCaster'||
      referenceProfile.rulesEra!==era||!validSlotTable(referenceProfile.slotsByLevel))return pending('multiclassReferenceTableRequired');
    if(effectiveCasterLevel>20)return pending('effectiveCasterLevelOutOfScope');
    slots=effectiveCasterLevel?referenceProfile.slotsByLevel[String(effectiveCasterLevel)]:{};
  }
  for(const [k,max] of Object.entries(slots)){
    if(!circle(Number(k))||!integer(max))return pending('invalidSlotCount');
    if(max)pools.push({id:'spellcasting-shared-'+k,level:Number(k),max,current:max,recharge:'longRest',poolKind:'spellcasting'});
  }
  for(const b of pact){
    const p=profileAtLevel(b.profile,b.level);
    if(p.status!=='tableCandidate')return p;
    for(const [k,max] of Object.entries(p.slots))if(max)pools.push({id:'pact-'+b.classInstanceId+'-'+k,level:Number(k),max,current:max,
      recharge:'shortRest',poolKind:'pactMagic',sourceClassId:b.classInstanceId});
  }
  return result('poolCandidate',{pools,...(effectiveCasterLevel!==undefined?{effectiveCasterLevel}:{}),regularCasterClassCount:regular.length,pactCasterClassCount:pact.length});
}
function compileSpellCost(item){
  const p=item.payload,raw=p?.mechanics?.upstreamSpell;
  if(item.kind!=='spell'||!rec(raw)||!integer(p.level)||p.level>9)return pending('spellSourcePending');
  const t=p.castingTime;
  if(!rec(t)||t.kind!=='action'||!['action','bonusAction','reaction'].includes(t.actionCost)||
    !Array.isArray(raw.time)||raw.time.length!==1||raw.time[0].number!==1)
    return result('castingTimePending',{spellId:item.id,spellLevel:p.level,castingTime:t});
  return result('costCandidate',{spellId:item.id,spellLevel:p.level,actionCost:t.actionCost,
    ...(text(t.trigger)?{trigger:t.trigger}:{}),triggerRequired:t.actionCost==='reaction'||text(t.trigger),
    ritualAlternative:p.ritual===true,minimumSlotLevel:p.level||null});
}
// Access is an independent requirement supplied by the consumer; list membership is not preparation.
function evaluateCast(plan,request){
  if(plan?.status!=='costCandidate'||!rec(request))return pending('spellCostPending');
  if(request.accessConfirmed===false)return result('notSatisfied',{reason:'spellAccessDenied'});
  if(request.accessConfirmed!==true)return pending('spellAccessPending');
  if(plan.triggerRequired){
    if(request.triggerConfirmed===false)return result('notSatisfied',{reason:'triggerDenied'});
    if(request.triggerConfirmed!==true)return pending('triggerPending');
  }
  if(request.mode!=='normal')return pending('alternateCastingModePending');
  if(plan.spellLevel===0){
    if(request.pool!==undefined)return result('notSatisfied',{reason:'cantripDoesNotUseSlot'});
    return result('costCandidate',{actionCost:plan.actionCost,slotCosts:[]});
  }
  const pool=request.pool;
  if(!rec(pool)||!circle(pool.level)||!['spellcasting','pactMagic'].includes(pool.poolKind)||
    pool.poolKind==='pactMagic'&&!text(pool.sourceClassId)||pool.poolKind==='spellcasting'&&pool.sourceClassId!==undefined)
    return pending('explicitSlotPoolRequired');
  if(pool.level<plan.minimumSlotLevel)return result('notSatisfied',{reason:'slotTooLow'});
  return result('costCandidate',{actionCost:plan.actionCost,slotCosts:[{slotLevel:pool.level,minimumSlotLevel:plan.minimumSlotLevel,
    poolKind:pool.poolKind,...(pool.sourceClassId?{sourceClassId:pool.sourceClassId}:{}),amount:1,spellId:plan.spellId}]});
}
function compileResourceEvidence(item){
  const m=item.payload?.mechanics||{},rows=[];
  for(const field of ['upstreamFeature','upstreamClassRecord','upstreamItem','upstreamOrigin','upstreamCreature']){
    const raw=m[field];if(!rec(raw))continue;
    if(raw.consumes!==undefined)rows.push(result('resourceBindingPending',{itemId:item.id,path:'/payload/mechanics/'+field+'/consumes',raw:raw.consumes}));
    if(raw.charges!==undefined){
      // Capacity candidate only. Recharge and spend binding require explicit decisions.
      rows.push(result(positive(raw.charges)?'capacityCandidate':'capacityFormulaPending',{itemId:item.id,path:'/payload/mechanics/'+field+'/charges',
        ...(positive(raw.charges)?{max:raw.charges}:{}),raw:{charges:raw.charges,recharge:raw.recharge,rechargeAmount:raw.rechargeAmount}}));
    }
    if(field==='upstreamClassRecord')for(const tableField of ['classTableGroups','subclassTableGroups']){
      if(!Array.isArray(raw[tableField]))continue;
      for(const [i,t] of raw[tableField].entries()){
        if(!rec(t)||!Array.isArray(t.colLabels)||!Array.isArray(t.rows))continue;
        rows.push(result('tableSemanticsPending',{itemId:item.id,path:'/payload/mechanics/'+field+'/'+tableField+'/'+i,columns:t.colLabels.length}));
      }
    }
  }
  return rows;
}
// Daily, dawn, recharge dice, resourceName and charges are not silently mapped to rests.
function compileSpellResource(edge){
  const c=edge.context||{};
  const status=edge.status==='resolvedIdentity'?'spellResourceContextCandidate':edge.status;
  return result(status,{itemId:edge.fromId,path:edge.path,targetId:edge.targetId,context:c,qualifier:edge.qualifier,
    recoveryPolicy:c.rechargeType===undefined?'notSpecified':'rechargeSemanticsPending'});
}
// Runtime-compatible resource pool/cost adapters, only for explicit reviewed inputs.
// No guessing amount from a label or mapping 'daily' to longRest.
function resourcePool(spec){
  if(!rec(spec)||!text(spec.id)||!text(spec.name)||!integer(spec.max)||!integer(spec.current)||spec.current>spec.max||
    !['turn','shortRest','longRest','manual'].includes(spec.recharge))return pending('resourceSpecPending');
  const pool={id:spec.id,name:spec.name,max:spec.max,current:spec.current,recharge:spec.recharge};
  if(spec.recoveryRules!==undefined){
    if(!Array.isArray(spec.recoveryRules)||spec.recoveryRules.some(r=>!rec(r)||!['turnStart','shortRest','longRest'].includes(r.trigger)||
      r.amount!=='all'&&!integer(r.amount))||new Set(spec.recoveryRules.map(r=>r.trigger)).size!==spec.recoveryRules.length)return pending('recoveryRulePending');
    pool.recoveryRules=clone(spec.recoveryRules);
  }
  return result('poolCandidate',{pool});
}
function resourceCost(spec){
  if(!rec(spec)||!text(spec.resourceId)||!positive(spec.amount)||spec.oncePerTurnKey!==undefined&&!text(spec.oncePerTurnKey))return pending('resourceCostPending');
  return result('costCandidate',{cost:{resourceId:spec.resourceId,amount:spec.amount,...(spec.oncePerTurnKey?{oncePerTurnKey:spec.oncePerTurnKey}:{})}});
}
// Evaluate only simple action costs with an explicit budget, never model weapon attacks as distinct Attack actions.
// Restricted extra actions, timing, reactions across turns and slot-per-turn rules remain runtime gates.
function checkActionBudget(costs,budget){
  if(!Array.isArray(costs)||!rec(budget)||!['action','bonusAction','reaction'].every(k=>own(budget,k)&&integer(budget[k])))return pending('actionBudgetPending');
  const usage={action:0,bonusAction:0,reaction:0};let unresolved=false;
  for(const c of costs){
    if(!rec(c)||!own(usage,c.actionCost)||!positive(c.amount)||c.restricted===true){unresolved=true;continue;}
    usage[c.actionCost]+=c.amount;
    if(!Number.isSafeInteger(usage[c.actionCost]))return pending('actionBudgetOverflow');
  }
  if(Object.keys(usage).some(k=>usage[k]>budget[k]))return result('notSatisfied',{usage});
  return result(unresolved?'indeterminate':'satisfied',{usage});
}
function buildResourceReport(main,homebrew){
  const {records}=collect(main,homebrew),items=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const index=createReferenceIndex(records,items),profiles=[],spellCosts=[],resourceEvidence=[],spellResources=[];
  const byProfile=dict(),byProgression=dict(),bySpellCost=dict(),byActionCost=dict(),byResource=dict(),byRecharge=dict();
  for(const item of items){
    if(['class','subclass'].includes(item.kind)){
      const p=compileProfile(item);profiles.push(p);bump(byProfile,p.status);
      if(p.status==='tableCandidate')bump(byProgression,p.kind+':'+p.progression);
    }
    if(item.kind==='spell'){
      const s=compileSpellCost(item);spellCosts.push(s);bump(bySpellCost,s.status);if(s.actionCost)bump(byActionCost,s.actionCost);
    }
    for(const e of compileResourceEvidence(item)){resourceEvidence.push(e);bump(byResource,e.status);}
    for(const e of spellLists(item,index)){
      const s=compileSpellResource(e);spellResources.push(s);bump(byRecharge,s.context.rechargeType||'unspecified');
    }
  }
  return {schemaVersion:'dnd-upstream-resource-spellcasting-preview.v1',commits:{main:main.commit,homebrew:homebrew.commit},items:items.length,
    profiles,spellCosts,resourceEvidence,spellResources,
    summary:{profiles:profiles.length,byProfile,byProgression,spellCosts:spellCosts.length,bySpellCost,byActionCost,resourceEvidence:resourceEvidence.length,byResource,spellResources:spellResources.length,byRecharge},
    activation:'review-required',scope:'runtime-compatible candidates; explicit binding, access and multiclass policy required; no activation or character writes'};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,items:r.items,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={compileProfile,profileAtLevel,derivePools,compileSpellCost,evaluateCast,compileResourceEvidence,compileSpellResource,resourcePool,resourceCost,checkActionBudget,buildResourceReport,publicSummary};
