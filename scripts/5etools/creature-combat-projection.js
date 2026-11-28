'use strict';
// a8.10.2: isolated creature chassis and action evidence; no encounter mutation.
const {digest}=require('./integrated-review');
const {convertCreature,pbFromCR}=require('./creature-converter');
const {buildRemainingFamilyEvidence}=require('./remaining-family-evidence');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const era=x=>x==='2014'||x==='2024';
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const result=(status,reason,extra={})=>({status,reason,...extra,...flags()});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const sizes={T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'};
const modes=['walk','burrow','climb','fly','swim'];
const abilityKeys=['str','dex','con','int','wis','cha'];
const damageTypes=new Set('acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(' '));
const conditionTypes=new Set('blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed poisoned prone restrained stunned unconscious'.split(' '));
const skillTypes=new Set('acrobatics|animal handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight of hand|stealth|survival'.split('|'));
const same=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
const exactKeys=(o,keys)=>rec(o)&&Object.keys(o).every(k=>keys.includes(k));
const candidate=value=>({status:'literalCandidate',value});
const pending=()=>({status:'shapePending'});
const absent=()=>({status:'notDeclared'});
function dice(raw){
 if(!text(raw))return undefined;
 const m=/^([1-9][0-9]*)d(4|6|8|10|12|20|100)(?:\s*([+-])\s*([0-9]+))?$/i.exec(raw);
 if(!m)return undefined;
 const count=Number(m[1]),sides=Number(m[2]),modifier=m[3]==='-'?-Number(m[4]):Number(m[4]||0);
 if(!int(count,1,1000)||!int(modifier,-100000,100000))return undefined;
 return {count,sides,modifier};
}
function diceBounds(d){
 return {min:d.count+d.modifier,max:d.count*d.sides+d.modifier,average:d.count*(d.sides+1)/2+d.modifier};
}
function modifiers(raw,allowed){
 if(raw===undefined)return absent();
 if(!rec(raw)||Object.entries(raw).some(([k,v])=>!allowed.has(k.toLowerCase())||
  !(typeof v==='number'||typeof v==='string'&&/^[+-]?[0-9]+$/.test(v))||!int(Number(v),-100,100)))return pending();
 const names=Object.keys(raw).map(k=>k.toLowerCase());
 if(new Set(names).size!==names.length)return pending();
 return candidate(Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.toLowerCase(),Number(v)])));
}
function defense(raw,allowed){
 if(raw===undefined)return absent();
 if(!Array.isArray(raw)||!raw.every(v=>text(v)&&allowed.has(v.toLowerCase())))return pending();
 const values=raw.map(v=>v.toLowerCase());
 return new Set(values).size===values.length?candidate(values):pending();
}
function chassis(raw){
 const ac=Array.isArray(raw.ac)&&raw.ac.length===1?raw.ac[0]:null;
 const armor=int(ac,0,100)?candidate(ac):
  exactKeys(ac,['ac','from'])&&int(ac.ac,0,100)&&(!own(ac,'from')||Array.isArray(ac.from)&&ac.from.every(text))?
   {status:'attributedAcPending',value:ac.ac}:pending();
 const d=dice(raw.hp?.formula),bounds=d?diceBounds(d):undefined;
 const hp=exactKeys(raw.hp,['average','formula'])&&int(raw.hp.average,1,1000000)&&bounds&&bounds.min>=1&&raw.hp.average===Math.floor(bounds.average)?
  candidate({average:raw.hp.average,dice:d}):pending();
 const speed=int(raw.speed,0,10000)?{walk:raw.speed}:raw.speed;
 const movement=exactKeys(speed,modes)&&own(speed,'walk')&&Object.values(speed).every(v=>int(v,0,10000))?candidate({...speed}):pending();
 const size=Array.isArray(raw.size)&&raw.size.length===1&&own(sizes,raw.size[0])?candidate(sizes[raw.size[0]]):pending();
 const type=text(raw.type)?candidate(raw.type):exactKeys(raw.type,['type'])&&text(raw.type.type)?candidate(raw.type.type):pending();
 const scores=abilityKeys.every(k=>int(raw[k],1,30))?candidate(Object.fromEntries(abilityKeys.map(k=>[k.toUpperCase(),raw[k]]))):pending();
 const cr=typeof raw.cr==='string'||typeof raw.cr==='number'?String(raw.cr):null;
 const validCr=cr!==null&&/^(?:0|[1-9]|[12][0-9]|30|1\/8|1\/4|1\/2)$/.test(cr);
 const numeric=validCr?(cr.includes('/')?1/Number(cr.split('/')[1]):Number(cr)):undefined;
 const challenge=validCr?candidate(cr):pending();
 const proficiency=validCr&&!own(raw,'pbNote')&&!own(raw,'summonedBySpell')&&!own(raw,'summonedByClass')?
  {status:'crDerivedCandidate',value:pbFromCR(numeric)}:pending();
 const saves=modifiers(raw.save,new Set(abilityKeys)),skills=modifiers(raw.skill,skillTypes);
 return {armor,hp,movement,size,type,scores,challenge,proficiency,saves,skills};
}
function actionEvidence(raw,payload){
 const rows=[];
 for(const [field,projected,section] of [['action','actions','action'],['bonus','bonusActions','bonusAction'],['reaction','reactions','reaction']]){
  if(!own(raw,field))continue;
  const entries=raw[field],out=payload[projected];
  if(!Array.isArray(entries)||!Array.isArray(out)||entries.length!==out.length)throw Error('creatureActionCoverageMismatch');
  for(const [index,a] of entries.entries()){
   const p=out[index];
   if(!rec(a)||!rec(p)||a.name!==p.name||p.actionCost!==section)throw Error('creatureActionBindingMismatch');
   const row={section,index,sourceFingerprint:digest(a),status:'actionSemanticsPending',...flags()};
   const d=dice(p.damageFormula),r=p.reach??p.range;
   const match=typeof r==='string'?/^(\d+)(?:\/(\d+))? ft\.$/.exec(r):null;
   const normal=match?Number(match[1]):null,long=match?Number(match[2]??match[1]):null;
   const rawText=Array.isArray(a.entries)&&a.entries.length===1&&typeof a.entries[0]==='string'?a.entries[0]:'';
   const tag=/^\{@(?:atk (mw|rw|ms|rs)|atkr (m|r))\}/.exec(rawText);
   const mode=tag?(tag[1]||tag[2]).startsWith('m')?'melee':'ranged':null;
   if(section!=='reaction'&&exactKeys(a,['name','entries'])&&text(a.name)&&!/[{}]/.test(a.name)&&
    !/^Multiattack$/i.test(a.name)&&p.type==='attack'&&int(p.attackBonus,-100,100)&&d&&diceBounds(d).min>=0&&
    damageTypes.has(p.damageType)&&int(normal,1,10000)&&int(long,normal,10000)&&
    (mode==='melee'&&own(p,'reach')&&!own(p,'range')&&normal===long||mode==='ranged'&&own(p,'range')&&!own(p,'reach'))){
    Object.assign(row,{status:'simpleAttackCandidate',attack:{mode,attackBonus:p.attackBonus,dice:d,damageType:p.damageType,normalFeet:normal,longFeet:long},
     targeting:'explicitContextRequired'});
   }else if(section==='reaction')row.status='reactionTriggerPending';
   else if(/^Multiattack$/i.test(a.name))row.status='multiattackPending';
   else if(/\{@recharge(?: [^}]+)?\}/.test(a.name))row.status='rechargePending';
   rows.push(row);
  }
 }
 return rows;
}
function buildCreatureCombatProjection(input,evidence){
 const actual=buildRemainingFamilyEvidence(input);
 if(evidence!==undefined&&digest(evidence)!==digest(actual))throw Error('remainingEvidenceMismatch');
 const items=new Map(input.items.map(i=>[i.id,i])),rows=[];
 const summary={items:0,chassis:{},defenses:{},actions:{},actionSections:{},special:{},tacticalFallbacks:{}};
 for(const e of actual.upstreamRows.filter(r=>r.kind==='creatureStatBlock')){
  const i=items.get(e.itemId),raw=i.payload.mechanics.upstreamCreature,p=i.provenance;
  if(e.sourceFingerprint!==digest(i))throw Error('creatureEvidenceBindingMismatch');
  const rederived=convertCreature({blob:p.blob,path:p.path,index:p.index,key:p.entityKey},{entity:raw,lineage:p.lineage},i.source,actual.commits.main).item;
  if(!same(rederived.payload,i.payload))throw Error('creatureProjectionBindingMismatch');
  const c=chassis(raw),defenses={resistance:defense(raw.resist,damageTypes),vulnerability:defense(raw.vulnerable,damageTypes),
   immunity:defense(raw.immune,damageTypes),conditionImmunity:defense(raw.conditionImmune,conditionTypes)};
  const actions=actionEvidence(raw,i.payload);
  const special=['trait','spellcasting','legendary','legendaryGroup','legendaryActionsLair','mythic','initiative','summonedBySpell','summonedByClass','pbNote'].filter(k=>own(raw,k));
  const fallbacks=[];
  if(c.armor.status!=='literalCandidate')fallbacks.push('acAlternativeOrTextReview');
  if(c.hp.status!=='literalCandidate')fallbacks.push('hpFormulaOrDefaultReview');
  if(c.movement.status!=='literalCandidate')fallbacks.push('movementDefaultOrAlternativeReview');
  if(c.size.status!=='literalCandidate')fallbacks.push('sizeDefaultOrFirstOptionReview');
  if(actions.some(a=>a.status!=='simpleAttackCandidate'))fallbacks.push('actionUtilityOrRangeDefaultReview');
  for(const [k,v] of Object.entries(c))bump(summary.chassis[k]??={},v.status);
  for(const [k,v] of Object.entries(defenses))bump(summary.defenses[k]??={},v.status);
  for(const a of actions){bump(summary.actions,a.status);bump(summary.actionSections,a.section);}
  for(const k of special)bump(summary.special,k);
  for(const k of fallbacks)bump(summary.tacticalFallbacks,k);
  rows.push({creatureId:i.id,sourceFingerprint:e.sourceFingerprint,rulesEra:e.rulesEra,chassis:c,defenses,actions,special,fallbacks,...flags()});
  summary.items++;
 }
 const body={schemaVersion:'dnd-upstream-creature-combat-projection.v1',commits:actual.commits,remainingFingerprint:actual.fingerprint,summary,rows,
  scope:'static stat block fields and isolated attack/defense candidates; no encounter, damage or resource execution',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function previewCreatureCombat(input,request){
 if(!rec(request)||!era(request.rulesEra)||!text(request.creatureId)||!text(request.sourceFingerprint)||!text(request.projectionFingerprint)||
  request.contextConfirmed!==true)return result('indeterminate','explicitCreatureContextRequired');
 const p=buildCreatureCombatProjection(input);
 if(p.fingerprint!==request.projectionFingerprint)return result('indeterminate','staleProjection');
 const row=p.rows.find(r=>r.creatureId===request.creatureId);
 if(!row||row.sourceFingerprint!==request.sourceFingerprint||row.rulesEra!==request.rulesEra)return result('indeterminate','creatureIdentityOrEditionMismatch');
 if(request.domain==='chassis'){
  const c=row.chassis;
  if(request.staticStatsPolicyConfirmed!==true||row.special.some(k=>['summonedBySpell','summonedByClass'].includes(k))||
   ['armor','hp','movement','size','type','scores'].some(k=>c[k].status!=='literalCandidate'))return result('indeterminate','staticChassisPending');
  if(!int(request.currentHp,0,c.hp.value.average)||!int(request.positionFeet,0,100000))return result('notSatisfied','invalidEncounterValues');
  return result('chassisCandidate','isolatedStaticFieldsOnly',{armorClass:c.armor.value,hitPoints:{current:request.currentHp,max:c.hp.value.average},
   size:c.size.value,creatureType:c.type.value,speedFeet:c.movement.value.walk,positionFeet:request.positionFeet,abilityScores:c.scores.value});
 }
 if(request.domain==='attack'){
  const a=row.actions.find(x=>x.section===request.section&&x.index===request.index);
  if(!a||a.status!=='simpleAttackCandidate'||request.actionFingerprint!==a.sourceFingerprint||request.targetingPolicyConfirmed!==true||
   request.otherActionDependenciesExcludedConfirmed!==true||!int(request.distanceFeet,0,100000))return result('indeterminate','actionContextPending');
  if(request.distanceFeet>a.attack.longFeet)return result('notSatisfied','outsideExplicitRange');
  return result('attackCandidate','rangeAndFormulaOnly',{rangeBand:request.distanceFeet>a.attack.normalFeet?'long':'normal',attackBonus:a.attack.attackBonus,
   damageType:a.attack.damageType,damageBounds:diceBounds(a.attack.dice)});
 }
 if(request.domain==='defense'){
  if(!damageTypes.has(request.damageType)||request.defenseInventoryCompleteConfirmed!==true||request.otherDefenseDependenciesExcludedConfirmed!==true)
   return result('indeterminate','defenseContextPending');
  const d=row.defenses;
  if(['resistance','vulnerability','immunity'].some(k=>!['notDeclared','literalCandidate'].includes(d[k].status)))return result('indeterminate','conditionalDefensePending');
  const has=k=>d[k].value?.includes(request.damageType)===true;
  const traits=['immunity','resistance','vulnerability'].filter(has);
  if(traits.length>1)return result('indeterminate','combinedDefensePolicyPending');
  return result('defenseCandidate','literalMembershipOnly',{membership:traits[0]??'noneDeclared'});
 }
 return result('indeterminate','unsupportedCreatureDomain');
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
module.exports={buildCreatureCombatProjection,previewCreatureCombat,publicSummary};
