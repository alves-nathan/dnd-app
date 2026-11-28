import {sha256Hex,catalogDigestAdapter} from '../catalog/catalogBundleDigest';
import {CatalogLoader} from '../catalog/catalogLoader';
import {COMPENDIUM_STORAGE_KEY} from '../storage/compendiumSnapshot';
import {CATALOG_PACKAGE_INDEX_KEY,catalogPackageChunkKey} from '../storage/catalogPackageRepository';
import {CATALOG_DOWNLOAD_CACHE_INDEX_KEY} from '../storage/catalogDownloadCacheRepository';
import {compareIndependentCompendiumReads,type IndependentCompendiumObservation,type IndependentBackend} from '../storage/readOnlyCompendiumObservation';
import type {KeyValueStorageAdapter} from '../storage/keyValueStorage';
import {AUXILIARY_PERSISTENCE,readAuxiliaryPersistence,reviewAuxiliaryPersistence} from './localInventoryAuxiliaryPersistence';
import {PORTABLE_PERSISTENCE,readPortablePersistence,reviewPortablePersistence} from './localInventoryPortablePersistence';
import {observeIndexedPackageContents,compareLoadedPackage} from './localInventoryPackageObservation';
import {prepareV3PreservationCheckpoint,type V3PreservationInputs} from './importV3Preservation';
import type {LocalInventoryInput} from './localInventoryEvidence';

export const V3_DURABLE_CHECKPOINT_SCHEMA='dnd-v3-durable-checkpoint.v1' as const;
export const V3_CHECKPOINT_FIXED_KEYS=[
 COMPENDIUM_STORAGE_KEY,CATALOG_PACKAGE_INDEX_KEY,CATALOG_DOWNLOAD_CACHE_INDEX_KEY,'dnd-combat-math-beta-feedback',
 ...Object.values(AUXILIARY_PERSISTENCE).map(x=>x.key),...Object.values(PORTABLE_PERSISTENCE).map(x=>x.key)
].sort();
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const MAX_KEYS=4096,MAX_CHARS=100_000_000,MAX_BUNDLE_CHARS=32_000_000;
const appKey=(k:string)=>k.startsWith('@dnd-combat-math/')||k.startsWith('dnd-combat-math-');
const hash=(v:unknown)=>sha256Hex(JSON.stringify(v));
const requireCondition=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
const sameGuard=(a:readonly unknown[],b:readonly unknown[])=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
type RawRow={key:string;raw:string|null};
export interface V3CheckpointReadFrame {
 guard:readonly unknown[];
 blocked:boolean;
 backend:IndependentBackend;
 preservation:V3PreservationInputs;
 /** Auxiliary projections and character reconciliation from the same hydrated frame. */
 observations:LocalInventoryInput['observations'];
}
export interface V3CheckpointReadPorts {
 readFrame:()=>V3CheckpointReadFrame;
 storage:Pick<KeyValueStorageAdapter,'getItem'>&{getAllKeys:()=>Promise<readonly string[]>|readonly string[]};
 observeActiveCompendium:()=>Promise<IndependentCompendiumObservation>;
 /** Exact supplied local asset text; Metro's parsed asset is not original file bytes. */
 readBundledRuntimeText:()=>Promise<string>;
}
export interface V3CheckpointPayload {
 schemaVersion:typeof V3_DURABLE_CHECKPOINT_SCHEMA;
 backend:IndependentBackend;
 compendiumExport:string;
 characterBackup:string;
 portableCheckpoint:V3PreservationInputs['portableCheckpoint'];
 bundledRuntimeText:string;
 keyValues:RawRow[];
}
export interface V3CheckpointManifest {
 schemaVersion:typeof V3_DURABLE_CHECKPOINT_SCHEMA;
 preservationFingerprint:string;
 backend:IndependentBackend;
 compendiumFingerprint:string;
 independentRawFingerprint:string;
 characterBackupFingerprint:string;
 portableFingerprint:string;
 bundledRuntimeFingerprint:string;
 runtimeFingerprint:string;
 keyValuesFingerprint:string;
 keyCount:number;
 presentKeyCount:number;
 missingFixedKeyCount:number;
 auxiliaryMatches:number;
 portableMatches:number;
 packageStatus:string;
 pending:string[];
 activation:'review-required';
 runtimeEligible:false;
 writeAuthorized:false;
 distributionAuthorized:false;
 retirementAuthorized:false;
 executable:false;
 fingerprint:string;
}
type Result={ok:false;code:string;executable:false}|{ok:true;manifest:V3CheckpointManifest;payload:V3CheckpointPayload;executable:false};
async function readRaw(storage:V3CheckpointReadPorts['storage']):Promise<RawRow[]>{
 const listed=await storage.getAllKeys();
 requireCondition(Array.isArray(listed)&&listed.every(k=>typeof k==='string')&&new Set(listed).size===listed.length,'invalidKeyEnumeration');
 const keys=[...new Set([...listed.filter(appKey),...V3_CHECKPOINT_FIXED_KEYS])].sort();
 requireCondition(keys.length<=MAX_KEYS,'checkpointKeyBudgetExceeded');
 const present=new Set(listed),rows:RawRow[]=[];let chars=0;
 for(const key of keys){
  const raw=await storage.getItem(key);
  requireCondition(raw===null||typeof raw==='string','invalidRawValue');
  requireCondition((raw!==null)===present.has(key),'keyEnumerationChanged');
  chars+=raw?.length??0;requireCondition(chars<=MAX_CHARS,'checkpointSizeBudgetExceeded');
  rows.push({key,raw});
 }
 return rows;
}
const asStorage=(rows:RawRow[]):Pick<KeyValueStorageAdapter,'getItem'>=>{
 const map=new Map(rows.map(r=>[r.key,r.raw]));
 return {getItem:key=>map.get(key)??null};
};
const parseIndex=(raw:string)=>JSON.parse(raw) as {packages:Record<string,{id:string;chunkCount:number;checksum:string}>};
const payloadBinding=(p:V3CheckpointPayload)=>({
 compendiumFingerprint:sha256Hex(p.compendiumExport),characterBackupFingerprint:sha256Hex(p.characterBackup),
 portableFingerprint:hash(p.portableCheckpoint),bundledRuntimeFingerprint:sha256Hex(p.bundledRuntimeText),
 // JSON quoting preserves exact UTF-16 chunk boundaries, including split surrogate pairs.
 keyValuesFingerprint:hash(p.keyValues)
});
/** In-memory private checkpoint candidate only. Never persist, log, publish or
 * activate this payload. Two consistent reads are not cross-store atomicity. */
