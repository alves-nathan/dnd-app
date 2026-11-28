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

import {useCatalogDistributionStore} from '../store/catalogDistributionStore';
import {useCatalogPublicationStore} from '../store/catalogPublicationStore';
import {useCatalogTransparencyStore} from '../store/catalogTransparencyStore';
import {useCatalogRolloutHealthStore} from '../store/catalogRolloutHealthStore';
import {useCatalogRolloutAggregationStore} from '../store/catalogRolloutAggregationStore';
import {useCatalogOperationalAuditStore} from '../store/catalogOperationalAuditStore';
import {useCatalogOperationalAuthorizationStore} from '../store/catalogOperationalAuthorizationStore';
import {useCatalogOperationalFederationStore} from '../store/catalogOperationalFederationStore';
import {getActiveCompendiumRepositoryKind,getActiveCompendiumObservationIdentity,observeExistingActiveCompendium} from '../storage/activeCompendiumRepository';

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
 const distribution=useCatalogDistributionStore.getState(),distributionReady=useCatalogDistributionStore.persist.hasHydrated();
 const publication=useCatalogPublicationStore.getState(),publicationReady=useCatalogPublicationStore.persist.hasHydrated();
 const transparency=useCatalogTransparencyStore.getState(),transparencyReady=useCatalogTransparencyStore.persist.hasHydrated();
 const rolloutHealth=useCatalogRolloutHealthStore.getState(),rolloutHealthReady=useCatalogRolloutHealthStore.persist.hasHydrated();
 const rolloutAggregation=useCatalogRolloutAggregationStore.getState(),rolloutAggregationReady=useCatalogRolloutAggregationStore.persist.hasHydrated();
 const operationalAudit=useCatalogOperationalAuditStore.getState(),operationalAuditReady=useCatalogOperationalAuditStore.persist.hasHydrated();
 const operationalAuthorization=useCatalogOperationalAuthorizationStore.getState(),operationalAuthorizationReady=useCatalogOperationalAuthorizationStore.persist.hasHydrated();
 const operationalFederation=useCatalogOperationalFederationStore.getState(),operationalFederationReady=useCatalogOperationalFederationStore.persist.hasHydrated();
 const activeBackend=getActiveCompendiumRepositoryKind();
 const blocked=Object.values(distribution.sessions).some(s=>s.status==='downloading')||operationalAuthorization.sessions.some(s=>['prepared','executing','interrupted'].includes(s.status))||compendium.isSaving||compendium.isHydrating||catalog.isSaving||!!catalog.pendingChange||
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
 observations.distribution=distributionReady?{status:'observed',source:'catalogDistributionStore',captureId,value:{policy:distribution.policy,manifests:distribution.manifests,observations:distribution.observations,sessions:distribution.sessions,cachedBundles:distribution.cachedBundles,evidence:distribution.evidence,events:distribution.events}}:{status:'unavailable',source:'catalogDistributionStore',captureId};
 observations.publication=publicationReady?{status:'observed',source:'catalogPublicationStore',captureId,value:{selectedChannel:publication.selectedChannel,cohortId:publication.cohortId,publications:publication.publications,controls:publication.controls,eligibilityEvidence:publication.eligibilityEvidence,events:publication.events}}:{status:'unavailable',source:'catalogPublicationStore',captureId};
 observations.transparency=transparencyReady?{status:'observed',source:'catalogTransparencyStore',captureId,value:{logs:transparency.logs,remoteManifests:transparency.remoteManifests,recoveryPolicies:transparency.recoveryPolicies,importedTrust:transparency.importedTrust,events:transparency.events}}:{status:'unavailable',source:'catalogTransparencyStore',captureId};
 observations.rolloutHealth=rolloutHealthReady?{status:'observed',source:'catalogRolloutHealthStore',captureId,value:{sharingOptIn:rolloutHealth.sharingOptIn,policies:rolloutHealth.policies,directives:rolloutHealth.directives,operationalOverrides:rolloutHealth.operationalOverrides,signals:rolloutHealth.signals,evidence:rolloutHealth.evidence,events:rolloutHealth.events}}:{status:'unavailable',source:'catalogRolloutHealthStore',captureId};
 observations.rolloutAggregation=rolloutAggregationReady?{status:'observed',source:'catalogRolloutAggregationStore',captureId,value:{policies:rolloutAggregation.policies,submissions:rolloutAggregation.submissions,reports:rolloutAggregation.reports,approvals:rolloutAggregation.approvals,decisions:rolloutAggregation.decisions,events:rolloutAggregation.events,contributorSecretPresent:!!rolloutAggregation.contributorSecret}}:{status:'unavailable',source:'catalogRolloutAggregationStore',captureId};
 observations.operationalAudit=operationalAuditReady?{status:'observed',source:'catalogOperationalAuditStore',captureId,value:{importedAudits:operationalAudit.importedAudits,events:operationalAudit.events}}:{status:'unavailable',source:'catalogOperationalAuditStore',captureId};
 observations.operationalAuthorization=operationalAuthorizationReady?{status:'observed',source:'catalogOperationalAuthorizationStore',captureId,value:{authorizations:operationalAuthorization.authorizations,confirmations:operationalAuthorization.confirmations,sessions:operationalAuthorization.sessions,receipts:operationalAuthorization.receipts,events:operationalAuthorization.events,journal:operationalAuthorization.journal,journalArchives:operationalAuthorization.journalArchives,reconciliations:operationalAuthorization.reconciliations,evidence:operationalAuthorization.evidence,recoveryAuthorizations:operationalAuthorization.recoveryAuthorizations,recoveryConfirmations:operationalAuthorization.recoveryConfirmations,recoveryExecutions:operationalAuthorization.recoveryExecutions}}:{status:'unavailable',source:'catalogOperationalAuthorizationStore',captureId};
 observations.operationalFederation=operationalFederationReady?{status:'observed',source:'catalogOperationalFederationStore',captureId,value:{importedFederations:operationalFederation.importedFederations,events:operationalFederation.events}}:{status:'unavailable',source:'catalogOperationalFederationStore',captureId};
 return {guard:[compendium,catalog,characters,scenarios,presets,history,update,restore,trust,...hydrated,distribution,distributionReady,publication,publicationReady,transparency,transparencyReady,rolloutHealth,rolloutHealthReady,rolloutAggregation,rolloutAggregationReady,operationalAudit,operationalAuditReady,operationalAuthorization,operationalAuthorizationReady,operationalFederation,operationalFederationReady,activeBackend,getActiveCompendiumObservationIdentity()],observations,blocked,activeBackend};
}
/** Explicit local call; not yet wired to a screen or startup lifecycle. */
export function observeHydratedLocalInventory(captureId:string){
 return captureLocalInventoryEvidence(captureId,{readStores:readHydratedInventoryStores,storage:asyncStorageAdapter,readActivePersistence:observeExistingActiveCompendium});
}

