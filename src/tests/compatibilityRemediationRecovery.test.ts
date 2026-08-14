import { createEmptyCharacter } from '../data/mockData';
import { createCompatibilityRemediationPlan } from '../characters/compatibilityRemediation';
import {
  acknowledgeCompatibilityRemediationRecovery,
  reconcileCompatibilityRemediationRecovery
} from '../characters/compatibilityRemediationRecovery';
import { characterProgressionFingerprint } from '../characters/progressionTransaction';

describe('APP-10 compatibility remediation recovery', () => {
  it('recovers, acknowledges and isolates invalid plans without mutating characters', () => {
    const character = { ...createEmptyCharacter('Recovered'), id: 'recovered', catalogSnapshotId: 'snapshot-current' };
    const report = {
      manifest: { currentCatalogSnapshotId: 'snapshot-current' }
    } as never;
    const plan = {
      ...createCompatibilityRemediationPlan({ character, report }),
      baseFingerprint: characterProgressionFingerprint(character)
    };
    const before = JSON.stringify(character);
    const result = reconcileCompatibilityRemediationRecovery({
      characters: [character],
      plans: { [character.id]: plan, invalid: { schemaVersion: 'invalid' } },
      currentCatalogSnapshotId: 'snapshot-current',
      markRecovered: true
    });
    expect(result.summary.pendingAcknowledgementCharacterIds).toContain(character.id);
    expect(Object.values(result.quarantine)).toHaveLength(1);
    const acknowledged = acknowledgeCompatibilityRemediationRecovery(result.summary, character.id);
    expect(acknowledged.pendingAcknowledgementCharacterIds).not.toContain(character.id);
    expect(JSON.stringify(character)).toBe(before);
  });
});
