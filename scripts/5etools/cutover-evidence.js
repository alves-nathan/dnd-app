'use strict';
// a8.4: aggregate-only evidence matrix. Never converts a review into approval.
const fs=require('node:fs');
const {digest}=require('./integrated-review');
const KINDS=['class','subclass','species','background','feat','weapon','armor','equipment','magicItem','spell','feature','condition','creatureStatBlock'];
const SCHEMA='dnd-upstream-cutover-evidence.v1';
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dict=()=>Object.create(null);
const add=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const cleanCounts=o=>rec(o)&&Object.values(o).every(count);
const zeroIssues=o=>rec(o)&&Object.keys(o).length===0;
const kindMap=()=>Object.fromEntries(KINDS.map(k=>[k,dict()]));
const pair=x=>({main:x.main,homebrew:x.homebrew});
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const runtimeKind=k=>['classFeature','subclassFeature'].includes(k)?'feature':k;
const requireKinds=o=>assert(rec(o)&&Object.keys(o).every(k=>KINDS.includes(k)),'unexpectedCanonicalKind');
function fragment(type,commits,body){
  assert(sha(commits?.main)&&sha(commits?.homebrew),'invalidSnapshotPair');
  const f={schemaVersion:SCHEMA,fragment:type,commits:pair(commits),...body};
  return {...f,fingerprint:digest(f)};
}
function fromCoverage(r){
  assert(r.schemaVersion==='dnd-upstream-coverage-baseline.v1'&&r.activation==='review-required'&&zeroIssues(r.issues),'invalidCoverage');
  requireKinds(r.canonical);requireKinds(r.canonicalValidation);
  const byKind=kindMap();
  for(const k of KINDS){
    const n=r.canonical[k]||0,v=r.canonicalValidation[k]||{};
    assert(count(n)&&cleanCounts(v)&&Object.keys(v).every(s=>['stagingValid','stagingInvalid'].includes(s))&&sum(v)===n,'coverageKindAccounting');
    byKind[k]={emitted:n,stagingValid:v.stagingValid||0,stagingInvalid:v.stagingInvalid||0};
  }
  assert(sum(r.canonical)===r.uniquePhysicalIds&&r.totalsByOrigin.main.emitted===r.uniquePhysicalIds&&
    r.totalsByOrigin.homebrew.emitted===0,'coveragePhysicalAccounting');
  // Raw upstream kinds stay separate: items/variants and races do not have a
  // one-to-one correspondence to canonical kinds. Never allocate gaps by guess.
  const rawByOrigin=dict();
  for(const s of r.sources){
    const group=rawByOrigin[s.origin]??=dict();
    for(const [k,c] of Object.entries(s.kinds)){
      const v=group[k]??=dict();
      for(const field of ['observed','eligible','outsidePilot','validRow','invalidRow','notEmitted','templateNoOutput'])
        {assert(count(c[field]),'invalidRawCount');add(v,field,c[field]);}
    }
  }
  return fragment('coverage',r.commits,{byKind,rawByOrigin,uniquePhysicalIds:r.uniquePhysicalIds,runtimeEntries:r.runtime.total});
}
function fromGraph(r){
  assert(r.schemaVersion==='dnd-upstream-global-graph.v1'&&r.activation==='review-required'&&r.summary.integrityValid===true&&
    r.summary.stagingValid===true&&zeroIssues(r.summary.issues)&&r.summary.runtimeEligible===0&&r.summary.distributionAuthorized===0,'invalidGraph');
  const byKind=kindMap(),ids=new Set();
  for(const n of r.nodes){
    assert(KINDS.includes(n.kind)&&['main','homebrew'].includes(n.namespace)&&!ids.has(n.id)&&n.activation==='review-required'&&
      n.runtimeEligible===false&&['hardDependenciesClosed','dependencyBlocked'].includes(n.closure)&&count(n.pendingEvidence)&&Array.isArray(n.evidenceIds),'invalidGraphNode');
    ids.add(n.id);
    const v=byKind[n.kind];
    add(v,n.namespace==='main'?'main':'homebrewProbes');
    add(v,n.namespace+':'+n.closure);
    add(v,n.namespace+':evidenceMemberships',n.evidenceIds.length);
    add(v,n.namespace+':pendingEvidence',n.pendingEvidence);
  }
  assert(ids.size===r.summary.registry&&Object.values(byKind).reduce((a,b)=>a+(b.main||0),0)===r.summary.mainItems&&
    Object.values(byKind).reduce((a,b)=>a+(b.homebrewProbes||0),0)===r.summary.homebrewProbes,'graphAccounting');
  return fragment('graph',r.commits,{byKind,registry:r.summary.registry,mainItems:r.summary.mainItems,homebrewProbes:r.summary.homebrewProbes,
    evidenceOccurrences:r.summary.evidenceOccurrences,stageIssues:r.summary.stageIssues});
}
function fromMigration(r,p,installed){
  assert(r.schemaVersion==='dnd-upstream-historical-reconciliation.v1'&&r.activation==='review-required'&&
    zeroIssues(r.summary.issues)&&r.summary.approvedMappings===0&&r.summary.mechanicalParityEstablished===0&&
    r.summary.retirementAuthorized===false,'invalidReconciliation');
  assert(p.schemaVersion==='dnd-upstream-migration-preview.v1'&&p.scope==='bundledFixture'&&p.activation==='review-required'&&
    p.executable===false&&p.retirementAuthorized===false&&zeroIssues(p.summary.issues)&&
    ['writes','deletes','replacements','approvedMappings'].every(k=>p.summary[k]===0)&&
    digest(r.commits)===digest(p.commits)&&p.checkpoint.reconciliationFingerprint===digest(r)&&
    p.checkpoint.snapshotFingerprint===digest(installed),'invalidMigrationPreview');
  const byKind=kindMap(),outsideRuntime=dict(),outsideHistorical=dict(),outsideStorage=dict();
  const row=(kind,other)=>KINDS.includes(kind)?byKind[kind]:other[kind]??=dict();
  const evidence=new Set();
  for(const h of r.historical){
    assert(h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed'&&!evidence.has(h.evidenceId),'invalidHistoricalRow');
    evidence.add(h.evidenceId);const v=row(h.kind,outsideHistorical);
    add(v,'historical');add(v,'historical:'+h.status);
    if(h.comparison)add(v,'payload:'+h.comparison.status);
  }
  for(const h of r.runtime){
    assert(h.preservation==='required'&&h.activation==='review-required'&&h.decision==='unreviewed'&&!evidence.has(h.evidenceId),'invalidRuntimeRow');
    evidence.add(h.evidenceId);const v=row(runtimeKind(h.kind),outsideRuntime);
    add(v,'runtime');add(v,'runtime:'+h.status);
  }
  const stored=new Map(installed.items.map(i=>[i.id,i])),seen=new Set();
  for(const h of p.storageRows){
    const i=stored.get(h.storageId);
    assert(i&&!seen.has(h.storageId)&&h.writeAuthorized===false&&h.preservesStorageId===true&&h.preservesReview===true&&
      h.canonicalId===i.importItemId&&h.fingerprint===digest(i),'invalidStorageRow');
    seen.add(h.storageId);const v=row(i.type,outsideStorage);
    add(v,'storage');add(v,'storage:'+h.disposition);
  }
  assert(seen.size===installed.items.length&&seen.size===p.summary.storageItems&&r.historical.length===p.summary.historicalOccurrences&&
    r.runtime.length===p.summary.runtimeEntries,'migrationAccounting');
  assert(sha(r.commits.application),'invalidApplicationCommit');
  return fragment('migration',r.commits,{applicationCommit:r.commits.application,scope:p.scope,byKind,outsideRuntime,outsideHistorical,outsideStorage,
    totals:{storage:p.summary.storageItems,historical:p.summary.historicalOccurrences,runtime:p.summary.runtimeEntries,
      dependencies:p.summary.dependencies,aliases:p.summary.aliases,categories:p.summary.categories,legacyLinks:p.summary.legacyLinks},
    relationStatus:{dependencies:r.summary.dependencyStatus,aliases:r.summary.aliasStatus,legacyLinks:r.summary.legacyLinkStatus},
    approvedMappings:0,mechanicalParityEstablished:0,writes:0});
}
function buildMatrix(coverage,graph,migration){
  for(const [f,t] of [[coverage,'coverage'],[graph,'graph'],[migration,'migration']]){
    assert(rec(f)&&f.schemaVersion===SCHEMA&&f.fragment===t&&sha(f.commits?.main)&&sha(f.commits?.homebrew),'invalidFragment');
    const {fingerprint,...body}=f;
    assert(digest(body)===fingerprint,'fragmentFingerprintMismatch');
    assert(digest(f.commits)===digest(coverage.commits),'snapshotPairMismatch');
    assert(rec(f.byKind)&&Object.keys(f.byKind).sort().join('|')===[...KINDS].sort().join('|')&&Object.values(f.byKind).every(cleanCounts),'kindAccountingMismatch');
  }
  assert(migration.scope==='bundledFixture'&&sha(migration.applicationCommit)&&migration.approvedMappings===0&&
    migration.mechanicalParityEstablished===0&&migration.writes===0,'migrationNotReadOnly');
  const rows=KINDS.map(kind=>{
    const c=coverage.byKind[kind],g=graph.byKind[kind],m=migration.byKind[kind];
    assert(c.emitted===c.stagingValid+c.stagingInvalid&&c.emitted===(g.main||0)&&
      (g.main||0)===(g['main:hardDependenciesClosed']||0)+(g['main:dependencyBlocked']||0)&&
      (g.homebrewProbes||0)===(g['homebrew:hardDependenciesClosed']||0)+(g['homebrew:dependencyBlocked']||0),'crossKindAccounting');
    return {kind,conversion:c,graph:g,preservation:m,
      mechanicalParity:'notEstablished',runtimeEligible:0,retirementAuthorized:false,
      nextReview:!c.emitted?'conversionCoverage':c.stagingInvalid?'stagingValidation':g['main:dependencyBlocked']?'hardDependencyClosure':'mechanicalAndIdentityReview'};
  });
  const total=(key,other)=>rows.reduce((n,r)=>n+(r.preservation[key]||0),0)+Object.values(other).reduce((n,r)=>n+(r[key]||0),0);
  for(const o of [migration.outsideRuntime,migration.outsideHistorical,migration.outsideStorage]){
    assert(rec(o)&&Object.values(o).every(cleanCounts),'invalidOutsideKindAccounting');
  }
  assert(rows.reduce((n,r)=>n+r.conversion.emitted,0)===coverage.uniquePhysicalIds&&coverage.uniquePhysicalIds===graph.mainItems&&
    graph.registry===graph.mainItems+graph.homebrewProbes&&rows.reduce((n,r)=>n+(r.graph.homebrewProbes||0),0)===graph.homebrewProbes&&
    total('runtime',migration.outsideRuntime)===coverage.runtimeEntries&&coverage.runtimeEntries===migration.totals.runtime&&
    total('historical',migration.outsideHistorical)===migration.totals.historical&&total('storage',migration.outsideStorage)===migration.totals.storage,'crossReportAccounting');
  const body={schemaVersion:SCHEMA,commits:{...coverage.commits,application:migration.applicationCommit},scope:'bundledFixtureAndPilotOnly',
    evidenceFingerprints:{coverage:coverage.fingerprint,graph:graph.fingerprint,migration:migration.fingerprint},rows,
    rawByOrigin:coverage.rawByOrigin,outsideRuntime:migration.outsideRuntime,outsideHistorical:migration.outsideHistorical,outsideStorage:migration.outsideStorage,
    totals:{...migration.totals,mainItems:graph.mainItems,homebrewProbes:graph.homebrewProbes,evidenceOccurrences:graph.evidenceOccurrences},
    relationStatus:migration.relationStatus,stageIssues:graph.stageIssues,
    blockers:['mechanicalParityNotApproved','historicalAndInstalledInventoryNotVerified','dependencyAliasAndRuntimeContractParityPending',
      'durableFullCheckpointNotVerified','productionTransactionAndRollbackNotVerified','rightsAndRuntimeTrustNotVerified','nativeValidationPending','explicitCutoverApprovalMissing'],
    activation:'review-required',executable:false,runtimeEligible:0,distributionAuthorized:false,retirementAuthorized:false};
  return {...body,fingerprint:digest(body)};
}
function writeFragment(dir,name,report){
  if(!dir)return;
  fs.writeFileSync(require('node:path').join(dir,name+'.json'),JSON.stringify(report)+'\n',{flag:'wx'});
}
module.exports={KINDS,fromCoverage,fromGraph,fromMigration,buildMatrix,writeFragment};
if(require.main===module){
  const dir=process.argv[2];assert(dir,'fragmentDirectoryRequired');
  const read=n=>JSON.parse(fs.readFileSync(require('node:path').join(dir,n+'.json'),'utf8'));
  const report=buildMatrix(read('coverage'),read('graph'),read('migration'));
  // Aggregates only: no entity IDs, raw rows, filenames, source codes or texts.
  console.log(JSON.stringify(report));
  const families=read('families');
  const global=require('./global-checkpoint-review').buildGlobalCheckpointReview(report,families);
  const mechanical=require('./mechanical-preservation-review').buildMechanicalPreservationReview(families);
  assert(digest(mechanical)===digest(families.mechanicalPreservation)&&families.bindings.mechanicalPreservation===mechanical.fingerprint,'mechanicalPreservationReportMismatch');
  console.log(JSON.stringify(mechanical));
  const relations=families.relationshipIdentity;
  const {fingerprint:relationFingerprint,...relationBody}=relations;
  assert(digest(relationBody)===relationFingerprint&&families.bindings.relationshipIdentity===relationFingerprint&&relations.bindings.reconciliation===families.reconciliationFingerprint&&relations.legacy.occurrences===report.totals.legacyLinks&&relations.dependencies.occurrences===report.totals.dependencies&&relations.relationshipParityEstablished===0&&relations.writeAuthorized===false,'relationshipIdentityReportMismatch');
  console.log(JSON.stringify(relations));
  console.log(JSON.stringify(global));
  const acceptance=require('./cutover-acceptance-matrix').buildCutoverAcceptanceMatrix(report,families,global);
  console.log(JSON.stringify(acceptance));
}

