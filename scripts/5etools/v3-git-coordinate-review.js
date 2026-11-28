'use strict';
// Local, read-only verification of declared immutable source coordinates.
// No conversion, upstream script execution, fetch, or content export.
const {digest}=require('./integrated-review');
const {identity,normalizeIdentity}=require('./resolver');
const {openSnapshot}=require('./inventory');
const repos={'5etools':'5etools-mirror-3/5etools-src',homebrew:'TheGiddyLimit/homebrew'};
const kinds=new Set('class subclass classFeature subclassFeature race subrace background feat spell monster item baseitem itemGroup magicvariant optionalfeature condition disease status action variantrule legendaryGroup reward vehicle trap hazard object psionic charoption facility itemProperty itemType itemMastery language skill sense table tableGroup deck card deity cult boon'.split(' '));
const hash=x=>typeof x==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x);
const pathOk=p=>typeof p==='string'&&p.endsWith('.json')&&!p.includes('\\')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
function reviewGitCoordinates(pack,snapshots){
 assert(pack&&Array.isArray(pack.items),'invalidProvenancePack');
 const cache=new Map(),rows=[];
 for(const [index,item] of pack.items.entries()){
  const p=item.provenance;
  let status='unsupportedOrigin';
  if(p&&Object.prototype.hasOwnProperty.call(repos,p.origin)){
   const s=snapshots[p.origin];
   if(p.repository!==repos[p.origin]||!hash(p.commit)||!hash(p.blob)||!pathOk(p.path)||!Number.isSafeInteger(p.index)||p.index<0)status='invalidCoordinate';
   else if(!s)status='snapshotUnavailable';
   else if(s.commit!==p.commit)status='commitMismatch';
   else if(!s.files.has(p.path))status='pathMissing';
   else if(s.files.get(p.path)!==p.blob)status='blobMismatch';
   else {
    try{
     const key=JSON.parse(p.entityKey),kind=Array.isArray(key)?key[0]:undefined;
     if(!kinds.has(kind))status='unsupportedEntityKey';
     else {
      const cacheKey=JSON.stringify([p.origin,p.commit,p.path]);
      if(!cache.has(cacheKey))cache.set(cacheKey,s.readJson(p.path));
      const data=cache.get(cacheKey),entry=Object.prototype.hasOwnProperty.call(data,kind)&&Array.isArray(data[kind])?data[kind][p.index]:undefined;
      if(!entry)status='entityMissing';
      else {
       const normalized=normalizeIdentity(kind,entry);
       status=normalized.source===p.sourceCode&&identity(kind,normalized)===p.entityKey?'coordinateMatch':'entityIdentityMismatch';
      }
     }
    }catch{status='unreadableOrInvalidEntity';}
   }
  }
  rows.push({index,status,claimFingerprint:digest({id:item.id,kind:item.kind,provenance:p??null})});
 }
 const statuses=rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
 const body={schemaVersion:'dnd-v3-git-coordinate-review.v1',itemOccurrences:rows.length,statuses,claimsFingerprint:digest(rows),snapshotCommits:Object.fromEntries(Object.entries(snapshots).filter(([k,s])=>Object.prototype.hasOwnProperty.call(repos,k)&&s).map(([k,s])=>[k,s.commit])),
  allCoordinatesMatched:rows.length>0&&rows.every(r=>r.status==='coordinateMatch'),payloadEquivalence:'notEstablished',snapshotAuthenticity:'notEstablished',rights:'notEstablished',distributionAuthorized:false,writeAuthorized:false,executable:false};
 return {...body,fingerprint:digest(body)};
}
// Production offline adapter is restricted to exact commits and tracked JSON
// objects via openSnapshot; repository labels are asserted, not authenticated.
function reviewLocalGitCoordinates(pack,roots){
 const snapshots={};
 for(const origin of Object.keys(repos)){
  const commits=new Set(pack.items.filter(i=>i.provenance?.origin===origin).map(i=>i.provenance.commit));
  if(roots[origin]&&commits.size===1&&hash([...commits][0])){
   try{snapshots[origin]=openSnapshot(roots[origin],[...commits][0]);}catch{/* unavailable stays explicit */}
  }
 }
 return reviewGitCoordinates(pack,snapshots);
}
module.exports={reviewGitCoordinates,reviewLocalGitCoordinates};
