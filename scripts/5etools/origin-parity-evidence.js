'use strict';
// a8.8.1: origin mechanical evidence only. Preserve all historical variants.
const {createHash}=require('node:crypto');
const {digest}=require('./integrated-review');
const {identity}=require('./resolver');
const {backgroundAbility,mergeSubrace}=require('./origin-converter');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const coord=x=>JSON.stringify([x.path,x.index]);
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const eras={PHB:'2014',XPHB:'2024',AAG:'2014',MPMM:'2014',EFA:'2024',AU:'2024',WoW:'unknown',ERLW:'2014',VRGR:'2014',FTD:'2014',SCAG:'2014',TCE:'2014',VGM:'2014',MTF:'2014'};
const kinds=new Set(['species','background']);
const common=['abilityScoreOptions','abilityScoreIncrease','abilityScoreIncreaseRule','skillProficiencies','skillProficiencyChoice','toolProficiencies','toolProficiencyChoice','languages','languageProficiencies','languageProficiencyChoice','weaponProficiencies','armorTraining','armorProficiencies','expertise','featIds','featChoice','featureIds','grantsFeatureIds','additionalSpells','spellGrants','resources','grantsActions','effectTemplates','prerequisite','engineKey','mechanics'];
const fields={species:[...common,'creatureType','size','sizeOptions','speed','darkvisionFt','blindsightFt','resistances','damageImmunities','vulnerabilities','conditionImmunities','optionType','inheritsFrom','inheritsFromChoice','baseSpecies','replacesTraits','variableTraitChoice'],
 background:[...common,'equipmentOptions','startingEquipment','customBackground','requiresChoice','choiceType','choices','feature']};
