'use strict';
// a8.6.2: read-only chassis and spell table evidence. No default rule or
// preparation policy inferred from field absence or from class names.
const {digest}=require('./integrated-review');
const {compileProfile}=require('./resource-spellcasting-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const coordinate=x=>JSON.stringify([x.path,x.index]);
const levels=Array.from({length:20},(_,i)=>String(i+1));
const circles=Array.from({length:9},(_,i)=>String(i+1));
const safeSet=v=>{
 if(!Array.isArray(v)||!v.every(x=>typeof x==='string'&&x.trim()&&!/[{}|]/.test(x)))return undefined;
 const a=v.map(x=>x.trim().toLowerCase());
 return new Set(a).size===a.length?a.sort():undefined;
};
function compare(a,b,normalize){
 if(a===undefined||b===undefined)return a===b?'absentBoth':a===undefined?'addedCandidate':'missingCandidate';
 if(digest(a)===digest(b))return 'exactValue';
 if(normalize){
  const x=normalize(a),y=normalize(b);
  if(x!==undefined&&y!==undefined&&digest(x)===digest(y))return 'representationOnlyCandidate';
 }
 return 'differentValue';
}
function skillChoice(p){
 const v=p.skillProficienciesChoice,n=p.skillChoiceCount;
 if(v===undefined)return undefined;
 if(Array.isArray(v)){
  const options=safeSet(v);
  return options&&int(n)&&n>0&&n<=options.length?{count:n,options}:null;
 }
 if(!rec(v)||Object.keys(v).some(k=>!['count','options','from'].includes(k))||v.from!=='skills')return null;
 const options=safeSet(v.options);
 return options&&int(v.count)&&v.count>0&&v.count<=options.length&&(n===undefined||n===v.count)?{count:v.count,options}:null;
}
function compareSkillChoices(a,b){
 const x=skillChoice(a),y=skillChoice(b);
 if(x===null||y===null)return 'shapeOrCountPending';
 if(x===undefined||y===undefined)return compare(x,y);
 return digest(x)===digest(y)?'choiceShapeCandidate':'choiceDifferences';
}
// Only explicit complete 20-row tables are normalized. In an observed
// row, absent slot circles and explicit zero both mean no slot in the
// current runtime's positive-slot iteration. No missing LEVEL is filled.
function slotRows(t){
 if(!rec(t)||Object.keys(t).length!==20||!levels.every(l=>own(t,l)&&rec(t[l])&&Object.entries(t[l]).every(([k,v])=>circles.includes(k)&&int(v))))return undefined;
 return levels.map(l=>circles.map(k=>own(t[l],k)?t[l][k]:0));
}
function sequence(v,{slotLevel=false,allowRecord=false}={}){
 const a=Array.isArray(v)?v:allowRecord&&rec(v)&&Object.keys(v).length===20&&levels.every(l=>own(v,l))?levels.map(l=>v[l]):undefined;
 return a&&a.length===20&&a.every(x=>int(x)&&(!slotLevel||x>=1&&x<=9))?a:undefined;
}
function compareTable(a,b,normalize){
 if(a===undefined||b===undefined)return {status:compare(a,b)};
 const x=normalize(a),y=normalize(b);
 if(x===undefined||y===undefined)return {status:'tableShapePending'};
 const differentLevels=x.reduce((n,v,i)=>n+(digest(v)!==digest(y[i])?1:0),0);
 return {status:differentLevels?'tableDifferences':digest(a)===digest(b)?'exactTable':'numericTableCandidate',comparedLevels:20,differentLevels};
}
const tableFields=['slotsByLevel','pactSlotsByLevel','pactSlotLevelByLevel','cantripsKnownByLevel','spellsKnownByLevel','preparedSpellsByLevel'];
function compareSpellcasting(old,next){
 const a=rec(old)?old:{},b=rec(next)?next:{};
 const rows={};
 for(const k of tableFields){
  const normalize=k==='slotsByLevel'?slotRows:v=>sequence(v,{allowRecord:k.startsWith('pact'),slotLevel:k==='pactSlotLevelByLevel'});
  rows[k]=compareTable(a[k],b[k],normalize);
 }
 for(const k of ['ability','progression','preparationSource','slotRecovery','ritualCasting','spellcastingFocus'])rows[k]={status:compare(a[k],b[k])};
 return rows;
}
function compareChassis(a,b){
 const out={};
 for(const k of ['hitDie','primaryAbilities','savingThrowProficiencies','armorTraining','weaponProficiencies','toolProficiencies']){
  out[k]=compare(a[k],b[k],k==='hitDie'?undefined:safeSet);
 }
 out.skillChoice=compareSkillChoices(a,b);
 return out;
}
function buildClassMechanicsEvidence({reconciliation:r,rawHistorical,items},progression){
 const {fingerprint,...body}=progression;
 assert(progression.schemaVersion==='dnd-upstream-class-progression-evidence.v1'&&digest(body)===fingerprint&&digest(progression.commits)===digest(r.commits)&&
  progression.approvedMappings===0&&progression.mechanicalParityEstablished===0&&progression.retirementAuthorized===false,'invalidProgressionEvidence');
 const raw=new Map(rawHistorical.map(x=>[coordinate(x),x.item])),targets=new Map(items.map(i=>[i.id,i]));
 const bound=new Map(progression.rows.map(x=>[x.evidenceId,x]));
 const rows=[],historical={class:{occurrences:0,candidates:0,eraPending:0,chassis:{},spellcasting:{}},subclass:{occurrences:0,candidates:0,eraPending:0,chassis:{},spellcasting:{}}};
 const upstream={class:{},subclass:{}},contract={structuredSkillChoice:0,declaredProfileWithoutRuntimeProgression:0,knownLimitWithoutPreparedLimit:0,subclassTableOutsidePayload:0};
 for(const i of items.filter(i=>['class','subclass'].includes(i.kind))){
  assert(i.provenance?.origin==='5etools'&&i.provenance.commit===r.commits.main&&i.source?.status==='needsReview','candidateSourceMismatch');
  const p=compileProfile(i);bump(upstream[i.kind],p.status);
  if(p.status==='tableCandidate')bump(upstream[i.kind],'progression:'+p.progression);
  const s=i.payload.spellcasting;
  if(i.kind==='class'&&rec(i.payload.skillProficienciesChoice))contract.structuredSkillChoice++;
  if(i.kind==='class'&&p.status==='tableCandidate'&&!s?.progression)contract.declaredProfileWithoutRuntimeProgression++;
  if(p.status==='tableCandidate'&&own(p.limits,'spellsKnownByLevel')&&!own(p.limits,'preparedSpellsByLevel'))contract.knownLimitWithoutPreparedLimit++;
  if(i.kind==='subclass'&&p.status==='tableCandidate'&&!rec(s))contract.subclassTableOutsidePayload++;
 }
 for(const h of r.historical.filter(h=>['class','subclass'].includes(h.kind))){
  const s=historical[h.kind],e=bound.get(h.evidenceId),a=raw.get(coordinate(h));
  assert(e&&e.sourceFingerprint===h.sourceFingerprint&&e.identityStatus===h.status&&a&&digest(a)===h.sourceFingerprint,'historicalEvidenceMismatch');
  s.occurrences++;
  if(h.status!=='identityCandidate')continue;
  const t=targets.get(h.targetId);
  assert(t&&e.targetFingerprint===h.targetFingerprint&&digest(t)===h.targetFingerprint,'targetEvidenceMismatch');
  s.candidates++;if(h.eraStatus!=='sameKnownEra')s.eraPending++;
  const old=a.payload,next=t.payload;
  if(!rec(old)||!rec(next)){bump(s.chassis,'payloadNotAvailable');continue;}
  const chassis=h.kind==='class'?compareChassis(old,next):{};
  // Compare the explicit candidate projection, including subclass tables
  // compiled in isolation. Never map spellsKnown to prepared spells.
  const profile=compileProfile(t),projected={...(rec(next.spellcasting)?next.spellcasting:{})};
  if(profile.status==='tableCandidate'){
   for(const k of ['slotsByLevel','pactSlotsByLevel','pactSlotLevelByLevel'])if(own(profile,k))projected[k]=profile[k];
   Object.assign(projected,profile.limits);
   if(profile.ability!==undefined)projected.ability=profile.ability;
  }
  const spellcasting=compareSpellcasting(old.spellcasting,projected);
  for(const [k,v] of Object.entries(chassis))bump(s.chassis[k]??={},v);
  for(const [k,v] of Object.entries(spellcasting))bump(s.spellcasting[k]??={},v.status);
  rows.push({kind:h.kind,evidenceId:h.evidenceId,sourceFingerprint:h.sourceFingerprint,targetFingerprint:h.targetFingerprint,
    eraStatus:h.eraStatus,chassis,spellcasting,profileStatus:profile.status,writeAuthorized:false,retirementAuthorized:false});
 }
 const out={schemaVersion:'dnd-upstream-class-mechanics-evidence.v1',commits:r.commits,progressionFingerprint:fingerprint,historical,upstream,contract,rows,
  scope:'selected raw class chassis and exact table rows; representation candidates only, no preparation/multiclass policy or runtime equivalence',
  activation:'review-required',approvedMappings:0,mechanicalParityEstablished:0,executable:false,retirementAuthorized:false};
 return {...out,fingerprint:digest(out)};
}
function publicSummary(report){const {rows,...summary}=report;return summary;}
module.exports={compareChassis,compareSkillChoices,compareSpellcasting,slotRows,buildClassMechanicsEvidence,publicSummary};
