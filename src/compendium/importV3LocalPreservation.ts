import type { PortableRestoreDataCheckpoint } from '../backup/portableRestoreSession';
import type { CatalogRuntimePackageRef } from '../storage/catalogPackageRepository';
import { observedV3StageContext, type LocalV3PreviewContext } from './importV3LocalPreview';
import { prepareAdditiveV3Stage } from './importV3AdditiveStage';
import { prepareV3PreservationCheckpoint, type V3PreservationCheckpoint } from './importV3Preservation';

export const MAX_LOCAL_PRESERVATION_BACKUP_CHARS = 25_000_000;

export interface LocalV3PreservationInput {
  rawText: string;
  expectedStageFingerprint: string;
  context: LocalV3PreviewContext;
  portableReady: boolean;
  portableCheckpoint?: PortableRestoreDataCheckpoint;
  runtimeRef: CatalogRuntimePackageRef;
  compendiumExport: string;
  characterBackup: string;
}

export interface LocalV3PreservationEvidence {
  ok: boolean;
  codes: string[];
  executable: false;
  activation: 'review-required';
  writeAuthorized: false;
  distributionAuthorized: false;
  retirementAuthorized: false;
  checkpoint?: V3PreservationCheckpoint;
}

/** Read-only comparison of user-selected exports against currently observed
 * state. Does not certify storage durability, backups outside this device,
 * completeness of historical inventory or restore on the production backend. */
export function verifyLocalV3Preservation(input: LocalV3PreservationInput): LocalV3PreservationEvidence {
  const base = {executable:false,activation:'review-required',writeAuthorized:false,
    distributionAuthorized:false,retirementAuthorized:false} as const;
  const fail = (...codes: string[]): LocalV3PreservationEvidence => ({...base,ok:false,codes});
  try {
    if (!input.portableReady || !input.portableCheckpoint) return fail('portableInventoryNotReady');
    const context = observedV3StageContext(input.context);
    if (!context || !input.context.catalog) return fail('localInventoryNotReady');
    const stage = prepareAdditiveV3Stage(input.rawText,context).stage;
    if (!stage || stage.fingerprint !== input.expectedStageFingerprint) return fail('staleOrInvalidStage');
    if ([input.compendiumExport,input.characterBackup].some(text =>
      typeof text !== 'string' || !text.trim() || text.length > MAX_LOCAL_PRESERVATION_BACKUP_CHARS))
      return fail('backupSizeOrType');
    const result = prepareV3PreservationCheckpoint({
      stage,context,portableCheckpoint:input.portableCheckpoint,catalog:input.context.catalog,
      runtimeRef:input.runtimeRef,compendiumExport:input.compendiumExport,characterBackup:input.characterBackup
    });
    return {...base,...result};
  } catch {
    return fail('localPreservationVerificationFailed');
  }
}
