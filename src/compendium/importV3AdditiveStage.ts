import { sha256Hex } from '../catalog/catalogBundleDigest';
import type { CompendiumPersistenceState } from '../storage/compendiumSnapshot';
import { stageImportV3 } from './importV3Staging';

export const ADDITIVE_V3_STAGE_SCHEMA = 'dnd-additive-v3-stage.v1' as const;

/** Caller supplies the installed snapshot and IDs from its historical/runtime inventory.
 * This is an observation boundary, not evidence that the inventory is complete or trusted. */
export interface AdditiveV3StageContext {
  installed: CompendiumPersistenceState;
  runtimeSnapshotId: string;
  runtimeIds: readonly string[];
  historicalIds: readonly string[];
}

export interface AdditiveV3Stage {
  schemaVersion: typeof ADDITIVE_V3_STAGE_SCHEMA;
  rawText: string;
  rawFingerprint: string;
  contextFingerprint: string;
  packId: string;
  itemIds: string[];
  sourceIds: string[];
  upstreamCommit: string;
  validationCodes: string[];
  activation: 'review-required';
  writeAuthorized: false;
  distributionAuthorized: false;
  retirementAuthorized: false;
  fingerprint: string;
}

export interface AdditiveV3StageResult {
  ok: boolean;
  codes: string[];
  stage?: AdditiveV3Stage;
}

const fail = (codes: string[]): AdditiveV3StageResult => ({ok:false,codes:[...new Set(codes)].sort()});
const fingerprint = (value: unknown) => sha256Hex(JSON.stringify(value));
const isId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.trim() === id;
const distinct = (ids: readonly string[]) => ids.every(isId) && new Set(ids).size === ids.length;
const mainId = (id: string) => id.startsWith('upstream:main:');

/** A deliberately isolated, single-pack local staging session. Never passes the
 * V2 compatibility projection to an importer, repository or catalog loader. */
export function prepareAdditiveV3Stage(rawText: string, context: AdditiveV3StageContext): AdditiveV3StageResult {
  try {
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > 10_000_000)
      return fail(['stageInputSizeOrType']);
    const {installed, runtimeSnapshotId, runtimeIds, historicalIds} = context;
    if (!isId(runtimeSnapshotId) || !Array.isArray(runtimeIds) || !Array.isArray(historicalIds) ||
        !distinct(runtimeIds) || !distinct(historicalIds)) return fail(['invalidInventory']);
    if (!installed || !Array.isArray(installed.sources) || !Array.isArray(installed.packs) ||
        !Array.isArray(installed.items) || !Array.isArray(installed.enabledSourceIds))
      return fail(['invalidInstalledSnapshot']);
    const sourceIds = installed.sources.map(s => s.id);
    const packIds = installed.packs.map(p => p.id);
    const storageIds = installed.items.map(i => i.id);
    const sources = new Set(sourceIds), packs = new Set(packIds);
    if (!distinct(sourceIds) || !distinct(packIds) || !distinct(storageIds) ||
        !distinct(installed.enabledSourceIds) || installed.enabledSourceIds.some(id => !sources.has(id)) ||
        installed.packs.some(p => !sources.has(p.sourceId)) ||
        installed.items.some(i => !isId(i.importItemId) || !sources.has(i.sourceId) || !packs.has(i.packId) ||
          !['draft','validated','needsReview','disabled'].includes(i.status) ||
          !i.rawJson || !i.normalizedJson || i.rawJson.id !== i.importItemId))
      return fail(['invalidInstalledSnapshot']);

    // Do not satisfy missing references from legacy IDs or from a name lookup.
    const result = stageImportV3(rawText);
    const validationCodes = [...new Set(result.issues.map(i => i.code))].sort();
    if (!result.ok || !('pack' in result) || !result.pack)
      return fail(['canonicalStageInvalid',...validationCodes]);
    const pack = result.pack;
    if (!pack.items.length) return fail(['emptyCandidatePack']);
    const reserved = new Set([...runtimeIds,...historicalIds,...storageIds,
      ...installed.items.map(i => i.importItemId),...sourceIds,...packIds]);
    const codes: string[] = [];
    const candidateSources = new Set([pack.source.id]);
    const candidateItems = new Set<string>();
    const commits = new Set<string>();
    if (!mainId(pack.id) || !mainId(pack.source.id) || pack.source.status !== 'needsReview')
      codes.push('packOutsideMainReviewScope');
    if (reserved.has(pack.id)) codes.push('packIdentityCollision');
    for (const item of pack.items) {
      const p = item.provenance;
      if (!mainId(item.id) || !mainId(item.source.id) || item.source.status !== 'needsReview' ||
          p.origin !== '5etools' || p.repository !== '5etools-mirror-3/5etools-src' ||
          item.source.id !== 'upstream:main:'+p.sourceCode)
        codes.push('itemOutsideMainReviewScope');
      if (p.origin === '5etools') commits.add(p.commit);
      if (reserved.has(item.id) || candidateItems.has(item.id) || item.id === pack.id)
        codes.push('itemIdentityCollision');
      candidateItems.add(item.id);
      candidateSources.add(item.source.id);
    }
    if (commits.size !== 1) codes.push('mixedOrMissingUpstreamCommit');
    for (const id of candidateSources) {
      if (reserved.has(id) || candidateItems.has(id) || id === pack.id) codes.push('sourceIdentityCollision');
    }
    if (codes.length) return fail(codes);
    // Raw bytes remain local, untrusted, and separate from runtime entities.
    // Hashes bind exact serialized context (including manual reviews and disabled state),
    // not mechanical equivalence, signatures, or authorization.
    const body: Omit<AdditiveV3Stage,'fingerprint'> = {
      schemaVersion:ADDITIVE_V3_STAGE_SCHEMA,rawText,rawFingerprint:sha256Hex(rawText),
      contextFingerprint:fingerprint({installed,runtimeSnapshotId,runtimeIds,historicalIds}),
      packId:pack.id,itemIds:[...candidateItems].sort(),sourceIds:[...candidateSources].sort(),
      upstreamCommit:[...commits][0],validationCodes,activation:'review-required',
      writeAuthorized:false,distributionAuthorized:false,retirementAuthorized:false
    };
    return {ok:true,codes:validationCodes,stage:{...body,fingerprint:fingerprint(body)}};
  } catch {
    // Schema projection, malformed local state or fingerprint failures fail closed.
    return fail(['stagePreparationFailed']);
  }
}

/** Recompute from raw bytes and current context; a matching stage remains
 * non-executable. This is a stale/tamper check, not a cryptographic signature. */
export function checkAdditiveV3Stage(stage: AdditiveV3Stage, context: AdditiveV3StageContext): {ok:boolean; executable:false} {
  try {
    const next = prepareAdditiveV3Stage(stage.rawText,context);
    return {ok:!!next.stage && fingerprint(stage) === fingerprint(next.stage),executable:false};
  } catch {
    return {ok:false,executable:false};
  }
}
