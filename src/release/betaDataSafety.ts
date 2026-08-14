import type { CharacterBackupEntities } from '../backup/characterBackup';
import {
  backupToJson,
  createCharacterDataBackup,
  parseCharacterDataBackup,
  restoreCharacterDataBackup,
  verifyCharacterBackupIntegrity
} from '../backup/characterBackup';
import {
  CHARACTER_STORE_VERSION,
  migrateCharacterStoreState
} from '../storage/characterMigrations';

export interface BetaDataSafetyCheck {
  id: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  details: string;
}

export interface BetaMigrationVersionResult {
  fromVersion: number;
  passed: boolean;
  characterCount: number;
  details: string;
}

export interface BetaDataSafetyReport {
  schemaVersion: 'dnd-combat-beta-data-safety.v1';
  generatedAt: string;
  status: 'passed' | 'failed';
  durationMs: number;
  summary: {
    characterCount: number;
    scenarioCount: number;
    buildPresetCount: number;
    buildHistorySnapshotCount: number;
    testedMigrationVersions: number;
  };
  checks: BetaDataSafetyCheck[];
  migrations: BetaMigrationVersionResult[];
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonicalize(entry);
      return result;
    }, {});
};

const canonicalStringify = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

const check = (
  id: string,
  label: string,
  passed: boolean,
  details: string,
  blocking = true
): BetaDataSafetyCheck => ({ id, label, passed, blocking, details });

const hasCompleteCharacterShape = (character: Record<string, unknown>): boolean => {
  const arrays = [
    'classes',
    'subclasses',
    'feats',
    'featChoices',
    'features',
    'weapons',
    'equipment',
    'magicItems',
    'spells',
    'compendiumLinks',
    'pendingChoices',
    'spellbookEntries',
    'weaponMasteries',
    'spellChangeTransactions',
    'resources',
    'spellSlots',
    'activeEffects',
    'rotations',
    'resourceTransactions',
    'spellSlotTransactions',
    'activeEffectTransactions'
  ];

  if (!arrays.every((key) => Array.isArray(character[key]))) return false;

  const buildChoices = character.buildChoices as Record<string, unknown> | undefined;
  const proficiencies = character.proficiencies as Record<string, unknown> | undefined;

  return Boolean(
    buildChoices &&
    Array.isArray(buildChoices.classSkillChoices) &&
    Array.isArray(buildChoices.classToolChoices) &&
    Array.isArray(buildChoices.expertiseSkills) &&
    Array.isArray(buildChoices.languages) &&
    Array.isArray(buildChoices.equipmentSelections) &&
    buildChoices.spellAssignments &&
    buildChoices.spellbookAssignments &&
    proficiencies &&
    Array.isArray(proficiencies.skills) &&
    Array.isArray(proficiencies.savingThrows)
  );
};

const buildLegacyCharacters = (entities: CharacterBackupEntities): unknown[] =>
  entities.characters.map((character) => ({
    ...character,
    name: character.name || undefined,
    proficiencies: character.proficiencies
      ? { skills: character.proficiencies.skills }
      : undefined,
    buildChoices: character.buildChoices
      ? {
          startingClassItemId: character.buildChoices.startingClassItemId,
          spellAssignments: character.buildChoices.spellAssignments
        }
      : undefined,
    featChoices: undefined,
    pendingChoices: undefined,
    spellbookEntries: undefined,
    weaponMasteries: undefined,
    spellChangeTransactions: undefined,
    currency: undefined,
    activeEffects: undefined,
    resourceTransactions: undefined,
    spellSlotTransactions: undefined,
    activeEffectTransactions: undefined
  }));

const validateReferences = (entities: CharacterBackupEntities): string[] => {
  const problems: string[] = [];
  const characterIds = new Set(entities.characters.map((character) => character.id));

  for (const character of entities.characters) {
    for (const rotation of character.rotations ?? []) {
      if (rotation.characterId !== character.id) {
        problems.push(`rotation:${rotation.id}`);
      }
    }
    for (const link of character.compendiumLinks ?? []) {
      if (link.characterId !== character.id) problems.push(`link:${link.id}`);
    }
  }

  for (const scenario of entities.scenarios) {
    if (!characterIds.has(scenario.characterId)) problems.push(`scenario:${scenario.id}`);
  }

  for (const snapshot of entities.buildHistorySnapshots) {
    if (!characterIds.has(snapshot.characterId)) problems.push(`history:${snapshot.id}`);
  }

  return problems;
};

