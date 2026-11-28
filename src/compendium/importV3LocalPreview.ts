import type { CatalogSnapshot } from '../catalog/types';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { isV3StagingJson } from './importVersion';
import { prepareAdditiveV3Stage, type AdditiveV3StageContext } from './importV3AdditiveStage';

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
  const stageContext = observedV3StageContext(context);
  if (!stageContext) return {...base,ok:false,codes:['localInventoryNotReady']};
  const result = prepareAdditiveV3Stage(rawText,stageContext);
  const stage = result.stage;
  return {...base,ok:result.ok,codes:result.codes,...(stage ? {summary:{
    packId:stage.packId,items:stage.itemIds.length,sources:stage.sourceIds.length,
    upstreamCommit:stage.upstreamCommit,fingerprint:stage.fingerprint
  }} : {})};
}

/** Both UI probes must bind exactly the same observed inventory and order. */
export function observedV3StageContext(context: LocalV3PreviewContext): AdditiveV3StageContext | undefined {
  if (!context.compendiumReady || !context.catalogReady || !context.installed || !context.catalog ||
      context.catalog.validation.status !== 'passed') return undefined;
  const {installed,catalog} = context;
  return {
    // The preview component and store getSnapshot have different property
    // insertion orders. Construct a fixed envelope before hashing either.
    installed:{sources:installed.sources,packs:installed.packs,items:installed.items,enabledSourceIds:installed.enabledSourceIds},
    runtimeSnapshotId:catalog.snapshotId,runtimeIds:[...catalog.registry.keys()].sort(),
    historicalIds:[...new Set(installed.items.map(i=>i.importItemId))].sort()
  };
}
