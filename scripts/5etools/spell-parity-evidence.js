'use strict';
// a8.7.1: occurrence-bound spell evidence, not a new spell converter.
// Keep field equivalence separate from runtime readiness and source approval.
const {digest}=require('./integrated-review');
const {physicalId,pilot}=require('./spell-converter');
const {directDamage,compileScaling,compileDuration}=require('./effect-damage-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const coord=x=>JSON.stringify([x.path,x.index]);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const fields=['level','school','classes','classIds','castingTime','actionCost','range','duration','components','specificMaterial','ritual','concentration',
 'requiresConcentration','requiresAttackRoll','attackRoll','saveAbility','damageFormula','damageType','healingFormula','targets','targeting','area',
 'consumesSpellSlot','minimumSlotLevel','consumes','scaling','damageOnSaveSuccess','grantsActions','effectTemplates','engineKey','mechanics'];
const required=new Set(['level','classes','castingTime']);
const schoolNames=new Set(['abjuration','conjuration','divination','enchantment','evocation','illusion','necromancy','transmutation']);
const damageTypes=new Set('acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(' '));
const abilities=new Set(['str','dex','con','int','wis','cha']);
function normalize(k,v){
 if(k==='classes'&&Array.isArray(v)&&v.length&&v.every(x=>text(x)&&!/[{}|]/.test(x))){
  const a=v.map(x=>x.trim().toLowerCase());return new Set(a).size===a.length?a.sort():undefined;
 }
 if(typeof v==='string'){
  const s=v.trim().toLowerCase();
  if(k==='school'&&schoolNames.has(s))return s;
  if(k==='damageType'&&damageTypes.has(s))return s;
  if(k==='saveAbility'&&abilities.has(s))return s;
  if(k==='range'){
   // Only literal point distance / nonnumeric canonical labels. Do not
   // equate self areas, reach, sight, or touch with numeric distances.
   const m=/^([1-9][0-9]*)\s+(ft\.?|feet|foot|mi\.?|miles?|mile)$/.exec(s);
   if(m&&Number.isSafeInteger(Number(m[1])))return [Number(m[1]),m[2].startsWith('m')?'mi':'ft'];
   if(['self','touch','sight','unlimited','same plane','special'].includes(s))return s;
  }
 }
 return undefined;
}
function compareSpellFields(a,b){
 assert(rec(a)&&rec(b),'invalidSpellPayloadComparison');
 return fields.map(field=>{
  const x=own(a,field)&&a[field]!==undefined,y=own(b,field)&&b[field]!==undefined;
  let status;
  if(!x&&!y)status=required.has(field)?'requiredAbsentBoth':'absentBoth';
  else if(!x)status='addedCandidate';else if(!y)status='missingCandidate';
  else if(digest(a[field])===digest(b[field]))status='exactValue';
  else {const n=normalize(field,a[field]),m=normalize(field,b[field]);status=n!==undefined&&m!==undefined&&digest(n)===digest(m)?'representationOnlyCandidate':'differentValue';}
  return {field,status};
 });
}
function bindSpell(i,commit){
 const p=i?.provenance,s=i?.source,r=i?.payload?.mechanics?.upstreamSpell;
 const code=p?.sourceCode;
 assert(i?.kind==='spell'&&text(i.name)&&own(pilot,code)&&p.origin==='5etools'&&p.repository==='5etools-mirror-3/5etools-src'&&p.commit===commit&&
  sha(p.blob)&&/^data\/spells\/[^/]+\.json$/.test(p.path)&&s?.id==='upstream:main:'+code&&s.status==='needsReview'&&s.rulesEra===pilot[code].era&&
  i.id===physicalId(code,i.name)&&i.identity?.canonicalKey==='spell:'+i.name.trim().toLowerCase()&&rec(r),'spellSourceBindingMismatch');
 return r;
}
function spellContractEvidence(i){
 const p=i.payload,r=p.mechanics.upstreamSpell,issues=[];
 const time=p.castingTime;
 if(time?.kind!=='action'||!['action','bonusAction','reaction'].includes(time.actionCost))issues.push('castingTimeActionFallbackReview');
 if(time?.actionCost==='reaction')issues.push('reactionTriggerExecutionPending');
 if(time?.ritualAlternative===true||p.ritual===true)issues.push('ritualTimingAndSlotPolicyPending');
 if(p.targets===undefined&&p.targeting===undefined)issues.push('defaultTargetCountNotEstablished');
 if(p.area!==undefined||r.areaTags?.length)issues.push('areaGeometryAndOriginPending');
 if(!Number.isInteger(p.level)||p.level<0||p.level>9)issues.push('spellLevelPending');
 if(!Array.isArray(p.classIds)||!p.classIds.length)issues.push('qualifiedClassAccessPending');
 if(!Array.isArray(r.selectedClassAccess)||!r.selectedClassAccess.length)issues.push('selectedClassAccessPending');
 if(rec(r.access)&&Object.keys(r.access).some(k=>k!=='class'))issues.push('additionalAccessPending');
 if(p.level>0&&p.consumesSpellSlot===undefined)issues.push('slotConsumptionPolicyPending');
 if(p.level>0&&p.minimumSlotLevel===undefined)issues.push('minimumSlotLevelPolicyPending');
 if(rec(r.components?.m)&&(own(r.components.m,'cost')||own(r.components.m,'consume')))issues.push('materialCostOrConsumptionPending');
 if(rec(r.components)&&Object.keys(r.components).some(k=>!['v','s','m'].includes(k)))issues.push('specialComponentsPending');
 if(r.damageTags?.length||r.damageTypes?.length){
  if(p.damageFormula===undefined)issues.push('damageApplicationPending');
 }
 if(p.damageFormula!==undefined&&p.requiresAttackRoll===undefined)issues.push('attackRollFallbackReview');
 if(r.spellAttack?.length&&p.requiresAttackRoll!==true)issues.push('attackModePending');
 if(r.savingThrow?.length){
  if(p.saveAbility===undefined)issues.push('saveAbilityPending');
  if(p.damageOnSaveSuccess===undefined)issues.push('saveSuccessOutcomePending');
 }
 if(r.scalingLevelDice!=null||r.entriesHigherLevel?.length)issues.push('scalingApplicationPending');
 if(r.conditionInflict?.length||r.conditionImmune?.length)issues.push('conditionApplicationPending');
 if(r.damageResist?.length||r.damageImmune?.length||r.damageVulnerable?.length)issues.push('defenseApplicationPending');
 if(r.duration?.length!==1||p.concentration===undefined)issues.push('durationOrConcentrationAlternativesPending');
 if(p.concentration===true)issues.push('concentrationLifecyclePending');
 if(r.miscTags?.includes('HL')||p.healingFormula!==undefined)issues.push('healingApplicationPending');
 // Absence of a healing tag or a damage tag never proves absence of the mechanic.
 issues.push('effectAndTargetSemanticsNotEstablished');
 return {codes:issues.sort(),durationStatus:compileDuration(i).status,
  damageStatuses:directDamage(i).map(x=>x.status),scalingStatuses:compileScaling(i).map(x=>x.status)};
}
function buildSpellParityEvidence({reconciliation:r,rawHistorical,items}){
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&
  r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0&&
  ['application','main','homebrew'].every(k=>sha(r.commits[k])),'invalidReconciliation');
 const raw=new Map(),targets=new Map(),seen=new Set(),rows=[],upstreamRows=[];
 for(const x of rawHistorical){assert(!raw.has(coord(x)),'duplicateHistoricalCoordinate');raw.set(coord(x),x.item);}
 for(const i of items){assert(text(i.id)&&!targets.has(i.id),'duplicateTarget');targets.set(i.id,i);}
 const upstream={items:0,bySource:{},contractCodes:{},durationStatuses:{},damageStatuses:{},scalingStatuses:{}};
 for(const i of items.filter(x=>x.kind==='spell')){
  bindSpell(i,r.commits.main);const c=spellContractEvidence(i);
  upstream.items++;bump(upstream.bySource,i.provenance.sourceCode);
  for(const k of c.codes)bump(upstream.contractCodes,k);
  bump(upstream.durationStatuses,c.durationStatus);
  for(const k of c.damageStatuses)bump(upstream.damageStatuses,k);
  for(const k of c.scalingStatuses)bump(upstream.scalingStatuses,k);
  upstreamRows.push({itemId:i.id,sourceFingerprint:digest(i),rulesEra:i.source.rulesEra,...c,...flags()});
 }
 const historical={occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,byIdentityStatus:{},byField:{},byStatus:{},unassessedFields:0};
 for(const h of r.historical.filter(x=>x.kind==='spell')){
  const a=raw.get(coord(h));
  assert(a&&a.id===h.id&&a.kind==='spell'&&digest(a)===h.sourceFingerprint&&!seen.has(coord(h))&&
   h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed','historicalBindingMismatch');
  seen.add(coord(h));historical.occurrences++;bump(historical.byIdentityStatus,h.status);
  const row={evidenceId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,fields:[],...flags()};
  if(h.status!=='identityCandidate'){historical.identityPending++;rows.push(row);continue;}
  const t=targets.get(h.targetId);
  assert(t?.kind==='spell'&&digest(t)===h.targetFingerprint,'targetBindingMismatch');
  historical.identityCandidates++;if(h.eraStatus!=='sameKnownEra')historical.eraPending++;
  row.targetFingerprint=h.targetFingerprint;row.eraStatus=h.eraStatus;
  if(!rec(a.payload)||!rec(t.payload)){bump(historical.byStatus,'payloadNotAvailable');rows.push(row);continue;}
  row.fields=compareSpellFields(a.payload,t.payload);
  row.unassessedFieldCount=new Set([...Object.keys(a.payload),...Object.keys(t.payload)].filter(k=>!fields.includes(k))).size;
  historical.unassessedFields+=row.unassessedFieldCount;
  for(const f of row.fields)bump(historical.byField[f.field]??={},f.status);
  bump(historical.byStatus,row.fields.some(f=>['differentValue','missingCandidate','addedCandidate','requiredAbsentBoth'].includes(f.status))?'fieldReviewRequired':'selectedFieldsCompatibleCandidate');
  rows.push(row);
 }
 assert(seen.size===rawHistorical.filter(x=>x.item.kind==='spell').length,'historicalCoverageMismatch');
 const runtime={occurrences:0,byStatus:{}};
 for(const x of r.runtime.filter(x=>x.kind==='spell')){
  assert(x.preservation==='required'&&x.activation==='review-required'&&x.decision==='unreviewed','runtimeBindingMismatch');
  runtime.occurrences++;bump(runtime.byStatus,x.status);
 }
 const body={schemaVersion:'dnd-upstream-spell-parity-evidence.v1',commits:r.commits,historical,upstream,runtime,rows,upstreamRows,
  scope:'selected historical payload fields and observed staging runtime contract gaps; no spell access, casting or damage authorization',
  approvedMappings:0,mechanicalParityEstablished:0,executable:false,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,upstreamRows,...summary}=r;return summary;}
module.exports={compareSpellFields,spellContractEvidence,buildSpellParityEvidence,publicSummary};