export async function captureV3DurableCheckpoint(ports:V3CheckpointReadPorts):Promise<Result>{
 const fail=(code:string):Result=>({ok:false,code,executable:false});
 try{
  const before=ports.readFrame();
  if(before.blocked)return fail('checkpointCaptureBusy');
  const p=before.preservation,base=prepareV3PreservationCheckpoint(p);
  if(!base.ok||!base.checkpoint)return fail('checkpointPreservationInvalid');
  if(p.compendiumExport.length+p.characterBackup.length>MAX_CHARS)return fail('checkpointSizeBudgetExceeded');
  // Freeze serializable inputs before awaiting reads. Do not retain live store objects.
  const portable:V3CheckpointPayload['portableCheckpoint']=JSON.parse(JSON.stringify(p.portableCheckpoint));
  const first=await ports.observeActiveCompendium();
  const rows=await readRaw(ports.storage),bundled=await ports.readBundledRuntimeText();
  if(typeof bundled!=='string'||!bundled.length||bundled.length>MAX_BUNDLE_CHARS)return fail('bundledRuntimeTextInvalid');
  const storage=asStorage(rows);
  const indexRaw=await storage.getItem(CATALOG_PACKAGE_INDEX_KEY);
  const packages=await observeIndexedPackageContents(indexRaw,storage);
  if(indexRaw!==null&&packages.status!=='observed')return fail('indexedRuntimePackageInvalid');
  const bundledSnapshot=await new CatalogLoader().initializeFromText(bundled);
  let active=bundledSnapshot,packageStatus='bundledAssetSupplied';
  if(packages.status==='observed'){
   const comparison=compareLoadedPackage({snapshot:p.catalog,ref:p.runtimeRef},packages);
   if(p.runtimeRef.kind==='stored'){
    if(comparison!=='storedPackageMatch'||indexRaw===null)return fail('activeRuntimePackageMismatch');
    const d=parseIndex(indexRaw).packages[p.runtimeRef.packageId];
    if(!d)return fail('activeRuntimePackageMismatch');
    const parts:string[]=[];
    for(let i=0;i<d.chunkCount;i++){
     const part=await storage.getItem(catalogPackageChunkKey(d.id,i));
     if(part===null)return fail('indexedRuntimePackageInvalid');parts.push(part);
    }
    active=await new CatalogLoader().initializeFromText(parts.join(''),{expectedSha256:d.checksum,digestAdapter:catalogDigestAdapter});
    packageStatus='storedBytesMatch';
   }else if(comparison!=='bundledRefOnly')return fail('activeRuntimePackageMismatch');
  }else if(p.runtimeRef.kind!=='bundled')return fail('activeRuntimePackageMismatch');
  const rebuilt=prepareV3PreservationCheckpoint({...p,catalog:active});
  if(!rebuilt.ok||rebuilt.checkpoint?.runtimeFingerprint!==base.checkpoint.runtimeFingerprint)return fail('runtimeBytesGraphMismatch');
  const secondRows=await readRaw(ports.storage),bundledAgain=await ports.readBundledRuntimeText();
  const second=await ports.observeActiveCompendium(),after=ports.readFrame();
  const afterBase=prepareV3PreservationCheckpoint(after.preservation);
  if(after.blocked||before.backend!==after.backend||!sameGuard(before.guard,after.guard)||afterBase.checkpoint?.fingerprint!==base.checkpoint.fingerprint||hash(rows)!==hash(secondRows)||bundled!==bundledAgain)return fail('checkpointCaptureStale');
  if(first.backend!==before.backend||second.backend!==before.backend||compareIndependentCompendiumReads(first,second,p.context.installed)!=='snapshotMatch'||second.status!=='observed')return fail('activeCompendiumNotVerified');
  const observations:LocalInventoryInput['observations']={...after.observations,
   portable:{status:'observed',source:'portableDataCheckpoint',captureId:'checkpoint',value:portable},
   runtime:{status:'observed',source:'catalogStore',captureId:'checkpoint',value:{snapshot:p.catalog,ref:p.runtimeRef}}};
  const auxiliary=reviewAuxiliaryPersistence(await readAuxiliaryPersistence(storage),observations);
  const portableReview=reviewPortablePersistence(await readPortablePersistence(storage),observations);
  if(auxiliary.summary.mismatch||portableReview.summary.mismatch)return fail('persistedProjectionMismatch');
  const payload:V3CheckpointPayload={schemaVersion:V3_DURABLE_CHECKPOINT_SCHEMA,backend:before.backend,compendiumExport:p.compendiumExport,characterBackup:p.characterBackup,portableCheckpoint:portable,bundledRuntimeText:bundled,keyValues:rows};
  const binding=payloadBinding(payload),presentKeyCount=rows.filter(r=>r.raw!==null).length;
  const pending=['durableWriteAndReadbackNotVerified','crossStoreAtomicityNotVerified','externalInventoryNotVerified','runtimeTrustNotVerified','productionRestoreNotVerified','downloadCacheSemanticIntegrityNotVerified','bundledAssetOriginalFileProvenanceNotVerified','physicalDatabaseAndOtherNamespacesNotCaptured'];
  if(auxiliary.summary.match!==auxiliary.summary.required)pending.push('auxiliaryProjectionCoveragePending');
  if(portableReview.summary.match!==portableReview.summary.required||portableReview.rows.some(r=>r.timestampComparison==='notObserved'))pending.push('portableProjectionCoveragePending');
  if(indexRaw===null)pending.push('packageIndexAbsent');
  const body:Omit<V3CheckpointManifest,'fingerprint'>={schemaVersion:V3_DURABLE_CHECKPOINT_SCHEMA,preservationFingerprint:base.checkpoint.fingerprint,backend:before.backend,...binding,independentRawFingerprint:second.rawFingerprint,runtimeFingerprint:base.checkpoint.runtimeFingerprint,keyCount:rows.length,presentKeyCount,missingFixedKeyCount:rows.length-presentKeyCount,auxiliaryMatches:auxiliary.summary.match,portableMatches:portableReview.summary.match,packageStatus,pending,...flags};
  return {ok:true,manifest:{...body,fingerprint:hash(body)},payload,executable:false};
 }catch{return fail('checkpointCaptureFailed');}
}
/** Integrity only; the manifest is not an authenticity or restore authorization. */
export function verifyV3CheckpointPayload(manifest:V3CheckpointManifest,payload:V3CheckpointPayload):boolean{
 try{
  const {fingerprint,...body}=manifest;
  const keys=payload.keyValues.map(r=>r.key),binding=payloadBinding(payload);
  return manifest.schemaVersion===V3_DURABLE_CHECKPOINT_SCHEMA&&payload.schemaVersion===V3_DURABLE_CHECKPOINT_SCHEMA&&manifest.backend===payload.backend&&
   Object.entries(flags).every(([k,v])=>manifest[k as keyof V3CheckpointManifest]===v)&&hash(body)===fingerprint&&
   keys.length===new Set(keys).size&&keys.every((k,i)=>appKey(k)&&(i===0||keys[i-1]<k))&&V3_CHECKPOINT_FIXED_KEYS.every(k=>keys.includes(k))&&
   payload.keyValues.every(r=>r.raw===null||typeof r.raw==='string')&&manifest.keyCount===keys.length&&manifest.presentKeyCount===payload.keyValues.filter(r=>r.raw!==null).length&&manifest.missingFixedKeyCount===manifest.keyCount-manifest.presentKeyCount&&
   Object.entries(binding).every(([k,v])=>manifest[k as keyof V3CheckpointManifest]===v);
 }catch{return false;}
}