export const runBetaDataSafetyRehearsal = (
  entities: CharacterBackupEntities,
  now = new Date().toISOString()
): BetaDataSafetyReport => {
  const startedAt = Date.now();
  const checks: BetaDataSafetyCheck[] = [];

  const backup = createCharacterDataBackup(entities, {
    metadata: {
      name: 'Ensaio local da beta',
      description: 'Backup temporário criado para verificar migração, integridade e restauração.'
    }
  });

  checks.push(
    check(
      'backup.integrity',
      'Integridade do backup',
      verifyCharacterBackupIntegrity(backup),
      `Checksum ${backup.integrity?.algorithm ?? '-'}:${backup.integrity?.checksum ?? '-'}`
    )
  );

  const parsed = parseCharacterDataBackup(backupToJson(backup));
  checks.push(
    check(
      'backup.parse',
      'Leitura do backup exportado',
      parsed.ok && Boolean(parsed.backup),
      parsed.issues.length
        ? parsed.issues.map((entry) => `${entry.severity}:${entry.code}`).join(', ')
        : 'Nenhum problema encontrado.'
    )
  );

  const empty: CharacterBackupEntities = {
    characters: [],
    scenarios: [],
    buildPresets: [],
    buildHistorySnapshots: []
  };

  const restored = parsed.backup
    ? restoreCharacterDataBackup(empty, parsed.backup, { mode: 'replaceAll' })
    : undefined;

  checks.push(
    check(
      'backup.restore',
      'Restauração isolada',
      Boolean(restored?.ok),
      restored
        ? `${restored.imported.characterCount} personagem(ns), ${restored.imported.scenarioCount} cenário(s), ${restored.imported.buildPresetCount} preset(s), ${restored.imported.buildHistorySnapshotCount} snapshot(s).`
        : 'A restauração não foi iniciada.'
    )
  );

  const restoredEntities: CharacterBackupEntities = restored
    ? {
        characters: restored.characters,
        scenarios: restored.scenarios,
        buildPresets: restored.buildPresets,
        buildHistorySnapshots: restored.buildHistorySnapshots
      }
    : empty;

  const expectedSemantic = canonicalStringify(backup.entities);
  const restoredBackup = createCharacterDataBackup(restoredEntities);
  const restoredSemantic = canonicalStringify(restoredBackup.entities);

  checks.push(
    check(
      'backup.semanticRoundTrip',
      'Round-trip sem perda semântica',
      expectedSemantic === restoredSemantic,
      expectedSemantic === restoredSemantic
        ? 'As entidades restauradas são equivalentes às entidades exportadas.'
        : 'O conteúdo restaurado difere do conteúdo exportado.'
    )
  );

  const referenceProblems = validateReferences(restoredEntities);
  checks.push(
    check(
      'backup.references',
      'Referências internas após restauração',
      referenceProblems.length === 0,
      referenceProblems.length
        ? `Referências inválidas: ${referenceProblems.slice(0, 10).join(', ')}`
        : 'Rotações, links, cenários e histórico continuam associados aos personagens corretos.'
    )
  );

  const legacyCharacters = buildLegacyCharacters(entities);
  const migrations: BetaMigrationVersionResult[] = [];

  for (let fromVersion = 0; fromVersion <= CHARACTER_STORE_VERSION; fromVersion += 1) {
    const migrated = migrateCharacterStoreState(
      { characters: legacyCharacters },
      fromVersion
    );
    const characters = migrated.characters ?? [];
    const passed =
      characters.length === legacyCharacters.length &&
      characters.every((character) =>
        hasCompleteCharacterShape(character as unknown as Record<string, unknown>)
      );

    migrations.push({
      fromVersion,
      passed,
      characterCount: characters.length,
      details: passed
        ? `Snapshot v${fromVersion} normalizado para v${CHARACTER_STORE_VERSION}.`
        : `Snapshot v${fromVersion} não produziu o shape completo esperado.`
    });
  }

  checks.push(
    check(
      'migration.allVersions',
      'Migração de todas as versões suportadas',
      migrations.every((entry) => entry.passed),
      `${migrations.filter((entry) => entry.passed).length}/${migrations.length} versões aprovadas.`
    )
  );

  const failed = checks.some((entry) => entry.blocking && !entry.passed);

  return {
    schemaVersion: 'dnd-combat-beta-data-safety.v1',
    generatedAt: now,
    status: failed ? 'failed' : 'passed',
    durationMs: Math.max(0, Date.now() - startedAt),
    summary: {
      characterCount: entities.characters.length,
      scenarioCount: entities.scenarios.length,
      buildPresetCount: entities.buildPresets.length,
      buildHistorySnapshotCount: entities.buildHistorySnapshots.length,
      testedMigrationVersions: migrations.length
    },
    checks,
    migrations
  };
};

export const betaDataSafetyReportToJson = (
  report: BetaDataSafetyReport
): string => JSON.stringify(report, null, 2);
