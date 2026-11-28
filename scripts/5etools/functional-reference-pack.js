'use strict';
// Separate private reference contract. Raw observations are never gameplay grants.
const {digest}=require('./integrated-review');
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const assert=(ok,c)=>{if(!ok)throw Error(c);};
const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const clone=v=>JSON.parse(JSON.stringify(v));
const coordinate=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const sourceKey=r=>JSON.stringify([r.origin,JSON.parse(r.sourceId)[1]]);
const schema='dnd-upstream-reference-pack.v1';
const consultation=new Set(['variantrule','table','tableGroup','deity']);
const definitions=new Set(['itemProperty','itemType','itemMastery','language','skill','sense','legendaryGroup']);
const mechanics=new Set(['itemGroup','action','status','disease','reward','vehicle','trap','hazard','object','psionic','charoption','facility','deck','card','cult','boon']);
const fluff=new Set(['raceFluff','backgroundFluff','classFluff','subclassFluff','featFluff','optionalfeatureFluff','spellFluff','monsterFluff','itemFluff','conditionFluff','vehicleFluff','objectFluff','trapFluff','hazardFluff','deityFluff']);
function referenceUsage(r){
 if(r.origin!=='main'||r.disposition!=='included')return null;
 if(r.lane==='publicationSection'&&['data','bookData','adventureData'].includes(r.kind)||r.lane==='publicationIndex'&&['book','adventure'].includes(r.kind))return 'consultation';
 if(['resolverEntity','unscannedEntity'].includes(r.lane)){
  if(definitions.has(r.kind))return 'definitionSupport';
  if(mechanics.has(r.kind))return 'mechanicalReferencePending';
  if(consultation.has(r.kind))return 'consultation';
 }
 if(r.lane==='otherCollection'&&fluff.has(r.kind)&&/(?:^|\/)fluff-[^/]+\.json$/.test(r.path))return 'consultation';
 // Shared source-less metadata, unfamiliar root keys and mechanical kinds
 // handled by canonical converters remain outside this projection.
 return null;
}
function titleOf(r,value){
 if(rec(value)){
  for(const k of ['name','caption','title','abbreviation','id'])if(nonempty(value[k]))return value[k].trim();
 }
 return r.kind+(r.index===null?'':' #'+(r.index+1));
}
function verifyPlan(plan){
 const {fingerprint,...body}=plan;
 assert(plan.schemaVersion==='dnd-upstream-functional-input-plan.v1'&&plan.scope==='privateConversionInputs'&&plan.executable===false&&digest(body)===fingerprint,'functionalReferencePlanInvalid');
}
function recordFor(r,value,commit){
 const usage=referenceUsage(r);
 assert(usage&&digest(value)===r.valueFingerprint,'functionalReferenceInputMismatch');
 const source=JSON.parse(r.sourceId);
 assert(Array.isArray(source)&&source.length===2&&source[0]===r.origin&&nonempty(source[1])&&sourceKey(r)===r.sourceId,'functionalReferenceSourceInvalid');
 assert(nonempty(r.path)&&!r.path.startsWith('/')&&!r.path.includes('\\')&&r.path.split('/').every(x=>x&&x!=='.'&&x!=='..')&&nonempty(r.kind)&&Number.isSafeInteger(r.index)&&r.index>=0&&r.rootArray===true,'functionalReferenceCoordinateInvalid');
 const provenance={origin:r.origin,commit,blob:r.blob,path:r.path,kind:r.kind,index:r.index,attribution:r.attribution??'unrecorded',inputFingerprint:r.valueFingerprint};
 return {id:'upstream:reference:'+digest([r.sourceId,coordinate(r)]),sourceId:r.sourceId,kind:r.kind,usage,title:titleOf(r,value),provenance,content:clone(value),activation:'review-required',mechanicallyExecutable:false};
}
function packId(sourceId,usage){return 'upstream:reference-pack:'+digest([sourceId,usage]);}
function buildReferencePacks(plan,inputs){
 verifyPlan(plan);
 const expected=new Map(),seen=new Set(),groups=new Map();
 for(const r of plan.rows){
  const k=coordinate(r);assert(!expected.has(k),'functionalReferenceDuplicateCoordinate');expected.set(k,r);
 }
 for(const {descriptor:r,value} of inputs){
  const k=coordinate(r),original=expected.get(k);
  assert(original&&original.disposition==='included'&&!seen.has(k)&&digest(original)===digest(r)&&digest(value)===r.valueFingerprint,'functionalReferenceInputMismatch');seen.add(k);
  const usage=referenceUsage(r);if(!usage)continue;
  const item=recordFor(r,value,plan.commits[r.origin]),key=JSON.stringify([r.sourceId,usage]);
  const g=groups.get(key)||{sourceId:r.sourceId,usage,records:[]};g.records.push(item);groups.set(key,g);
 }
 assert(seen.size===plan.rows.filter(r=>r.disposition==='included').length,'functionalReferenceSelectionIncomplete');
 return [...groups.values()].map(g=>{
  const body={schemaVersion:schema,id:packId(g.sourceId,g.usage),sourceId:g.sourceId,usage:g.usage,commits:plan.commits,bindings:{inputPlan:plan.fingerprint,scope:plan.bindings.scope},activation:'review-required',runtimeEligible:false,records:g.records.sort((a,b)=>cmp(a.id,b.id))};
  return {...body,fingerprint:digest(body)};
 }).sort((a,b)=>cmp(a.id,b.id));
}
// Validate every output against its exact input descriptor, not merely the
// self-declared pack checksum. Reconstruct record metadata from its raw value.
function validateReferencePacks(plan,packs){
 verifyPlan(plan);
 const expected=new Map(plan.rows.filter(r=>referenceUsage(r)).map(r=>[coordinate(r),r]));
 const seen=new Set(),ids=new Set(),packIds=new Set(),outputs=new Map();
 for(const pack of packs){
  const {fingerprint,...body}=pack;
  assert(pack.schemaVersion===schema&&pack.activation==='review-required'&&pack.runtimeEligible===false&&digest(body)===fingerprint&&digest(pack.commits)===digest(plan.commits)&&pack.bindings?.inputPlan===plan.fingerprint&&pack.bindings?.scope===plan.bindings.scope&&pack.id===packId(pack.sourceId,pack.usage)&&!packIds.has(pack.id)&&Array.isArray(pack.records)&&pack.records.length>0,'functionalReferencePackInvalid');
  packIds.add(pack.id);
  for(const item of pack.records){
   const k=coordinate(item.provenance),r=expected.get(k);
   assert(r&&!seen.has(k)&&!ids.has(item.id)&&item.sourceId===pack.sourceId&&item.usage===pack.usage&&digest(item)===digest(recordFor(r,item.content,plan.commits[r.origin])),'functionalReferenceRecordInvalid');
   seen.add(k);ids.add(item.id);
   outputs.set(k,{id:item.id,packId:pack.id,fingerprint:digest(item),usage:item.usage});
  }
 }
 assert(seen.size===expected.size,'functionalReferenceCoverageMismatch');
 return outputs;
}
// Pure offline consultation boundary. Only validated records, source and kind
// filters, no HTML interpretation, no implicit runtime or grant activation.
function createReferenceIndex(plan,packs){
 validateReferencePacks(plan,packs);
 const records=packs.flatMap(p=>p.records),byId=new Map(records.map(r=>[r.id,r]));
 const searchable=records.map(r=>({r,key:[r.title,r.kind,r.sourceId].join(' ').toLowerCase()}));
 return {
  get(id){const r=byId.get(id);return r?clone(r):null;},
  search({query='',sourceId,kind,usage,limit=50,offset=0}={}){
   assert(typeof query==='string'&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200&&Number.isSafeInteger(offset)&&offset>=0,'functionalReferenceQueryInvalid');
   const q=query.trim().toLowerCase();
   const matches=searchable.filter(({r,key})=>(!sourceId||r.sourceId===sourceId)&&(!kind||r.kind===kind)&&(!usage||r.usage===usage)&&(!q||key.includes(q)))
    .map(({r})=>r).sort((a,b)=>cmp(a.title.toLowerCase(),b.title.toLowerCase())||cmp(a.id,b.id));
   return {total:matches.length,results:matches.slice(offset,offset+limit).map(({id,title,sourceId,kind,usage,provenance})=>({id,title,sourceId,kind,usage,provenance:clone(provenance)}))};
  }
 };
}
module.exports={referenceUsage,buildReferencePacks,validateReferencePacks,createReferenceIndex};