const sets=new Set(['abilityScoreOptions','skillProficiencies','resistances','damageImmunities','vulnerabilities','sizeOptions']);
function normalizedSet(v){
 if(!Array.isArray(v)||!v.length||!v.every(x=>text(x)&&!/[^a-zA-Z ]/.test(x)))return undefined;
 const a=v.map(x=>x.toLowerCase());
 return new Set(a).size===a.length?a.sort():undefined;
}
function compareOriginFields(kind,a,b){
 assert(kinds.has(kind)&&rec(a)&&rec(b),'invalidOriginComparison');
 return fields[kind].map(field=>{
  const x=own(a,field)&&a[field]!==undefined,y=own(b,field)&&b[field]!==undefined;
  let status;
  if(!x&&!y)status='absentBoth';
  else if(!x)status='addedCandidate';else if(!y)status='missingCandidate';
  else if(digest(a[field])===digest(b[field]))status='exactValue';
  else{
   const n=sets.has(field)?normalizedSet(a[field]):undefined,m=sets.has(field)?normalizedSet(b[field]):undefined;
   status=n!==undefined&&m!==undefined&&digest(n)===digest(m)?'representationOnlyCandidate':'differentValue';
  }
  return {field,status};
 });
}
function bindOrigin(i,commit){
 const p=i?.provenance,m=i?.payload?.mechanics,r=m?.upstreamOrigin,k=i?.metadata?.upstreamKind;
 assert(kinds.has(i?.kind)&&rec(r)&&text(i.name)&&r.name===i.name&&own(eras,p?.sourceCode)&&r.source===p.sourceCode&&
 p.origin==='5etools'&&p.repository==='5etools-mirror-3/5etools-src'&&p.commit===commit&&sha(p.blob)&&
 i.source?.id==='upstream:main:'+p.sourceCode&&i.source.status==='needsReview'&&i.source.rulesEra===eras[p.sourceCode]&&
 (i.kind==='background'?k==='background'&&p.path==='data/backgrounds.json':['race','subrace'].includes(k)&&p.path==='data/races.json'),'originSourceBindingMismatch');
 let key,canonical;
 const norm=s=>s.trim().toLowerCase();
 if(k==='subrace'){
  const child=m.subraceRecord,base=m.baseRecord,parent=m.parent;
  assert(rec(child)&&rec(base)&&rec(parent)&&child.source===r.source&&base.name===parent.name&&base.source===parent.source&&
   parent.key===identity('race',{name:child.raceName,source:child.raceSource})&&parent.key===identity('race',base)&&sha(parent.blob)&&
   parent.path==='data/races.json'&&i.name===base.name+' ('+child.name+')','subraceOwnerBindingMismatch');
  assert(digest(mergeSubrace(base,child,new Set()))===digest(r),'subraceMergeFingerprintMismatch');
  key=identity(k,child);canonical='species:'+norm(base.name)+':'+norm(child.name);
 }else{key=identity(k,r);canonical=i.kind+':'+norm(r.name);}
 assert(p.entityKey===key&&i.id==='upstream:main:'+i.kind+':'+createHash('sha256').update(key).digest('hex')&&
 i.identity?.canonicalKey===canonical,'originIdentityMismatch');
 return r;
}
function originContractEvidence(i,itemsById,commit){
 const p=i.payload,m=p.mechanics,r=m.upstreamOrigin,codes=[],featEdges=[];
 const add=code=>{if(!codes.includes(code))codes.push(code);};
 if(i.source.rulesEra==='unknown')add('editionPending');
 if(i.kind==='background'){
  const projected=i.source.rulesEra==='2024'?backgroundAbility(r.ability):undefined;
  if(projected){
   assert(digest(projected.abilityScoreOptions)===digest(p.abilityScoreOptions)&&digest(projected.abilityScoreIncreaseRule)===digest(p.abilityScoreIncreaseRule),'backgroundAbilityProjectionMismatch');
   add('standardBackgroundAbilityCandidate');
  }else add('backgroundAbilityFallbackReview');
  if(p.toolProficiencies===undefined&&p.toolProficiencyChoice===undefined)add('backgroundToolFallbackReview');
  if(p.skillProficiencyChoice!==undefined)add('backgroundSkillSelectionRuntimeReview');
  if(r.startingEquipment!==undefined)add('startingEquipmentResolutionPending');
  if(r.fromFeature!==undefined)add('inheritedBackgroundFeaturePending');
 }else{
  if(r.ability!==undefined)add('speciesAbilityEditionPolicyPending');
  if(Array.isArray(p.size)&&p.size.length>1&&p.sizeOptions===undefined)add('sizeOptionsContractPending');
  if(p.speed!==undefined)add('movementApplicationPending');
  if(rec(r.speed)&&Object.values(r.speed).some(v=>typeof v!=='number'))add('conditionalMovementPending');
  if(p.darkvisionFt!==undefined||p.blindsightFt!==undefined)add('senseApplicationPending');
  if(p.resistances!==undefined||p.damageImmunities!==undefined||p.vulnerabilities!==undefined)add('defenseApplicationPending');
  if([r.resist,r.immune,r.vulnerable].some(a=>Array.isArray(a)&&a.some(v=>typeof v!=='string'))||r.conditionImmune!==undefined)add('conditionalDefensePending');
  if(i.metadata.upstreamKind==='subrace'||m.versions!==undefined||r.lineage!==undefined)add('variantAndInheritancePending');
  if(Array.isArray(m.namedTraits)&&m.namedTraits.length&&!Array.isArray(p.featureIds))add('traitFeatureLinksPending');
  if(r.size===undefined||p.creatureType===undefined)add('speciesChassisPending');
 }
 for(const [raw,k] of [['skillProficiencies','skill'],['toolProficiencies','tool'],['languageProficiencies','language']]){
  if(r[raw]===undefined)continue;
  if(!Array.isArray(r[raw])||r[raw].length!==1||!rec(r[raw][0]))add(k+'AlternativesPending');
  if(p[k+'ProficiencyChoice']!==undefined)add(k+'ChoicePolicyPending');
  if(p[k+'Proficiencies']===undefined&&p[k+'ProficiencyChoice']===undefined)add(k+'ProjectionPending');
 }
 if(p.languageProficiencies!==undefined&&p.languages===undefined)add('languageFieldContractPending');
 if(['skillToolLanguageProficiencies','weaponProficiencies','armorProficiencies','expertise'].some(k=>r[k]!==undefined))add('complexProficiencyPending');
 if(r.additionalSpells!==undefined)add('spellGrantSemanticsPending');
 if(r.prerequisite!==undefined)add('prerequisiteSemanticsPending');
 if(r.feats!==undefined){
  add('featGrantSemanticsPending');
  if(!Array.isArray(p.featIds))add('featRuntimeLinksPending');
  for(const [group,g] of (Array.isArray(r.feats)?r.feats:[]).entries()){
   if(!rec(g)){featEdges.push({status:'featShapePending',group});continue;}
   for(const [uid,v] of Object.entries(g)){
    const parts=uid.split('|');
    if(v!==true||parts.length!==2||!parts.every(text)){featEdges.push({status:'featSelectionPending',group});continue;}
    const f=(m.featReferences||[]).find(x=>x.group===group&&x.uid===uid);
    const t=f?.matched===true?itemsById.get(f.candidateId):undefined;
    let status='featEndpointPending';
    if(t){
     const [name,source]=parts;
     assert(t.kind==='feat'&&t.provenance?.origin==='5etools'&&t.provenance.commit===commit&&
      t.name.toLowerCase()===name.toLowerCase()&&t.provenance.sourceCode.toLowerCase()===source.toLowerCase(),'originFeatBindingMismatch');
     status=i.source.rulesEra!=='unknown'&&t.source.rulesEra===i.source.rulesEra?'featIdentityCandidate':'featEditionPending';
    }
    featEdges.push({status,group,...(t?{targetId:t.id,targetFingerprint:digest(t)}:{})});
   }
  }
 }
 add('originApplicationNotEstablished');
 return {codes:codes.sort(),featEdges};
}
function buildOriginParityEvidence({reconciliation:r,rawHistorical,items}){
 assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&r.summary.approvedMappings===0&&
 r.summary.mechanicalParityEstablished===0&&r.summary.retirementAuthorized===false&&Object.keys(r.summary.issues).length===0&&
 ['application','main','homebrew'].every(k=>sha(r.commits[k])),'invalidReconciliation');
 const raw=new Map(),targets=new Map(),seen=new Set(),rows=[],upstreamRows=[],upstream={},historical={},runtime={};
 for(const k of kinds){upstream[k]={items:0,bySource:{},contractCodes:{},featEdges:{}};historical[k]={occurrences:0,identityCandidates:0,identityPending:0,eraPending:0,byIdentityStatus:{},byField:{},byStatus:{},unassessedFields:0};runtime[k]={occurrences:0,byStatus:{}};}
 for(const x of rawHistorical){assert(!raw.has(coord(x)),'duplicateHistoricalCoordinate');raw.set(coord(x),x.item);}
 for(const i of items){assert(text(i.id)&&!targets.has(i.id),'duplicateTarget');targets.set(i.id,i);}
 for(const i of items.filter(x=>kinds.has(x.kind))){
  bindOrigin(i,r.commits.main);const c=originContractEvidence(i,targets,r.commits.main),s=upstream[i.kind];
  s.items++;bump(s.bySource,i.provenance.sourceCode);
  for(const k of c.codes)bump(s.contractCodes,k);
  for(const f of c.featEdges)bump(s.featEdges,f.status);
  upstreamRows.push({itemId:i.id,kind:i.kind,sourceFingerprint:digest(i),rulesEra:i.source.rulesEra,...c,...flags()});
 }
 for(const h of r.historical.filter(x=>kinds.has(x.kind))){
  const a=raw.get(coord(h)),s=historical[h.kind];
  assert(a&&a.id===h.id&&a.kind===h.kind&&digest(a)===h.sourceFingerprint&&!seen.has(coord(h))&&
   h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed','historicalBindingMismatch');
  seen.add(coord(h));s.occurrences++;bump(s.byIdentityStatus,h.status);
  const row={evidenceId:h.evidenceId,kind:h.kind,sourceFingerprint:h.sourceFingerprint,identityStatus:h.status,fields:[],...flags()};
  if(h.status!=='identityCandidate'){s.identityPending++;rows.push(row);continue;}
  const t=targets.get(h.targetId);
  assert(t?.kind===h.kind&&digest(t)===h.targetFingerprint,'targetBindingMismatch');
  s.identityCandidates++;if(h.eraStatus!=='sameKnownEra')s.eraPending++;
  row.targetFingerprint=h.targetFingerprint;row.eraStatus=h.eraStatus;
  if(!rec(a.payload)||!rec(t.payload)){bump(s.byStatus,'payloadNotAvailable');rows.push(row);continue;}
  row.fields=compareOriginFields(h.kind,a.payload,t.payload);
  row.unassessedFieldCount=new Set([...Object.keys(a.payload),...Object.keys(t.payload)].filter(k=>!fields[h.kind].includes(k))).size;
  s.unassessedFields+=row.unassessedFieldCount;
  for(const f of row.fields)bump(s.byField[f.field]??={},f.status);
  bump(s.byStatus,row.fields.some(f=>['differentValue','missingCandidate','addedCandidate'].includes(f.status))?'fieldReviewRequired':'selectedFieldsCompatibleCandidate');
  rows.push(row);
 }
 assert(seen.size===rawHistorical.filter(x=>kinds.has(x.item.kind)).length,'historicalCoverageMismatch');
 for(const x of r.runtime.filter(x=>kinds.has(x.kind))){
  assert(x.preservation==='required'&&x.activation==='review-required'&&x.decision==='unreviewed','runtimeBindingMismatch');
  const s=runtime[x.kind];s.occurrences++;bump(s.byStatus,x.status);
 }
 const body={schemaVersion:'dnd-upstream-origin-parity-evidence.v1',commits:r.commits,historical,upstream,runtime,rows,upstreamRows,
 scope:'selected origin fields, explicit source feat endpoints and runtime contract observations; no mechanical or character creation approval',
 approvedMappings:0,mechanicalParityEstablished:0,executable:false,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(r){const {rows,upstreamRows,...summary}=r;return summary;}
module.exports={compareOriginFields,originContractEvidence,buildOriginParityEvidence,publicSummary};
