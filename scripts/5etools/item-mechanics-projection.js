'use strict';
// a8.10.3: item evidence and isolated arithmetic, never equipment or resource writes.
const {digest}=require('./integrated-review');
const {identity}=require('./resolver');
const {physicalId:equipmentId,costWeight,classify}=require('./equipment-converter');
const {physicalId:spellId}=require('./spell-converter');
const {matches,expand}=require('./magic-item-converter');
const {buildRemainingFamilyEvidence}=require('./remaining-family-evidence');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const era=x=>x==='2014'||x==='2024';
const same=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const result=(status,reason,extra={})=>({status,reason,...extra,...flags()});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const absent=()=>({status:'notDeclared'});
const pending=()=>({status:'semanticsPending'});
const candidate=value=>({status:'literalCandidate',value});
const rarities=new Set(['common','uncommon','rare','very rare','legendary','artifact']);
const mundaneKinds=['equipment','weapon','armor'];
function uid(raw){
 if(!text(raw)||/[{}#\r\n]/.test(raw))return undefined;
 const p=raw.split('|');return p.length===2&&p.every(text)?p:undefined;
}
function endpoint(index,raw,kind,owner,commit){
 const u=uid(raw);if(!u)return {status:'explicitSourcePending'};
 const [name,source]=u;
 const targets=kind==='spell'?[index.get(spellId(source,name))]:mundaneKinds.map(k=>index.get(equipmentId(source,k,name)));
 const found=targets.filter(Boolean);
 if(found.length!==1)return {status:found.length?'ambiguousEndpoint':'endpointPending'};
 const t=found[0],p=t.provenance;
 const rawKind=kind==='spell'?'spell':p?.path==='data/items-base.json'?'baseitem':'item';
 const validPath=kind==='spell'?/^data\/spells\/[^/]+\.json$/.test(p?.path):['data/items-base.json','data/items.json'].includes(p?.path);
 if(!validPath||p.origin!=='5etools'||p.commit!==commit||p.entityKey!==identity(rawKind,{name,source})||
  !/^[a-f0-9]{40}$/.test(p.blob)||!int(p.index,0,Number.MAX_SAFE_INTEGER)||t.source?.id!=='upstream:main:'+p.sourceCode||
  t.source.status!=='needsReview'||t.name.toLowerCase()!==name.toLowerCase()||p.sourceCode.toLowerCase()!==source.toLowerCase()||
  (kind==='spell'?t.kind!=='spell':!mundaneKinds.includes(t.kind)))return {status:'endpointBindingPending'};
 const binding={targetId:t.id,targetFingerprint:digest(t)};
 if(t.id===owner.itemId)return {...binding,status:'selfReferencePending'};
 if(!era(owner.rulesEra)||t.source.rulesEra!==owner.rulesEra)return {...binding,status:'editionPending'};
 return {...binding,status:'identityCandidate'};
}
function priceWeight(raw,payload){
 const expected=costWeight(raw,new Set());
 if(!same(expected.cost,payload.cost)||!same(expected.weight,payload.weight))throw Error('itemValueBindingMismatch');
 const cost=!own(raw,'value')?absent():int(raw.value,0,Number.MAX_SAFE_INTEGER)?candidate(raw.value):pending();
 const weight=!own(raw,'weight')?absent():typeof raw.weight==='number'&&Number.isFinite(raw.weight)&&raw.weight>=0?candidate(raw.weight):pending();
 return {costCopper:cost,weightPounds:weight};
}
function attunement(raw,p){
 const v=raw.reqAttune;
 const expected=v===true||typeof v==='string'&&v.trim()?true:v===undefined||v===false?false:undefined;
 if(!same(expected,p.attunement))throw Error('itemAttunementBindingMismatch');
 if(own(raw,'reqAttuneTags')||own(raw,'reqAttuneAlt')||own(raw,'reqAttuneAltTags')||typeof v==='string')return {status:'conditionalPending'};
 if(!own(raw,'reqAttune'))return absent();
 return typeof v==='boolean'?{status:'explicitRequirementCandidate',required:v}:pending();
}
function bonus(raw,p){
 const parsed=x=>typeof x==='number'||typeof x==='string'&&/^[+-]?\d+$/.test(x)?Number(x):NaN;
 const expected=x=>Number.isInteger(parsed(x))&&Number.isFinite(parsed(x))?parsed(x):undefined;
 const b=expected(raw.bonusWeapon),ac=expected(raw.bonusAc);
 if(!same(raw.bonusWeaponAttack===undefined&&raw.bonusWeaponDamage===undefined?b:undefined,p.magicBonus)||
  !same(ac,p.mechanics.armorClassBonus))throw Error('itemBonusBindingMismatch');
 const weapon=own(raw,'bonusWeaponAttack')||own(raw,'bonusWeaponDamage')?{status:'separateBonusesPending'}:
  !own(raw,'bonusWeapon')?absent():int(b,-100,100)?candidate(b):pending();
 const armorClass=!own(raw,'bonusAc')?absent():int(ac,-100,100)?candidate(ac):pending();
 return {weapon,armorClass};
}
function charges(raw){
 const cap=!own(raw,'charges')?absent():int(raw.charges,1,1000000)?candidate(raw.charges):pending();
 const event=!own(raw,'recharge')?absent():['dawn','dusk','midnight'].includes(raw.recharge)?
  {status:'explicitEventCandidate',event:raw.recharge}:pending();
 const n=raw.rechargeAmount;
 let recovery=!own(raw,'rechargeAmount')?absent():int(n,1,1000000)?{status:'fixedAmountCandidate',amount:n}:pending();
 if(typeof n==='string'){
  const m=/^([1-9]\d*)d(3|4|6|8|10|12|20)(?:\s*\+\s*(\d+))?$/.exec(n);
  if(m&&int(Number(m[1]),1,1000)&&int(Number(m[3]||0),0,1000000)){
   const count=Number(m[1]),sides=Number(m[2]),modifier=Number(m[3]||0);
   recovery={status:'diceAmountCandidate',count,sides,modifier,min:count+modifier,max:count*sides+modifier};
  }
 }
 return {cap,event,recovery,sharing:'notEstablished',consumption:'notEstablished',depletion:'notEstablished'};
}
function references(raw,index,owner,commit){
 const base=own(raw,'baseItem')?endpoint(index,raw.baseItem,'item',owner,commit):absent();
 const spells=!own(raw,'attachedSpells')?[]:!Array.isArray(raw.attachedSpells)?
  [{status:'shapePending',fingerprint:digest(raw.attachedSpells)}]:raw.attachedSpells.map((v,i)=>({index:i,fingerprint:digest(v),...endpoint(index,v,'spell',owner,commit)}));
 const bundle=!own(raw,'packContents')?absent():{status:'bundleSemanticsPending',fingerprint:digest(raw.packContents)};
 const capacity=!own(raw,'containerCapacity')?absent():{status:'capacitySemanticsPending',fingerprint:digest(raw.containerCapacity)};
 return {base,spells,bundle,capacity};
}
function variant(i,raw,base){
 if(!i.metadata?.variantTemplateKey)return {status:'notVariant'};
 const m=i.payload.mechanics,b=m.baseItem,t=m.variantTemplate;
 if(!matches(b,t)||!same(expand(b,t),raw))throw Error('itemVariantExpansionMismatch');
 return {status:base.status==='identityCandidate'?'variantBaseIdentityCandidate':'variantBasePending',templateFingerprint:digest(t),baseFingerprint:digest(b),textInterpolation:'pending'};
}
function buildItemMechanicsProjection(input,evidence){
 const actual=buildRemainingFamilyEvidence(input);
 if(evidence!==undefined&&digest(evidence)!==digest(actual))throw Error('remainingEvidenceMismatch');
 const index=new Map(input.items.map(i=>[i.id,i])),rows=[];
 const summary={items:0,byKind:{},values:{},attunement:{},rarity:{},bonuses:{},charges:{},variants:{},references:{},uninterpreted:{}};
 for(const e of actual.upstreamRows.filter(r=>['equipment','magicItem'].includes(r.kind))){
  const i=index.get(e.itemId),p=i.payload,raw=p.mechanics.upstreamItem;
  if(digest(i)!==e.sourceFingerprint)throw Error('itemEvidenceBindingMismatch');
  const values=priceWeight(raw,p),refs=references(raw,index,e,actual.commits.main);
  let magic;
  if(i.kind==='magicItem'){
   const r=typeof raw.rarity==='string'?raw.rarity.trim().toLowerCase():undefined;
   const rarity=!own(raw,'rarity')?absent():rarities.has(r)&&p.rarity===r?candidate(r):pending();
   magic={rarity,attunement:attunement(raw,p),bonuses:bonus(raw,p),charges:charges(raw),variant:variant(i,raw,refs.base),baseEquipmentKind:classify(raw)};
   bump(summary.rarity,rarity.status);bump(summary.attunement,magic.attunement.status);bump(summary.variants,magic.variant.status);
   for(const [k,v] of Object.entries(magic.bonuses))bump(summary.bonuses[k]??={},v.status);
   for(const k of ['cap','event','recovery'])bump(summary.charges[k]??={},magic.charges[k].status);
  }
  const uninterpreted=['entries','additionalEntries','classFeatures','curse','sentient','property','reqAttuneTags','recharge','rechargeAmount','charges'].filter(k=>own(raw,k));
  for(const k of uninterpreted)bump(summary.uninterpreted,k);
  for(const [k,v] of Object.entries(values))bump(summary.values[k]??={},v.status);
  for(const k of ['base','bundle','capacity'])bump(summary.references[k]??={},refs[k].status);
  for(const s of refs.spells)bump(summary.references.spells??={},s.status);
  rows.push({itemId:i.id,kind:i.kind,sourceFingerprint:e.sourceFingerprint,rulesEra:e.rulesEra,values,references:refs,
   ...(magic?{magic}:{}),uninterpreted,...flags()});
  summary.items++;bump(summary.byKind,i.kind);
 }
 const body={schemaVersion:'dnd-upstream-item-mechanics-projection.v1',commits:actual.commits,remainingFingerprint:actual.fingerprint,summary,rows,
  scope:'literal item data and isolated arithmetic; no acquisition, equip, attunement, effects or charge writes',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function previewItemMechanics(input,request){
 if(!rec(request)||!era(request.rulesEra)||!text(request.itemId)||!text(request.sourceFingerprint)||!text(request.projectionFingerprint)||
  request.contextConfirmed!==true)return result('indeterminate','explicitItemContextRequired');
 const p=buildItemMechanicsProjection(input);
 if(request.projectionFingerprint!==p.fingerprint)return result('indeterminate','staleProjection');
 const r=p.rows.find(x=>x.itemId===request.itemId);
 if(!r||r.rulesEra!==request.rulesEra||r.sourceFingerprint!==request.sourceFingerprint)return result('indeterminate','itemIdentityOrEditionMismatch');
 if(request.domain==='quantity'){
  if(request.quantityPolicyConfirmed!==true||!int(request.quantity,1,1000000))return result('indeterminate','quantityContextPending');
  const {costCopper,weightPounds}=r.values;
  if(costCopper.status!=='literalCandidate'||weightPounds.status!=='literalCandidate'||r.references.bundle.status!=='notDeclared')return result('indeterminate','unitValueOrBundlePending');
  const copper=costCopper.value*request.quantity,weight=weightPounds.value*request.quantity;
  if(!Number.isSafeInteger(copper)||!Number.isFinite(weight)||weight>Number.MAX_SAFE_INTEGER)return result('indeterminate','quantityOverflow');
  return result('quantityCandidate','unitArithmeticOnly',{copper,weightPounds:weight});
 }
 if(!r.magic)return result('indeterminate','magicItemRequired');
 if(request.domain==='attunement'){
  const a=r.magic.attunement;
  if(a.status!=='explicitRequirementCandidate'||request.slotPolicyConfirmed!==true||request.otherRequirementsExcludedConfirmed!==true||
   !int(request.usedSlots,0,100)||!int(request.slotLimit,0,100)||request.usedSlots>request.slotLimit||
   request.currentlyAttuned!==false)return result('indeterminate','attunementContextPending');
  if(!a.required)return result('attunementRequirementCandidate','explicitNotRequiredOnly',{required:false});
  if(request.usedSlots===request.slotLimit)return result('notSatisfied','noConfirmedSlotCapacity');
  return result('attunementRequirementCandidate','capacityOnly',{required:true,remainingSlots:request.slotLimit-request.usedSlots-1});
 }
 if(request.domain==='chargeArithmetic'){
  const c=r.magic.charges.cap;
  if(c.status!=='literalCandidate'||request.resourceBindingConfirmed!==true||request.spendPolicyConfirmed!==true||
   request.otherChargeDependenciesExcludedConfirmed!==true||!text(request.instanceId)||!text(request.resourceId)||
   !int(request.current,0,c.value)||!int(request.amount,1,1000000))return result('indeterminate','chargeContextPending');
  if(request.amount>request.current)return result('notSatisfied','insufficientCharges');
  return result('chargeArithmeticCandidate','subtractionOnly',{instanceId:request.instanceId,resourceId:request.resourceId,before:request.current,after:request.current-request.amount,max:c.value});
 }
 return result('indeterminate','unsupportedItemDomain');
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
module.exports={buildItemMechanicsProjection,previewItemMechanics,publicSummary};
