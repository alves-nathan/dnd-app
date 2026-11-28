'use strict';
const {digest}=require('./integrated-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const count=(rows)=>rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
const increment=(m,key)=>m.set(key,(m.get(key)||0)+1);
const multiset=rows=>{const m=new Map();for(const r of rows)increment(m,digest(r));return [...m].sort(([a],[b])=>a.localeCompare(b));};
// Match exact occurrences first. Same-id leftovers are changed only when
// one-to-one. Duplicates remain ambiguous, never collapsed or paired by name.
function compareOccurrences(baseline,loaded){
 const group=(rows,base)=>{const m=new Map();for(const r of rows){
  assert(text(r.id)&&(!base||hex(r.fingerprint)),'invalidRuntimeGraphOccurrence');
  const a=m.get(r.id)||[];a.push(base?r.fingerprint:digest(r));m.set(r.id,a);
 }return m;};
 const a=group(baseline,true),b=group(loaded,false),rows=[];
 for(const id of new Set([...a.keys(),...b.keys()])){
  const before=[...(a.get(id)||[])],after=[...(b.get(id)||[])];
  for(let i=before.length-1;i>=0;i--){
   const j=after.indexOf(before[i]);if(j<0)continue;
   rows.push({id,status:'exact',before:before[i],after:after[j]});before.splice(i,1);after.splice(j,1);
  }
  if(before.length===1&&after.length===1)rows.push({id,status:'changed',before:before.pop(),after:after.pop()});
  const ambiguous=before.length>0&&after.length>0;
  for(const hash of before)rows.push({id,status:ambiguous?'ambiguousBaseline':'missing',before:hash});
  for(const hash of after)rows.push({id,status:ambiguous?'ambiguousLoaded':'loadedOnly',after:hash});
 }
 return {baseline:baseline.length,loaded:loaded.length,statuses:count(rows),fingerprint:digest(rows)};
}
function reviewRuntimeGraph(reconciliation,snapshot){
 const entries=snapshot.entries,registry=snapshot.registry;
 const outgoing=[...snapshot.dependenciesFrom].flatMap(([key,edges])=>edges.map(e=>({key,edge:e})));
 const incoming=[...snapshot.dependenciesTo].flatMap(([key,edges])=>edges.map(e=>({key,edge:e})));
 const issues={outgoingIndexMismatch:0,incomingIndexMismatch:0,missingDependencyEndpoint:0,dependencyCountMismatch:0,registryMetadataMismatch:0,registryKeyMismatch:0,aliasKeyMismatch:0,missingAliasEndpoint:0,categoryIndexMismatch:0,categoryMemberCountMismatch:0,missingCategoryMember:0,missingEntryCategory:0,categoryMembershipMismatch:0};
 const out=outgoing.map(r=>r.edge),inc=incoming.map(r=>r.edge);
 issues.outgoingIndexMismatch=outgoing.filter(r=>r.key!==r.edge.fromId).length;
 issues.incomingIndexMismatch=incoming.filter(r=>r.key!==r.edge.toId).length;
 const indexAgreement=digest(multiset(out))===digest(multiset(inc));
 const outCounts=new Map(),inCounts=new Map();
 for(const e of out){increment(outCounts,e.fromId);increment(inCounts,e.toId);if(!registry.has(e.fromId)||!registry.has(e.toId))issues.missingDependencyEndpoint++;}
 for(const e of entries){
  const r=registry.get(e.entityId);
  if(!r||r.kind!==e.kind||r.sourceBookId!==e.sourceBookId||r.sourceFile!==e.sourceFile)issues.registryMetadataMismatch++;
  if(e.dependencyCounts.outgoing!==(outCounts.get(e.entityId)||0)||e.dependencyCounts.incoming!==(inCounts.get(e.entityId)||0))issues.dependencyCountMismatch++;
 }
 for(const [key,r] of registry)if(key!==r.entityId)issues.registryKeyMismatch++;
 const aliases=[...snapshot.aliases].map(([key,a])=>{
  if(key!==a.from)issues.aliasKeyMismatch++;
  if(!registry.has(a.from)||!registry.has(a.to))issues.missingAliasEndpoint++;
  return a;
 });
 const categories=snapshot.categories;
 const membership=new Map();
 for(const c of categories){
  if(snapshot.categoryById.get(c.id)!==c)issues.categoryIndexMismatch++;
  if(c.memberCount!==c.memberEntityIds.length)issues.categoryMemberCountMismatch++;
  for(const id of c.memberEntityIds){increment(membership,JSON.stringify([c.id,id]));if(!registry.has(id))issues.missingCategoryMember++;}
 }
 const entryMembership=new Map();
 for(const e of entries)for(const id of e.categoryIds){
  increment(entryMembership,JSON.stringify([id,e.entityId]));
  if(!snapshot.categoryById.has(id))issues.missingEntryCategory++;
 }
 for(const k of new Set([...membership.keys(),...entryMembership.keys()]))if((membership.get(k)||0)!==(entryMembership.get(k)||0))issues.categoryMembershipMismatch++;
 issues.categoryIndexMismatch+=Math.abs(snapshot.categoryById.size-categories.length);
 const registryBaseline=reconciliation.runtime.filter(r=>r.registryFingerprint!==undefined).map(r=>({id:r.id,fingerprint:r.registryFingerprint}));
 const registryLoaded=[...registry.values()].map(r=>({id:r.entityId,fingerprint:digest(r)}));
 // Registry fingerprints were not exported by older reconciliation reports.
 // Missing coverage must not masquerade as a mismatch or successful equality.
 // compareOccurrences expects loaded raw objects; registry has entityId, not id.
 // Use the explicit fingerprint form below instead of hashing an injected id.
 const registryCoverage=registryBaseline.length===reconciliation.runtime.length?'completeBaseline':'partialBaseline';
 const actualRegistry=new Map(registryLoaded.map(r=>[r.id,r.fingerprint]));
 const registryStatus={exact:0,changed:0,missing:0,loadedOnly:0,notVerified:0};
 const baselineIds=new Set(reconciliation.runtime.map(r=>r.id));
 for(const r of reconciliation.runtime){
  const observed=actualRegistry.get(r.id);
  if(r.registryFingerprint===undefined)registryStatus.notVerified++;
  else {assert(hex(r.registryFingerprint),'invalidRegistryBaselineFingerprint');registryStatus[!observed?'missing':observed===r.registryFingerprint?'exact':'changed']++;}
 }
 for(const id of actualRegistry.keys())if(!baselineIds.has(id))registryStatus.loadedOnly++;
 const baselineMembership=reconciliation.categories.flatMap(c=>{
  assert(Array.isArray(c.memberIds)&&c.memberIds.every(text),'invalidCategoryMembershipBaseline');
  return c.memberIds.map(id=>({categoryId:c.id,entityId:id}));
 });
 const loadedMembership=categories.flatMap(c=>c.memberEntityIds.map(id=>({categoryId:c.id,entityId:id})));
 const a=new Map(),b=new Map();for(const row of baselineMembership)increment(a,digest(row));for(const row of loadedMembership)increment(b,digest(row));
 let exact=0,missing=0,loadedOnly=0;for(const key of new Set([...a.keys(),...b.keys()])){const x=a.get(key)||0,y=b.get(key)||0;exact+=Math.min(x,y);missing+=Math.max(0,x-y);loadedOnly+=Math.max(0,y-x);}
 const body={schemaVersion:'dnd-runtime-graph-inventory.v1',registry:{baseline:reconciliation.runtime.length,loaded:registry.size,coverage:registryCoverage,statuses:registryStatus,fingerprint:digest({baseline:registryBaseline,loaded:registryLoaded})},
  dependencies:compareOccurrences(reconciliation.dependencies,out),aliases:compareOccurrences(reconciliation.aliases,aliases),categories:compareOccurrences(reconciliation.categories,categories),
  memberships:{baseline:baselineMembership.length,loaded:loadedMembership.length,exact,missing,loadedOnly,fingerprint:digest({baseline:baselineMembership,loaded:loadedMembership})},
  indexAgreement,issues,readiness:'blocked',writeAuthorized:false,executable:false};
 return {...body,fingerprint:digest(body)};
}
module.exports={reviewRuntimeGraph,compareOccurrences};
