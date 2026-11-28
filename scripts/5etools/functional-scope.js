'use strict';
// Local-only scope preparation: exact source identities, never silent exclusions.
const fs=require('node:fs'),path=require('node:path');
const {digest}=require('./integrated-review');
const {selectFunctionalCorpus}=require('./functional-corpus');
const assert=(v,c)=>{if(!v)throw Error(c);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const text=v=>typeof v==='string'&&v.trim().length>0;
const seal=body=>({...body,fingerprint:digest(body)});
const verify=(draft)=>{
 const {fingerprint,...body}=draft;
 assert(draft.schemaVersion==='dnd-upstream-functional-corpus.v1'&&draft.scope==='privateScopeDraft'&&draft.executable===false&&digest(body)===fingerprint,'functionalDraftInvalid');
 assert(Array.isArray(draft.sources)&&new Set(draft.sources.map(s=>s.id)).size===draft.sources.length&&draft.sources.every(s=>['main','homebrew'].includes(s.origin)&&s.id===JSON.stringify([s.origin,s.source])),'functionalSourceRegistryInvalid');
};
function reconcileFunctionalLegacySources(draft,history){
 verify(draft);
 assert(history?.schemaVersion==='dnd-upstream-historical-baseline.v1'&&history.activation==='review-required'&&digest(history.commits)===digest(draft.commits)&&Object.keys(history.summary.issues).length===0&&history.summary.retirementAuthorized===false,'functionalHistoryBindingMismatch');
 const main=new Map(draft.sources.filter(s=>s.origin==='main'&&s.source!==null).map(s=>[s.source,s.id]));
 const required=new Set(),seen=new Set(),totals={historicalOccurrences:0,bootstrap:0,runtime:0},pending={historicalOccurrences:0,bootstrap:0,runtime:0};
 const rows=history.comparison.sources.map(s=>{
  const key=JSON.stringify([s.domain,s.sourceId]);
  assert(Object.hasOwn(totals,s.domain)&&!seen.has(key)&&count(s.count)&&Array.isArray(s.codes)&&s.migrationState==='preservePending'&&s.equivalence==='notEstablished','functionalHistorySourceInvalid');
  seen.add(key);totals[s.domain]+=s.count;
  const targets=s.codes.map(code=>main.get(code)??null);
  const resolved=s.status==='mainPublicationCandidate'&&targets.length>0&&targets.every(Boolean);
  if(resolved)for(const target of targets)required.add(target);
  else pending[s.domain]+=s.count;
  return {domain:s.domain,legacySourceId:s.sourceId,occurrences:s.count,sourceIds:resolved?targets:[],disposition:resolved?'requireSourceAndPreserveIdentity':'preserveUnmappedLegacy',equivalence:'notEstablished'};
 });
 assert(totals.historicalOccurrences===history.summary.historical.historical.count&&totals.bootstrap===history.summary.historical.bootstrap.count&&totals.runtime===history.summary.runtime.entries&&totals.runtime===draft.baselineRuntime.entries,'functionalHistoryDenominatorMismatch');
 return seal({schemaVersion:'dnd-upstream-functional-legacy-source-review.v1',corpusFingerprint:draft.fingerprint,historyFingerprint:digest(history),commits:draft.commits,requiredSourceIds:[...required].sort(),rows,totals,pending,installedInventory:'notInspected',scope:'publicationBindingOnly',executable:false});
}
// Explicit batch selection is bound to a digest of the exact source set.
// No wildcard for future snapshots; unknown sources remain pending.
function prepareFunctionalSelection(draft,{mainPolicy,mainSourceIds=[],homebrewSourceIds=[],excludedSourceIds=[],reason}={},legacy){
 verify(draft);
 assert(['allObservedMain','explicitOnly'].includes(mainPolicy)&&Array.isArray(mainSourceIds)&&Array.isArray(homebrewSourceIds)&&Array.isArray(excludedSourceIds)&&text(reason),'functionalBatchSelectionInvalid');
 const known=new Map(draft.sources.map(s=>[s.id,s]));
 const include=new Set(),exclude=new Set();
 for(const id of mainSourceIds){const s=known.get(id);assert(s?.origin==='main'&&s.source!==null&&!include.has(id),'functionalBatchMainInvalid');include.add(id);}
 for(const id of homebrewSourceIds){const s=known.get(id);assert(s?.origin==='homebrew'&&s.source!==null&&!include.has(id),'functionalBatchHomebrewInvalid');include.add(id);}
 for(const id of excludedSourceIds){const s=known.get(id);assert(s&&s.source!==null&&!exclude.has(id)&&!include.has(id),'functionalBatchExclusionInvalid');exclude.add(id);}
 if(mainPolicy==='allObservedMain')for(const s of draft.sources)if(s.origin==='main'&&s.source!==null&&!exclude.has(s.id))include.add(s.id);
 if(legacy){
  const {fingerprint,...body}=legacy;
  assert(legacy.schemaVersion==='dnd-upstream-functional-legacy-source-review.v1'&&legacy.corpusFingerprint===draft.fingerprint&&digest(body)===fingerprint&&Array.isArray(legacy.requiredSourceIds),'functionalLegacyReviewInvalid');
  for(const id of legacy.requiredSourceIds){assert(known.has(id)&&!exclude.has(id),'functionalRequiredLegacySourceExcluded');include.add(id);}
 }
 const decisions=[...include].map(sourceId=>({sourceId,disposition:'include',reason})).concat([...exclude].map(sourceId=>({sourceId,disposition:'exclude',reason}))).sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
 const selection={schemaVersion:'dnd-upstream-functional-source-selection.v1',corpusFingerprint:draft.fingerprint,decisions};
 const scope=selectFunctionalCorpus(draft,selection);
 return {selection,scope,requiredLegacySources:legacy?.requiredSourceIds.length??null,selectionStatus:scope.counts.pending?'partial':'allSourcesDecided',executable:false};
}
function run(args){
 const [draftPath,policyPath,outPath,historyPath]=args;
 assert(args.length===3||args.length===4,'Usage: node functional-scope.js CORPUS_JSON POLICY_JSON OUT_JSON [HISTORICAL_JSON]');
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const draft=read(draftPath),legacy=historyPath?reconcileFunctionalLegacySources(draft,read(historyPath)):undefined;
 const result=prepareFunctionalSelection(draft,read(policyPath),legacy);
 const root=fs.realpathSync(path.resolve(__dirname,'../..')),parent=fs.realpathSync(path.dirname(path.resolve(outPath))),rel=path.relative(root,parent);
 assert(rel&&(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)),'functionalScopeOutputMustBeOutsideRepository');
 fs.writeFileSync(path.join(parent,path.basename(outPath)),JSON.stringify({...result,...(legacy?{legacy}: {})},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({counts:result.scope.counts,selectionStatus:result.selectionStatus,requiredLegacySources:result.requiredLegacySources,legacyPending:legacy?.pending,executable:false}));
}
module.exports={reconcileFunctionalLegacySources,prepareFunctionalSelection};
if(require.main===module){try{run(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