/** Observe changes without hydrating or calling store actions. The panel
 * invalidates conservatively on every subscribed replacement or hydration. */
export function subscribeLocalInventoryChanges(listener:()=>void):()=>void {
 const unsubscribers=[
  useCompendiumStore.subscribe(listener),
  useCatalogStore.subscribe(listener),
  useCharacterStore.subscribe(listener),
  useCombatScenarioStore.subscribe(listener),
  useBuildPresetStore.subscribe(listener),
  useBuildHistoryStore.subscribe(listener),
  useCatalogUpdateSessionStore.subscribe(listener),
  usePortableRestoreSessionStore.subscribe(listener),
  useCatalogTrustStore.subscribe(listener),
  useCatalogDistributionStore.subscribe(listener),
  useCatalogPublicationStore.subscribe(listener),
  useCatalogTransparencyStore.subscribe(listener),
  useCatalogRolloutHealthStore.subscribe(listener),
  useCatalogRolloutAggregationStore.subscribe(listener),
  useCatalogOperationalAuditStore.subscribe(listener),
  useCatalogOperationalAuthorizationStore.subscribe(listener),
  useCatalogOperationalFederationStore.subscribe(listener),
  useCharacterStore.persist.onHydrate(listener),useCharacterStore.persist.onFinishHydration(listener),
  useCombatScenarioStore.persist.onHydrate(listener),useCombatScenarioStore.persist.onFinishHydration(listener),
  useBuildPresetStore.persist.onHydrate(listener),useBuildPresetStore.persist.onFinishHydration(listener),
  useBuildHistoryStore.persist.onHydrate(listener),useBuildHistoryStore.persist.onFinishHydration(listener),
  useCatalogUpdateSessionStore.persist.onHydrate(listener),useCatalogUpdateSessionStore.persist.onFinishHydration(listener),
  usePortableRestoreSessionStore.persist.onHydrate(listener),usePortableRestoreSessionStore.persist.onFinishHydration(listener),
  useCatalogTrustStore.persist.onHydrate(listener),useCatalogTrustStore.persist.onFinishHydration(listener),
  useCatalogDistributionStore.persist.onHydrate(listener),useCatalogDistributionStore.persist.onFinishHydration(listener),
  useCatalogPublicationStore.persist.onHydrate(listener),useCatalogPublicationStore.persist.onFinishHydration(listener),
  useCatalogTransparencyStore.persist.onHydrate(listener),useCatalogTransparencyStore.persist.onFinishHydration(listener),
  useCatalogRolloutHealthStore.persist.onHydrate(listener),useCatalogRolloutHealthStore.persist.onFinishHydration(listener),
  useCatalogRolloutAggregationStore.persist.onHydrate(listener),useCatalogRolloutAggregationStore.persist.onFinishHydration(listener),
  useCatalogOperationalAuditStore.persist.onHydrate(listener),useCatalogOperationalAuditStore.persist.onFinishHydration(listener),
  useCatalogOperationalAuthorizationStore.persist.onHydrate(listener),useCatalogOperationalAuthorizationStore.persist.onFinishHydration(listener),
  useCatalogOperationalFederationStore.persist.onHydrate(listener),useCatalogOperationalFederationStore.persist.onFinishHydration(listener),
 ];
 return ()=>unsubscribers.forEach(unsubscribe=>unsubscribe());
}
