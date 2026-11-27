'use strict';
// a8.10.1: full reconciliation coverage plus remaining-family field evidence.
const {createHash}=require('node:crypto');
const {digest}=require('./integrated-review');
const {identity}=require('./resolver');
const {physicalId:creatureId}=require('./creature-converter');
const {physicalId:equipmentId}=require('./equipment-converter');
const {converters}=require('./pilot-coverage');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const text=x=>typeof x==='string'&&!!x.trim();
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const coord=x=>JSON.stringify([x.path,x.index]);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const fields=Object.freeze({
 equipment:['equipmentCategory','cost','weight','quantity','properties','capacity','contents','consumes','uses','recharge','resource','resources','effects','effectTemplates','grantsActions','prerequisite'],
 magicItem:['equipmentCategory','cost','weight','rarity','attunement','attunementRequirements','magicBonus','baseItemId','charges','recharge','resource','resources','grantedSpellIds','effects','effectTemplates','grantsActions'],
 creatureStatBlock:['size','creatureType','alignment','armorClass','hitPoints','speed','abilityScores','challenge','proficiencyBonus','savingThrows','skills','resistances','vulnerabilities','immunities','traits','actions','bonusActions','reactions','legendaryActions','lairActions','spellcasting','languages','senses','initiative']
});
const nested=Object.freeze({
 equipment:['typeReference','resource','resources','effects','contents','grantsActions'],
 magicItem:['baseEquipment','armorClassBonus','variantTemplate','baseItem','charges','recharge','resource','resources','effects','grantsActions'],
 creatureStatBlock:['spellcasting','legendaryActions','lairActions','initiative','summonScaling','resources','effects']
});
const declarations=Object.freeze({
 equipment:['type','weight','value','quantity','packContents','containerCapacity','capacity','entries','charges','recharge','attachedSpells','property','ammoType','bonusAc'],
 magicItem:['rarity','reqAttune','reqAttuneTags','bonusWeapon','bonusWeaponAttack','bonusWeaponDamage','bonusAc','baseItem','charges','recharge','rechargeAmount','attachedSpells','classFeatures','property','entries','curse','sentient'],
 creatureStatBlock:['ac','hp','speed','save','skill','resist','vulnerable','immune','conditionImmune','trait','action','bonus','reaction','legendary','legendaryGroup','legendaryActionsLair','mythic','spellcasting','initiative','summonedBySpell','summonedByClass','cr','pbNote','senses','languages']
});
const pilotKinds=new Set(converters.flatMap(c=>c.kinds));
const family=k=>k==='classFeature'||k==='subclassFeature'?'feature':k;
const lane=k=>own(fields,k)?'remainingFamilyEvidence':pilotKinds.has(k)?'priorScopedCheckpoint':'outsidePilotContract';
function bucket(groups,kind){
 return groups[kind]??={coverage:lane(family(kind)),occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,byStatus:dict()};
}
function compareFields(kind,a,b){
 assert(own(fields,kind)&&rec(a)&&rec(b),'invalidRemainingComparison');
 const compare=(x,y,keys,prefix)=>keys.map(field=>{
  const left=own(x,field),right=own(y,field);
  return {field:prefix+field,status:!left&&!right?'absentBoth':!left?'addedCandidate':!right?'missingCandidate':digest(x[field])===digest(y[field])?'exactValue':'differentValue'};
 });
 return [...compare(a,b,fields[kind],'/payload/'),...compare(rec(a.mechanics)?a.mechanics:{},rec(b.mechanics)?b.mechanics:{},nested[kind],'/payload/mechanics/')];
}
function bindRemaining(i,commit){
 const p=i.provenance,m=i.payload?.mechanics,raw=i.kind==='creatureStatBlock'?m?.upstreamCreature:m?.upstreamItem;
 assert(rec(raw)&&raw.name===i.name&&raw.source===p?.sourceCode&&text(raw.name)&&text(raw.source)&&
  p.origin==='5etools'&&p.commit===commit&&sha(p.blob)&&Number.isSafeInteger(p.index)&&p.index>=0&&
  i.source?.id==='upstream:main:'+raw.source&&i.source.status==='needsReview'&&['2014','2024','unknown'].includes(i.source.rulesEra),'remainingSourceMismatch');
 if(i.kind==='creatureStatBlock'){
  assert(i.id===creatureId(raw.source,raw.name)&&p.entityKey===identity('monster',raw)&&/^data\/bestiary\/[^/]+\.json$/.test(p.path),'creatureIdentityMismatch');
 }else if(i.kind==='equipment'){
  assert(i.id===equipmentId(raw.source,'equipment',raw.name)&&['data/items.json','data/items-base.json'].includes(p.path)&&
   p.entityKey===identity(p.path==='data/items-base.json'?'baseitem':'item',raw),'equipmentIdentityMismatch');
 }else{
  const variant=!!i.metadata?.variantTemplateKey;
  const t=m.variantTemplate,b=m.baseItem,v=i.metadata?.variantBase;
  const parts=variant?['variant',p.entityKey,rec(b)?identity('baseitem',b):null]:['item',p.entityKey];
  assert(i.id==='upstream:main:magicItem:'+createHash('sha256').update(JSON.stringify(parts)).digest('hex'),'magicIdentityMismatch');
  if(variant)assert(p.path==='data/magicvariants.json'&&rec(t)&&rec(b)&&rec(v)&&p.entityKey===i.metadata.variantTemplateKey&&
   p.entityKey===identity('magicvariant',t)&&v.name===b.name&&v.source===b.source&&v.path==='data/items-base.json'&&sha(v.blob)&&Number.isSafeInteger(v.index)&&v.index>=0,'magicVariantBindingMismatch');
  else assert(p.path==='data/items.json'&&p.entityKey===identity('item',raw),'magicIdentityMismatch');
 }
 return raw;
}
function buildRemainingFamilyEvidence({reconciliation:r,rawHistorical,items}){
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&
  r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0&&
  ['application','main','homebrew'].every(k=>sha(r.commits[k])),'invalidReconciliation');
 const raw=new Map(),targets=new Map(),seen=new Set(),ids=new Set(),runtimeIds=new Set(),rows=[],upstreamRows=[],runtimeRows=[];
 for(const x of rawHistorical){assert(!raw.has(coord(x)),'duplicateHistoricalCoordinate');raw.set(coord(x),x.item);}
 for(const i of items){assert(text(i.id)&&!targets.has(i.id)&&pilotKinds.has(i.kind)&&i.provenance?.origin==='5etools'&&i.provenance.commit===r.commits.main,'invalidUpstreamItem');targets.set(i.id,i);}
 const coverage={historical:dict(),runtime:dict(),upstream:dict()},remaining=Object.fromEntries(Object.keys(fields).map(k=>[k,{historical:{byField:{},byComparison:{},unassessedFields:0},upstream:{bySource:{},byEra:{},declarations:{},reviewCodes:{},variants:0}}]));
 for(const i of items){
  const s=coverage.upstream[i.kind]??={coverage:lane(i.kind),items:0};s.items++;
  if(!own(fields,i.kind))continue;
  const raw=bindRemaining(i,r.commits.main),u=remaining[i.kind].upstream;
  bump(u.bySource,i.provenance.sourceCode);bump(u.byEra,i.source.rulesEra);
  if(i.metadata?.variantTemplateKey)u.variants++;
  const declared=declarations[i.kind].filter(k=>own(raw,k)).map(field=>({field,fingerprint:digest(raw[field]),status:'semanticsPending'}));
  const reviewCodes=i.metadata?.reviewCodes;
  assert(Array.isArray(reviewCodes)&&reviewCodes.every(text),'remainingReviewCodesMissing');
  for(const d of declared)bump(u.declarations,d.field);
  for(const c of reviewCodes)bump(u.reviewCodes,c);
  upstreamRows.push({itemId:i.id,kind:i.kind,sourceFingerprint:digest(i),rulesEra:i.source.rulesEra,declarations:declared,reviewCodes:[...reviewCodes],variant:!!i.metadata?.variantTemplateKey,...flags()});
 }
 function preserve(h,domain){
  assert(h.domain===domain&&text(h.kind)&&text(h.evidenceId)&&!ids.has(h.evidenceId)&&hash(h.sourceFingerprint)&&h.preservation==='required'&&
   h.activation==='review-required'&&h.decision==='unreviewed','occurrenceBindingMismatch');ids.add(h.evidenceId);
 }
 function account(h,s){
  s.occurrences++;bump(s.byStatus,h.status);
  if(h.status!=='identityCandidate'){s.identityPending++;return undefined;}
  const t=targets.get(h.targetId);
  assert(t&&t.kind===family(h.kind)&&digest(t)===h.targetFingerprint,'remainingTargetMismatch');
  s.identityCandidates++;if(h.eraStatus!=='sameKnownEra')s.eraPending++;
  return t;
 }
 for(const h of r.historical){
  preserve(h,'historical');const a=raw.get(coord(h));
  assert(a&&a.id===h.id&&a.kind===h.kind&&digest(a)===h.sourceFingerprint&&!seen.has(coord(h)),'historicalBindingMismatch');
  seen.add(coord(h));const t=account(h,bucket(coverage.historical,h.kind));
  if(!own(fields,h.kind))continue;
  const row={evidenceId:h.evidenceId,kind:h.kind,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,preservation:'required',fields:[],...flags()};
  if(t){
   Object.assign(row,{targetId:t.id,targetFingerprint:h.targetFingerprint,eraStatus:h.eraStatus});
   const s=remaining[h.kind].historical;
   if(rec(a.payload)&&rec(t.payload)){
    row.fields=compareFields(h.kind,a.payload,t.payload);
    const unassessed=(x,y,keys)=>new Set([...Object.keys(x),...Object.keys(y)].filter(k=>!keys.includes(k))).size;
    row.unassessedFieldCount=unassessed(a.payload,t.payload,[...fields[h.kind],'mechanics'])+
     unassessed(rec(a.payload.mechanics)?a.payload.mechanics:{},rec(t.payload.mechanics)?t.payload.mechanics:{},nested[h.kind]);
    s.unassessedFields+=row.unassessedFieldCount;
    for(const f of row.fields)bump(s.byField[f.field]??={},f.status);
    bump(s.byComparison,row.fields.some(f=>['missingCandidate','addedCandidate','differentValue'].includes(f.status))?'fieldReviewRequired':'selectedFieldsCompatibleCandidate');
   }else bump(s.byComparison,'payloadNotAvailable');
  }
  rows.push(row);
 }
 assert(seen.size===rawHistorical.length&&seen.size===r.summary.historicalOccurrences,'historicalCoverageMismatch');
 for(const h of r.runtime){
  preserve(h,'runtime');assert(text(h.id)&&!runtimeIds.has(h.id),'duplicateRuntimeOccurrence');runtimeIds.add(h.id);
  const t=account(h,bucket(coverage.runtime,h.kind));
  if(own(fields,h.kind))runtimeRows.push({evidenceId:h.evidenceId,kind:h.kind,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,preservation:'required',
   ...(t?{targetId:t.id,targetFingerprint:h.targetFingerprint,eraStatus:h.eraStatus}:{}),...flags()});
 }
 assert(runtimeIds.size===r.summary.runtime,'runtimeCoverageMismatch');
 const totals={historical:seen.size,runtime:runtimeIds.size,upstream:targets.size};
 const body={schemaVersion:'dnd-upstream-remaining-family-evidence.v1',commits:r.commits,totals,coverage,remaining,rows,upstreamRows,runtimeRows,
  scope:'all historical and staging runtime kinds; selected remaining family fields; no installed inventory or mechanical approval',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,upstreamRows,runtimeRows,...summary}=r;return summary;}
module.exports={compareFields,buildRemainingFamilyEvidence,publicSummary};
