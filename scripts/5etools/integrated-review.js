'use strict';
// Consolidation only: evidence is neither a content import nor runtime authorization.
const {createHash}=require('node:crypto');
const {collect,audit}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {scopeFor}=require('./coverage-baseline');
const {createReferenceIndex,extractReferences}=require('./reference-index');
const {previewPrecedence}=require('./precedence-policy');
const {buildVariantReport}=require('./variant-lineage');
const {buildTagReport}=require('./tag-uid-preview');
const {buildSemanticReport}=require('./semantic-eligibility');
const {buildResourceReport}=require('./resource-spellcasting-preview');
const {buildEffectReport}=require('./effect-damage-preview');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const coord=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const sourceOf=r=>typeof r.entity?.source==='string'&&r.entity.source.trim()?r.entity.source:
  r.kind==='magicvariant'&&typeof r.entity?.inherits?.source==='string'&&r.entity.inherits.source.trim()?r.entity.inherits.source:null;
const sha=x=>createHash('sha256').update(x).digest('hex');
function canonical(x){
  if(Array.isArray(x))return x.map(v=>v===undefined?null:canonical(v));
  if(rec(x))return Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])]));
  return x;
}
const digest=x=>sha(JSON.stringify(canonical(x)));
const knownEra=x=>['2014','2024'].includes(x);
function compatibility(from,to){
  if(!from||!to)return 'endpointNotEmitted';
  if(from.provenance.origin!==to.provenance.origin)return 'namespaceReviewRequired';
  if(!knownEra(from.source.rulesEra)||!knownEra(to.source.rulesEra))return 'unknownEraReviewRequired';
  return from.source.rulesEra===to.source.rulesEra?'sameEraIdentityOnly':'crossEraReviewRequired';
}
function createLedger({collection,structural,runs,indexPaths,commits,includeDetails=false}){
  const raw=new Map(),items=new Map(),rows=new Map(),evidence=new Map(),issues=dict();
  const stages=Object.fromEntries(runs.map(x=>[x.stage,new Set(Object.keys(x.result.counts))]));
  const resolved=new Set(structural.entities.map(coord));
  for(const [list,invalid] of [[collection.records,false],[collection.invalidRecords,true]])for(const r of list){
    if(r.origin!=='main')continue;
    const k=coord(r);
    if(raw.has(k)){bump(issues,'duplicateCoordinate');continue;}
    raw.set(k,r);
    const scope=scopeFor(r,stages,indexPaths);
    rows.set(k,{coordinate:{origin:r.origin,path:r.path,kind:r.kind,index:r.index,blob:r.blob,key:r.key},source:sourceOf(r),
      structural:invalid?'identityInvalid':resolved.has(k)?'structuralResolved':'structuralBlocked',scope:scope.stages.length?'eligible':scope.reason,
      outputIds:[],evidenceIds:[],candidateIds:[]});
  }
  for(const {stage,result} of runs){
    if(result.commit!==commits.main||result.activation!=='review-required')bump(issues,'snapshotOrActivationMismatch');
    for(const pack of result.packs)for(const i of pack.items){
      const p=i.provenance;let kind;
      try{kind=JSON.parse(p.entityKey)[0];}catch{bump(issues,'invalidProvenanceKey');continue;}
      const k=coord({origin:'main',path:p.path,kind,index:p.index}),r=raw.get(k),row=rows.get(k);
      if(!r||r.blob!==p.blob||r.key!==p.entityKey||sourceOf(r)!==p.sourceCode||p.commit!==commits.main||p.origin!=='5etools'||
        i.source.status!=='needsReview'||pack.metadata?.activation!=='review-required'||!scopeFor(r,stages,indexPaths).stages.includes(stage)){
        bump(issues,'outputProvenanceMismatch');continue;
      }
      if(items.has(i.id)){bump(issues,'duplicatePhysicalId');continue;}
      items.set(i.id,{id:i.id,kind:i.kind,source:p.sourceCode,coordinateKey:k,provenance:p,rulesEra:i.source.rulesEra,reviewCodes:i.metadata?.reviewCodes||[],evidenceIds:[],activation:'review-required'});
      row.outputIds.push(i.id);
    }
  }
  function coordinate(c){
    if(!rec(c))return null;
    const r=raw.get(coord(c));
    return r&&r.blob===c.blob&&(r.key===c.key||r.key===undefined&&c.key===undefined)?coord(c):null;
  }
  function add(domain,row,{itemId,rawCoordinate,targetId,candidateId,kind='observation',ordinal}={}){
    const item=itemId===undefined?null:items.get(itemId),k=rawCoordinate===undefined?item?.coordinateKey:coordinate(rawCoordinate);
    if(!k||itemId!==undefined&&!item||item&&item.coordinateKey!==k){bump(issues,'unverifiedEvidenceOrigin');return;}
    if(row.activation!==undefined&&row.activation!=='review-required'){bump(issues,'evidenceActivationMismatch');return;}
    const sourceRow=rows.get(k),target=targetId===undefined?null:items.get(targetId);
    if(targetId!==undefined&&!target&&['resolvedIdentity','defaultIdentityCandidate','explicitSpellCandidate','conditionIdentityCandidate','directContextCandidate','reprintProposed','resolvedBaseStructuralMatch','matchedExistingOutput'].includes(row.status)){
      bump(issues,'unverifiedEvidenceTarget');return;
    }
    const fingerprint=digest({domain,kind,ordinal,commits,coordinate:sourceRow.coordinate,itemId,targetId,candidateId,row});
    const id='review:'+fingerprint;
    if(evidence.has(id)){bump(issues,'duplicateEvidence');return;}
    const e={id,fingerprint,domain,kind,sourceCoordinate:k,...(itemId!==undefined?{itemId}:{}),...(targetId!==undefined?{targetId}:{}),
      ...(candidateId!==undefined?{candidateId}:{}),status:row.status||'structuredObservation',
      ...(row.path!==undefined?{path:row.path}:{}),...(row.start!==undefined?{start:row.start,end:row.end}:{}),
      ...(target?{compatibility:item?compatibility({provenance:item.provenance,source:{rulesEra:item.rulesEra}}, {provenance:target.provenance,source:{rulesEra:target.rulesEra}}):'endpointNotEmitted'}:{}),
      review:'unreviewed',activation:'review-required',...(includeDetails?{detail:row}:{})};
    // For raw-only sources compatibility remains unresolved, rather than guessed from a source code.
    if(!item&&target)e.compatibility='endpointNotEmitted';
    evidence.set(id,e);sourceRow.evidenceIds.push(id);if(item)item.evidenceIds.push(id);
    if(kind==='structuralCandidate')sourceRow.candidateIds.push(id);
    return e;
  }
  return {rows,items,evidence,issues,add,coordinate,commits};
}
// Approval is scoped to one exact evidence fingerprint and both immutable snapshots.
// No decisions can alter IDs, owners, source status, runtime or structural coverage.
function applyDecisions(ledger,decisions=[]){
  const out=[],groups=new Map();
  for(const d of decisions){
    if(!rec(d)||!text(d.evidenceId)){out.push({status:'invalidDecision'});continue;}
    const a=groups.get(d.evidenceId)||[];a.push(d);groups.set(d.evidenceId,a);
  }
  for(const [id,ds] of groups){
    if(ds.length!==1){out.push({evidenceId:id,status:'conflictingDecisions'});continue;}
    const d=ds[0],e=ledger.evidence.get(id);
    let status='recorded';
    if(!e)status='unknownEvidence';
    else if(d.fingerprint!==e.fingerprint||d.mainCommit!==ledger.commits.main||d.homebrewCommit!==ledger.commits.homebrew)status='staleEvidence';
    else if(!['acceptEvidence','rejectEvidence','defer'].includes(d.decision)||d.approved!==true||!text(d.reason)||!text(d.reviewer))status='approvalRequired';
    else e.review=d.decision;
    out.push({evidenceId:id,status,...(status==='recorded'?{decision:d.decision,reason:d.reason,reviewer:d.reviewer}:{})});
  }
  return out;
}
function summarize(ledger,decisionResults){
  const bySource=new Map(),rowStates=dict(),byDomain=dict(),byCompatibility=dict(),byReview=dict(),byDecision=dict();
  for(const r of ledger.rows.values()){
    const state=r.outputIds.length?'emitted':r.scope!=='eligible'?'outsidePilot':r.candidateIds.length?'gapWithStructuralCandidate':r.coordinate.kind==='magicvariant'?'templateNoOutput':'gapWithoutCandidate';
    r.coverageState=state;bump(rowStates,state);
    const k=JSON.stringify([r.source,r.coordinate.kind]);
    if(!bySource.has(k))bySource.set(k,{source:r.source,kind:r.coordinate.kind,rows:0,outputs:0,states:dict(),structural:dict(),scope:dict()});
    const s=bySource.get(k);s.rows++;s.outputs+=r.outputIds.length;bump(s.states,state);bump(s.structural,r.structural);bump(s.scope,r.scope);
  }
  for(const e of ledger.evidence.values()){
    bump(byDomain[e.domain]??=dict(),e.status);bump(byReview,e.review);
    if(e.compatibility)bump(byCompatibility[e.domain]??=dict(),e.compatibility);
  }
  for(const d of decisionResults)bump(byDecision,d.status);
  return {upstreamRows:ledger.rows.size,emittedItems:ledger.items.size,evidenceOccurrences:ledger.evidence.size,rowStates,byDomain,byCompatibility,byReview,byDecision,
    bySourceKind:[...bySource.values()].sort((a,b)=>JSON.stringify([a.source,a.kind]).localeCompare(JSON.stringify([b.source,b.kind]))),issues:ledger.issues};
}
function buildIntegratedReport(main,homebrew,{decisions=[],includeDetails=false,sharedContext}={}){
  const collection=sharedContext?.collection??collect(main,homebrew);
  // Main only, same immutable inputs and converter products for every domain.
  const structural=sharedContext?.structural??audit(main,homebrew,collection),commits={main:main.commit,homebrew:homebrew.commit};
  const runs=sharedContext?.runs??converters.map(c=>({stage:c.stage,result:require('./'+c.module).buildPilot(main)}));
  const items=runs.flatMap(r=>r.result.packs.flatMap(p=>p.items)),records=collection.records;
  const index=sharedContext?.index??createReferenceIndex(records,items);
  const context={collection,records,items,index,runs};
  const indexed=folder=>new Set(Object.values(main.readJson('data/'+folder+'/index.json')).map(p=>'data/'+folder+'/'+p));
  const ledger=createLedger({collection,structural,runs,indexPaths:{spell:indexed('spells'),monster:indexed('bestiary')},commits,includeDetails});
  const attach=(domain,list,key='itemId')=>list.forEach((e,i)=>ledger.add(domain,e,{itemId:e[key],targetId:e.targetId,ordinal:i}));
  for(const i of items){
    const refs=extractReferences(i,index);
    refs.forEach((e,n)=>ledger.add('reference',e,{itemId:i.id,targetId:e.targetId,ordinal:n}));
  }
  const precedence=sharedContext?.precedence??previewPrecedence(items,records);
  precedence.previewItems.forEach((i,n)=>ledger.add('precedence',{status:i.precedence.relation,...i.precedence},{itemId:i.id,ordinal:n}));
  attach('reprintDeclaration',precedence.declarations,'fromId');
  for(const [k,n] of Object.entries(precedence.issues))bump(ledger.issues,'precedence:'+k,n);
  const variants=buildVariantReport(main,homebrew,context);
  for(const [domain,list] of [['externalTemplate',variants.external],['version',variants.versions]]){
    list.forEach((e,i)=>ledger.add(domain,e,{rawCoordinate:e.record,candidateId:e.id,kind:e.status==='structuralPreview'?'structuralCandidate':'observation',ordinal:i}));
  }
  variants.aliases.forEach((a,i)=>{
    if(a.baseOwner&&!ledger.coordinate(a.baseOwner)){bump(ledger.issues,'unverifiedAliasBase');return;}
    ledger.add('ownerAlias',a,{rawCoordinate:a.owner,candidateId:a.ownerId,kind:a.status==='completeAliasCandidate'?'structuralCandidate':'observation',ordinal:i});
    a.grants.forEach((g,n)=>{
      if(g.target&&!ledger.coordinate(g.target)){bump(ledger.issues,'unverifiedAliasTarget');return;}
      ledger.add('aliasGrant',g,{rawCoordinate:a.owner,targetId:g.targetId,candidateId:a.ownerId,ordinal:[i,n]});
    });
  });
  attach('magicVerification',variants.magic);
  variants.magicCandidates.forEach((e,i)=>{
    if(e.base&&!ledger.coordinate(e.base)){bump(ledger.issues,'unverifiedVariantBase');return;}
    ledger.add('magicCandidate',e,{rawCoordinate:e.template||e.base,candidateId:e.candidateId,
      targetId:e.status==='matchedExistingOutput'?e.candidateId:undefined,kind:e.status==='newStructuralCandidate'?'structuralCandidate':'observation',ordinal:i});
  });
  const tags=buildTagReport(main,homebrew,context);
  attach('inline',tags.inline,'fromId');attach('uidRefinement',tags.refinements,'fromId');attach('structuredSpell',tags.structured,'fromId');
  const semantic=buildSemanticReport(main,homebrew,context);
  attach('requirement',semantic.requirements.map(e=>({...e,status:hasPending(e.tree)?'partiallyEvaluable':'fullyEvaluable'})));
  attach('choice',semantic.choices);attach('spellGrant',semantic.spellCandidates,'fromId');
  semantic.grants.forEach((e,i)=>ledger.add('contextualGrant',e,{...(ledger.items.has(e.ownerId)?{itemId:e.ownerId}:{rawCoordinate:e.ownerCoordinate}),targetId:e.targetId,ordinal:i}));
  const resource=buildResourceReport(main,homebrew,context);
  attach('profile',resource.profiles);attach('spellCost',resource.spellCosts,'spellId');attach('resource',resource.resourceEvidence);attach('spellResource',resource.spellResources);
  const effect=buildEffectReport(main,homebrew,context);
  for(const k of ['formulas','damage','scaling','durations','conditions','defenses','conditionDefinitions','saves'])attach('effect:'+k,effect[k]);
  const decisionResults=applyDecisions(ledger,decisions),summary=summarize(ledger,decisionResults);
  return {schemaVersion:'dnd-upstream-integrated-review.v1',commits,summary,rows:[...ledger.rows.values()],items:[...ledger.items.values()],evidence:[...ledger.evidence.values()],decisionResults,
    activation:'review-required',scope:'main row coverage and immutable preview evidence only; acceptance is not activation; no V3 or runtime changes'};
}
function hasPending(n){return !rec(n)||n.op==='pending'||(n.children||[]).some(hasPending);}
function publicSummary(r){
  const {bySourceKind,...summary}=r.summary;
  const priority=bySourceKind.filter(s=>['PHB','XPHB','XMM','EFA','AAG','BAM','LoX','TCE','XDMG'].includes(s.source)).reduce((a,s)=>{
    const v=a[s.source]??={rows:0,outputs:0,gapsWithCandidate:0,gapsWithoutCandidate:0,templateNoOutput:0,outsidePilot:0};
    v.rows+=s.rows;v.outputs+=s.outputs;v.gapsWithCandidate+=s.states.gapWithStructuralCandidate||0;v.gapsWithoutCandidate+=s.states.gapWithoutCandidate||0;v.templateNoOutput+=s.states.templateNoOutput||0;v.outsidePilot+=s.states.outsidePilot||0;return a;
  },dict());
  return {schemaVersion:r.schemaVersion,commits:r.commits,summary:{...summary,priority},activation:r.activation,scope:r.scope};
}
module.exports={digest,compatibility,createLedger,applyDecisions,summarize,buildIntegratedReport,publicSummary};
