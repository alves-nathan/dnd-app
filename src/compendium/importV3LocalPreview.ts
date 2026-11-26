import type { CatalogSnapshot } from '../catalog/types';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { isV3StagingJson } from './importVersion';
import { prepareAdditiveV3Stage } from './importV3AdditiveStage';

export interface LocalV3PreviewContext {
  installed?: CompendiumPersistenceState;
  catalog?: CatalogSnapshot;
  compendiumReady: boolean;
  catalogReady: boolean;
}

export interface LocalV3Preview {
  ok: boolean;
  codes: string[];
  activation: 'review-required';
  writeAuthorized: false;
  distributionAuthorized: false;
  retirementAuthorized: false;
  inventoryScope: 'observedInstalledAndRuntimeOnly';
  summary?: { packId: string; items: number; sources: number; upstreamCommit: string; fingerprint: string };
}

/** Only an aggregate UI model; no raw payload or compatibility projection can
 * be passed from the result to the persistence or share actions. */
export function previewLocalV3File(rawText: string, context: LocalV3PreviewContext): LocalV3Preview {
  const base = {activation:'review-required',writeAuthorized:false,distributionAuthorized:false,
    retirementAuthorized:false,inventoryScope:'observedInstalledAndRuntimeOnly'} as const;
  if (!isV3StagingJson(rawText)) return {...base,ok:false,codes:['notV3Envelope']};
  if (!context.compendiumReady || !context.catalogReady || !context.installed || !context.catalog ||
      context.catalog.validation.status !== 'passed')
    return {...base,ok:false,codes:['localInventoryNotReady']};
  const {installed,catalog} = context;
  const result = prepareAdditiveV3Stage(rawText,{
    installed,runtimeSnapshotId:catalog.snapshotId,runtimeIds:[...catalog.registry.keys()].sort(),
    historicalIds:[...new Set(installed.items.map(i=>i.importItemId))].sort()
  });
  const stage = result.stage;
  return {...base,ok:result.ok,codes:result.codes,...(stage ? {summary:{
    packId:stage.packId,items:stage.itemIds.length,sources:stage.sourceIds.length,
    upstreamCommit:stage.upstreamCommit,fingerprint:stage.fingerprint
  }} : {})};
}
