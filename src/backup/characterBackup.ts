import type { Character, CombatScenario, BuildHistorySnapshot, RuleValidationIssue, TurnRotation } from '../types';
import type { BuildPreset } from '../presets/buildPresets';
import { createId } from '../utils/id';
import {
  PORTABLE_CATALOG_AUDIT_SCHEMA,
  portableCatalogHistoryChecksum,
  type PortableCatalogAuditSection
} from './portableCatalogBackup';

export const LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION = 'dnd-combat-character-backup.v1';
export const PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION = 'dnd-combat-character-backup.v2';
export const CHARACTER_BACKUP_SCHEMA_VERSION = 'dnd-combat-character-backup.v3';
export const CHARACTER_BACKUP_CHECKSUM_ALGORITHM = 'fnv1a32';

export interface CharacterBackupEntities {
  characters: Character[];
  scenarios: CombatScenario[];
  buildPresets: BuildPreset[];
  buildHistorySnapshots: BuildHistorySnapshot[];
}

export interface CharacterBackupMetadata {
  name?: string;
  description?: string;
  exportedBy?: string;
  notes?: string;
}

export interface CharacterBackupIntegrity {
  algorithm: typeof CHARACTER_BACKUP_CHECKSUM_ALGORITHM;
  checksum: string;
}

export interface CharacterBackupPayload {
  schemaVersion: typeof CHARACTER_BACKUP_SCHEMA_VERSION | typeof PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION | typeof LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  app: {
    name: 'dnd-combat-math-mvp';
    backupKind: 'characters-and-builds' | 'portable-user-data';
    contractVersion: 1 | 2 | 3;
  };
  metadata?: CharacterBackupMetadata;
  integrity?: CharacterBackupIntegrity;
  summary: {
    characterCount: number;
    scenarioCount: number;
    buildPresetCount: number;
    buildHistorySnapshotCount: number;
    characterIds: string[];
    catalogAuditIncluded?: boolean;
    catalogHistoryCommitCount?: number;
    remediationPlanCount?: number;
  };
  entities: CharacterBackupEntities;
  catalogAudit?: PortableCatalogAuditSection;
}

export interface CharacterBackupCreateOptions {
  metadata?: CharacterBackupMetadata;
  selectedCharacterIds?: string[];
  includeCharacters?: boolean;
  includeScenarios?: boolean;
  includeBuildPresets?: boolean;
  includeBuildHistory?: boolean;
  catalogAudit?: PortableCatalogAuditSection;
}

export interface CharacterBackupParseResult {
  ok: boolean;
  issues: RuleValidationIssue[];
  backup?: CharacterBackupPayload;
}

export interface CharacterBackupRestoreOptions {
  mode: 'merge' | 'replaceAll';
  includeCharacters?: boolean;
  includeScenarios?: boolean;
  includeBuildPresets?: boolean;
  includeBuildHistory?: boolean;
}

