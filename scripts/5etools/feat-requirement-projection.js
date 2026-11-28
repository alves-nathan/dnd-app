'use strict';
// a8.9.2: pure, source-qualified prerequisite and category preview.
const {digest}=require('./integrated-review');
const {prerequisite,physicalId}=require('./feature-converter');
const {physicalId:classId}=require('./class-converter');
const {compilePrerequisite,evaluatePrerequisite}=require('./semantic-eligibility');
const {buildFeatParityEvidence}=require('./feat-parity-evidence');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0;
const era=x=>x==='2014'||x==='2024';
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const flags=()=>({activation:'review-required',runtimeEligible:false,writeAuthorized:false,retirementAuthorized:false,executable:false});
const pending=reason=>({op:'pending',reason});
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const categories=Object.freeze({O:'origin',G:'general',EB:'epicBoon',FS:'fightingStyle','FS:P':'fightingStyleReplacementPaladin','FS:R':'fightingStyleReplacementRanger',D:'dragonmark',DG:'darkGift'});
const categoryValues=new Set(Object.values(categories));
const abilities=new Set(['STR','DEX','CON','INT','WIS','CHA']);
const factNames=new Set(['canCastSpell','hasSpellcastingOrPactMagicFeature','hasSpellcastingFeature']);
const key=(kind,name,source)=>JSON.stringify([kind,name.toLowerCase(),source.toLowerCase()]);
function endpointIndex(items,commit){
 const index=new Map();
 for(const i of items){
  const kind=i.kind==='feat'?'feat':i.kind==='class'?'class':i.kind==='feature'&&i.payload?.mechanics?.upstreamFeature?'optionalfeature':null;
  if(!kind)continue;
  const raw=kind==='class'?i.payload?.mechanics?.upstreamClassRecord:i.payload?.mechanics?.upstreamFeature;
  if(!rec(raw)||!text(raw.name)||!text(raw.source)||i.name!==raw.name||i.provenance?.origin!=='5etools'||i.provenance.commit!==commit||i.provenance.sourceCode!==raw.source||i.source?.id!=='upstream:main:'+raw.source)continue;
  if(i.id!==(kind==='class'?classId('class',raw):physicalId(kind==='feat'?'feat':'feature',raw.source,raw.name)))continue;
  const k=key(kind,raw.name,raw.source),list=index.get(k)||[];
  list.push(i);index.set(k,list);
 }
 return index;
}
function endpoint(index,owner,kind,name,source){
 if(!text(name)||!text(source)||/[{}#|\r\n]/.test(name+source))return pending('explicitSourceRequired');
 const candidates=index.get(key(kind,name,source))||[];
 if(candidates.length!==1)return pending(candidates.length?'ambiguousEndpoint':'endpointNotEmitted');
 const t=candidates[0];
 if(!era(owner.source.rulesEra)||t.source.rulesEra!==owner.source.rulesEra)return pending('endpointEditionPending');
 if(t.id===owner.id)return pending('selfReferencePending');
 return {targetId:t.id,targetFingerprint:digest(t)};
}
function compile(tree,owner,index,depth=0){
 if(depth>64||!rec(tree))return pending('unsupportedPrerequisite');
 if(['all','any'].includes(tree.op)){
  if(!Array.isArray(tree.children)||!tree.children.length)return pending('emptyPrerequisiteGroup');
  return {op:tree.op,children:tree.children.map(t=>compile(t,owner,index,depth+1))};
 }
 if(['characterLevel','abilityMinimum','spellcasting'].includes(tree.op)){
  const result=compilePrerequisite(tree,owner,null);
  return result.op==='pending'?pending(result.reason):result;
 }
 if(tree.op==='classLevel'){
  const raw=tree.raw;
  if(!integer(tree.minimum,1,20)||!rec(raw)||Object.keys(raw).some(k=>!['level','class'].includes(k))||!rec(raw.class)||
   Object.keys(raw.class).some(k=>!['name','source','visible','visibleStats','visibleList'].includes(k)))return pending('classLevelContextPending');
  const e=endpoint(index,owner,'class',tree.class?.name,tree.class?.source);
  return e.op?e:{op:'classLevel',classId:e.targetId,minimum:tree.minimum,targetFingerprint:e.targetFingerprint};
 }
 if(tree.op==='referenceRequirement'&&['feat','optionalfeature'].includes(tree.referenceType)&&Array.isArray(tree.raw)&&tree.raw.length){
  return {op:'any',children:tree.raw.map(uid=>{
   if(typeof uid!=='string')return pending('referenceExpressionPending');
   const parts=uid.split('|');if(parts.length!==2)return pending('explicitSourceRequired');
   const e=endpoint(index,owner,tree.referenceType,parts[0],parts[1]);
   return e.op?e:{op:'possesses',entityId:e.targetId,kind:tree.referenceType==='feat'?'feat':'feature',targetFingerprint:e.targetFingerprint};
  })};
 }
 return pending('prerequisiteSemanticsPending');
}
function categoryFor(i,raw){
 if(!own(raw,'category'))return {status:'notDeclared'};
 if(typeof raw.category!=='string'||!own(categories,raw.category)||i.payload.category!==categories[raw.category])return {status:'categoryPending'};
 return {status:'categoryCandidate',value:categories[raw.category]};
}
function buildFeatRequirementProjection(input,evidence){
 const actual=buildFeatParityEvidence(input);
 if(evidence!==undefined&&digest(evidence)!==digest(actual))throw Error('featEvidenceMismatch');
 const index=endpointIndex(input.items,actual.commits.main),byId=new Map(input.items.map(i=>[i.id,i])),rows=[];
 const summary={items:0,category:{},prerequisite:{},nodes:{},pendingReasons:{}};
 function visit(n){bump(summary.nodes,n.op);if(n.op==='pending')bump(summary.pendingReasons,n.reason);if(n.children)n.children.forEach(visit);}
 function hasPending(n){return n.op==='pending'||(n.children||[]).some(hasPending);}
 for(const e of actual.upstreamRows){
  const i=byId.get(e.itemId),raw=i.payload.mechanics.upstreamFeature,m=i.payload.mechanics;
  const expected=prerequisite(raw.prerequisite);
  if((expected===undefined)!==(m.prerequisiteTree===undefined)||expected!==undefined&&digest(expected)!==digest(m.prerequisiteTree))throw Error('featPrerequisiteBindingMismatch');
  const tree=expected===undefined?{op:'none'}:compile(expected,i,index);
  const category=categoryFor(i,raw),status=tree.op==='none'?'notDeclared':hasPending(tree)?'partialOrPending':'structuredCandidate';
  summary.items++;bump(summary.category,category.status);bump(summary.prerequisite,status);visit(tree);
  rows.push({featId:i.id,sourceFingerprint:e.sourceFingerprint,rulesEra:e.rulesEra,category,prerequisiteStatus:status,tree,...flags()});
 }
 const body={schemaVersion:'dnd-upstream-feat-requirement-projection.v1',commits:actual.commits,evidenceFingerprint:actual.fingerprint,summary,rows,
  scope:'emitted source-qualified endpoints and caller-supplied hypothetical facts; no eligibility or acquisition approval',
  approvedMappings:0,mechanicalParityEstablished:0,...flags()};
 return {...body,fingerprint:digest(body)};
}
function validFacts(f){
 if(!rec(f)||!integer(f.characterLevel,1,20))return false;
 if(f.abilities!==undefined&&(!rec(f.abilities)||Object.entries(f.abilities).some(([k,v])=>!abilities.has(k)||!integer(v,1,30))))return false;
 if(f.classLevels!==undefined&&(!rec(f.classLevels)||Object.entries(f.classLevels).some(([k,v])=>!text(k)||!integer(v,0,f.characterLevel))||Object.values(f.classLevels).reduce((a,b)=>a+b,0)>f.characterLevel))return false;
 if(f.classLevelsComplete===true&&(!rec(f.classLevels)||Object.values(f.classLevels).reduce((a,b)=>a+b,0)!==f.characterLevel))return false;
 if(f.possessedIds!==undefined&&(!Array.isArray(f.possessedIds)||!f.possessedIds.every(text)||new Set(f.possessedIds).size!==f.possessedIds.length))return false;
 if(f.possessedIdsComplete===true&&!Array.isArray(f.possessedIds))return false;
 if(f.flags!==undefined&&(!rec(f.flags)||Object.entries(f.flags).some(([k,v])=>!factNames.has(k)||typeof v!=='boolean')))return false;
 return true;
}
function previewFeatRequirements(input,request){
 const result=(status,reason,extra={})=>({status,reason,...extra,...flags()});
 if(!rec(request)||!era(request.rulesEra)||request.factsConfirmed!==true||request.categoryPolicyConfirmed!==true||
  !text(request.featId)||!text(request.projectionFingerprint)||!text(request.sourceFingerprint)||!validFacts(request.facts)||
  !Array.isArray(request.allowedCategories)||!request.allowedCategories.length||!request.allowedCategories.every(x=>categoryValues.has(x))||
  new Set(request.allowedCategories).size!==request.allowedCategories.length)return result('indeterminate','explicitContextRequired');
 const p=buildFeatRequirementProjection(input);
 if(request.projectionFingerprint!==p.fingerprint)return result('indeterminate','staleProjection');
 const row=p.rows.find(r=>r.featId===request.featId);
 if(!row||row.sourceFingerprint!==request.sourceFingerprint||row.rulesEra!==request.rulesEra)return result('indeterminate','featIdentityOrEditionMismatch');
 if(row.category.status!=='categoryCandidate')return result('indeterminate','categoryPolicyPending');
 if(!request.allowedCategories.includes(row.category.value))return result('notSatisfied','categoryOutsideConfirmedContext');
 const f=request.facts;
 // Caller must bind any supplied possession or class facts to exact same-edition emitted IDs.
 const qualified=endpointIndex(input.items,p.commits.main),byId=new Map([...qualified.values()].flat().map(i=>[i.id,i]));
 const validId=(id,kinds)=>{const i=byId.get(id);return i&&kinds.includes(i.kind)&&i.source.rulesEra===request.rulesEra;};
 if(Object.keys(f.classLevels||{}).some(id=>!validId(id,['class']))||(f.possessedIds||[]).some(id=>!validId(id,['feat','feature'])))return result('indeterminate','unqualifiedCharacterFacts');
 const status=evaluatePrerequisite(row.tree,f);
 return result(status==='satisfied'?'requirementsCandidate':status,status==='satisfied'?'selectedPrerequisitesAndCategoryOnly':'prerequisiteEvaluation',{prerequisiteStatus:status,category:row.category.value});
}
function publicSummary(r){const {rows,...summary}=r;return summary;}
module.exports={buildFeatRequirementProjection,previewFeatRequirements,publicSummary};
