'use strict';
// Review-only projection from the emitted class graph. Not an import pack,
// active catalog adapter, or a proof of authenticity/permission.
const {digest}=require('./integrated-review');
const {physicalId,projectClass,projectSpellcasting}=require('./class-converter');
const {ownerAndLevelGraph}=require('./class-progression-evidence');
const {compileProfile,profileAtLevel,derivePools}=require('./resource-spellcasting-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const level=x=>Number.isInteger(x)&&x>=1&&x<=20;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const clone=x=>JSON.parse(JSON.stringify(x));
const eras={PHB:'2014',XPHB:'2024',TCE:'2014',XGE:'2014',EFA:'2024'};
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false});
const pending=reason=>({...flags(),status:'indeterminate',reason});
const skills=['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation','Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'];
const skillNames=new Map(skills.map(s=>[s.toLowerCase(),s]));
function flatSkillCandidate(p){
 const c=p.skillProficienciesChoice;
 if(c===undefined)return {status:'notProjected'};
 if(!rec(c)||Object.keys(c).some(k=>!['from','count','options'].includes(k))||c.from!=='skills'||
   !Array.isArray(c.options)||!Number.isSafeInteger(c.count)||c.count<1||c.count!==p.skillChoiceCount||c.count>c.options.length)
   return {status:'choiceShapePending'};
 const options=c.options.map(x=>text(x)?skillNames.get(x.toLowerCase()):undefined);
 if(options.some(x=>!x)||new Set(options).size!==options.length)return {status:'choiceShapePending'};
 return {status:'flatChoiceCandidate',skillChoiceCount:c.count,skillProficienciesChoice:options};
}
function bind(i,commit){
 const p=i.provenance,r=i.payload?.mechanics?.upstreamClassRecord;
 assert(rec(r)&&['class','subclass'].includes(i.kind)&&p?.origin==='5etools'&&p.repository==='5etools-mirror-3/5etools-src'&&
   p.commit===commit&&sha(p.blob)&&/^data\/class\/class-[^/]+\.json$/.test(p.path)&&r.source===p.sourceCode&&r.name===i.name&&
   own(eras,p.sourceCode)&&i.source?.id==='upstream:main:'+p.sourceCode&&i.source.status==='needsReview'&&
   i.source.rulesEra===eras[p.sourceCode]&&physicalId(i.kind,r)===i.id,'classProjectionIdentityMismatch');
 return r;
}
function buildClassProjection(items,commit){
 assert(sha(commit),'invalidMainCommit');
 const graph=ownerAndLevelGraph(items,commit),rows=[],byKind={class:{},subclass:{}};
 for(const i of items.filter(i=>['class','subclass'].includes(i.kind))){
  const raw=bind(i,commit),p=i.payload,notes=new Set();
  const projected=i.kind==='class'?projectClass(raw,notes):{};
  if(i.kind==='class'){
   for(const k of ['hitDie','primaryAbilities','savingThrowProficiencies','armorTraining','weaponProficiencies','skillChoiceCount','skillProficienciesChoice','spellcasting']){
    assert(own(p,k)===own(projected,k)&&(!own(p,k)||digest(p[k])===digest(projected[k])),'classProjectionPayloadMismatch');
   }
  }else{
   const owner=graph.index.get(p.classId);
   const ownerRaw=bind(owner,commit);
   assert(raw.className===ownerRaw.name&&raw.classSource===ownerRaw.source,'subclassProjectionOwnerMismatch');
  }
  const compiled=compileProfile(i);
  const profile=compiled.status==='tableCandidate'?clone(compiled):{status:compiled.status,reason:compiled.reason};
  const chassis={};
  if(i.kind==='class')for(const k of ['hitDie','primaryAbilities','savingThrowProficiencies','armorTraining','weaponProficiencies'])if(own(projected,k))chassis[k]=clone(projected[k]);
  const skillChoice=i.kind==='class'?flatSkillCandidate(projected):{status:'notApplicable'};
  if(skillChoice.status==='flatChoiceCandidate'){
   chassis.skillChoiceCount=skillChoice.skillChoiceCount;chassis.skillProficienciesChoice=skillChoice.skillProficienciesChoice;
  }
  // Explicit numeric limits only. No known->prepared alias or evaluation of
  // ability-based formulas; no assumption that an absent table is zero.
  const preparation=compiled.status==='tableCandidate'?{
   knownTable:own(compiled.limits,'spellsKnownByLevel'),preparedTable:own(compiled.limits,'preparedSpellsByLevel'),
   cantripTable:own(compiled.limits,'cantripsKnownByLevel'),
   formulaPending:compiled.preparationFormulaPending,changesPending:compiled.preparationChangesPending
  }:null;
  const row={itemId:i.id,kind:i.kind,classId:i.kind==='class'?i.id:p.classId,rulesEra:i.source.rulesEra,
   sourceFingerprint:digest(i),sourceCode:i.provenance.sourceCode,skillChoiceStatus:skillChoice.status,chassis,
   profile,preparation,...flags()};
  rows.push(row);const s=byKind[i.kind];
  bump(s,'total');bump(s,'profile:'+profile.status);bump(s,'skill:'+skillChoice.status);
  if(compiled.status==='tableCandidate'){
   bump(s,'progression:'+compiled.progression);
   if(preparation.knownTable)bump(s,'knownTable');
   if(preparation.preparedTable)bump(s,'preparedTable');
   if(preparation.formulaPending)bump(s,'formulaPending');
   if(compiled.upstreamProgression==='artificer')bump(s,'artificerProgression');
  }
 }
 rows.sort((a,b)=>a.itemId.localeCompare(b.itemId));
 const body={schemaVersion:'dnd-upstream-class-projection-preview.v1',commit,byKind,rows,
   approvedMappings:0,mechanicalParityEstablished:0,executable:false,...flags()};
 return {...body,fingerprint:digest(body)};
}
function publicSummary(report){const {rows,...summary}=report;return summary;}
function atLevel(row,n){
 if(!level(n)||row.profile.status!=='tableCandidate')return pending('profileOrLevelPending');
 const p=profileAtLevel(row.profile,n);
 if(p.status!=='tableCandidate')return pending(p.reason||'invalidTable');
 const limits={};
 for(const [k,v] of Object.entries(p.limits))limits[k]=v;
 return {...flags(),status:'levelProjectionCandidate',level:n,slots:clone(p.slots),limits,
   ability:row.profile.ability,progression:row.profile.progression,preparation:clone(row.preparation)};
}
// Candidate policy is deliberately edition-specific and requires explicit
// review acknowledgement. The Artificer upstream code stays distinct from
// ordinary half casters, including in the legacy edition.
const rounding=era=>era==='2014'?{full:'floor','1/2':'floor',artificer:'ceil','1/3':'floor'}:
 era==='2024'?{full:'floor','1/2':'ceil',artificer:'ceil','1/3':'floor'}:undefined;
