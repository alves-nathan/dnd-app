'use strict';
// Preserve runtime lookup order and directional declarations; no resolution changes.
const {digest}=require('./integrated-review');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const bump=(o,k)=>{o[k]=(o[k]||0)+1;};
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false};
const group=(m,k,v)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(v);};
function buildRelationshipPolicyReview(input,evidence){
 const b=input.runtimeBundle,r=input.reconciliation;
 assert(evidence?.schemaVersion==='dnd-upstream-runtime-contract-evidence.v1'&&evidence.approvedMappings===0&&evidence.mechanicalParityEstablished===0&&evidence.activation==='review-required'&&evidence.writeAuthorized===false&&evidence.runtimeEligible===false&&evidence.retirementAuthorized===false&&evidence.executable===false,'invalidRelationshipPolicyEvidence');
 const {fingerprint,...body}=evidence;
 assert(digest(body)===fingerprint&&evidence.bundleFingerprint===digest(b)&&evidence.reconciliationFingerprint===digest(r)&&digest(evidence.commits)===digest(r.commits),'relationshipPolicyBindingMismatch');
 const entries=new Map(b.runtimeIndex.entries.map(e=>[e.entityId,e])),aliases=b.aliases.entities,categories=b.contentCategories.entities;
 assert(entries.size===b.runtimeIndex.entries.length&&entries.size===evidence.rows.length&&aliases.length===evidence.aliases.length&&categories.length===evidence.categories.length,'relationshipPolicyCoverageMismatch');
 const identity=new Map();
 for(const row of evidence.rows){
  const e=entries.get(row.id);assert(e&&digest(e)===row.sourceFingerprint&&!identity.has(row.id),'relationshipPolicyEntryMismatch');identity.set(row.id,row);
 }
 const aliasGroups=new Map(),categoryGroups=new Map(),aliasRows=[],categoryRows=[],entryRows=[];
 const alias={occurrences:aliases.length,groups:0,duplicateFromOccurrences:0,conflictingTargetGroups:0,conflictingContractGroups:0,shadowedActive:0,activeShadowedByNonActive:0,selectedActive:0,selectedNonActive:0,selectedSelfLinks:0,selectedActiveChainStarts:0,selectedActiveCycleMembers:0,directEntryPrecedesAliasLookup:0,byResolutionPolicy:{}};
 for(const [index,e] of aliases.entries()){
  const h=evidence.aliases[index];assert(h.index===index&&h.sourceFingerprint===digest(e)&&entries.has(e.from)&&entries.has(e.to)&&h.preservation==='required','relationshipPolicyAliasMismatch');
  group(aliasGroups,e.from,{e,index});bump(alias.byResolutionPolicy,e.resolutionPolicy??'unspecified');
 }
 alias.groups=aliasGroups.size;alias.duplicateFromOccurrences=aliases.length-alias.groups;
 const active=new Map();
 for(const [from,rows] of aliasGroups){
  const winner=rows[rows.length-1].e;
  if(new Set(rows.map(x=>x.e.to)).size>1)alias.conflictingTargetGroups++;
  if(new Set(rows.map(x=>digest([x.e.to,x.e.kind,x.e.relation,x.e.status,x.e.resolutionPolicy]))).size>1)alias.conflictingContractGroups++;
  if(winner.status==='active'){alias.selectedActive++;active.set(from,winner.to);if(from===winner.to)alias.selectedSelfLinks++;}
  else alias.selectedNonActive++;
  // The existing character dependency resolver returns a direct entry first.
  if(entries.has(from))alias.directEntryPrecedesAliasLookup++;
  for(const [ordinal,{e,index}] of rows.entries()){
   const selected=ordinal===rows.length-1;
   if(!selected&&e.status==='active'){alias.shadowedActive++;if(winner.status!=='active')alias.activeShadowedByNonActive++;}
   aliasRows.push({index,sourceFingerprint:digest(e),selectedByLastOccurrence:selected,selectedFingerprint:digest(winner),preservation:'required'});
  }
 }
 // Diagnostic topology only: no transitive resolution; direct ID behavior is retained.
 const visited=new Set();
 for(const [from,to] of active){
  if(active.has(to))alias.selectedActiveChainStarts++;
  if(visited.has(from))continue;
  const trail=[],positions=new Map();let at=from;
  while(active.has(at)&&!visited.has(at)&&!positions.has(at)){positions.set(at,trail.length);trail.push(at);at=active.get(at);}
  if(positions.has(at))alias.selectedActiveCycleMembers+=trail.length-positions.get(at);
  for(const id of trail)visited.add(id);
 }
 const category={occurrences:categories.length,groups:0,shadowedOccurrences:0,conflictingMembershipGroups:0,conflictingFilterContractGroups:0,membershipOccurrences:0,duplicateMembersWithinRecord:0,shadowedMembershipOccurrences:0,entryDeclarations:0,duplicateEntryDeclarations:0,entryCategoryMissing:0,entryNotInSelectedCategory:0,selectedMembershipWithoutEntryDeclaration:0,selectedMembershipOccurrences:0};
 for(const [index,c] of categories.entries()){
  const h=evidence.categories[index];assert(h.index===index&&h.sourceFingerprint===digest(c)&&h.preservation==='required'&&c.memberCount===c.memberEntityIds.length&&c.memberEntityIds.every(id=>entries.has(id)),'relationshipPolicyCategoryMismatch');
  group(categoryGroups,c.id,{c,index});category.membershipOccurrences+=c.memberEntityIds.length;category.duplicateMembersWithinRecord+=c.memberEntityIds.length-new Set(c.memberEntityIds).size;
 }
 category.groups=categoryGroups.size;category.shadowedOccurrences=categories.length-category.groups;
 const selected=new Map();
 for(const [id,rows] of categoryGroups){
  const winner=rows[rows.length-1].c;selected.set(id,new Set(winner.memberEntityIds));
  if(new Set(rows.map(x=>digest(x.c.memberEntityIds))).size>1)category.conflictingMembershipGroups++;
  if(new Set(rows.map(x=>digest([x.c.canDisable,x.c.defaultEnabled]))).size>1)category.conflictingFilterContractGroups++;
  for(const [ordinal,{c,index}] of rows.entries()){
   const isSelected=ordinal===rows.length-1;
   if(isSelected){category.selectedMembershipOccurrences+=c.memberEntityIds.length;for(const member of c.memberEntityIds)if(!entries.get(member).categoryIds.includes(id))category.selectedMembershipWithoutEntryDeclaration++;}
   else category.shadowedMembershipOccurrences+=c.memberEntityIds.length;
   categoryRows.push({index,sourceFingerprint:digest(c),selectedByLastOccurrence:isSelected,selectedFingerprint:digest(winner),preservation:'required'});
  }
 }
 for(const [id,e] of entries){
  assert(Array.isArray(e.categoryIds),'relationshipPolicyEntryCategoriesInvalid');
  category.entryDeclarations+=e.categoryIds.length;category.duplicateEntryDeclarations+=e.categoryIds.length-new Set(e.categoryIds).size;
  for(const [index,c] of e.categoryIds.entries()){
   const members=selected.get(c),status=!members?'categoryMissing':!members.has(id)?'notInSelectedMembership':'reciprocalSelectedDeclaration';
   if(status==='categoryMissing')category.entryCategoryMissing++;
   if(status==='notInSelectedMembership')category.entryNotInSelectedCategory++;
   entryRows.push({entryFingerprint:identity.get(id).sourceFingerprint,index,categoryFingerprint:digest(c),status});
  }
 }
 assert(category.membershipOccurrences===category.selectedMembershipOccurrences+category.shadowedMembershipOccurrences&&category.membershipOccurrences===evidence.summary.categories.memberships&&alias.occurrences===evidence.summary.aliases.total,'relationshipPolicyAccountingMismatch');
 const policySections=evidence.policies.map(p=>{assert(p.sourceFingerprint===digest(b[p.section])&&p.preservation==='required','relationshipPolicySectionMismatch');return {section:p.section,fingerprint:p.sourceFingerprint};});
 assert(policySections.length===evidence.summary.policies,'relationshipPolicySectionCoverageMismatch');
 const dependencyPolicies={};for(const edge of b.dependencyGraph.edges)bump(dependencyPolicies,edge.resolutionPolicy??'unspecified');
 const report={schemaVersion:'dnd-upstream-relationship-policy-review.v1',commits:r.commits,bindings:{runtimeEvidence:fingerprint,runtimeBundle:evidence.bundleFingerprint,reconciliation:evidence.reconciliationFingerprint},alias,category,dependencyPolicies,policySections,
  occurrenceFingerprints:{aliases:digest(aliasRows),categories:digest(categoryRows),entryDeclarations:digest(entryRows)},consumerScope:{aliasIndex:'lastOccurrenceByFrom',characterDependencyResolver:'directEntryBeforeSingleActiveAlias',categoryIndex:'lastOccurrenceById',filter:'entryCategoryIdsAndSelectedCategoryMetadata',topology:'diagnosticOnlyNotTransitiveResolution'},
  pending:['semanticEquivalence','referenceSelectorsAndGrants','installedConfiguration','explicitApproval'],preservation:'required',relationshipParityEstablished:0,approvedMappings:0,mechanicalParityEstablished:0,readiness:'blocked',...flags};
 return {...report,fingerprint:digest(report)};
}
module.exports={buildRelationshipPolicyReview};