export interface CharacterBackupRestoreResult {
  ok: boolean;
  issues: RuleValidationIssue[];
  characters: Character[];
  scenarios: CombatScenario[];
  buildPresets: BuildPreset[];
  buildHistorySnapshots: BuildHistorySnapshot[];
  imported: {
    characterCount: number;
    scenarioCount: number;
    buildPresetCount: number;
    buildHistorySnapshotCount: number;
  };
  idMap: Record<string, string>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

const canonicalStringify = (value: unknown): string => JSON.stringify(canonicalize(value));

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const backupContentForIntegrity = (backup: Omit<CharacterBackupPayload, 'integrity'> | CharacterBackupPayload) => ({
  schemaVersion: backup.schemaVersion,
  exportedAt: backup.exportedAt,
  app: backup.app,
  metadata: backup.metadata,
  summary: backup.summary,
  entities: backup.entities,
  catalogAudit: backup.catalogAudit
});

export const createCharacterBackupIntegrity = (
  backup: Omit<CharacterBackupPayload, 'integrity'> | CharacterBackupPayload
): CharacterBackupIntegrity => ({
  algorithm: CHARACTER_BACKUP_CHECKSUM_ALGORITHM,
  checksum: fnv1a32(canonicalStringify(backupContentForIntegrity(backup)))
});

export const verifyCharacterBackupIntegrity = (backup: CharacterBackupPayload): boolean => {
  if (backup.schemaVersion === LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION) return true;
  if (backup.integrity?.algorithm !== CHARACTER_BACKUP_CHECKSUM_ALGORITHM) return false;
  return backup.integrity.checksum === createCharacterBackupIntegrity(backup).checksum;
};

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const selectedSet = (ids?: string[]): Set<string> | undefined => {
  const list = ids?.map((id) => id.trim()).filter(Boolean) ?? [];
  return list.length ? new Set(list) : undefined;
};

const normalizeRotationCharacterIds = (rotations: TurnRotation[] | undefined, characterId: string): TurnRotation[] =>
  (rotations ?? []).map((rotation) => ({
    ...rotation,
    characterId
  }));

const normalizeCharacter = (character: Character): Character => ({
  ...character,
  rotations: normalizeRotationCharacterIds(character.rotations, character.id),
  resources: character.resources ?? [],
  spellSlots: character.spellSlots ?? [],
  activeEffects: character.activeEffects ?? [],
  equipment: character.equipment ?? [],
  magicItems: character.magicItems ?? [],
  feats: character.feats ?? [],
  featChoices: character.featChoices ?? [],
  buildChoices: character.buildChoices ?? { speciesChoices: [], classSkillChoices: [], classToolChoices: [], expertiseSkills: [], languages: [], spellAssignments: {}, spellbookAssignments: {}, equipmentSelections: [], eldritchInvocationCounts: {}, eldritchInvocationChoices: [] },
  pendingChoices: character.pendingChoices ?? [],
  spellbookEntries: character.spellbookEntries ?? [],
  weaponMasteries: character.weaponMasteries ?? [],
  spellChangeTransactions: character.spellChangeTransactions ?? [],
  currency: character.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  spells: character.spells ?? [],
  features: character.features ?? [],
  weapons: character.weapons ?? [],
  classes: character.classes ?? [],
  subclasses: character.subclasses ?? [],
  compendiumLinks: character.compendiumLinks ?? [],
  resourceTransactions: character.resourceTransactions ?? [],
  abilityUseTransactions: character.abilityUseTransactions ?? [],
  spellSlotTransactions: character.spellSlotTransactions ?? [],
  activeEffectTransactions: character.activeEffectTransactions ?? []
});

export const createCharacterDataBackup = (
  entities: CharacterBackupEntities,
  options: CharacterBackupCreateOptions = {}
): CharacterBackupPayload => {
  const selectedIds = selectedSet(options.selectedCharacterIds);
  const includeCharacters = options.includeCharacters !== false;
  const includeScenarios = options.includeScenarios !== false;
  const includeBuildPresets = options.includeBuildPresets !== false;
  const includeBuildHistory = options.includeBuildHistory !== false;

  const characters = includeCharacters
    ? entities.characters.filter((character) => !selectedIds || selectedIds.has(character.id)).map((character) => normalizeCharacter(clone(character)))
    : [];
  const characterIds = new Set(characters.map((character) => character.id));
  const scenarios = includeScenarios
    ? entities.scenarios.filter((scenario) => !selectedIds || characterIds.has(scenario.characterId)).map(clone)
    : [];
  const buildHistorySnapshots = includeBuildHistory
    ? entities.buildHistorySnapshots.filter((snapshot) => !selectedIds || characterIds.has(snapshot.characterId)).map(clone)
    : [];
  const buildPresets = includeBuildPresets ? entities.buildPresets.map(clone) : [];

  const backup: Omit<CharacterBackupPayload, 'integrity'> = {
    schemaVersion: CHARACTER_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: {
      name: 'dnd-combat-math-mvp',
      backupKind: options.catalogAudit ? 'portable-user-data' : 'characters-and-builds',
      contractVersion: 3
    },
    metadata: options.metadata,
    summary: {
      characterCount: characters.length,
      scenarioCount: scenarios.length,
      buildPresetCount: buildPresets.length,
      buildHistorySnapshotCount: buildHistorySnapshots.length,
      characterIds: Array.from(characterIds),
      catalogAuditIncluded: Boolean(options.catalogAudit),
      catalogHistoryCommitCount: options.catalogAudit?.history.length ?? 0,
      remediationPlanCount: options.catalogAudit?.remediationPlans.length ?? 0
    },
    catalogAudit: options.catalogAudit ? clone(options.catalogAudit) : undefined,
    entities: {
      characters,
      scenarios,
      buildPresets,
      buildHistorySnapshots
    }
  };

  return { ...backup, integrity: createCharacterBackupIntegrity(backup) };
};

export const backupToJson = (backup: CharacterBackupPayload): string => JSON.stringify(backup, null, 2);

export const buildCharacterBackupFileName = (backup: CharacterBackupPayload): string => {
  const stamp = backup.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  const safeName = (backup.metadata?.name || 'dnd-character-backup')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'dnd-character-backup';
  return `${safeName}-${stamp}.json`;
};

export const summarizeCharacterBackup = (backup: CharacterBackupPayload): string =>
  `${backup.summary.characterCount} personagem(ns) · ${backup.summary.scenarioCount} cenário(s) · ${backup.summary.buildPresetCount} preset(s) · ${backup.summary.buildHistorySnapshotCount} snapshot(s)${backup.catalogAudit ? ` · catálogo r${backup.catalogAudit.revision} · ${backup.catalogAudit.history.length} commit(s) · ${backup.catalogAudit.remediationPlans.length} plano(s)` : ''}`;

export const parseCharacterDataBackup = (json: string): CharacterBackupParseResult => {
  const issues: RuleValidationIssue[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, issues: [issue('error', 'backup.invalidJson', 'O conteúdo não é um JSON válido.')] };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, issues: [issue('error', 'backup.invalidRoot', 'O backup precisa ser um objeto JSON.')] };
  }

  const root = parsed as Partial<CharacterBackupPayload>;
  const supportedSchema =
    root.schemaVersion === CHARACTER_BACKUP_SCHEMA_VERSION ||
    root.schemaVersion === PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION ||
    root.schemaVersion === LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION;

  if (!supportedSchema) {
    issues.push(issue('error', 'backup.unsupportedSchema', `Schema de backup não suportado: ${String(root.schemaVersion ?? 'ausente')}.`));
  } else if (root.schemaVersion === LEGACY_CHARACTER_BACKUP_SCHEMA_VERSION) {
    issues.push(issue('warning', 'backup.legacySchema', 'Backup v1 aceito e atualizado para o contrato v3 durante a leitura.'));
  } else if (root.schemaVersion === PREVIOUS_CHARACTER_BACKUP_SCHEMA_VERSION) {
    issues.push(issue('warning', 'backup.previousSchema', 'Backup v2 aceito. Ele não contém catálogo, auditoria nem planos preventivos.'));
    if (!verifyCharacterBackupIntegrity(root as CharacterBackupPayload)) issues.push(issue('error', 'backup.integrityMismatch', 'A verificação de integridade falhou. O arquivo pode estar incompleto ou alterado.'));
  } else if (!verifyCharacterBackupIntegrity(root as CharacterBackupPayload)) {
    issues.push(issue('error', 'backup.integrityMismatch', 'A verificação de integridade falhou. O arquivo pode estar incompleto ou alterado.'));
  }

  if (!root.entities || typeof root.entities !== 'object') {
    issues.push(issue('error', 'backup.missingEntities', 'O backup não possui o bloco entities.'));
  }

  const entities = root.entities ?? ({} as Partial<CharacterBackupEntities>);
  const characters = asArray<Character>(entities.characters).map((character) => normalizeCharacter(character));
  const scenarios = asArray<CombatScenario>(entities.scenarios);
  const buildPresets = asArray<BuildPreset>(entities.buildPresets);
  const buildHistorySnapshots = asArray<BuildHistorySnapshot>(entities.buildHistorySnapshots);

  const characterIds = new Set(characters.map((character) => character.id).filter(Boolean));
  characters.forEach((character, index) => {
    if (!character.id) issues.push(issue('error', 'backup.characterMissingId', `Personagem #${index + 1} não possui id.`));
    if (!character.name) issues.push(issue('warning', 'backup.characterMissingName', `Personagem ${character.id || index + 1} não possui nome.`));
  });

  scenarios.forEach((scenario) => {
    if (scenario.characterId && !characterIds.has(scenario.characterId)) {
      issues.push(issue('warning', 'backup.orphanScenario', `Cenário ${scenario.name ?? scenario.id} aponta para personagem não incluído no backup.`));
    }
  });

  buildHistorySnapshots.forEach((snapshot) => {
    if (snapshot.characterId && !characterIds.has(snapshot.characterId)) {
      issues.push(issue('warning', 'backup.orphanHistory', `Snapshot ${snapshot.name ?? snapshot.id} aponta para personagem não incluído no backup.`));
    }
  });

  let catalogAudit: PortableCatalogAuditSection | undefined;
  if (root.catalogAudit !== undefined) {
    const candidate = root.catalogAudit as PortableCatalogAuditSection;
    if (!candidate || candidate.schemaVersion !== PORTABLE_CATALOG_AUDIT_SCHEMA || !Array.isArray(candidate.history) || !Array.isArray(candidate.remediationPlans)) {
      issues.push(issue('error', 'backup.catalogAuditInvalid', 'A seção portátil do catálogo possui estrutura inválida.'));
    } else if (candidate.historyIntegrity?.checksum !== portableCatalogHistoryChecksum(candidate.history)) {
      issues.push(issue('error', 'backup.catalogAuditIntegrityMismatch', 'A integridade da auditoria do catálogo falhou.'));
    } else {
      catalogAudit = clone(candidate);
    }
  }

  const normalizedBackup: Omit<CharacterBackupPayload, 'integrity'> = {
    schemaVersion: CHARACTER_BACKUP_SCHEMA_VERSION,
    exportedAt: root.exportedAt || new Date().toISOString(),
    app: {
      name: 'dnd-combat-math-mvp',
      backupKind: catalogAudit ? 'portable-user-data' : 'characters-and-builds',
      contractVersion: 3
    },
    metadata: root.metadata,
    summary: {
      characterCount: characters.length,
      scenarioCount: scenarios.length,
      buildPresetCount: buildPresets.length,
      buildHistorySnapshotCount: buildHistorySnapshots.length,
      characterIds: characters.map((character) => character.id).filter(Boolean),
      catalogAuditIncluded: Boolean(catalogAudit),
      catalogHistoryCommitCount: catalogAudit?.history.length ?? 0,
      remediationPlanCount: catalogAudit?.remediationPlans.length ?? 0
    },
    entities: { characters, scenarios, buildPresets, buildHistorySnapshots },
    catalogAudit
  };

  const backup: CharacterBackupPayload = {
    ...normalizedBackup,
    integrity: createCharacterBackupIntegrity(normalizedBackup)
  };

  return { ok: !issues.some((entry) => entry.severity === 'error'), issues, backup };
};

