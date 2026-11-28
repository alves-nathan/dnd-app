import type {captureLocalInventoryEvidence} from './localInventoryCapture';
import type {InventorySurface} from './localInventoryEvidence';

export type LocalInventoryCaptureResult=Awaited<ReturnType<typeof captureLocalInventoryEvidence>>;
export const inventorySurfaceLabels:Record<InventorySurface,string>={
 compendium:'Compêndio carregado',legacyCompendium:'Persistência legada',portable:'Personagens e dados portáteis',
 characterReconciliation:'Reconciliação de personagens',runtime:'Catálogo carregado',packageIndex:'Índice de pacotes',
 packageContents:'Conteúdo dos pacotes',trust:'Registro de confiança',updateSessions:'Sessões de atualização',
 restoreSessions:'Sessões de restauração',distribution:'Distribuição',downloadCache:'Índice de cache',
 publication:'Publicação',transparency:'Transparência',rolloutHealth:'Saúde do rollout',rolloutAggregation:'Agregação do rollout',
 operationalAudit:'Auditoria operacional',operationalAuthorization:'Autorizações operacionais',operationalFederation:'Federação operacional',
 externalPacksAndBackups:'Pacotes e backups externos'
};
export const inventoryStatusLabels={observed:'Observado',notInspected:'Não inspecionado',unavailable:'Indisponível',busy:'Ocupado',invalid:'Inválido',stale:'Desatualizado'} as const;
const captureLabels={stableObservation:'Observação estável no momento da leitura',blocked:'Captura bloqueada por operação pendente',stale:'Estado alterado durante a leitura',unavailable:'Captura indisponível'} as const;
const coherenceLabels:Record<string,string>={notVerified:'Não verificado',storedPackageMatch:'Pacote armazenado correspondente',bundledRefOnly:'Apenas referência bundled',legacySnapshotMatch:'Snapshot legado correspondente',sqliteSnapshotMatch:'Snapshot SQLite correspondente',webSnapshotMatch:'Snapshot IndexedDB correspondente',mismatch:'Divergência detectada'};
export function presentLocalInventory(result:LocalInventoryCaptureResult){
 const {evidence,coherence}=result;
 return {title:captureLabels[result.captureStatus],summary:evidence.summary,
  surfaces:evidence.surfaces.map(s=>({surface:s.surface,label:inventorySurfaceLabels[s.surface],status:inventoryStatusLabels[s.status]})),
  runtimePackage:coherenceLabels[coherence.runtimePackage]??'Não verificado',
  activePersistence:coherenceLabels[coherence.activePersistence]??'Não verificado',
  independentPersistence:coherence.independentPersistence?{backend:coherence.independentPersistence.backend,status:inventoryStatusLabels[coherence.independentPersistence.status],...(coherence.independentPersistence.status==='observed'?{counts:coherence.independentPersistence.counts}:{code:coherence.independentPersistence.code})}:undefined,
  auxiliaryPersistence:coherence.auxiliaryPersistence?.summary,
  packageCode:coherence.packageCode,fingerprint:evidence.fingerprint,
  readiness:'Migração bloqueada',canMigrate:false as const};
}
/** A second explicit read must use the same capture ID. Comparing the
 * evidence and coherence does not grant acceptance or durability. */
export function compareLocalInventoryRevalidation(previous:LocalInventoryCaptureResult,next:LocalInventoryCaptureResult):'unchanged'|'changed'|'unavailable'{
 if(previous.captureStatus!=='stableObservation'||next.captureStatus!=='stableObservation')return 'unavailable';
 return previous.evidence.fingerprint===next.evidence.fingerprint&&
  previous.coherence.runtimePackage===next.coherence.runtimePackage&&previous.coherence.activePersistence===next.coherence.activePersistence&&
  previous.coherence.packageCode===next.coherence.packageCode&&
  JSON.stringify(previous.coherence.independentPersistence)===JSON.stringify(next.coherence.independentPersistence)&&
  previous.coherence.auxiliaryPersistence?.fingerprint===next.coherence.auxiliaryPersistence?.fingerprint?'unchanged':'changed';
}
