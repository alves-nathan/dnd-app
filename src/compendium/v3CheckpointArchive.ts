import {sha256Hex,catalogDigestAdapter} from '../catalog/catalogBundleDigest';
import {CatalogLoader} from '../catalog/catalogLoader';
import {parseCharacterDataBackup,CHARACTER_BACKUP_SCHEMA_VERSION} from '../backup/characterBackup';
import {createMemoryKeyValueStorage} from '../storage/keyValueStorage';
import {KeyValueCompendiumRepository} from '../storage/compendiumRepository';
import {COMPENDIUM_PERSISTENCE_VERSION} from '../storage/compendiumSnapshot';
import {fingerprintIndependentCompendiumSnapshot} from '../storage/readOnlyCompendiumObservation';
import {CATALOG_PACKAGE_INDEX_KEY,createCatalogPackageRepository} from '../storage/catalogPackageRepository';
import {observeIndexedPackageContents} from './localInventoryPackageObservation';
import {fingerprintV3PreservationRuntime} from './importV3Preservation';
import {verifyV3CheckpointPayload,type V3CheckpointManifest,type V3CheckpointPayload} from './v3DurableCheckpoint';

const schema='dnd-v3-private-checkpoint-archive.v1' as const;
const flags={activation:'review-required',runtimeEligible:false,writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false,executable:false} as const;
const MAX_ARCHIVE_CHARS=200_000_000;
const hash=(v:unknown)=>sha256Hex(JSON.stringify(v));
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
const same=(a:unknown,b:unknown)=>hash(canonical(a))===hash(canonical(b));
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export interface PrivateCheckpointArchivePort {
 /** Publish a new immutable archive or reject. Never replace another archive. */
 createExclusive:(id:string,text:string)=>Promise<void>;
 /** Independent read of the published archive (not the input buffer). */
 read:(id:string)=>Promise<string|null>;
}
interface Archive {schemaVersion:typeof schema;manifest:V3CheckpointManifest;payload:V3CheckpointPayload}
interface ArchiveReceipt {archiveId:string;archiveFingerprint:string;checkpointFingerprint:string;characterLength:number;status:'readbackVerified';durability:'adapterDependent';executable:false;fingerprint:string}
type ArchiveResult={ok:false;code:string;executable:false}|{ok:true;receipt:ArchiveReceipt;executable:false};
const fail=(code:string)=>({ok:false as const,code,executable:false as const});
const parse=(raw:string,id:string):Archive|null=>{
 try{
  if(!hex(id)||typeof raw!=='string'||raw.length>MAX_ARCHIVE_CHARS||sha256Hex(raw)!==id)return null;
  const a=JSON.parse(raw) as Archive;
  return a.schemaVersion===schema&&verifyV3CheckpointPayload(a.manifest,a.payload)?a:null;
 }catch{return null;}
};
/** Explicit private archive operation only; no writes to active app stores.
 * Port durability and confidentiality are separate requirements. */
export async function writeV3CheckpointArchive(port:PrivateCheckpointArchivePort,manifest:V3CheckpointManifest,payload:V3CheckpointPayload):Promise<ArchiveResult>{
 try{
  if(!verifyV3CheckpointPayload(manifest,payload))return fail('checkpointPayloadInvalid');
  const raw=JSON.stringify({schemaVersion:schema,manifest,payload});
  if(raw.length>MAX_ARCHIVE_CHARS)return fail('checkpointArchiveBudgetExceeded');
  const id=sha256Hex(raw);
  await port.createExclusive(id,raw);
  const actual=await port.read(id);
  if(actual!==raw||!parse(actual,id))return fail('checkpointArchiveReadbackMismatch');
  const body:Omit<ArchiveReceipt,'fingerprint'>={archiveId:id,archiveFingerprint:id,checkpointFingerprint:manifest.fingerprint,characterLength:raw.length,status:'readbackVerified',durability:'adapterDependent',executable:false};
  return {ok:true,receipt:{...body,fingerprint:hash(body)},executable:false};
 }catch{return fail('checkpointArchiveWriteFailed');}
}
export async function readV3CheckpointArchive(port:Pick<PrivateCheckpointArchivePort,'read'>,id:string):Promise<Archive|null>{
 try{if(!hex(id))return null;const raw=await port.read(id);return raw===null?null:parse(raw,id);}catch{return null;}
}
/** Rehearse from reopened archive using fresh disposable stores only.
 * Never inject a production repository or call the live restore executor. */
