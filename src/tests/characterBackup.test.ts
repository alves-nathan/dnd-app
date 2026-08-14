import {
  backupToJson,
  createCharacterDataBackup,
  parseCharacterDataBackup,
  restoreCharacterDataBackup,
  summarizeCharacterBackup,
  verifyCharacterBackupIntegrity,
  LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION,
  CHARACTER_BACKUP_SCHEMA_VERSION
} from '../backup/characterBackup';
import { createDefaultCharacter } from '../data/mockData';
import { compareRotationsForScenario, createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createBuildPresetFromCharacter } from '../presets/buildPresets';
import { createBuildHistorySnapshot } from '../history/buildHistory';

const makeEntities = () => {
  const character = createDefaultCharacter('Backup Hero');
  const scenario = createCombatScenario({
    id: 'scenario-1',
    characterId: character.id,
    name: 'CA 15',
    combatState: { targetAC: 15, rollMode: 'normal', targetCount: 1, resistanceMultiplier: 1 }
  });
  const preset = createBuildPresetFromCharacter(character, 'Preset de teste');
  const comparison = compareRotationsForScenario(character.rotations, character, scenario);
  const snapshot = createBuildHistorySnapshot({
    character,
    scenario,
    comparison,
    name: 'Snapshot teste',
    kind: 'manual'
  });
  return { characters: [character], scenarios: [scenario], buildPresets: [preset], buildHistorySnapshots: [snapshot] };
};

describe('character backup', () => {
  it('creates a parseable backup with characters, scenarios, presets and history', () => {
    const backup = createCharacterDataBackup(makeEntities(), { metadata: { name: 'Teste' } });
    const json = backupToJson(backup);
    const parsed = parseCharacterDataBackup(json);

    expect(parsed.ok).toBe(true);
    expect(parsed.backup?.summary.characterCount).toBe(1);
    expect(parsed.backup?.summary.scenarioCount).toBe(1);
    expect(parsed.backup?.summary.buildPresetCount).toBe(1);
    expect(parsed.backup?.summary.buildHistorySnapshotCount).toBe(1);
    expect(summarizeCharacterBackup(backup)).toContain('1 personagem');
  });

  it('supports selected character exports', () => {
    const first = createDefaultCharacter('First');
    const second = createDefaultCharacter('Second');
    const backup = createCharacterDataBackup(
      { characters: [first, second], scenarios: [], buildPresets: [], buildHistorySnapshots: [] },
      { selectedCharacterIds: [second.id] }
    );

    expect(backup.entities.characters).toHaveLength(1);
    expect(backup.entities.characters[0].name).toBe('Second');
  });

  it('merges backups without overwriting existing character ids', () => {
    const current = makeEntities();
    const backup = createCharacterDataBackup(current);
    const result = restoreCharacterDataBackup(current, backup, { mode: 'merge' });

    expect(result.ok).toBe(true);
    expect(result.characters).toHaveLength(2);
    expect(result.imported.characterCount).toBe(1);
    expect(result.characters[1].id).not.toBe(current.characters[0].id);
    expect(result.characters[1].rotations[0].characterId).toBe(result.characters[1].id);
  });

  it('replaces selected app data when requested', () => {
    const current = makeEntities();
    const incomingCharacter = createDefaultCharacter('Incoming');
    const backup = createCharacterDataBackup({ characters: [incomingCharacter], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
    const result = restoreCharacterDataBackup(current, backup, { mode: 'replaceAll' });

    expect(result.ok).toBe(true);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('Incoming');
  });

  it('rejects invalid backup json', () => {
    const parsed = parseCharacterDataBackup('{bad json');
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0].code).toBe('backup.invalidJson');
  });

  it('preserves spellbook, weapon mastery and spell audit collections', () => {
    const character = createDefaultCharacter('Phase 4C');
    character.spellbookEntries = [{
      id: 'book-entry', classEntityId: 'wizard-class', spellItemId: 'shield', spellName: 'Shield', spellLevel: 1,
      acquisition: 'copied', learnedAtCharacterLevel: 3, prepared: false, createdAt: '2026-07-14T00:00:00.000Z'
    }];
    character.weaponMasteries = [{ id: 'mastery-1', sourceKind: 'feat', sourceEntityId: 'feat-1', weaponName: 'Spear', mastery: 'sap' }];
    character.spellChangeTransactions = [{
      id: 'tx-1', characterId: character.id, kind: 'copied', spellItemId: 'shield', spellName: 'Shield',
      source: 'manual', characterLevel: 3, createdAt: '2026-07-14T00:00:00.000Z'
    }];
    const backup = createCharacterDataBackup({ characters: [character], scenarios: [], buildPresets: [], buildHistorySnapshots: [] });
    const parsed = parseCharacterDataBackup(backupToJson(backup));
    expect(parsed.backup?.entities.characters[0]?.spellbookEntries?.[0]?.spellName).toBe('Shield');
    expect(parsed.backup?.entities.characters[0]?.weaponMasteries?.[0]?.mastery).toBe('sap');
    expect(parsed.backup?.entities.characters[0]?.spellChangeTransactions?.[0]?.kind).toBe('copied');
  });

  it('adds and verifies a deterministic integrity checksum', () => {
    const backup = createCharacterDataBackup(makeEntities());
    expect(backup.schemaVersion).toBe(CHARACTER_BACKUP_SCHEMA_VERSION);
    expect(verifyCharacterBackupIntegrity(backup)).toBe(true);

    const tampered = JSON.parse(backupToJson(backup));
    tampered.entities.characters[0].name = 'Alterado fora do app';
    const parsed = parseCharacterDataBackup(JSON.stringify(tampered));

    expect(parsed.ok).toBe(false);
    expect(parsed.issues.some((entry) => entry.code === 'backup.integrityMismatch')).toBe(true);
  });

  it('accepts legacy v1 backups and upgrades them to v2', () => {
    const legacy = JSON.parse(backupToJson(createCharacterDataBackup(makeEntities())));
    legacy.schemaVersion = LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION;
    legacy.app.contractVersion = 1;
    delete legacy.integrity;

    const parsed = parseCharacterDataBackup(JSON.stringify(legacy));

    expect(parsed.ok).toBe(true);
    expect(parsed.backup?.schemaVersion).toBe(CHARACTER_BACKUP_SCHEMA_VERSION);
    expect(parsed.issues.some((entry) => entry.code === 'backup.legacySchema')).toBe(true);
    expect(parsed.backup && verifyCharacterBackupIntegrity(parsed.backup)).toBe(true);
  });

});
