import {sha256Hex} from '../catalog/catalogBundleDigest';
import {CATALOG_PACKAGE_SCHEMA,catalogPackageChunkKey,catalogPackageByteLength,CATALOG_PACKAGE_CHUNK_SIZE} from '../storage/catalogPackageRepository';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';
import type {RuntimeInventoryValue} from './localInventoryEvidence';

const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const MAX_PACKAGES=64,MAX_CHUNKS=512,MAX_BYTES=32_000_000;
type Descriptor={id:string;catalogVersion:string;snapshotId:string;checksum:string;byteLength:number;chunkCount:number};
type Ref={kind:'bundled'}|{kind:'stored';packageId:string};
type Result={status:'notInspected'|'invalid'|'unavailable';code:string}|{status:'observed';packages:Descriptor[];active:Ref;previous?:Ref;contentsFingerprint:string};
function parseRef(v:unknown,packages:Record<string,unknown>):Ref{
 if(record(v)&&v.kind==='bundled')return {kind:'bundled'};
 if(record(v)&&v.kind==='stored'&&text(v.packageId)&&own(packages,v.packageId))return {kind:'stored',packageId:v.packageId};
 throw Error('invalidPackageRef');
}
/** Strict bounded read of indexed raw package bytes. Not a trust check.
 * Never calls loadIndex (which can synthesize defaults), stage or activate. */
export async function observeIndexedPackageContents(rawIndex:string|null,storage:Pick<KeyValueStorageAdapter,'getItem'>):Promise<Result>{
 if(rawIndex===null)return {status:'notInspected',code:'packageIndexUnavailable'};
 try{
  const index:unknown=JSON.parse(rawIndex);
  if(!record(index)||index.schemaVersion!==CATALOG_PACKAGE_SCHEMA||!record(index.packages))throw Error('invalidPackageIndex');
  const active=parseRef(index.active,index.packages),previous=index.previous===undefined?undefined:parseRef(index.previous,index.packages);
  const descriptors:Descriptor[]=[];
  let bytes=0,chunks=0;
  for(const [id,v] of Object.entries(index.packages)){
   if(!record(v)||v.id!==id||!text(id)||!text(v.catalogVersion)||!text(v.snapshotId)||
    typeof v.checksum!=='string'||!/^[a-f0-9]{64}$/.test(v.checksum)||!positive(v.byteLength)||!positive(v.chunkCount))throw Error('invalidPackageDescriptor');
   bytes+=v.byteLength;chunks+=v.chunkCount;
   descriptors.push({id,catalogVersion:v.catalogVersion,snapshotId:v.snapshotId,checksum:v.checksum,byteLength:v.byteLength,chunkCount:v.chunkCount});
  }
  if(descriptors.length>MAX_PACKAGES||chunks>MAX_CHUNKS||bytes>MAX_BYTES)return {status:'notInspected',code:'packageReadBudgetExceeded'};
  const fingerprints:string[]=[];
  for(const d of descriptors){
   let raw='';
   for(let i=0;i<d.chunkCount;i++){
    let part:string|null;
    try{part=await storage.getItem(catalogPackageChunkKey(d.id,i));}catch{return {status:'unavailable',code:'packageChunkReadFailed'};}
    if(part===null)return {status:'invalid',code:'packageChunkMissing'};
    if(part.length===0||part.length>CATALOG_PACKAGE_CHUNK_SIZE||(i<d.chunkCount-1&&part.length!==CATALOG_PACKAGE_CHUNK_SIZE))return {status:'invalid',code:'packageChunkShapeMismatch'};
    raw+=part;
    if(raw.length>d.byteLength||raw.length>MAX_BYTES)return {status:'invalid',code:'packageLengthMismatch'};
   }
   if(catalogPackageByteLength(raw)!==d.byteLength)return {status:'invalid',code:'packageLengthMismatch'};
   if(sha256Hex(raw)!==d.checksum)return {status:'invalid',code:'packageChecksumMismatch'};
   const bundle:unknown=JSON.parse(raw);
   if(!record(bundle)||bundle.schemaVersion!=='dnd-combat-runtime-bundle.v1'||bundle.catalogVersion!==d.catalogVersion)return {status:'invalid',code:'packageVersionMismatch'};
   fingerprints.push(d.checksum);
  }
  return {status:'observed',packages:descriptors,active,...(previous?{previous}:{}),contentsFingerprint:sha256Hex(JSON.stringify(fingerprints))};
 }catch{return {status:'invalid',code:'invalidPackageContents'};}
}
export function compareLoadedPackage(runtime:RuntimeInventoryValue|undefined,result:Result){
 if(!runtime||result.status!=='observed')return 'notVerified' as const;
 const ref=runtime.ref;
 if(ref.kind!==result.active.kind)return 'mismatch' as const;
 if(ref.kind==='bundled')return 'bundledRefOnly' as const;
 if(result.active.kind!=='stored'||ref.packageId!==result.active.packageId)return 'mismatch' as const;
 const d=result.packages.find(p=>p.id===ref.packageId);
 if(!d||d.catalogVersion!==runtime.snapshot.catalogVersion||d.snapshotId!==runtime.snapshot.snapshotId)return 'mismatch' as const;
 if(!runtime.snapshot.bundleSha256)return 'notVerified' as const;
 return d.checksum===runtime.snapshot.bundleSha256?'storedPackageMatch' as const:'mismatch' as const;
}
