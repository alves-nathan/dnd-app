import type {CatalogSnapshot,CatalogFilterState} from '../catalog/types';
import type {CatalogConfigurationHistoryEntry} from '../catalog/catalogConfigurationHistory';
import type {CatalogConfigurationCheckpointDocument} from '../storage/catalogFilterPreferences';
import type {ReferenceStatus} from './localInventoryRecoveryReferences';
type Path=readonly (string|number)[];
type Add=(lane:string,path:Path,value:unknown,status:ReferenceStatus)=>void;
export function collectConfigurationHistoryReferences(config:CatalogConfigurationCheckpointDocument,snapshot:CatalogSnapshot,characterIds:ReadonlySet<string>,add:Add){
 const lane='configurationHistory';
 const emit=(path:Path,value:unknown,status:ReferenceStatus)=>{if(value!==undefined&&value!==null)add(lane,path,value,status);};
 const current=(id:string)=>id===snapshot.snapshotId?'present':'unqualified';
 const state=(p:Path,s:CatalogFilterState,sameSnapshot:boolean)=>{
  for(const [field,exists] of [
   ['bookStates',(id:string)=>snapshot.manifest.sourceBooks.includes(id)],
   ['categoryStates',(id:string)=>snapshot.categoryById.has(id)],
   ['entityStates',(id:string)=>snapshot.registry.has(id)]
  ] as const)for(const [id,value] of Object.entries(s[field]))emit([...p,field,id],value,sameSnapshot?(exists(id)?'present':'missing'):'unqualified');
 };
 let visited=0;
 const walk=(entries:readonly CatalogConfigurationHistoryEntry[],prefix:Path,depth:number,local:boolean)=>{
  if(depth>32||visited+entries.length>10000)throw Error('configurationHistoryLimit');
  visited+=entries.length;
  const ids=new Map<string,number>();for(const e of entries)ids.set(e.id,(ids.get(e.id)??0)+1);
  const commit=(id:string):ReferenceStatus=>(ids.get(id)??0)>1?'ambiguous':ids.has(id)?'present':'unqualified';
  entries.forEach((e,i)=>{
   const p=[...prefix,i],same=e.catalogSnapshotId===snapshot.snapshotId;
   emit([...p,'id'],e.id,commit(e.id));
   emit([...p,'revision'],e.revision,Number.isSafeInteger(e.revision)&&e.revision>=0&&(!local||e.revision<=config.revision)?'present':'ownerMismatch');
   emit([...p,'catalogSnapshotId'],e.catalogSnapshotId,current(e.catalogSnapshotId));
   emit([...p,'catalogVersion'],e.catalogVersion,same&&e.catalogVersion!==snapshot.catalogVersion?'ownerMismatch':same?'present':'unqualified');
   if(e.restoredFromCommitId)emit([...p,'restoredFromCommitId'],e.restoredFromCommitId,commit(e.restoredFromCommitId));
   state([...p,'beforeState'],e.beforeState,same);state([...p,'afterState'],e.afterState,same);
   for(const [field,exists] of [
    ['bookIds',(id:string)=>snapshot.manifest.sourceBooks.includes(id)],
    ['categoryIds',(id:string)=>snapshot.categoryById.has(id)],
    ['entityIds',(id:string)=>snapshot.registry.has(id)]
   ] as const)e.changes[field].forEach((id,j)=>emit([...p,'changes',field,j],id,same?(exists(id)?'present':'missing'):'unqualified'));
   for(const field of ['affectedCharacterIds','preventivePlanCharacterIds','obsoletePreventivePlanCharacterIds','preservedPreventivePlanCharacterIds'] as const)e.acknowledgement[field].forEach((id,j)=>emit([...p,'acknowledgement',field,j],id,local&&characterIds.has(id)?'present':'unqualified'));
   emit([...p,'portableRestoreSessionId'],e.portableRestoreSessionId,'unqualified');
   const imported=e.portableImport;
   if(imported){
    const q=[...p,'portableImport'];
    emit([...q,'sourceCatalogSnapshotId'],imported.sourceCatalogSnapshotId,current(imported.sourceCatalogSnapshotId));
    emit([...q,'sourceCatalogVersion'],imported.sourceCatalogVersion,imported.sourceCatalogSnapshotId===snapshot.snapshotId?(imported.sourceCatalogVersion===snapshot.catalogVersion?'present':'ownerMismatch'):'unqualified');
    imported.conflictingCommitIds.forEach((id,j)=>emit([...q,'conflictingCommitIds',j],id,'unqualified'));
    walk(imported.sourceHistory,[...q,'sourceHistory'],depth+1,false);
   }
  });
 };
 walk(config.history,['history'],0,true);
}
