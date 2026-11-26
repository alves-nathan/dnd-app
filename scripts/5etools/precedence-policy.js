'use strict';
// Evidence-based precedence preview; never changes IDs, eligibility or runtime.
const {collect}=require('./resolver');
const {converters}=require('./pilot-coverage');
const {createReferenceIndex,extractReferences}=require('./reference-index');
const dict=()=>Object.create(null);
const bump=(o,k)=>o[k]=(o[k]||0)+1;
const norm=x=>typeof x==='string'?x.trim().toLowerCase():'';
const known=x=>x==='2014'||x==='2024';
const coord=(origin,path,kind,index)=>JSON.stringify([origin,path,kind,index]);
const namespace=i=>i.provenance.origin==='5etools'?'main':i.provenance.origin==='homebrew'?'homebrew':null;
const sameScope=(a,b)=>namespace(a)!==null&&namespace(a)===namespace(b)&&a.source.contentType===b.source.contentType&&
  a.identity.precedenceScope===a.source.precedenceScope&&b.identity.precedenceScope===b.source.precedenceScope&&a.identity.precedenceScope===b.identity.precedenceScope;
const sameIdentity=(a,b)=>sameScope(a,b)&&a.kind===b.kind&&a.identity.canonicalKey===b.identity.canonicalKey;
function interval(p){
  if(!p||!Number.isInteger(p.year)||p.year<1||p.year>9999)return null;
  const year=String(p.year).padStart(4,'0');
  if(p.precision==='day'&&typeof p.date==='string'&&p.date.startsWith(year+'-')&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&!Number.isNaN(Date.parse(p.date))&&new Date(p.date).toISOString().slice(0,10)===p.date)return [p.date,p.date];
  if(p.precision==='month'&&Number.isInteger(p.month)&&p.month>=1&&p.month<=12){
    const month=String(p.month).padStart(2,'0'),end=new Date(Date.UTC(2000+(p.year%400),p.month,0)).getUTCDate();
    return [year+'-'+month+'-01',year+'-'+month+'-'+end];
  }
  if(p.precision==='year')return [year+'-01-01',year+'-12-31'];
  return null;
}
function chronology(newer,older){
  const a=interval(newer.source.publication),b=interval(older.source.publication);
  if(!a||!b)return 'publicationUnknown';
  if(a[0]>b[1])return 'strictlyLater';
  if(a[1]<b[0])return 'publicationReversed';
  return 'publicationOverlap';
}
function parseReprint(raw,kind){
  const text=typeof raw==='string'?raw:raw?.uid;
  if(typeof raw==='object'&&raw!==null&&(raw.tag!==undefined&&raw.tag!==kind))return {status:'crossKindDeclaration'};
  if(typeof text!=='string'||!text.trim()||text.includes('#')||text.includes('{@'))return {status:'unsupportedDeclaration'};
  const p=text.split('|').map(x=>x.trim());
  if(kind==='subclass'&&p.length===4&&p.every(Boolean))return {kind,target:{name:p[0],shortName:p[0],className:p[1],classSource:p[2],source:p[3]}};
  // Subrace and feature UIDs require owner/level rules not established here.
  if(['subrace','classFeature','subclassFeature','magicvariant'].includes(kind))return {status:'ownerOrVariantDeclarationPending'};
  if(p.length!==2||!p.every(Boolean))return {status:'unsupportedDeclaration'};
  return {kind,target:{name:p[0],source:p[1]}};
}
function compatibility(a,b){
  if(!a||!b)return 'endpointMissing';
  if(!sameScope(a,b))return 'scopeReviewRequired';
  if(!known(a.source.rulesEra)||!known(b.source.rulesEra))return 'unknownEraReviewRequired';
  return a.source.rulesEra===b.source.rulesEra?'sameEraIdentityOnly':'crossEraReviewRequired';
}
function previewPrecedence(items,records,decisions=[]){
  const idx=createReferenceIndex(records,items),rawByCoordinate=new Map(records.map(r=>[coord(r.origin,r.path,r.kind,r.index),r]));
  const proposed=new Map(items.map(i=>[i.id,{supersedes:new Set(),reprints:new Set(),coexistsWith:new Set(),basis:new Set(),original:false}]));
  const declarations=[],decisionResults=[],groups=new Map(),issues=dict();
  const groupKey=i=>JSON.stringify([namespace(i),i.source.contentType,i.kind,i.identity.precedenceScope,i.identity.canonicalKey]);
  const pair=(a,b)=>JSON.stringify([a,b].sort());
  const directedPairs=new Set();
  function add(from,to,relation,basis){
    const p=proposed.get(from);
    p[relation].add(to);p.basis.add(basis);
    if(relation!=='coexistsWith')directedPairs.add(pair(from,to));
  }
  for(const i of items){
    if(!namespace(i)||i.identity.precedenceScope!==i.source.precedenceScope){bump(issues,'invalidScope');continue;}
    const g=groupKey(i);if(!groups.has(g))groups.set(g,[]);groups.get(g).push(i);
    const p=i.provenance;let kind;
    try{kind=JSON.parse(p.entityKey)[0];}catch{bump(issues,'invalidProvenanceKey');continue;}
    if(i.metadata?.variantTemplateKey){
      if(i.metadata.upstreamReprintedAs?.length)declarations.push({fromId:i.id,status:'ownerOrVariantDeclarationPending',basis:'generatedVariant'});
      continue;
    }
    const raw=rawByCoordinate.get(coord(namespace(i),p.path,kind,p.index));
    if(!raw||raw.blob!==p.blob||raw.key!==p.entityKey){bump(issues,'provenanceMismatch');continue;}
    // Read the original row, not inherited metadata from merged or resolved payload.
    const refs=raw.entity.reprintedAs;
    if(refs===undefined)continue;
    if(!Array.isArray(refs)){declarations.push({fromId:i.id,status:'unsupportedDeclaration',raw:refs});continue;}
    for(const ref of refs){
      const parsed=parseReprint(ref,kind);
      const entry={fromId:i.id,raw:ref,basis:'upstreamReprintedAs'};
      if(parsed.status){declarations.push({...entry,status:parsed.status});continue;}
      const result=idx.lookup(namespace(i),[parsed.kind],parsed.target);
      if(result.status!=='resolvedIdentity'){declarations.push({...entry,status:result.status});continue;}
      const target=idx.byId.get(result.targetId),relation={...entry,targetId:target.id};
      if(target.id===i.id){declarations.push({...relation,status:'selfDeclaration'});continue;}
      if(!sameIdentity(i,target)){declarations.push({...relation,status:'canonicalOrScopeMismatch'});continue;}
      if(!known(i.source.rulesEra)||!known(target.source.rulesEra)){declarations.push({...relation,status:'unknownEraReviewRequired'});continue;}
      const order=chronology(target,i);
      if(order!=='strictlyLater'){declarations.push({...relation,status:order});continue;}
      // Upstream old -> new; contract new.reprints -> old. Not mechanical equivalence.
      add(target.id,i.id,'reprints','upstreamReprintedAsIdentity');
      declarations.push({...relation,status:'reprintProposed',crossEra:i.source.rulesEra!==target.source.rulesEra});
    }
  }
  // Optional editorial decisions: exact snapshot/physical endpoints, evidence and explicit approval.
  // None are supplied by default, and no declaration is treated as approval.
  for(const d of decisions){
    const from=idx.byId.get(d.fromId),to=idx.byId.get(d.targetId);
    let status='accepted';
    if(d.approved!==true||!norm(d.evidence)||!from||d.fromCommit!==from.provenance.commit||d.fromBlob!==from.provenance.blob)status='approvalOrEvidenceRequired';
    else if(d.relation==='original'){
      if(d.targetId!==undefined)status='unexpectedTarget';
      else if(!known(from.source.rulesEra))status='unknownEraReviewRequired';
      else if(proposed.get(from.id).reprints.size||proposed.get(from.id).supersedes.size)status='conflictingDecision';
      else{proposed.get(from.id).original=true;proposed.get(from.id).basis.add('editorialApproval');}
    }else if(d.relation==='supersedes'){
      if(!to||d.toCommit!==to.provenance.commit||d.toBlob!==to.provenance.blob)status='approvalOrEvidenceRequired';
      else if(from.id===to.id||!sameIdentity(from,to))status='canonicalOrScopeMismatch';
      else if(!known(from.source.rulesEra)||from.source.rulesEra!==to.source.rulesEra)status='crossOrUnknownEraSupersedes';
      else if(chronology(from,to)!=='strictlyLater')status=chronology(from,to);
      else if(proposed.get(from.id).original)status='conflictingDecision';
      else{
        // Explicit reviewed supersedes takes precedence over a reprint on the same pair.
        proposed.get(from.id).reprints.delete(to.id);
        add(from.id,to.id,'supersedes','editorialApproval');
      }
    }else status='unsupportedDecision';
    decisionResults.push({fromId:d.fromId,targetId:d.targetId,relation:d.relation,status,evidence:d.evidence});
  }
  // Same logical key across known eras: retain both. No automatic same-era winner.
  // Explicit reprints already retain both endpoints, so don't duplicate the same pair.
  for(const group of groups.values()){
    const legacy=group.filter(i=>i.source.rulesEra==='2014'),revised=group.filter(i=>i.source.rulesEra==='2024');
    for(const a of legacy)for(const b of revised){
      if(!sameIdentity(a,b)||directedPairs.has(pair(a.id,b.id)))continue;
      add(a.id,b.id,'coexistsWith','crossEraPreservationPolicy');add(b.id,a.id,'coexistsWith','crossEraPreservationPolicy');
    }
  }
  const precedenceById=new Map(),byRelation=dict(),edgeCounts={reprints:0,supersedes:0,coexistsWith:0};
  for(const i of items){
    const p=proposed.get(i.id);
    const reprints=[...p.reprints].sort(),supersedes=[...p.supersedes].sort(),coexistsWith=[...p.coexistsWith].sort();
    const relation=supersedes.length?'supersedes':reprints.length?'reprint':coexistsWith.length?'coexists':p.original?'original':'unresolved';
    const precedence={relation,reprints,supersedes,coexistsWith,basis:[...p.basis].sort().join('+')||'editorialReviewPending'};
    precedenceById.set(i.id,precedence);bump(byRelation,relation);
    for(const k of Object.keys(edgeCounts))edgeCounts[k]+=precedence[k].length;
  }
  // Strict chronology prevents directed cycles. Validate independently with V3 in CI.
  const previewItems=items.map(i=>({...i,precedence:precedenceById.get(i.id)}));
  const declarationsByStatus=dict(),decisionsByStatus=dict(),byCompatibility=dict(),compatibilityByRelation=dict();
  for(const d of declarations)bump(declarationsByStatus,d.status);
  for(const d of decisionResults)bump(decisionsByStatus,d.status);
  const referenceCompatibility=[];
  for(const item of items)for(const e of extractReferences(item,idx)){
    if(e.status!=='resolvedIdentity')continue;
    const status=compatibility(item,idx.byId.get(e.targetId));
    bump(byCompatibility,status);bump(compatibilityByRelation[e.relation]??=dict(),status);
    referenceCompatibility.push({fromId:e.fromId,targetId:e.targetId,relation:e.relation,path:e.path,status,activation:'review-required'});
  }
  return {previewItems,declarations,decisionResults,referenceCompatibility,byRelation,edgeCounts,declarationsByStatus,decisionsByStatus,byCompatibility,compatibilityByRelation,issues,
    activation:'review-required',scope:'precedence preview only; reprint is editorial evidence not mechanical equivalence; no auto replacement or activation'};
}
function buildPrecedenceReport(main,homebrew){
  const {records}=collect(main,homebrew);
  const packs=converters.flatMap(c=>require('./'+c.module).buildPilot(main).packs);
  const items=packs.flatMap(p=>p.items),r=previewPrecedence(items,records);
  return {...r,commits:{main:main.commit,homebrew:homebrew.commit},schemaVersion:'dnd-upstream-precedence-preview.v1',packSource:packs[0].source};
}
function publicSummary(r){
  return {schemaVersion:r.schemaVersion,commits:r.commits,items:r.previewItems.length,byRelation:r.byRelation,edgeCounts:r.edgeCounts,
    declarationsByStatus:r.declarationsByStatus,decisionsByStatus:r.decisionsByStatus,byCompatibility:r.byCompatibility,compatibilityByRelation:r.compatibilityByRelation,issues:r.issues,activation:r.activation,scope:r.scope};
}
module.exports={interval,chronology,parseReprint,compatibility,previewPrecedence,buildPrecedenceReport,publicSummary};
