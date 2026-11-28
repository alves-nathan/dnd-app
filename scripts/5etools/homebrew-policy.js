'use strict';
// a6.6.1: source/file policy and dependency evidence, not a converter or license grant.
const {collect,audit}=require('./resolver');
const {buildInventory}=require('./inventory');
const {digest}=require('./integrated-review');
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&!!x.trim();
const norm=x=>text(x)?x.trim().toLowerCase():'';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dict=()=>Object.create(null);
const bump=(o,k,n=1)=>o[k]=(o[k]||0)+n;
const coord=r=>JSON.stringify([r.origin,r.path,r.kind,r.index]);
const sourceOf=r=>norm(r.entity?.source)||(r.kind==='magicvariant'?norm(r.entity?.inherits?.source):'');
const validPath=p=>text(p)&&!p.startsWith('/')&&!p.includes('\\')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const sourceId=code=>'upstream:homebrew:source:'+digest(norm(code));
const physicalCandidateId=r=>'upstream:homebrew:'+r.kind+':'+digest(r.key);
const scopeFor=id=>'homebrew-source:'+id;
const result=(status,extra={})=>({status,...extra,activation:'review-required'});
function push(map,k,v){const a=map.get(k)||[];a.push(v);map.set(k,a);}
function readBrewManifest(snapshot){
  const index=snapshot.readJson('_generated/index-sources.json');
  if(!rec(index))throw Error('invalidHomebrewSourceIndex');
  const indexed=new Map(),files=new Map(),issues=dict();
  for(const [code,path] of Object.entries(index)){
    if(!norm(code)||code.trim()!==code||!validPath(path)||!snapshot.files.has(path)){bump(issues,'invalidIndexedSource');continue;}
    push(indexed,norm(code),{code,path});
    if(!files.has(path))files.set(path,{path,blob:snapshot.files.get(path),indexCodes:[],declarations:[],dependencies:[],internalCopies:[],metaIssues:[],properties:[],licenseHints:[]});
    files.get(path).indexCodes.push(code);
  }
  for(const f of files.values()){
    let j;try{j=snapshot.readJson(f.path);}catch{f.metaIssues.push('unreadableFile');continue;}
    if(!rec(j)){f.metaIssues.push('invalidFile');continue;}
    f.properties=Object.entries(j).filter(([k,v])=>!k.startsWith('_')&&Array.isArray(v)).map(([k])=>k).sort();
    const m=j._meta;
    if(!rec(m)){f.metaIssues.push('missingMeta');continue;}
    f.edition=m.edition;
    f.editionCandidate=m.edition==='classic'?'2014':m.edition==='one'?'2024':'unknown';
    // Ingestion/modification timestamps are not publication dates.
    f.addedTimestamp=Number.isSafeInteger(m.dateAdded)&&m.dateAdded>0?m.dateAdded:null;
    f.modifiedTimestamp=Number.isSafeInteger(m.dateLastModified)&&m.dateLastModified>0?m.dateLastModified:null;
    for(const k of ['license','licence','copyright','permissions','rights'])if(own(m,k))f.licenseHints.push({field:k,value:m[k]});
    if(!Array.isArray(m.sources)||!m.sources.length)f.metaIssues.push('missingSourceDeclarations');
    else for(const [i,s] of m.sources.entries()){
      if(!rec(s)||!norm(s.json)||s.json.trim()!==s.json){f.metaIssues.push('invalidSourceDeclaration');continue;}
      const hints=[];
      for(const k of ['license','licence','copyright','permissions','rights'])if(own(s,k))hints.push({field:k,value:s[k]});
      f.declarations.push({index:i,code:s.json,metadata:s,licenseHints:hints});
    }
    for(const field of ['dependencies','includes','otherSources']){
      const v=m[field];
      if(v===undefined)continue;
      if(!rec(v)){f.metaIssues.push('invalidDependencyMap:'+field);continue;}
      for(const [kind,values] of Object.entries(v)){
        if(!text(kind)){f.metaIssues.push('invalidDependencyKind');continue;}
        if(field==='otherSources'){
          if(!rec(values)||Object.entries(values).some(([k,x])=>!norm(k)||!norm(x))){f.metaIssues.push('invalidOtherSources');continue;}
          for(const [code,findWith] of Object.entries(values))f.dependencies.push({field,kind,code,findWith});
        }else{
          if(!Array.isArray(values)||!values.every(x=>norm(x)&&x.trim()===x)){f.metaIssues.push('invalidDependencyList:'+field);continue;}
          for(const code of [...new Set(values)])f.dependencies.push({field,kind,code});
        }
      }
    }
    if(m.internalCopies!==undefined){
      if(Array.isArray(m.internalCopies)&&m.internalCopies.every(text))f.internalCopies=[...new Set(m.internalCopies)];
      else f.metaIssues.push('invalidInternalCopies');
    }
  }
  return {indexed,files,issues};
}
function createPolicy({manifest,collection,structural,inventory,commits,decisions=[]}){
  const {indexed,files}=manifest,issues={...manifest.issues},sources=new Map(),byId=new Map(),byKey=new Map(),mainCodes=new Set(),kindCodes=new Set();
  const declarations=new Map(),mainKinds=new Set();
  const fileIssues=dict();
  for(const f of files.values()){
    for(const issue of f.metaIssues)bump(fileIssues,issue);
    for(const d of f.declarations)push(declarations,norm(d.code),{file:f,declaration:d});
  }
  for(const r of collection.records){
    push(byId,r.id,r);push(byKey,r.key,r);
    if(r.origin==='main'){mainCodes.add(sourceOf(r));mainKinds.add(JSON.stringify([r.kind,sourceOf(r)]));}
    if(r.origin==='homebrew')kindCodes.add(JSON.stringify([r.kind,sourceOf(r),r.path]));
  }
  for(const s of inventory.sources)if(s.origin==='main')mainCodes.add(norm(s.code));
  for(const code of new Set([...indexed.keys(),...declarations.keys()])){
    const idx=indexed.get(code)||[],ds=declarations.get(code)||[];
    const valid=idx.length===1&&ds.length===1&&idx[0].path===ds[0].file.path&&idx[0].code===ds[0].declaration.code;
    const f=valid?ds[0].file:null,d=valid?ds[0].declaration:null,id=sourceId(code);
    const status=idx.length!==1?'indexIdentityPending':ds.length!==1?'declarationIdentityPending':!valid?'indexDeclarationMismatch':'sourceIdentityCandidate';
    const hints=f&&d?[...f.licenseHints,...d.licenseHints]:[];
    const s={id,code,precedenceScope:scopeFor(id),status,indexEntries:idx,declaredAt:ds.map(x=>({path:x.file.path,blob:x.file.blob,index:x.declaration.index,code:x.declaration.code})),
      mainCodeCollision:mainCodes.has(code),editionCandidate:f?.editionCandidate||'unknown',classification:'unclassified',rulesEra:'unknown',
      publication:{precision:'unknown',date:null,year:null,evidence:'publication-not-established'},
      licenseStatus:hints.length?'declarationUnverified':'noDeclarationObserved',rights:'notEstablished',
      distribution:'blocked',activation:'review-required'};
    if(valid){
      s.path=f.path;s.blob=f.blob;s.declarationIndex=d.index;
      s.fingerprint=digest({commits,path:f.path,blob:f.blob,source:d.metadata,metaEdition:f.edition,licenseHints:hints});
      s.licenseHints=hints;s.authorDeclared=Array.isArray(d.metadata.authors)&&d.metadata.authors.some(text);
      s.converterDeclared=Array.isArray(d.metadata.convertedBy)&&d.metadata.convertedBy.some(text);
      s.titleDeclared=text(d.metadata.full);
    }
    sources.set(code,s);
  }
  // Decisions record reviewer evidence. No authorization to redistribute is produced here.
  const decisionResults=[],grouped=new Map();
  for(const d of decisions){
    if(!rec(d)||!text(d.sourceId)){decisionResults.push({status:'invalidDecision'});continue;}
    push(grouped,d.sourceId,d);
  }
  const sourceById=new Map([...sources.values()].map(s=>[s.id,s]));
  for(const [id,list] of grouped){
    if(list.length!==1){decisionResults.push({sourceId:id,status:'conflictingDecisions'});continue;}
    const d=list[0],s=sourceById.get(id);
    let status='recorded';
    if(!s||s.status!=='sourceIdentityCandidate')status='sourceIdentityPending';
    else if(d.fingerprint!==s.fingerprint||d.homebrewCommit!==commits.homebrew||d.mainCommit!==commits.main)status='staleEvidence';
    else if(d.approved!==true||!text(d.reviewer)||!text(d.evidence)||!['homebrew','third-party','official-reproduction'].includes(d.classification)||!['2014','2024','unknown'].includes(d.rulesEra)||
      !['localReviewOnly','rightsNotEstablished'].includes(d.usagePolicy))status='approvalRequired';
    else{
      s.classification=d.classification;s.rulesEra=d.rulesEra;s.rights=d.usagePolicy==='localReviewOnly'?'localReviewDecision':'notEstablished';
      // "official-reproduction" is a quarantine label, never official precedence.
      s.review={reviewer:d.reviewer,evidence:d.evidence,usagePolicy:d.usagePolicy};
    }
    decisionResults.push({sourceId:id,status});
  }
  function dependencyTarget(kind,code){
    const n=norm(code),s=sources.get(n),main=mainCodes.has(n);
    if(s&&main)return result('namespaceCollisionPending');
    if(s){
      if(s.status!=='sourceIdentityCandidate')return result('dependencySourcePending');
      if(!kindCodes.has(JSON.stringify([kind,n,s.path])))return result('dependencyKindNotObserved',{targetSourceId:s.id,targetPath:s.path});
      return result('homebrewDependencyCandidate',{targetSourceId:s.id,targetPath:s.path});
    }
    if(main)return result(mainKinds.has(JSON.stringify([kind,n]))?'mainDependencyCandidate':'mainDependencyKindPending',{targetNamespace:'main'});
    return result('missingDependencySource');
  }
  const dependencies=[],adj=new Map([...files.keys()].map(p=>[p,new Set()]));
  for(const f of files.values())for(const d of f.dependencies){
    const target=dependencyTarget(d.kind,d.code);
    const edge={fromPath:f.path,fromBlob:f.blob,...d,...target};
    dependencies.push(edge);
    if(target.status==='homebrewDependencyCandidate'&&target.targetPath!==f.path)adj.get(f.path).add(target.targetPath);
  }
  // Remove nodes with no dependencies, then their consumers. Residual includes cycles AND dependants.
  const reverse=new Map(),remaining=new Map();
  for(const [p,targets] of adj){remaining.set(p,targets.size);for(const q of targets)push(reverse,q,p);}
  const queue=[...remaining].filter(([,n])=>n===0).map(([p])=>p);
  for(let i=0;i<queue.length;i++)for(const p of reverse.get(queue[i])||[]){
    const n=remaining.get(p)-1;remaining.set(p,n);if(n===0)queue.push(p);
  }
  const cycleOrDependent=new Set([...remaining].filter(([,n])=>n>0).map(([p])=>p));
  const depByPath=new Map();for(const d of dependencies)push(depByPath,d.fromPath,d);
  const fileBlock=new Map();
  for(const f of files.values()){
    const reasons=[...f.metaIssues];
    if(cycleOrDependent.has(f.path))reasons.push('dependencyCycleOrDependent');
    if((depByPath.get(f.path)||[]).some(d=>!['homebrewDependencyCandidate','mainDependencyCandidate'].includes(d.status)))reasons.push('dependencyResolutionPending');
    if(f.dependencies.some(d=>d.field!=='dependencies'))reasons.push('includeOrOtherSourcesMergePending');
    fileBlock.set(f.path,[...new Set(reasons)]);
  }
  // Propagate unresolved metadata along declared file-level dependencies.
  const blocked=[...fileBlock].filter(([,reasons])=>reasons.length).map(([p])=>p);
  const seen=new Set(blocked);
  for(let i=0;i<blocked.length;i++)for(const p of reverse.get(blocked[i])||[]){
    const reasons=fileBlock.get(p);
    if(!reasons.includes('dependencyFilePending'))reasons.push('dependencyFilePending');
    if(!seen.has(p)){seen.add(p);blocked.push(p);}
  }
  const resolved=new Map(structural.entities.map(e=>[coord(e),e]));
  const rows=[],links=[],candidates=new Set();
  function checkLink(from,targetId,relation){
    const matches=byId.get(targetId)||[];
    if(matches.length!==1)return result('targetIdentityPending');
    const target=matches[0],f=files.get(from.path);
    if(from.origin==='main')return result(target.origin==='main'?'mainOnly':'forbiddenMainToHomebrew');
    const collision=(byKey.get(target.key)||[]).some(x=>x.origin!==target.origin);
    const declared=(depByPath.get(from.path)||[]).some(d=>d.field==='dependencies'&&d.kind===target.kind&&norm(d.code)===sourceOf(target)&&
      (target.origin==='main'?d.status==='mainDependencyCandidate':d.status==='homebrewDependencyCandidate'&&d.targetPath===target.path));
    const targetSource=target.origin==='homebrew'?sources.get(sourceOf(target)):null;
    const sourceBlocked=target.origin==='homebrew'&&(targetSource?.status!=='sourceIdentityCandidate'||targetSource.path!==target.path||fileBlock.get(target.path)?.length>0);
    const sameFile=target.origin==='homebrew'&&target.path===from.path;
    let status;
    if(collision)status='namespaceCollisionPending';
    else if(sourceBlocked)status='targetSourcePending';
    else if(!resolved.has(coord(target)))status='targetStructuralPending';
    else if(relation==='copyLineage'&&sameFile&&!f?.internalCopies.includes(target.kind))status='internalCopyDeclarationPending';
    else if(sameFile)status='sameFileCandidate';
    else if(!declared)status='undeclaredDependencyPending';
    else status=target.origin==='main'?'mainLinkCandidate':'homebrewLinkCandidate';
    return result(status,{targetCoordinate:coord(target),targetOrigin:target.origin,targetKey:target.key});
  }
  // Check main direction, then homebrew source membership and resolved copy/owner evidence.
  for(const r of collection.records){
    const entity=resolved.get(coord(r));
    if(r.origin==='main'){
      for(const id of [...(entity?.lineage||[]),...(entity?.references||[]).map(e=>e.target)])
        if((byId.get(id)||[]).some(x=>x.origin==='homebrew'))bump(issues,'forbiddenMainToHomebrew');
      continue;
    }
    const s=sources.get(sourceOf(r)),row={coordinate:coord(r),path:r.path,blob:r.blob,kind:r.kind,key:r.key,sourceId:s?.id,
      identityCollisionWithMain:(byKey.get(r.key)||[]).some(x=>x.origin==='main'),activation:'review-required'};
    const start=links.length;
    if(entity){
      // Only the direct copy edge is attributable to this file's metadata; ancestors
      // have their own direct edges. Still retain ancestry as a separate observation.
      if(entity.lineage.length)links.push({from:row.coordinate,relation:'copyLineage',...checkLink(r,entity.lineage[0],'copyLineage')});
      for(const e of entity.references)links.push({from:row.coordinate,relation:e.relation,...checkLink(r,e.target,e.relation)});
    }
    const reasons=[];
    if(!s||s.status!=='sourceIdentityCandidate'||s.path!==r.path)reasons.push('sourceMembershipPending');
    if(s?.mainCodeCollision||row.identityCollisionWithMain)reasons.push('namespaceCollisionPending');
    if((byId.get(r.id)||[]).length!==1)reasons.push('duplicateIdentity');
    if(!entity)reasons.push('structuralResolutionPending');
    if(fileBlock.get(r.path)?.length)reasons.push('filePolicyPending');
    if(links.slice(start).some(e=>!['sameFileCandidate','mainLinkCandidate','homebrewLinkCandidate'].includes(e.status)))reasons.push('linkPolicyPending');
    row.status=reasons.length?'blocked':'structuralSourceCandidate';row.reasons=reasons;
    if(!reasons.length){row.candidateId=physicalCandidateId(r);if(candidates.has(row.candidateId))bump(issues,'duplicateCandidateId');candidates.add(row.candidateId);}
    rows.push(row);
  }
  for(const r of collection.invalidRecords.filter(r=>r.origin==='homebrew'))rows.push({coordinate:coord(r),path:r.path,blob:r.blob,kind:r.kind,status:'identityInvalid',reasons:['identityInvalid'],activation:'review-required'});
  // Structural policy closure over actual links: a blocked brew target cannot be promoted
  // merely because the resolver had structurally parsed it.
  const rowMap=new Map(rows.map(r=>[r.coordinate,r])),consumers=new Map();
  for(const e of links)if(e.targetOrigin==='homebrew'&&e.targetCoordinate)push(consumers,e.targetCoordinate,e.from);
  const blockedRows=rows.filter(r=>r.status!=='structuralSourceCandidate').map(r=>r.coordinate),seenRows=new Set(blockedRows);
  for(let i=0;i<blockedRows.length;i++)for(const key of consumers.get(blockedRows[i])||[]){
    const row=rowMap.get(key);
    if(!row||seenRows.has(key))continue;
    row.status='blocked';row.reasons.push('blockedPolicyDependency');delete row.candidateId;seenRows.add(key);blockedRows.push(key);
  }
  const sourceCounts=dict(),editionCounts=dict(),licenseCounts=dict(),collisionCounts={sourceCodes:0,entityIdentities:0},rowCounts=dict(),rowReasons=dict(),byKind=dict(),dependencyCounts=dict(),linkCounts=dict(),fileBlockCounts=dict(),decisionCounts=dict();
  for(const s of sources.values()){
    bump(sourceCounts,s.status);bump(editionCounts,s.editionCandidate);bump(licenseCounts,s.licenseStatus);
    if(s.mainCodeCollision)collisionCounts.sourceCodes++;
  }
  for(const r of rows){
    bump(rowCounts,r.status);bump(byKind[r.kind]??=dict(),r.status);
    if(r.identityCollisionWithMain)collisionCounts.entityIdentities++;
    for(const reason of r.reasons)bump(rowReasons,reason);
  }
  for(const e of dependencies)bump(dependencyCounts,e.field+':'+e.status);
  for(const e of links)bump(linkCounts,e.status);
  for(const reasons of fileBlock.values())for(const reason of reasons)bump(fileBlockCounts,reason);
  for(const d of decisionResults)bump(decisionCounts,d.status);
  return {schemaVersion:'dnd-upstream-homebrew-policy.v1',commits,
    sources:[...sources.values()],files:[...files.values()].map(f=>({...f,policyReasons:fileBlock.get(f.path)})),rows,dependencies,links,decisionResults,
    summary:{indexedSources:[...indexed.values()].reduce((n,a)=>n+a.length,0),sourceIdentities:sources.size,files:files.size,sourceCounts,editionCounts,licenseCounts,collisionCounts,
      fileIssues,fileBlockCounts,dependencyCounts,cycleOrDependentFiles:cycleOrDependent.size,rows:rows.length,rowCounts,rowReasons,byKind,linkCounts,decisionCounts,
      distributionAuthorized:0,emitted:0,issues},
    activation:'review-required',scope:'homebrew source and dependency policy; local review candidates only; no V3 output, rights grant or runtime activation'};
}
function buildHomebrewPolicy(main,homebrew,{asOf=new Date().toISOString().slice(0,10),decisions=[]}={}){
  const collection=collect(main,homebrew),structural=audit(main,homebrew,collection),inventory=buildInventory(main,homebrew,asOf);
  return createPolicy({manifest:readBrewManifest(homebrew),collection,structural,inventory,commits:{main:main.commit,homebrew:homebrew.commit},decisions});
}
function publicSummary(r){return {schemaVersion:r.schemaVersion,commits:r.commits,summary:r.summary,activation:r.activation,scope:r.scope};}
module.exports={sourceId,physicalCandidateId,readBrewManifest,createPolicy,buildHomebrewPolicy,publicSummary};
