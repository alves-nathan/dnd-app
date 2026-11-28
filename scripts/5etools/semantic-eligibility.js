'use strict';
// Executable, pure semantic subset; no character writes or runtime activation.
const {collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {createReferenceIndex,extractReferences}=require('./reference-index');
const {resolveUid,spellLists}=require('./tag-uid-preview');
const {crossOwnerCandidates}=require('./variant-lineage');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const text=x=>typeof x==='string'&&!!x.trim();
const abilities=new Set(['STR','DEX','CON','INT','WIS','CHA']);
const pending=(reason,raw)=>({op:'pending',reason,raw});
const truth=(ok)=>ok?'satisfied':'notSatisfied';
const unknown='indeterminate';
function compilePrerequisite(tree,item,index,depth=0){
  if(depth>64||!rec(tree))return pending('unsupportedPrerequisite',tree);
  if(['all','any'].includes(tree.op)){
    if(!Array.isArray(tree.children)||!tree.children.length)return pending('emptyPrerequisiteGroup',tree);
    return {op:tree.op,children:tree.children.map(c=>compilePrerequisite(c,item,index,depth+1))};
  }
  if(tree.op==='characterLevel'&&positive(tree.minimum)&&tree.minimum<=20)return {op:tree.op,minimum:tree.minimum};
  if(tree.op==='abilityMinimum'&&abilities.has(tree.ability)&&positive(tree.minimum)&&tree.minimum<=30)return {op:tree.op,ability:tree.ability,minimum:tree.minimum};
  if(tree.op==='classLevel'&&positive(tree.minimum)&&tree.minimum<=20){
    // Visibility is presentation; subclass constraints or unknown metadata cannot be discarded.
    const raw=tree.raw;
    if(!rec(raw)||raw.subclass!==undefined||Object.keys(raw).some(k=>!['level','class'].includes(k))||
       !rec(raw.class)||Object.keys(raw.class).some(k=>!['name','source','visible','visibleStats','visibleList'].includes(k)))return pending('classLevelContextPending',tree);
    if(!text(tree.class?.name)||!text(tree.class?.source))return pending('classSourceRequired',tree);
    const result=resolveUid(item,index,'class',[tree.class.name,tree.class.source]);
    if(result.status!=='resolvedIdentity')return pending(result.status,tree);
    return {op:'classLevel',classId:result.targetId,minimum:tree.minimum};
  }
  if(tree.op==='spellcasting'&&['spellcasting','spellcasting2020','spellcastingFeature'].includes(tree.rule))
    return {op:'fact',fact:{spellcasting:'canCastSpell',spellcasting2020:'hasSpellcastingOrPactMagicFeature',spellcastingFeature:'hasSpellcastingFeature'}[tree.rule]};
  if(tree.op==='referenceRequirement'&&['feat','optionalfeature'].includes(tree.referenceType)&&Array.isArray(tree.raw)&&tree.raw.length){
    // Upstream renderer joins these arrays with "or". Default redirects are not proof.
    return {op:'any',children:tree.raw.map(raw=>{
      if(typeof raw!=='string')return pending('referenceExpressionPending',raw);
      const result=resolveUid(item,index,tree.referenceType==='feat'?'feat':'optfeature',raw.split('|'));
      return result.status==='resolvedIdentity'?{op:'possesses',entityId:result.targetId,kind:tree.referenceType==='feat'?'feat':'feature'}:pending(result.status,raw);
    })};
  }
  return pending('prerequisiteSemanticsPending',tree);
}
function evaluatePrerequisite(node,facts,depth=0){
  if(depth>64||!rec(node)||!rec(facts))return unknown;
  if(node.op==='all'||node.op==='any'){
    if(!Array.isArray(node.children)||!node.children.length)return unknown;
    const v=node.children.map(n=>evaluatePrerequisite(n,facts,depth+1));
    if(node.op==='all')return v.includes('notSatisfied')?'notSatisfied':v.every(x=>x==='satisfied')?'satisfied':unknown;
    return v.includes('satisfied')?'satisfied':v.every(x=>x==='notSatisfied')?'notSatisfied':unknown;
  }
  if(node.op==='none')return 'satisfied';
  if(node.op==='characterLevel')return nonnegative(facts.characterLevel)&&positive(node.minimum)?truth(facts.characterLevel>=node.minimum):unknown;
  if(node.op==='abilityMinimum'){
    const value=rec(facts.abilities)&&own(facts.abilities,node.ability)?facts.abilities[node.ability]:undefined;
    return abilities.has(node.ability)&&positive(value)&&value<=30&&positive(node.minimum)?truth(value>=node.minimum):unknown;
  }
  if(node.op==='classLevel'){
    const levels=facts.classLevels;
    if(!rec(levels)||!text(node.classId)||!positive(node.minimum))return unknown;
    const n=own(levels,node.classId)?levels[node.classId]:facts.classLevelsComplete===true?0:undefined;
    return nonnegative(n)?truth(n>=node.minimum):unknown;
  }
  if(node.op==='fact')return rec(facts.flags)&&own(facts.flags,node.fact)&&typeof facts.flags[node.fact]==='boolean'?truth(facts.flags[node.fact]):unknown;
  if(node.op==='possesses'){
    if(!text(node.entityId)||!['feat','feature'].includes(node.kind)||!Array.isArray(facts.possessedIds))return unknown;
    return facts.possessedIds.includes(node.entityId)?'satisfied':facts.possessedIdsComplete===true?'notSatisfied':unknown;
  }
  return unknown;
}
function normalizeSchedule(raw){
  let entries;
  if(Array.isArray(raw)){
    if(!raw.length||raw.length>20||!raw.every(nonnegative))return {status:'schedulePending'};
    entries=raw.map((count,i)=>({level:i+1,count}));
  }else if(rec(raw)&&Object.keys(raw).length){
    const keys=Object.keys(raw);
    if(keys.length===1&&keys[0]==='*'&&nonnegative(raw['*']))return {status:'structured',scope:'context',count:raw['*']};
    if(keys.some(k=>!/^(?:[1-9]|1[0-9]|20)$/.test(k)||!nonnegative(raw[k])))return {status:'schedulePending'};
    entries=keys.map(k=>({level:Number(k),count:raw[k]})).sort((a,b)=>a.level-b.level);
  }else return {status:'schedulePending'};
  if(entries.some((e,i)=>i&&e.count<entries[i-1].count))return {status:'schedulePending'};
  return {status:'structured',scope:'level',entries};
}
// Count at an explicitly specified point in the schedule, not a delta or new grant.
function scheduledCount(schedule,level){
  if(schedule?.status!=='structured')return undefined;
  if(schedule.scope==='context')return schedule.count;
  if(!positive(level)||level>20)return undefined;
  return schedule.entries.find(e=>e.level===level)?.count;
}
function choicesFor(item){
  const m=item.payload?.mechanics||{},rows=[];
  for(const field of ['upstreamClassRecord','upstreamOrigin','upstreamFeature']){
    const raw=m[field];if(!raw)continue;
    for(const [property,selector] of [['optionalfeatureProgression','featureType'],['featProgression','category']]){
      if(raw[property]===undefined)continue;
      const values=raw[property];
      if(!Array.isArray(values)){rows.push({kind:property,status:'selectorPending',raw:values});continue;}
      for(const [index,v] of values.entries()){
        const base={kind:property,path:'/payload/mechanics/'+field+'/'+property+'/'+index,raw:v};
        if(!rec(v)||Object.keys(v).some(k=>!['name',selector,'progression'].includes(k))||!Array.isArray(v[selector])||!v[selector].length||!v[selector].every(text)){
          rows.push({...base,status:'selectorPending'});continue;
        }
        const schedule=normalizeSchedule(v.progression);
        rows.push({...base,status:schedule.status==='structured'?'selectorAndSchedule':'schedulePending',selector:{field:selector,codes:v[selector]},schedule});
      }
    }
    if(raw.itemMasteriesProgression!==undefined){
      const schedule=normalizeSchedule(raw.itemMasteriesProgression);
      rows.push({kind:'itemMasteriesProgression',path:'/payload/mechanics/'+field+'/itemMasteriesProgression',status:schedule.status==='structured'?'selectorAndSchedule':'schedulePending',schedule,raw:raw.itemMasteriesProgression});
    }
  }
  // Ability allocation alternatives remain independent. The original converter carries their raw evidence.
  const plan=m.abilityAllocationPlan;
  if(Array.isArray(plan?.alternatives))for(const [index,a] of plan.alternatives.entries()){
    const valid=rec(a)&&a.kind==='allocation'&&!a.hidden&&positive(a.max)&&a.max<=30&&Array.isArray(a.fixed)&&
      a.fixed.every(f=>rec(f)&&abilities.has(f.ability)&&positive(f.amount))&&new Set(a.fixed.map(f=>f.ability)).size===a.fixed.length&&
      (a.choice===undefined||rec(a.choice)&&Array.isArray(a.choice.abilities)&&a.choice.abilities.every(x=>abilities.has(x))&&
      new Set(a.choice.abilities).size===a.choice.abilities.length&&positive(a.choice.count)&&a.choice.count<=a.choice.abilities.length&&positive(a.choice.amount)&&a.choice.distinct===true);
    rows.push({kind:'abilityAllocation',path:'/payload/mechanics/abilityAllocationPlan/alternatives/'+index,status:valid?'allocationEvaluable':'selectorPending',raw:a,...(valid?{allocation:a}:{})});
  }
  const rule=item.payload?.abilityScoreIncreaseRule,opts=item.payload?.abilityScoreOptions;
  if(rule?.chooseOnePlus2AndDifferentOnePlus1===true&&rule.orIncreaseAllBy1===true&&Array.isArray(opts)&&opts.length===3&&new Set(opts).size===3&&opts.every(x=>abilities.has(x))&&rule.maximumScoreAfterIncrease===20)
    rows.push({kind:'backgroundAbilityAllocation',status:'allocationEvaluable',options:opts,patterns:[[2,1],[1,1,1]],max:20});
  return rows;
}
function validateSelection(options,count,selected){
  if(!Array.isArray(options)||!options.every(text)||new Set(options).size!==options.length||!nonnegative(count)||count>options.length||!Array.isArray(selected))return unknown;
  return truth(selected.length===count&&new Set(selected).size===selected.length&&selected.every(x=>options.includes(x)));
}
function evaluateAllocation(plan,selected,scores){
  if(!rec(plan)||!Array.isArray(plan.fixed)||!positive(plan.max)||plan.max>30||!Array.isArray(selected)||!rec(scores))return unknown;
  if(plan.choice){
    const s=validateSelection(plan.choice.abilities,plan.choice.count,selected);
    if(s!=='satisfied')return s;
    if(!positive(plan.choice.amount))return unknown;
  }else if(selected.length)return 'notSatisfied';
  const increases=dict();
  for(const f of plan.fixed){if(!rec(f)||!abilities.has(f.ability)||!positive(f.amount))return unknown;increases[f.ability]=(increases[f.ability]||0)+f.amount;}
  for(const a of selected){if(!abilities.has(a))return 'notSatisfied';increases[a]=(increases[a]||0)+plan.choice.amount;}
  for(const [a,n] of Object.entries(increases)){
    if(!own(scores,a)||!positive(scores[a])||scores[a]>30)return unknown;
    if(scores[a]+n>plan.max)return 'notSatisfied';
  }
  return 'satisfied';
}
function evaluateBackgroundAllocation(plan,increases,scores){
  if(!rec(plan)||!Array.isArray(plan.options)||!Array.isArray(plan.patterns)||!rec(increases)||!rec(scores))return unknown;
  const keys=Object.keys(increases),pattern=Object.values(increases).sort((a,b)=>a-b);
  if(keys.some(k=>!plan.options.includes(k)||!positive(increases[k]))||!plan.patterns.some(p=>JSON.stringify([...p].sort((a,b)=>a-b))===JSON.stringify(pattern)))return 'notSatisfied';
  if(keys.some(k=>!own(scores,k)||!positive(scores[k])||scores[k]>30))return unknown;
  return truth(keys.every(k=>scores[k]+increases[k]<=plan.max));
}
function contextualGrants(items,index,aliases){
  const rows=[];
  for(const owner of items){
    if(!['class','subclass'].includes(owner.kind))continue;
    const links=owner.payload?.mechanics?.featureGrantReferences;
    if(!Array.isArray(links))continue;
    for(const [i,l] of links.entries()){
      const target=index.byId.get(l.featureId),classId=owner.kind==='class'?owner.id:owner.payload.classId;
      const valid=target?.kind==='feature'&&target.payload.classId===classId&&
        (owner.kind==='subclass'?target.payload.subclassId===owner.id:!target.payload.subclassId)&&positive(l.level)&&l.level<=20&&
        owner.payload.progression?.some(p=>p.level===l.level&&p.featureIds.includes(l.featureId))&&target.payload.levelGained===l.level;
      rows.push({ownerId:owner.id,ownerKind:owner.kind,classId,targetId:l.featureId,level:l.level,path:'/payload/mechanics/featureGrantReferences/'+i,
        status:valid?(typeof l.raw==='string'?'directContextCandidate':'grantOptionsPending'):'ownerOrTargetPending',activation:'review-required'});
    }
  }
  // Cross-owner evidence stays separate; aliases are not emitted owners yet.
  for(const a of aliases)for(const g of a.grants){
    if(g.status!=='inheritedCrossOwnerCandidate')continue;
    rows.push({ownerId:a.ownerId,ownerKind:'subclass',baseOwnerId:a.baseOwnerId,targetId:g.targetId,level:g.level,ownerCoordinate:a.owner,targetCoordinate:g.target,
      status:a.status==='completeAliasCandidate'&&a.ownerEmitted&&g.targetEmitted?'crossOwnerReviewRequired':'crossOwnerEndpointOrGrantPending',
      ownerEmitted:a.ownerEmitted,targetEmitted:g.targetEmitted,activation:'review-required'});
  }
  return rows;
}
// Mechanical context check only. Even satisfied direct grants must pass later editorial/runtime gates.
function evaluateGrant(row,facts){
  if(row?.status!=='directContextCandidate'||!rec(facts)||!text(row.classId)||!positive(row.level))return {eligibility:unknown,activation:'review-required'};
  const level=evaluatePrerequisite({op:'classLevel',classId:row.classId,minimum:row.level},facts);
  let eligibility=level;
  if(row.ownerKind==='subclass'){
    const selected=rec(facts.selectedSubclasses)&&own(facts.selectedSubclasses,row.classId)?facts.selectedSubclasses[row.classId]:undefined;
    const owner=typeof selected==='string'?truth(selected===row.ownerId):unknown;
    eligibility=owner==='notSatisfied'||level==='notSatisfied'?'notSatisfied':owner==='satisfied'&&level==='satisfied'?'satisfied':unknown;
  }else if(row.ownerKind!=='class'||row.ownerId!==row.classId)eligibility=unknown;
  return {eligibility,activation:'review-required'};
}
function buildSemanticReport(main,homebrew,context){
  const records=context?.records??collect(main,homebrew).records,items=context?.items??converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs.flatMap(p=>p.items));
  const index=context?.index??createReferenceIndex(records,items),requirements=[],choices=[],spellCandidates=[];
  const counts=dict(),nodes=dict(),choiceCounts=dict(),grantCounts=dict(),spellCounts=dict();
  function visit(n){bump(nodes,n.op);if(n.op==='pending')bump(counts,n.reason);if(n.children)n.children.forEach(visit);}
  for(const item of items){
    const tree=item.payload?.mechanics?.prerequisiteTree;
    if(tree!==undefined){const compiled=compilePrerequisite(tree,item,index);visit(compiled);requirements.push({itemId:item.id,tree:compiled,activation:'review-required'});}
    for(const c of choicesFor(item)){choices.push({itemId:item.id,...c,activation:'review-required'});bump(choiceCounts,c.kind+':'+c.status);}
    for(const e of spellLists(item,index)){
      const status=e.status==='resolvedIdentity'?'explicitSpellCandidate':e.status;
      spellCandidates.push({...e,status});bump(spellCounts,status);
    }
  }
  const aliases=crossOwnerCandidates(records.filter(r=>r.origin==='main'&&['class','subclass','classFeature','subclassFeature'].includes(r.kind)),new Set(items.map(i=>i.id)));
  const grants=contextualGrants(items,index,aliases);
  for(const g of grants)bump(grantCounts,g.status);
  const hasPending=n=>n.op==='pending'||(n.children||[]).some(hasPending);
  return {schemaVersion:'dnd-upstream-semantic-eligibility.v1',commits:{main:main.commit,homebrew:homebrew.commit},items:items.length,requirements,choices,grants,spellCandidates,
    summary:{requirements:requirements.length,fullyEvaluableRequirements:requirements.filter(r=>!hasPending(r.tree)).length,nodes,pendingReasons:counts,choices:choices.length,choiceCounts,grants:grants.length,grantCounts,spellCandidates:spellCandidates.length,spellCounts},
    activation:'review-required',scope:'pure semantic subset; explicit character facts required; no automatic choices, cross-owner activation, runtime mutation or content promotion'};
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,items:r.items,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={compilePrerequisite,evaluatePrerequisite,normalizeSchedule,scheduledCount,choicesFor,validateSelection,evaluateAllocation,evaluateBackgroundAllocation,contextualGrants,evaluateGrant,buildSemanticReport,publicSummary};