const mergeEntityList = <T extends { id: string }>(current: T[], incoming: T[], prefix: string): { items: T[]; idMap: Record<string, string> } => {
  const usedIds = new Set(current.map((item) => item.id));
  const idMap: Record<string, string> = {};
  const merged = [...current];

  incoming.forEach((item) => {
    const originalId = item.id;
    const nextItem = clone(item);
    if (!nextItem.id || usedIds.has(nextItem.id)) {
      nextItem.id = createId(prefix);
    }
    usedIds.add(nextItem.id);
    idMap[originalId] = nextItem.id;
    merged.push(nextItem);
  });

  return { items: merged, idMap };
};

const remapCharacter = (character: Character, nextId: string, originalId: string): Character => {
  const cloned = normalizeCharacter(clone(character));
  cloned.id = nextId;
  if (nextId !== originalId) cloned.name = `${cloned.name} (importado)`;
  cloned.rotations = (cloned.rotations ?? []).map((rotation) => ({ ...rotation, characterId: nextId }));
  cloned.compendiumLinks = (cloned.compendiumLinks ?? []).map((link) => ({ ...link, characterId: nextId }));
  cloned.resourceTransactions = (cloned.resourceTransactions ?? []).map((entry) => ({ ...entry, characterId: nextId }));
  cloned.spellSlotTransactions = (cloned.spellSlotTransactions ?? []).map((entry) => ({ ...entry, characterId: nextId }));
  cloned.activeEffectTransactions = (cloned.activeEffectTransactions ?? []).map((entry) => ({ ...entry, characterId: nextId }));
  return cloned;
};