export async function rehearseV3CheckpointRestore(port:Pick<PrivateCheckpointArchivePort,'read'>,id:string){
 try{
  const archive=await readV3CheckpointArchive(port,id);
  if(!archive)return fail('checkpointArchiveInvalid');
  const {payload:p,manifest:m}=archive;
  const values=createMemoryKeyValueStorage();
  for(const row of p.keyValues)if(row.raw!==null)await values.setItem(row.key,row.raw);
  const present=p.keyValues.filter(r=>r.raw!==null);
  if(Object.keys(values.dump()).length!==present.length)return fail('checkpointRawRestoreMismatch');
  for(const row of p.keyValues)if(await values.getItem(row.key)!==row.raw)return fail('checkpointRawRestoreMismatch');
  // Independent logical compendium copy: the legacy fallback raw envelope
  // remains separate and is never overwritten by the active backend export.
  const exported=JSON.parse(p.compendiumExport);
  if(exported.version!==COMPENDIUM_PERSISTENCE_VERSION)return fail('checkpointCompendiumVersionMismatch');
  const expected=fingerprintIndependentCompendiumSnapshot(exported.state);
  const repository=new KeyValueCompendiumRepository(createMemoryKeyValueStorage());
  const restored=await repository.importSnapshot(p.compendiumExport);
  if(!restored.ok||!same(expected,fingerprintIndependentCompendiumSnapshot(await repository.loadSnapshot()))||
     !same(exported.state,JSON.parse(await repository.exportSnapshot()).state))return fail('checkpointCompendiumRestoreMismatch');
  const backup=parseCharacterDataBackup(p.characterBackup);
  const portable=p.portableCheckpoint;
  if(!backup.ok||!backup.backup||backup.issues.length||backup.backup.schemaVersion!==CHARACTER_BACKUP_SCHEMA_VERSION||
    !same(backup.backup.entities,{characters:portable.characterStore.characters,scenarios:portable.scenarios,buildPresets:portable.buildPresets,buildHistorySnapshots:portable.buildHistorySnapshots}))return fail('checkpointPortableRestoreMismatch');
  // Preserve recovery, drafts and quarantine as a full separate logical copy.
  // This is not a call to the live Zustand restore executor.
  const portableCopy=JSON.parse(JSON.stringify(portable));
  if(hash(portableCopy)!==m.portableFingerprint)return fail('checkpointPortableRestoreMismatch');
  const indexRaw=await values.getItem(CATALOG_PACKAGE_INDEX_KEY);
  const packages=await observeIndexedPackageContents(indexRaw,values);
  if(indexRaw!==null&&packages.status!=='observed')return fail('checkpointRuntimeRestoreMismatch');
  let active=await new CatalogLoader().initializeFromText(p.bundledRuntimeText);
  if(packages.status==='observed'&&packages.active.kind==='stored'){
   const loaded=await createCatalogPackageRepository(values).readPackage(packages.active.packageId);
   active=await new CatalogLoader().initializeFromText(loaded.rawText,{expectedSha256:loaded.descriptor.checksum,digestAdapter:catalogDigestAdapter});
   if(active.snapshotId!==loaded.descriptor.snapshotId)return fail('checkpointRuntimeRestoreMismatch');
  }
  if(fingerprintV3PreservationRuntime(active)!==m.runtimeFingerprint)return fail('checkpointRuntimeRestoreMismatch');
  const body={schemaVersion:'dnd-v3-checkpoint-restore-rehearsal.v1',archiveFingerprint:id,checkpointFingerprint:m.fingerprint,scope:'disposableMemoryOnly',status:'rehearsalVerified',counts:{rawKeys:p.keyValues.length,presentKeys:present.length,compendiumItems:expected.counts.items,characters:portable.characterStore.characters.length,runtimeEntries:active.registry.size},pending:[...m.pending,'productionAdapterRestoreAndNativeDurabilityPending'],...flags};
  return {ok:true as const,report:{...body,fingerprint:hash(body)},executable:false as const};
 }catch{return fail('checkpointRestoreRehearsalFailed');}
}
