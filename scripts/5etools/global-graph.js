'use strict';
// Global graph: identity/closure validation, not a runtime import or editorial approval.
const {collect,audit}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {createReferenceIndex}=require('./reference-index');
const {previewPrecedence,chronology}=require('./precedence-policy');
const {digest,buildIntegratedReport}=require('./integrated-review');
const {physicalCandidateId}=require('./homebrew-policy');
const {buildHomebrewPilot}=require('./homebrew-pilot');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const coord=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const ns=i=>i?.provenance?.origin==='5etools'?'main':i?.provenance?.origin==='homebrew'?'homebrew':null;
const sourceOf=r=>typeof r.entity?.source==='string'&&r.entity.source.trim()?r.entity.source:r.kind==='magicvariant'?r.entity?.inherits?.source:null;
const knownEra=x=>['2014','2024'].includes(x);
const push=(m,k,v)=>{const a=m.get(k)||[];a.push(v);m.set(k,a);};
const sourceKey=i=>JSON.stringify([ns(i),i.source?.id,i.kind,i.identity?.canonicalKey]);
const compatibility=(a,b)=>!a||!b?'endpointNotEmitted':ns(a)!==ns(b)?'namespaceReviewRequired':!knownEra(a.source.rulesEra)||!knownEra(b.source.rulesEra)?'unknownEraReviewRequired':a.source.rulesEra===b.source.rulesEra?'sameEraIdentityOnly':'crossEraReviewRequired';
// Kahn residual includes both cycles and dependants; do not label every residual a cycle.
function residual(ids,edges){
  const remaining=new Map([...ids].map(id=>[id,0])),reverse=new Map();
  for(const [from,to] of edges){
    if(!remaining.has(from)||!remaining.has(to))continue;
    remaining.set(from,remaining.get(from)+1);push(reverse,to,from);
  }
  const q=[...remaining].filter(([,n])=>n===0).map(([id])=>id);
  for(let i=0;i<q.length;i++)for(const id of reverse.get(q[i])||[]){
    const n=remaining.get(id)-1;remaining.set(id,n);if(!n)q.push(id);
  }
  return [...remaining].filter(([,n])=>n>0).map(([id])=>id);
}
function rawGraph(collection,structural){
  const byId=new Map(),issues=dict(),byOrigin=dict(),counts=dict(),copyEdges=[];
  for(const e of structural.entities){
    if(byId.has(e.id))bump(issues,'duplicateResolvedRawId');
    byId.set(e.id,e);bump(byOrigin,e.origin);
  }
  for(const e of structural.entities){
    for(const [relation,targets] of [['lineage',e.lineage||[]],['reference',(e.references||[]).map(x=>x.target)]]){
      for(const id of targets){
        const t=byId.get(id);
        bump(counts,relation);
        if(!t){bump(issues,'rawResolvedEndpointMissing');continue;}
        if(e.origin==='main'&&t.origin!=='main')bump(issues,'rawMainToHomebrew');
        if(relation==='lineage')copyEdges.push([e.id,id]);
      }
    }
  }
  const cycleOrDependent=residual(byId.keys(),copyEdges).length;
  if(cycleOrDependent)bump(issues,'rawLineageCycleOrDependent',cycleOrDependent);
  return {observed:collection.records.length+collection.invalidRecords.length,resolved:byId.size,byOrigin,counts,cycleOrDependent,issues};
}
function validateGraph({collection,structural,items,precedenceItems,mainLedger,brewPilot,commits,validate}){
  if(typeof validate!=='function')throw Error('stagingValidatorRequired');
  const issues=dict(),nodes=new Map(),raw=new Map(),rawIds=new Map(),edges=[],logicalGroups=new Map(),blocked=new Set();
  const mark=(code,id)=>{bump(issues,code);if(id)blocked.add(id);};
  for(const r of [...collection.records,...collection.invalidRecords]){
    const k=coord(r);if(raw.has(k))mark('duplicateRawCoordinate');else raw.set(k,r);
    if(r.id)push(rawIds,r.id,r);
  }
  const structuralGraph=rawGraph(collection,structural);
  for(const [k,n] of Object.entries(structuralGraph.issues))bump(issues,k,n);
  const ledgerItems=new Map(mainLedger.items.map(i=>[i.id,i])),probes=new Map(brewPilot.probes.map(p=>[p.itemId,p]));
  if(ledgerItems.size!==mainLedger.items.length||probes.size!==brewPilot.probes.length)mark('duplicateLedgerItem');
  if(mainLedger.commits.main!==commits.main||mainLedger.commits.homebrew!==commits.homebrew||
    brewPilot.commits.main!==commits.main||brewPilot.commits.homebrew!==commits.homebrew)mark('ledgerSnapshotMismatch');
  for(const [domain,report] of [['mainLedger',mainLedger],['brewPilot',brewPilot]])for(const [k,n] of Object.entries(report.summary.issues||{}))bump(issues,domain+':'+k,n);
  const fingerprints=new Map();
  for(const i of items){
    if(nodes.has(i.id)){mark('duplicatePhysicalId',i.id);continue;}
    const origin=ns(i),p=i.provenance;let kind;
    try{kind=JSON.parse(p.entityKey)[0];}catch{mark('invalidProvenanceKey',i.id);}
    const k=coord({origin,path:p?.path,kind,index:p?.index}),r=raw.get(k),fingerprint=digest(i);
    fingerprints.set(i.id,fingerprint);
    const node={id:i.id,namespace:origin,kind:i.kind,sourceId:i.source?.id,sourceCode:p?.sourceCode,coordinate:k,blob:p?.blob,
      fingerprint,hardDependencies:[],evidenceIds:[],pendingEvidence:0,reviewCodes:i.metadata?.reviewCodes||[],activation:'review-required',runtimeEligible:false};
    nodes.set(i.id,node);
    if(!origin||!r||r.key!==p.entityKey||r.blob!==p.blob||sourceOf(r)!==p.sourceCode||p.commit!==commits[origin]||
      i.source.status!=='needsReview'||i.identity.precedenceScope!==i.source.precedenceScope)mark('itemProvenanceMismatch',i.id);
    if(origin==='main'){
      const l=ledgerItems.get(i.id);
      if(!l||l.coordinateKey!==k||l.provenance.blob!==p.blob||l.activation!=='review-required')mark('mainLedgerMismatch',i.id);
      if(!i.id.startsWith('upstream:main:'))mark('mainIdNamespaceMismatch',i.id);
    }else if(origin==='homebrew'){
      const probe=probes.get(i.id),m=i.metadata?.homebrewPolicy;
      if(!probe||probe.coordinate!==k||probe.fingerprint!==fingerprint||probe.sourceId!==i.source.id||probe.distribution!=='blocked'||
        m?.sourceId!==i.source.id||m?.distribution!=='blocked'||m?.activation!=='review-required'||probe.classificationProvisional!==m?.classificationProvisional||
        !r||i.id!==physicalCandidateId(r)||i.identity.precedenceScope!=='homebrew-source:'+i.source.id||i.source.contentType==='official')mark('brewProbeMismatch',i.id);
      node.classificationProvisional=probe?.classificationProvisional;
      node.distribution='blocked';
    }
    for(const id of p?.lineage||[]){
      const targets=rawIds.get(id)||[];
      if(targets.length!==1)mark('lineageIdentityPending',i.id);
      else if(origin==='main'&&targets[0].origin!=='main')mark('mainToHomebrewLineage',i.id);
    }
    const b=i.metadata?.variantBase;
    if(b){
      const base=raw.get(coord({origin,path:b.path,kind:'baseitem',index:b.index}));
      if(!base||base.blob!==b.blob||sourceOf(base)!==b.source||base.entity.name!==b.name)mark('variantBaseProvenanceMismatch',i.id);
    }
    push(logicalGroups,sourceKey(i),i.id);
  }
  const full=new Map(items.map(i=>[i.id,i]));
  const actualMain=items.filter(i=>ns(i)==='main');
  const mainDigest=digest(actualMain.map(i=>[i.id,fingerprints.get(i.id)]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(mainDigest!==brewPilot.summary.mainDigest||actualMain.length!==ledgerItems.size||actualMain.length!==brewPilot.summary.mainItems)mark('mainDigestOrCountMismatch');
  if(items.filter(i=>ns(i)==='homebrew').length!==probes.size)mark('brewProbeCountMismatch');
  function link(from,to,relation,type,expected){
    const a=full.get(from),b=full.get(to),n=nodes.get(from);
    if(!a||!b){mark(type==='hard'?'hardEndpointMissing':'resolvedEndpointMissing',from);return;}
    if(expected&&!expected.includes(b.kind)){mark('wrongEndpointKind',from);return;}
    if(ns(a)==='main'&&ns(b)==='homebrew'){mark('forbiddenMainToHomebrew',from);return;}
    const e={from,to,relation,type,compatibility:compatibility(a,b),activation:'review-required'};
    edges.push(e);
    if(type==='hard')n.hardDependencies.push(to);
  }
  // Explicit physical relationships in canonical payloads. Reciprocal ownership
  // is allowed; only precedence and raw lineage are DAGs.
  for(const i of items){
    const p=i.payload||{};
    for(const [k,kind] of [['classId','class'],['subclassId','subclass'],['speciesId','species']])if(p[k]!==undefined)link(i.id,p[k],k,'hard',[kind]);
    for(const [k,kind] of [['classIds','class'],['featIds','feat'],['featureIds','feature']])if(Array.isArray(p[k])){
      if(new Set(p[k]).size!==p[k].length)mark('duplicatePhysicalRelationship',i.id);
      for(const id of p[k])link(i.id,id,k,'hard',[kind]);
    }
    if(i.kind==='subclass'&&!p.classId)mark('missingSubclassOwner',i.id);
    if(i.kind==='feature'&&p.sourceType==='classFeature'&&(!p.classId||p.subclassId))mark('invalidClassFeatureOwner',i.id);
    if(i.kind==='feature'&&p.sourceType==='subclassFeature'){
      if(!p.classId||!p.subclassId||full.get(p.subclassId)?.payload.classId!==p.classId)mark('invalidSubclassFeatureOwner',i.id);
    }
    if(['class','subclass'].includes(i.kind)){
      const granted=new Set(p.featureIds||[]),progressed=new Set();
      for(const step of p.progression||[])for(const id of step.featureIds||[]){
        const f=full.get(id);
        if(!granted.has(id)||!f||f.kind!=='feature'||f.payload.levelGained!==step.level||
          f.payload.classId!==(i.kind==='class'?i.id:p.classId)||
          (i.kind==='subclass'?f.payload.subclassId!==i.id:!!f.payload.subclassId))mark('progressionOwnerOrLevelMismatch',i.id);
        progressed.add(id);
      }
      if([...granted].some(id=>!progressed.has(id)))mark('grantMissingProgression',i.id);
    }
  }
  const evidenceIds=new Set(),byEvidenceStatus=dict(),byEvidenceDomain=dict(),reviewCounts=dict(),unattachedEvidence=dict();
  const identityStatuses=new Set(['resolvedIdentity','defaultIdentityCandidate','explicitSpellCandidate','conditionIdentityCandidate','directContextCandidate','reprintProposed','spellResourceContextCandidate']);
  const nonPending=new Set([...identityStatuses,'nonReference','numericFormulaCandidate','numericRollParameter','damageFormulaCandidate','instantaneous','durationCandidate','plainDefenseCandidate','fullyEvaluable','allocationEvaluable','tableCandidate','costCandidate','capacityCandidate','noDeclaredProgression']);
  for(const [origin,list] of [['main',mainLedger.evidence],['homebrew',brewPilot.evidence]])for(const e of list){
    if(evidenceIds.has(e.id))mark('duplicateEvidenceId',e.itemId);else evidenceIds.add(e.id);
    if(e.activation!=='review-required'||!text(e.fingerprint)||e.id!=='review:'+e.fingerprint)mark('evidenceIntegrityMismatch',e.itemId);
    bump(byEvidenceStatus,e.status);bump(byEvidenceDomain[e.domain]??=dict(),e.status);bump(reviewCounts,e.review||'unreviewed');
    const n=nodes.get(e.itemId);
    if(!n){
      if(e.itemId!==undefined)mark('evidenceOwnerMissing',e.itemId);
      else bump(unattachedEvidence,e.domain);
      continue; // raw-only structural candidates/aliases do not become graph nodes
    }
    if(n.namespace!==origin)mark('evidenceNamespaceMismatch',e.itemId);
    n.evidenceIds.push(e.id);
    if(!nonPending.has(e.status))n.pendingEvidence++;
    if(e.targetId!==undefined&&identityStatuses.has(e.status))link(e.itemId,e.targetId,e.domain,'evidence');
  }
  for(const n of nodes.values()){
    const expected=n.namespace==='main'?ledgerItems.get(n.id)?.evidenceIds:probes.get(n.id)?.evidenceIds;
    if(!Array.isArray(expected)||digest([...expected].sort())!==digest([...n.evidenceIds].sort()))mark('evidenceMembershipMismatch',n.id);
  }
  // Proposed precedence never crosses namespaces/scopes; no arbitrary winning edition.
  const precedence=new Map(precedenceItems.map(i=>[i.id,i.precedence]));
  if(precedence.size!==actualMain.length||precedenceItems.length!==actualMain.length)mark('precedenceRegistryMismatch');
  const directional=[],precedenceCounts=dict();
  for(const i of items){
    const p=ns(i)==='main'?precedence.get(i.id):i.precedence;
    if(!rec(p)){mark('missingPrecedence',i.id);continue;}
    bump(precedenceCounts,p.relation);
    const seen=new Set();
    for(const k of ['reprints','supersedes','coexistsWith']){
      if(!Array.isArray(p[k])){mark('invalidPrecedenceList',i.id);continue;}
      for(const id of p[k]){
        const t=full.get(id);
        if(!t||i.id===id||seen.has(id)||ns(i)!==ns(t)||i.kind!==t.kind||
          i.source.contentType!==t.source.contentType||i.identity.precedenceScope!==t.identity.precedenceScope||
          i.identity.canonicalKey!==t.identity.canonicalKey){mark('invalidPrecedenceEndpoint',i.id);continue;}
        seen.add(id);
        if(k==='coexistsWith'){
          const other=ns(t)==='main'?precedence.get(id):t.precedence;
          if(!other?.coexistsWith?.includes(i.id))mark('asymmetricCoexistence',i.id);
        }else{
          if(chronology(i,t)!=='strictlyLater'||!knownEra(i.source.rulesEra)||!knownEra(t.source.rulesEra)||
            k==='supersedes'&&i.source.rulesEra!==t.source.rulesEra)mark('invalidPrecedenceChronology',i.id);
          directional.push([i.id,id]);
        }
        link(i.id,id,k,'precedence');
      }
    }
    if(ns(i)==='homebrew'&&seen.size)mark('brewPrecedenceNotReviewed',i.id);
  }
  const precedenceResidual=residual(nodes.keys(),directional).length;
  if(precedenceResidual)mark('precedenceCycleOrDependent');
  // Validate the combined payload graph as one staging pack. Proposed precedence
  // is applied to a copy only. No production persistence or active statuses.
  const first=items[0];
  if(!first)throw Error('emptyGraph');
  const pack={templateVersion:'dnd-combat-import.v3',contractRevision:'canonical-v3.1',id:'upstream:global:validation',
    source:first.source,metadata:{activation:'review-required',stage:'a6.7'},items:items.map(i=>({...i,precedence:precedence.get(i.id)||i.precedence}))};
  const validation=validate(pack),stageIssues=dict();
  for(const e of validation.issues||[]){
    bump(stageIssues,e.severity+':'+e.code);
    if(e.severity==='error')mark('globalStagingError:'+e.code,e.itemId);
  }
  if(validation.ok!==true)mark('globalStagingInvalid');
  const reverse=new Map();for(const e of edges.filter(e=>e.type==='hard'))push(reverse,e.to,e.from);
  const queue=[...blocked];for(let i=0;i<queue.length;i++)for(const id of reverse.get(queue[i])||[])if(!blocked.has(id)){blocked.add(id);queue.push(id);}
  const byNamespace=dict(),byKind=dict(),byClosure=dict(),edgeCounts=dict(),compatibilityCounts=dict();
  const integrityValid=Object.keys(issues).length===0;
  for(const n of nodes.values()){
    n.hardDependencies=[...new Set(n.hardDependencies)].sort();
    n.closure=blocked.has(n.id)?'dependencyBlocked':'hardDependenciesClosed';
    n.readiness=!integrityValid?'graphIntegrityPending':n.namespace==='homebrew'?'homebrewQuarantined':'semanticReviewRequired';
    bump(byNamespace[n.namespace]??=dict(),n.readiness);bump(byKind[n.kind]??=dict(),n.readiness);bump(byClosure,n.closure);
  }
  for(const e of edges){bump(edgeCounts[e.type]??=dict(),e.relation);bump(compatibilityCounts[e.type]??=dict(),e.compatibility);}
  const logicalMultiplicity=[...logicalGroups.values()].filter(a=>a.length>1).length;
  return {schemaVersion:'dnd-upstream-global-graph.v1',commits,summary:{rawGraph:structuralGraph,registry:nodes.size,mainItems:actualMain.length,homebrewProbes:probes.size,mainDigest,
    evidenceOccurrences:evidenceIds.size,unattachedEvidence,byEvidenceStatus,byEvidenceDomain,reviewCounts,logicalMultiplicity,
    byNamespace,byKind,byClosure,edgeCounts,compatibilityCounts,precedenceCounts,precedenceResidual,stagingValid:validation.ok===true,stageIssues,integrityValid,issues,runtimeEligible:0,distributionAuthorized:0},
    nodes:[...nodes.values()],edges,activation:'review-required',scope:'global staging graph only; hard closure is not semantic completeness, editorial approval, distribution or runtime eligibility'};
}
function buildGlobalGraph(main,homebrew,{validate,decisions=[],sourceDecisions=[],limitPerKind=30,attemptLimitPerKind=600}={}){
  const collection=collect(main,homebrew),structural=audit(main,homebrew,collection),commits={main:main.commit,homebrew:homebrew.commit};
  const runs=converters.map(c=>({stage:c.stage,result:require('./'+c.module).buildPilot(main)}));
  const items=runs.flatMap(r=>r.result.packs.flatMap(p=>p.items)),records=collection.records,index=createReferenceIndex(records,items);
  const precedence=previewPrecedence(items,records);
  const context={collection,structural,runs,records,items,index,precedence};
  const mainLedger=buildIntegratedReport(main,homebrew,{decisions,sharedContext:context});
  const brewItems=[];
  const brewPilot=buildHomebrewPilot(main,homebrew,{validate,decisions:sourceDecisions,limitPerKind,attemptLimitPerKind,sharedContext:context,onProbe:i=>brewItems.push(i)});
  return validateGraph({collection,structural,items:[...items,...brewItems],precedenceItems:precedence.previewItems,mainLedger,brewPilot,commits,validate});
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={residual,rawGraph,validateGraph,buildGlobalGraph,publicSummary};