function previewClassBuild(items,commit,request){
 try{
  if(!rec(request)||request.inventoryComplete!==true||!rounding(request.rulesEra)||!Array.isArray(request.classes)||!request.classes.length)
   return pending('explicitBuildContextRequired');
  const projection=buildClassProjection(items,commit);
  if(request.projectionFingerprint!==projection.fingerprint)return pending('projectionFingerprintMismatch');
  const byId=new Map(projection.rows.map(x=>[x.itemId,x])),ids=new Set(),usedClasses=new Set(),bindings=[],profiles=[];
  let totalLevel=0;
  for(const b of request.classes){
   if(!rec(b)||!text(b.classInstanceId)||ids.has(b.classInstanceId)||!level(b.level)||b.subclassSelectionComplete!==true||
    typeof b.spellcastingActive!=='boolean'||usedClasses.has(b.classId))return pending('classBindingPending');
   ids.add(b.classInstanceId);usedClasses.add(b.classId);totalLevel+=b.level;
   const cl=byId.get(b.classId);
   if(!cl||cl.kind!=='class'||cl.rulesEra!==request.rulesEra)return pending('classEditionOrIdentityPending');
   let selected=cl;
   if(b.subclassId!==undefined){
    const sub=byId.get(b.subclassId);
    if(!sub||sub.kind!=='subclass'||sub.classId!==cl.itemId||sub.rulesEra!==request.rulesEra||
      b.subclassGrantConfirmed!==true||!level(b.subclassUnlockLevel)||b.level<b.subclassUnlockLevel)return pending('subclassOwnerOrGrantPending');
    if(sub.profile.status==='indeterminate')return pending('subclassTablePending');
    if(sub.profile.status==='tableCandidate'){
     if(cl.profile.status!=='noDeclaredProgression')return pending('combinedClassSubclassProfilePending');
     selected=sub;
    }
   }
   if(selected.profile.status==='indeterminate')return pending('classTablePending');
   if(selected.profile.status==='noDeclaredProgression'){
    if(b.spellcastingActive||b.noDeclaredSpellcastingConfirmed!==true)return pending('noDeclaredSpellcastingNotConfirmed');
    profiles.push({classInstanceId:b.classInstanceId,status:'noDeclaredSpellcastingConfirmed'});
    continue;
   }
   const row=atLevel(selected,b.level);
   if(row.status!=='levelProjectionCandidate')return row;
   if(!b.spellcastingActive){
    if(Object.values(row.slots).some(n=>n>0))return pending('inactiveProfileHasSlots');
    profiles.push({classInstanceId:b.classInstanceId,status:'inactiveTableCandidate',level:b.level});
    continue;
   }
   if(!Object.values(row.slots).some(n=>n>0))return pending('activeProfileWithoutSlots');
   bindings.push({classInstanceId:b.classInstanceId,level:b.level,profile:selected.profile,
     ...(selected.kind==='subclass'?{subclassConfirmed:true}:{})});
   profiles.push({classInstanceId:b.classInstanceId,sourceItemId:selected.itemId,...row});
  }
  if(totalLevel>20)return pending('totalLevelOutOfScope');
  const regular=bindings.filter(b=>b.profile.progression!=='pactMagic');
  let options={};
  if(regular.length>1){
   if(request.multiclassPolicyConfirmed!==true)return pending('multiclassPolicyReviewRequired');
   const ref=byId.get(request.referenceClassId);
   if(!ref||ref.kind!=='class'||ref.rulesEra!==request.rulesEra||ref.profile.status!=='tableCandidate'||ref.profile.progression!=='fullCaster')
     return pending('qualifiedReferenceTableRequired');
   options={multiclassPolicy:{rulesEra:request.rulesEra,rounding:rounding(request.rulesEra)},referenceProfile:ref.profile};
  }
  const pools=derivePools(bindings,options);
  if(pools.status!=='poolCandidate')return pending(pools.reason||'poolProjectionPending');
  return {...flags(),status:'buildProjectionCandidate',projectionFingerprint:projection.fingerprint,rulesEra:request.rulesEra,
   totalLevel,profiles,pools:pools.pools,...(pools.effectiveCasterLevel===undefined?{}:{effectiveCasterLevel:pools.effectiveCasterLevel}),
   limitations:['preparationAndReplacementPolicyPending','multiclassPrerequisitesPending','subclassGrantConfirmationExternal','noResourceOrCharacterMutation']};
 }catch{return pending('classProjectionFailed');}
}
module.exports={flatSkillCandidate,buildClassProjection,publicSummary,atLevel,previewClassBuild};
