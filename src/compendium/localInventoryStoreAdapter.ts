import {captureLocalInventoryEvidence,type InventoryStoreFrame} from './localInventoryCapture';
import type {LocalInventoryInput} from './localInventoryEvidence';
import {asyncStorageAdapter} from '../storage/asyncStorageAdapter';
import {capturePortableRestoreCheckpoint} from '../backup/portableRestoreSessionExecutor';
import {useCompendiumStore} from '../store/compendiumStore';
import {useCatalogStore} from '../store/catalogStore';
import {useCharacterStore} from '../store/characterStore';
import {useCombatScenarioStore} from '../store/combatScenarioStore';
import {useBuildPresetStore} from '../store/buildPresetStore';
import {useBuildHistoryStore} from '../store/buildHistoryStore';
import {useCatalogUpdateSessionStore} from '../store/catalogUpdateSessionStore';
import {usePortableRestoreSessionStore} from '../store/portableRestoreSessionStore';
import {useCatalogTrustStore} from '../store/catalogTrustStore';

const busySession=(status?:string)=>!!status&&['prepared','committing','rollingBack','interrupted','failed'].includes(status);
/** Only synchronous reads of already initialized stores. No hydration, repair,
 * repository factory, or action invocation (except the pure checkpoint reader). */
export function readHydratedInventoryStores(captureId:string):InventoryStoreFrame {
 const compendium=useCompendiumStore.getState(),catalog=useCatalogStore.getState(),characters=useCharacterStore.getState(),
  scenarios=useCombatScenarioStore.getState(),presets=useBuildPresetStore.getState(),history=useBuildHistoryStore.getState(),
  update=useCatalogUpdateSessionStore.getState(),restore=usePortableRestoreSessionStore.getState(),trust=useCatalogTrustStore.getState();
 const hydrated=[useCharacterStore.persist.hasHydrated(),useCombatScenarioStore.persist.hasHydrated(),
  useBuildPresetStore.persist.hasHydrated(),useBuildHistoryStore.persist.hasHydrated(),useCatalogUpdateSessionStore.persist.hasHydrated(),
  usePortableRestoreSessionStore.persist.hasHydrated(),useCatalogTrustStore.persist.hasHydrated()];
 const blocked=compendium.isSaving||compendium.isHydrating||catalog.isSaving||!!catalog.pendingChange||
  !hydrated[4]||!hydrated[5]||busySession(update.activeSession?.status)||busySession(restore.activeSession?.status)||!!restore.activeSession?.recoveryRequired;
 const observations:LocalInventoryInput['observations']={};
 const compendiumReady=compendium.isHydrated&&!compendium.lastStorageError;
 const catalogReady=catalog.status==='ready'&&!!catalog.snapshot&&catalog.initializationIssues.length===0&&!catalog.lastError;
 const portableReady=hydrated.slice(0,4).every(Boolean)&&catalogReady&&!!catalog.filterState;
 observations.compendium=compendiumReady?{status:'observed',source:'activeCompendiumRepository',captureId,value:{
  sources:compendium.sources,packs:compendium.packs,items:compendium.items,enabledSourceIds:compendium.enabledSourceIds
 }}:{status:'unavailable',source:'activeCompendiumRepository',captureId};
 observations.runtime=catalogReady&&catalog.snapshot?{status:'observed',source:'catalogStore',captureId,value:{snapshot:catalog.snapshot,ref:catalog.runtimeRef}}:
  {status:'unavailable',source:'catalogStore',captureId};
 observations.portable=portableReady&&!blocked?{status:'observed',source:'portableDataCheckpoint',captureId,value:capturePortableRestoreCheckpoint()}:
  {status:'unavailable',source:'portableDataCheckpoint',captureId};
 observations.characterReconciliation=hydrated[0]?{status:'observed',source:'characterStore',captureId,value:characters.catalogAwareReconciliation}:
  {status:'unavailable',source:'characterStore',captureId};
 observations.updateSessions=hydrated[4]?{status:'observed',source:'catalogUpdateSessionStore',captureId,value:{activeSession:update.activeSession,history:update.history}}:
  {status:'unavailable',source:'catalogUpdateSessionStore',captureId};
 observations.restoreSessions=hydrated[5]?{status:'observed',source:'portableRestoreSessionStore',captureId,value:{activeSession:restore.activeSession,history:restore.history,archivedSessions:restore.archivedSessions,evidenceRecords:restore.evidenceRecords}}:
  {status:'unavailable',source:'portableRestoreSessionStore',captureId};
 observations.trust=hydrated[6]?{status:'observed',source:'catalogTrustStore',captureId,value:trust.registry}:
  {status:'unavailable',source:'catalogTrustStore',captureId};
 return {guard:[compendium,catalog,characters,scenarios,presets,history,update,restore,trust,...hydrated],observations,blocked};
}
/** Explicit local call; not yet wired to a screen or startup lifecycle. */
export function observeHydratedLocalInventory(captureId:string){
 return captureLocalInventoryEvidence(captureId,{readStores:readHydratedInventoryStores,storage:asyncStorageAdapter});
}