const remapScenario = (scenario: CombatScenario, characterIdMap: Record<string, string>, existingIds: Set<string>): CombatScenario => {
  const cloned = clone(scenario);
  if (!cloned.id || existingIds.has(cloned.id)) cloned.id = createId('scenarioImported');
  cloned.characterId = characterIdMap[cloned.characterId] ?? cloned.characterId;
  return cloned;
};

const remapHistory = (snapshot: BuildHistorySnapshot, characterIdMap: Record<string, string>, existingIds: Set<string>): BuildHistorySnapshot => {
  const cloned = clone(snapshot);
  if (!cloned.id || existingIds.has(cloned.id)) cloned.id = createId('historyImported');
  cloned.characterId = characterIdMap[cloned.characterId] ?? cloned.characterId;
  return cloned;
};

const remapPreset = (preset: BuildPreset, existingIds: Set<string>): BuildPreset => {
  const cloned = clone(preset);
  if (!cloned.id || existingIds.has(cloned.id)) cloned.id = createId('presetImported');
  return {
    ...cloned,
    name: existingIds.has(preset.id) ? `${cloned.name} (importado)` : cloned.name,
    updatedAt: new Date().toISOString()
  };
};

export const restoreCharacterDataBackup = (
  current: CharacterBackupEntities,
  backup: CharacterBackupPayload,
  options: CharacterBackupRestoreOptions
): CharacterBackupRestoreResult => {
  const issues: RuleValidationIssue[] = [];
  const includeCharacters = options.includeCharacters !== false;
  const includeScenarios = options.includeScenarios !== false;
  const includeBuildPresets = options.includeBuildPresets !== false;
  const includeBuildHistory = options.includeBuildHistory !== false;

  if (options.mode === 'replaceAll') {
    const characters = includeCharacters ? backup.entities.characters.map((character) => normalizeCharacter(clone(character))) : current.characters;
    const characterIds = new Set(characters.map((character) => character.id));
    const scenarios = includeScenarios ? backup.entities.scenarios.filter((scenario) => characterIds.has(scenario.characterId)).map(clone) : current.scenarios;
    const buildPresets = includeBuildPresets ? backup.entities.buildPresets.map(clone) : current.buildPresets;
    const buildHistorySnapshots = includeBuildHistory ? backup.entities.buildHistorySnapshots.filter((snapshot) => characterIds.has(snapshot.characterId)).map(clone) : current.buildHistorySnapshots;
    return {
      ok: true,
      issues,
      characters,
      scenarios,
      buildPresets,
      buildHistorySnapshots,
      imported: {
        characterCount: includeCharacters ? characters.length : 0,
        scenarioCount: includeScenarios ? scenarios.length : 0,
        buildPresetCount: includeBuildPresets ? buildPresets.length : 0,
        buildHistorySnapshotCount: includeBuildHistory ? buildHistorySnapshots.length : 0
      },
      idMap: Object.fromEntries(characters.map((character) => [character.id, character.id]))
    };
  }

  const existingCharacterIds = new Set(current.characters.map((character) => character.id));
  const characterIdMap: Record<string, string> = {};
  const importedCharacters = includeCharacters
    ? backup.entities.characters.map((character) => {
        const nextId = !character.id || existingCharacterIds.has(character.id) ? createId('charImported') : character.id;
        existingCharacterIds.add(nextId);
        characterIdMap[character.id] = nextId;
        return remapCharacter(character, nextId, character.id);
      })
    : [];

  const scenarioIds = new Set(current.scenarios.map((scenario) => scenario.id));
  const importedScenarios = includeScenarios
    ? backup.entities.scenarios
        .filter((scenario) => !includeCharacters || Boolean(characterIdMap[scenario.characterId]) || existingCharacterIds.has(scenario.characterId))
        .map((scenario) => {
          const remapped = remapScenario(scenario, characterIdMap, scenarioIds);
          scenarioIds.add(remapped.id);
          return remapped;
        })
    : [];

  const presetIds = new Set(current.buildPresets.map((preset) => preset.id));
  const importedPresets = includeBuildPresets
    ? backup.entities.buildPresets.map((preset) => {
        const remapped = remapPreset(preset, presetIds);
        presetIds.add(remapped.id);
        return remapped;
      })
    : [];

  const historyIds = new Set(current.buildHistorySnapshots.map((snapshot) => snapshot.id));
  const importedHistory = includeBuildHistory
    ? backup.entities.buildHistorySnapshots
        .filter((snapshot) => !includeCharacters || Boolean(characterIdMap[snapshot.characterId]) || existingCharacterIds.has(snapshot.characterId))
        .map((snapshot) => {
          const remapped = remapHistory(snapshot, characterIdMap, historyIds);
          historyIds.add(remapped.id);
          return remapped;
        })
    : [];

  if (includeScenarios && backup.entities.scenarios.length !== importedScenarios.length) {
    issues.push(issue('warning', 'backup.skippedScenarios', 'Alguns cenários foram ignorados porque apontavam para personagens não importados.'));
  }
  if (includeBuildHistory && backup.entities.buildHistorySnapshots.length !== importedHistory.length) {
    issues.push(issue('warning', 'backup.skippedHistory', 'Alguns snapshots foram ignorados porque apontavam para personagens não importados.'));
  }

  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    issues,
    characters: [...current.characters, ...importedCharacters],
    scenarios: [...current.scenarios, ...importedScenarios],
    buildPresets: [...current.buildPresets, ...importedPresets],
    buildHistorySnapshots: [...current.buildHistorySnapshots, ...importedHistory],
    imported: {
      characterCount: importedCharacters.length,
      scenarioCount: importedScenarios.length,
      buildPresetCount: importedPresets.length,
      buildHistorySnapshotCount: importedHistory.length
    },
    idMap: characterIdMap
  };
};

export const buildBackupRestoreSummary = (result: CharacterBackupRestoreResult): string =>
  `${result.imported.characterCount} personagem(ns), ${result.imported.scenarioCount} cenário(s), ${result.imported.buildPresetCount} preset(s) e ${result.imported.buildHistorySnapshotCount} snapshot(s) restaurados.`;
