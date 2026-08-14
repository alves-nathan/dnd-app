import type {
  ActiveEffect,
  BuildHistorySnapshot,
  Character,
  CombatScenario,
  RuleSource,
  TurnAction,
  TurnRotation
} from '../types';
import type { BuildPreset } from '../presets/buildPresets';
import type { StoredCompendiumItem, StoredCompendiumPack } from '../compendium/types';
import { buildEngineReadinessReport, type EngineReadinessReport } from '../compendium/engineReadiness';
import { backupToJson, createCharacterDataBackup, parseCharacterDataBackup } from '../backup/characterBackup';
import { defaultCombatState } from '../data/mockData';
import { buildAvailableActionsResult } from '../rules-engine/actions/buildActions';
import { analyzeTurnRotation } from '../rules-engine/turns/analyzeTurn';
import { getTotalLevel } from '../rules-engine/characters/derivedStats';
import { spellSlotPoolKey } from '../rules-engine/resources/spellSlotManager';

export type GlobalDiagnosticSeverity = 'info' | 'warning' | 'error';
export type GlobalDiagnosticArea =
  | 'characters'
  | 'rotations'
  | 'actions'
  | 'resources'
  | 'spellSlots'
  | 'effects'
  | 'compendium'
  | 'engine'
  | 'scenarios'
  | 'presets'
  | 'history'
  | 'backup';

export interface GlobalDiagnosticIssue {
  id: string;
  severity: GlobalDiagnosticSeverity;
  area: GlobalDiagnosticArea;
  code: string;
  message: string;
  entityLabel?: string;
  entityId?: string;
  suggestedAction?: string;
}

export interface GlobalDiagnosticSummary {
  generatedAt: string;
  healthScore: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  characterCount: number;
  rotationCount: number;
  scenarioCount: number;
  compendiumItemCount: number;
  validatedCompendiumItemCount: number;
  engineReadyCompendiumItemCount: number;
  orphanReferenceCount: number;
  backupRoundtripOk: boolean;
}

export interface GlobalDiagnosticAreaSummary {
  area: GlobalDiagnosticArea;
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

export interface GlobalDiagnosticReportInput {
  characters: Character[];
  scenarios: CombatScenario[];
  buildPresets: BuildPreset[];
  buildHistorySnapshots: BuildHistorySnapshot[];
  compendium: {
    sources: RuleSource[];
    packs: StoredCompendiumPack[];
    items: StoredCompendiumItem[];
    enabledSourceIds: string[];
  };
}

export interface GlobalDiagnosticReport {
  summary: GlobalDiagnosticSummary;
  areas: GlobalDiagnosticAreaSummary[];
  issues: GlobalDiagnosticIssue[];
  engineReadiness: EngineReadinessReport;
}

const trackedAreas: GlobalDiagnosticArea[] = [
  'characters',
  'rotations',
  'actions',
  'resources',
  'spellSlots',
  'effects',
  'compendium',
  'engine',
  'scenarios',
  'presets',
  'history',
  'backup'
];

const asId = (value: unknown): string => (typeof value === 'string' && value.trim() ? value.trim() : 'missing-id');

const makeIssue = (
  issues: GlobalDiagnosticIssue[],
  severity: GlobalDiagnosticSeverity,
  area: GlobalDiagnosticArea,
  code: string,
  message: string,
  options: Pick<GlobalDiagnosticIssue, 'entityLabel' | 'entityId' | 'suggestedAction'> = {}
): void => {
  issues.push({
    id: `${area}.${code}.${issues.length + 1}`,
    severity,
    area,
    code,
    message,
    ...options
  });
};

const addDuplicateIdIssues = <T extends { id?: string; name?: string }>(
  issues: GlobalDiagnosticIssue[],
  area: GlobalDiagnosticArea,
  code: string,
  label: string,
  values: T[]
): void => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const id = value.id;
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  for (const duplicateId of duplicates) {
    makeIssue(issues, 'error', area, code, `${label} possui id duplicado: ${duplicateId}.`, { entityId: duplicateId, suggestedAction: 'Renomeie ou recrie a entidade conflitante antes de exportar/mesclar backups.' });
  }
};

const countBySeverity = (issues: GlobalDiagnosticIssue[], severity: GlobalDiagnosticSeverity): number => issues.filter((issue) => issue.severity === severity).length;

const sortIssues = (issues: GlobalDiagnosticIssue[]): GlobalDiagnosticIssue[] => {
  const severityWeight: Record<GlobalDiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.slice().sort((left, right) => {
    const severityDiff = severityWeight[left.severity] - severityWeight[right.severity];
    if (severityDiff !== 0) return severityDiff;
    const areaDiff = left.area.localeCompare(right.area);
    if (areaDiff !== 0) return areaDiff;
    return left.code.localeCompare(right.code) || (left.entityLabel ?? '').localeCompare(right.entityLabel ?? '');
  });
};

const totalRotationCount = (characters: Character[]): number => characters.reduce((sum, character) => sum + (character.rotations?.length ?? 0), 0);

const allActiveEffects = (character: Character): ActiveEffect[] => (character.activeEffects ?? []).filter((effect) => effect.status === 'active');

const turnActionLabel = (turnAction: TurnAction): string => turnAction.name || turnAction.action?.name || turnAction.id;

const validateCharacterCollections = (character: Character, issues: GlobalDiagnosticIssue[]): void => {
  const label = character.name || character.id;
  const totalClassLevel = (character.classes ?? []).reduce((sum, characterClass) => sum + (Number.isFinite(characterClass.level) ? characterClass.level : 0), 0);

  if (!character.id) {
    makeIssue(issues, 'error', 'characters', 'CHARACTER_ID_MISSING', 'Personagem sem id.', { entityLabel: label });
  }
  if (!character.name?.trim()) {
    makeIssue(issues, 'info', 'characters', 'CHARACTER_NAME_MISSING', 'Personagem sem nome; o app usará um identificador substituto.', { entityId: character.id, entityLabel: label, suggestedAction: 'Adicione um nome quando desejar.' });
  }
  if (getTotalLevel(character) !== totalClassLevel && totalClassLevel > 0) {
    makeIssue(issues, 'warning', 'characters', 'CHARACTER_LEVEL_OUT_OF_SYNC', `Nível total (${getTotalLevel(character)}) difere da soma das classes (${totalClassLevel}).`, { entityId: character.id, entityLabel: label, suggestedAction: 'Revise level e multiclass antes de comparar rotações.' });
  }
  if (!character.classes?.length) {
    makeIssue(issues, 'warning', 'characters', 'CHARACTER_WITHOUT_CLASS', 'Personagem não possui nenhuma classe cadastrada.', { entityId: character.id, entityLabel: label });
  }

  addDuplicateIdIssues(issues, 'characters', 'DUPLICATE_CLASS_ID', `Classes de ${label}`, character.classes ?? []);
  addDuplicateIdIssues(issues, 'characters', 'DUPLICATE_WEAPON_ID', `Armas de ${label}`, character.weapons ?? []);
  addDuplicateIdIssues(issues, 'characters', 'DUPLICATE_SPELL_ID', `Magias de ${label}`, character.spells ?? []);
  addDuplicateIdIssues(issues, 'characters', 'DUPLICATE_FEATURE_ID', `Features de ${label}`, character.features ?? []);
  addDuplicateIdIssues(issues, 'rotations', 'DUPLICATE_ROTATION_ID', `Rotações de ${label}`, character.rotations ?? []);

  for (const ability of Object.entries(character.abilities ?? {})) {
    const [abilityName, value] = ability;
    if (!Number.isFinite(value) || value < 1 || value > 30) {
      makeIssue(issues, 'warning', 'characters', 'ABILITY_OUT_OF_EXPECTED_RANGE', `${abilityName} está fora do intervalo esperado 1–30: ${String(value)}.`, { entityId: character.id, entityLabel: label, suggestedAction: 'Confirme se o valor é intencional ou se veio de importação incorreta.' });
    }
  }
};

const validateResources = (character: Character, issues: GlobalDiagnosticIssue[]): void => {
  const label = character.name || character.id;
  addDuplicateIdIssues(issues, 'resources', 'DUPLICATE_RESOURCE_ID', `Recursos de ${label}`, character.resources ?? []);

  for (const resource of character.resources ?? []) {
    if (!Number.isFinite(resource.max) || resource.max < 0) {
      makeIssue(issues, 'error', 'resources', 'RESOURCE_MAX_INVALID', `Recurso "${resource.name}" possui máximo inválido: ${String(resource.max)}.`, { entityId: resource.id, entityLabel: `${label} · ${resource.name}` });
    }
    if (!Number.isFinite(resource.current) || resource.current < 0) {
      makeIssue(issues, 'error', 'resources', 'RESOURCE_CURRENT_INVALID', `Recurso "${resource.name}" possui valor atual inválido: ${String(resource.current)}.`, { entityId: resource.id, entityLabel: `${label} · ${resource.name}` });
    }
    if (resource.current > resource.max) {
      makeIssue(issues, 'warning', 'resources', 'RESOURCE_CURRENT_ABOVE_MAX', `Recurso "${resource.name}" está acima do máximo (${resource.current}/${resource.max}).`, { entityId: resource.id, entityLabel: `${label} · ${resource.name}`, suggestedAction: 'Ajuste o valor atual ou confirme bônus temporário.' });
    }
  }
};

const validateSpellSlots = (character: Character, issues: GlobalDiagnosticIssue[]): void => {
  const label = character.name || character.id;
  const seenPools = new Set<string>();
  for (const slot of character.spellSlots ?? []) {
    const poolKey = spellSlotPoolKey(slot);
    if (seenPools.has(poolKey)) {
      makeIssue(issues, 'error', 'spellSlots', 'DUPLICATE_SPELL_SLOT_POOL', `Há mais de um pool idêntico de slot (${poolKey}) em ${label}.`, { entityId: character.id, entityLabel: label });
    }
    seenPools.add(poolKey);
    if (slot.level < 1 || slot.level > 9) {
      makeIssue(issues, 'error', 'spellSlots', 'SPELL_SLOT_LEVEL_INVALID', `Slot de magia com nível inválido: ${String(slot.level)}.`, { entityId: character.id, entityLabel: label });
    }
    if (slot.max < 0 || slot.current < 0) {
      makeIssue(issues, 'error', 'spellSlots', 'SPELL_SLOT_NEGATIVE', `Slot nível ${slot.level} possui máximo ou atual negativo.`, { entityId: character.id, entityLabel: label });
    }
    if (slot.current > slot.max) {
      makeIssue(issues, 'warning', 'spellSlots', 'SPELL_SLOT_CURRENT_ABOVE_MAX', `Slot nível ${slot.level} está acima do máximo (${slot.current}/${slot.max}).`, { entityId: character.id, entityLabel: label });
    }
  }
};

const validateEffects = (character: Character, issues: GlobalDiagnosticIssue[]): void => {
  const label = character.name || character.id;
  addDuplicateIdIssues(issues, 'effects', 'DUPLICATE_ACTIVE_EFFECT_ID', `Efeitos ativos de ${label}`, character.activeEffects ?? []);
  const activeConcentrationEffects = allActiveEffects(character).filter((effect) => effect.concentration);
  if (activeConcentrationEffects.length > 1) {
    makeIssue(issues, 'error', 'effects', 'MULTIPLE_ACTIVE_CONCENTRATION_EFFECTS', `${label} possui mais de um efeito ativo de concentração: ${activeConcentrationEffects.map((effect) => effect.name).join(', ')}.`, { entityId: character.id, entityLabel: label, suggestedAction: 'Encerre a concentração antiga ou revise a origem dos efeitos.' });
  }
  for (const effect of character.activeEffects ?? []) {
    if (effect.status === 'active' && effect.duration.unit !== 'manual' && effect.duration.remaining !== undefined && effect.duration.remaining <= 0) {
      makeIssue(issues, 'warning', 'effects', 'ACTIVE_EFFECT_EXPIRED_DURATION', `Efeito "${effect.name}" ainda está ativo, mas a duração restante é ${effect.duration.remaining}.`, { entityId: effect.id, entityLabel: `${label} · ${effect.name}`, suggestedAction: 'Avance efeitos ou marque o efeito como expirado/removido.' });
    }
    if (effect.sourceRef?.itemId) {
      const linkExists = (character.compendiumLinks ?? []).some((link) => link.itemId === effect.sourceRef?.itemId || link.importItemId === effect.sourceRef?.itemId);
      if (!linkExists) {
        makeIssue(issues, 'warning', 'effects', 'EFFECT_SOURCE_LINK_ORPHAN', `Efeito "${effect.name}" aponta para item de compêndio não vinculado à ficha.`, { entityId: effect.id, entityLabel: `${label} · ${effect.name}` });
      }
    }
  }
};

const validateRotations = (character: Character, issues: GlobalDiagnosticIssue[]): void => {
  const label = character.name || character.id;
  const actionBuild = buildAvailableActionsResult(character);
  for (const actionIssue of actionBuild.issues) {
    makeIssue(issues, actionIssue.severity, 'actions', actionIssue.code, actionIssue.message, { entityId: character.id, entityLabel: label, suggestedAction: 'Revise armas, magias, features ou mapeamentos importados.' });
  }

  const availableActionIds = new Set(actionBuild.actions.map((action) => action.id));
  const availableWeaponIds = new Set((character.weapons ?? []).map((weapon) => weapon.id));
  const availableSpellIds = new Set((character.spells ?? []).map((spell) => spell.id));

  for (const rotation of character.rotations ?? []) {
    if (rotation.characterId !== character.id) {
      makeIssue(issues, 'error', 'rotations', 'ROTATION_CHARACTER_ID_MISMATCH', `Rotação "${rotation.name}" aponta para characterId ${rotation.characterId}, mas está dentro de ${character.id}.`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}`, suggestedAction: 'Recrie ou normalize a rotação.' });
    }
    if (!rotation.actions?.length) {
      makeIssue(issues, 'warning', 'rotations', 'ROTATION_WITHOUT_ACTIONS', `Rotação "${rotation.name}" não possui ações.`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}` });
      continue;
    }

    for (const turnAction of rotation.actions) {
      const action = turnAction.action;
      if (!action?.id) {
        makeIssue(issues, 'error', 'rotations', 'TURN_ACTION_WITHOUT_ACTION_ID', `Ação de turno "${turnActionLabel(turnAction)}" não possui id de ação.`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}` });
      }
      if (action?.id && !availableActionIds.has(action.id)) {
        makeIssue(issues, 'warning', 'rotations', 'ROTATION_ACTION_NOT_IN_AVAILABLE_ACTIONS', `Ação "${action.name}" da rotação "${rotation.name}" não aparece na lista de ações disponíveis reconstruída pela engine.`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}`, suggestedAction: 'Recrie a rotação após editar armas/magias/features.' });
      }
      if (action?.type === 'attack' && action.weaponId && !availableWeaponIds.has(action.weaponId)) {
        makeIssue(issues, 'error', 'rotations', 'ROTATION_ATTACK_ORPHAN_WEAPON', `Ataque "${action.name}" aponta para arma removida: ${action.weaponId}.`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}` });
      }
      if (action?.type === 'spell' && action.spellId && !availableSpellIds.has(action.spellId)) {
        makeIssue(issues, 'error', 'rotations', 'ROTATION_SPELL_ORPHAN', `Magia "${action.name}" aponta para magia removida: ${action.spellId}.`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}` });
      }
    }

    const analysis = analyzeTurnRotation(rotation, character, defaultCombatState);
    const collectedIssues = [
      ...analysis.validation.issues,
      ...analysis.resourceAvailability.issues,
      ...analysis.spellSlotAvailability.issues,
      ...analysis.actions.flatMap((action) => action.warnings)
    ];
    for (const turnIssue of collectedIssues) {
      makeIssue(issues, turnIssue.severity, 'rotations', turnIssue.code, `Rotação "${rotation.name}": ${turnIssue.message}`, { entityId: rotation.id, entityLabel: `${label} · ${rotation.name}`, suggestedAction: 'Abra a análise da rotação para ver os detalhes matemáticos e de regra.' });
    }
  }
};

const validateCharacterCompendiumLinks = (character: Character, compendiumItems: StoredCompendiumItem[], issues: GlobalDiagnosticIssue[]): void => {
  const itemIds = new Set(compendiumItems.map((item) => item.id));
  const importItemIds = new Set(compendiumItems.map((item) => item.importItemId));
  const label = character.name || character.id;
  addDuplicateIdIssues(issues, 'compendium', 'DUPLICATE_CHARACTER_COMPENDIUM_LINK_ID', `Vínculos de compêndio de ${label}`, character.compendiumLinks ?? []);
  for (const link of character.compendiumLinks ?? []) {
    if (!itemIds.has(link.itemId) && !importItemIds.has(link.importItemId)) {
      makeIssue(issues, 'warning', 'compendium', 'CHARACTER_COMPENDIUM_LINK_ORPHAN', `Vínculo "${link.appliedEntityName}" aponta para item de compêndio ausente.`, { entityId: link.id, entityLabel: `${label} · ${link.appliedEntityName}`, suggestedAction: 'Reimporte o pacote original ou remova o vínculo da ficha.' });
    }
    if (link.status === 'needsReview') {
      makeIssue(issues, 'warning', 'compendium', 'CHARACTER_COMPENDIUM_LINK_NEEDS_REVIEW', `Vínculo "${link.appliedEntityName}" ainda precisa de revisão.`, { entityId: link.id, entityLabel: `${label} · ${link.appliedEntityName}` });
    }
  }
};

const validateScenarios = (characters: Character[], scenarios: CombatScenario[], issues: GlobalDiagnosticIssue[]): void => {
  const characterIds = new Set(characters.map((character) => character.id));
  addDuplicateIdIssues(issues, 'scenarios', 'DUPLICATE_SCENARIO_ID', 'Cenários de combate', scenarios);
  for (const scenario of scenarios) {
    if (!characterIds.has(scenario.characterId)) {
      makeIssue(issues, 'warning', 'scenarios', 'ORPHAN_SCENARIO_CHARACTER', `Cenário "${scenario.name}" aponta para personagem inexistente: ${scenario.characterId}.`, { entityId: scenario.id, entityLabel: scenario.name, suggestedAction: 'Remova o cenário ou restaure o personagem correspondente.' });
    }
    if (!scenario.combatState || scenario.combatState.targetCount < 1) {
      makeIssue(issues, 'warning', 'scenarios', 'SCENARIO_TARGET_COUNT_INVALID', `Cenário "${scenario.name}" possui quantidade de alvos inválida.`, { entityId: scenario.id, entityLabel: scenario.name });
    }
  }
};

const validatePresets = (presets: BuildPreset[], issues: GlobalDiagnosticIssue[]): void => {
  addDuplicateIdIssues(issues, 'presets', 'DUPLICATE_PRESET_ID', 'Presets de build', presets.map((preset) => ({ id: preset.id, name: preset.name })));
  for (const preset of presets) {
    if (!preset.name?.trim()) {
      makeIssue(issues, 'warning', 'presets', 'PRESET_NAME_MISSING', 'Preset sem nome preenchido.', { entityId: preset.id });
    }
    if (!preset.snapshot) {
      makeIssue(issues, 'error', 'presets', 'PRESET_SNAPSHOT_MISSING', `Preset "${preset.name}" não possui snapshot de build.`, { entityId: preset.id, entityLabel: preset.name });
    }
  }
};

const validateHistory = (characters: Character[], snapshots: BuildHistorySnapshot[], issues: GlobalDiagnosticIssue[]): void => {
  const characterIds = new Set(characters.map((character) => character.id));
  addDuplicateIdIssues(issues, 'history', 'DUPLICATE_HISTORY_SNAPSHOT_ID', 'Snapshots de histórico', snapshots);
  for (const snapshot of snapshots) {
    if (!characterIds.has(snapshot.characterId)) {
      makeIssue(issues, 'warning', 'history', 'ORPHAN_HISTORY_CHARACTER', `Snapshot "${snapshot.name}" aponta para personagem inexistente: ${snapshot.characterId}.`, { entityId: snapshot.id, entityLabel: snapshot.name, suggestedAction: 'Remova o snapshot ou restaure o personagem correspondente.' });
    }
    if (!snapshot.rows?.length) {
      makeIssue(issues, 'info', 'history', 'HISTORY_SNAPSHOT_WITHOUT_ROWS', `Snapshot "${snapshot.name}" não possui linhas de rotação comparadas.`, { entityId: snapshot.id, entityLabel: snapshot.name });
    }
  }
};

const validateCompendium = (
  compendium: GlobalDiagnosticReportInput['compendium'],
  engineReadiness: EngineReadinessReport,
  issues: GlobalDiagnosticIssue[]
): void => {
  addDuplicateIdIssues(issues, 'compendium', 'DUPLICATE_SOURCE_ID', 'Fontes do compêndio', compendium.sources.map((source) => ({ id: source.id, name: source.book })));
  addDuplicateIdIssues(issues, 'compendium', 'DUPLICATE_PACK_ID', 'Pacotes do compêndio', compendium.packs);
  addDuplicateIdIssues(issues, 'compendium', 'DUPLICATE_ITEM_ID', 'Itens do compêndio', compendium.items);

  const sourceIds = new Set(compendium.sources.map((source) => source.id));
  const packIds = new Set(compendium.packs.map((pack) => pack.id));
  const enabledIds = new Set(compendium.enabledSourceIds);

  for (const enabledSourceId of compendium.enabledSourceIds) {
    if (!sourceIds.has(enabledSourceId)) {
      makeIssue(issues, 'warning', 'compendium', 'ENABLED_SOURCE_MISSING', `Fonte habilitada não existe no compêndio: ${enabledSourceId}.`, { entityId: enabledSourceId, suggestedAction: 'Limpe ou reimporte a fonte.' });
    }
  }
  for (const source of compendium.sources) {
    if (source.status === 'disabled' && enabledIds.has(source.id)) {
      makeIssue(issues, 'warning', 'compendium', 'DISABLED_SOURCE_ENABLED', `Fonte "${source.book ?? source.id}" está disabled, mas aparece como habilitada.`, { entityId: source.id, entityLabel: source.book ?? source.id });
    }
    if (!source.book && !source.notes) {
      makeIssue(issues, 'info', 'compendium', 'SOURCE_METADATA_LIGHT', `Fonte ${source.id} tem poucos metadados.`, { entityId: source.id, suggestedAction: 'Associe livro, página, versão ou notas para auditoria.' });
    }
  }
  for (const pack of compendium.packs) {
    if (!sourceIds.has(pack.sourceId)) {
      makeIssue(issues, 'error', 'compendium', 'PACK_SOURCE_MISSING', `Pacote "${pack.name}" aponta para fonte ausente: ${pack.sourceId}.`, { entityId: pack.id, entityLabel: pack.name });
    }
    const itemCount = compendium.items.filter((item) => item.packId === pack.id).length;
    if (itemCount !== pack.itemCount) {
      makeIssue(issues, 'warning', 'compendium', 'PACK_ITEM_COUNT_MISMATCH', `Pacote "${pack.name}" declara ${pack.itemCount} item(ns), mas possui ${itemCount}.`, { entityId: pack.id, entityLabel: pack.name });
    }
  }
  for (const item of compendium.items) {
    if (!packIds.has(item.packId)) {
      makeIssue(issues, 'error', 'compendium', 'ITEM_PACK_MISSING', `Item "${item.name}" aponta para pacote ausente: ${item.packId}.`, { entityId: item.id, entityLabel: item.name });
    }
    if (!sourceIds.has(item.sourceId)) {
      makeIssue(issues, 'error', 'compendium', 'ITEM_SOURCE_MISSING', `Item "${item.name}" aponta para fonte ausente: ${item.sourceId}.`, { entityId: item.id, entityLabel: item.name });
    }
    if (item.status === 'validated' && item.reviewDecision === 'rejected') {
      makeIssue(issues, 'warning', 'compendium', 'VALIDATED_ITEM_REJECTED', `Item "${item.name}" está validated, mas a decisão de revisão é rejected.`, { entityId: item.id, entityLabel: item.name });
    }
  }

  for (const row of engineReadiness.items) {
    if (row.status === 'blocked') {
      makeIssue(issues, 'error', 'engine', 'ENGINE_READINESS_BLOCKED_ITEM', `Item "${row.item.name}" está validado/avaliado, mas bloqueado para a engine.`, { entityId: row.item.id, entityLabel: row.item.name, suggestedAction: 'Abra prontidão pré-engine ou editor visual de mapeamento.' });
    } else if (row.status === 'partial') {
      makeIssue(issues, 'warning', 'engine', 'ENGINE_READINESS_PARTIAL_ITEM', `Item "${row.item.name}" só está parcialmente pronto para a engine.`, { entityId: row.item.id, entityLabel: row.item.name, suggestedAction: 'Revise tokens de dano, scaling, recursos ou efeitos.' });
    }
  }
};

const validateBackupRoundtrip = (input: GlobalDiagnosticReportInput, issues: GlobalDiagnosticIssue[]): boolean => {
  const backup = createCharacterDataBackup(
    {
      characters: input.characters,
      scenarios: input.scenarios,
      buildPresets: input.buildPresets,
      buildHistorySnapshots: input.buildHistorySnapshots
    },
    { metadata: { name: 'Diagnóstico automático', notes: 'Backup temporário gerado apenas para verificar serialização.' } }
  );
  const parsed = parseCharacterDataBackup(backupToJson(backup));
  for (const backupIssue of parsed.issues) {
    makeIssue(issues, backupIssue.severity, 'backup', backupIssue.code, backupIssue.message, { suggestedAction: 'Abra Backup/Restauração e gere um backup manual para revisar o payload.' });
  }
  if (!parsed.ok) {
    makeIssue(issues, 'error', 'backup', 'BACKUP_ROUNDTRIP_FAILED', 'O backup JSON gerado pelo app não passou na validação de restauração.', { suggestedAction: 'Corrija entidades inválidas antes de confiar no backup.' });
  }
  return parsed.ok;
};

const buildAreaSummaries = (issues: GlobalDiagnosticIssue[]): GlobalDiagnosticAreaSummary[] =>
  trackedAreas.map((area) => {
    const areaIssues = issues.filter((issue) => issue.area === area);
    return {
      area,
      errors: countBySeverity(areaIssues, 'error'),
      warnings: countBySeverity(areaIssues, 'warning'),
      infos: countBySeverity(areaIssues, 'info'),
      total: areaIssues.length
    };
  });

const calculateHealthScore = (issues: GlobalDiagnosticIssue[], engineReadiness: EngineReadinessReport): number => {
  const errors = countBySeverity(issues, 'error');
  const warnings = countBySeverity(issues, 'warning');
  const infos = countBySeverity(issues, 'info');
  const blockedPenalty = engineReadiness.summary.blockedItems * 5;
  const partialPenalty = engineReadiness.summary.partialItems * 2;
  const score = 100 - errors * 14 - warnings * 4 - infos - blockedPenalty - partialPenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
};

export const runGlobalDiagnostics = (input: GlobalDiagnosticReportInput): GlobalDiagnosticReport => {
  const issues: GlobalDiagnosticIssue[] = [];
  addDuplicateIdIssues(issues, 'characters', 'DUPLICATE_CHARACTER_ID', 'Personagens', input.characters);

  for (const character of input.characters) {
    validateCharacterCollections(character, issues);
    validateResources(character, issues);
    validateSpellSlots(character, issues);
    validateEffects(character, issues);
    validateRotations(character, issues);
    validateCharacterCompendiumLinks(character, input.compendium.items, issues);
  }

  validateScenarios(input.characters, input.scenarios, issues);
  validatePresets(input.buildPresets, issues);
  validateHistory(input.characters, input.buildHistorySnapshots, issues);

  const engineReadiness = buildEngineReadinessReport({
    items: input.compendium.items,
    sources: input.compendium.sources,
    packs: input.compendium.packs,
    enabledSourceIds: input.compendium.enabledSourceIds,
    filters: { onlyEnabledSources: false, onlyValidated: false }
  });
  validateCompendium(input.compendium, engineReadiness, issues);
  const backupRoundtripOk = validateBackupRoundtrip(input, issues);

  const sortedIssues = sortIssues(issues);
  const errorCount = countBySeverity(sortedIssues, 'error');
  const warningCount = countBySeverity(sortedIssues, 'warning');
  const infoCount = countBySeverity(sortedIssues, 'info');
  const orphanReferenceCount = sortedIssues.filter((issue) => issue.code.includes('ORPHAN') || issue.code.includes('MISSING')).length;

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      healthScore: calculateHealthScore(sortedIssues, engineReadiness),
      totalIssues: sortedIssues.length,
      errorCount,
      warningCount,
      infoCount,
      characterCount: input.characters.length,
      rotationCount: totalRotationCount(input.characters),
      scenarioCount: input.scenarios.length,
      compendiumItemCount: input.compendium.items.length,
      validatedCompendiumItemCount: input.compendium.items.filter((item) => item.status === 'validated').length,
      engineReadyCompendiumItemCount: engineReadiness.summary.readyItems,
      orphanReferenceCount,
      backupRoundtripOk
    },
    areas: buildAreaSummaries(sortedIssues),
    issues: sortedIssues,
    engineReadiness
  };
};

export const filterGlobalDiagnosticIssues = (
  report: GlobalDiagnosticReport,
  filters: { query?: string; area?: GlobalDiagnosticArea | 'all'; severity?: GlobalDiagnosticSeverity | 'all' }
): GlobalDiagnosticIssue[] => {
  const query = filters.query?.trim().toLowerCase() ?? '';
  return report.issues
    .filter((issue) => (filters.area && filters.area !== 'all' ? issue.area === filters.area : true))
    .filter((issue) => (filters.severity && filters.severity !== 'all' ? issue.severity === filters.severity : true))
    .filter((issue) => {
      if (!query) return true;
      const haystack = [issue.area, issue.severity, issue.code, issue.message, issue.entityLabel, issue.entityId, issue.suggestedAction]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return query.split(/\s+/).every((token) => haystack.includes(token));
    });
};

const severityEmoji: Record<GlobalDiagnosticSeverity, string> = { error: '❌', warning: '⚠️', info: 'ℹ️' };

export const globalDiagnosticsReportToMarkdown = (report: GlobalDiagnosticReport): string => {
  const lines: string[] = [];
  lines.push('# Diagnóstico global do D&D Combat Math');
  lines.push('');
  lines.push(`Gerado em: ${report.summary.generatedAt}`);
  lines.push(`Health score: ${report.summary.healthScore}/100`);
  lines.push('');
  lines.push('## Resumo');
  lines.push('');
  lines.push(`- Personagens: ${report.summary.characterCount}`);
  lines.push(`- Rotações: ${report.summary.rotationCount}`);
  lines.push(`- Cenários: ${report.summary.scenarioCount}`);
  lines.push(`- Itens de compêndio: ${report.summary.compendiumItemCount}`);
  lines.push(`- Itens validados: ${report.summary.validatedCompendiumItemCount}`);
  lines.push(`- Itens prontos para engine: ${report.summary.engineReadyCompendiumItemCount}`);
  lines.push(`- Backup roundtrip: ${report.summary.backupRoundtripOk ? 'OK' : 'falhou'}`);
  lines.push(`- Problemas: ${report.summary.errorCount} erro(s), ${report.summary.warningCount} aviso(s), ${report.summary.infoCount} info(s)`);
  lines.push('');
  lines.push('## Áreas');
  lines.push('');
  lines.push('| Área | Erros | Avisos | Info | Total |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const area of report.areas.filter((entry) => entry.total > 0)) {
    lines.push(`| ${area.area} | ${area.errors} | ${area.warnings} | ${area.infos} | ${area.total} |`);
  }
  lines.push('');
  lines.push('## Prontidão pré-engine');
  lines.push('');
  lines.push(`- Ready: ${report.engineReadiness.summary.readyItems}`);
  lines.push(`- Partial: ${report.engineReadiness.summary.partialItems}`);
  lines.push(`- Blocked: ${report.engineReadiness.summary.blockedItems}`);
  lines.push(`- Not applicable: ${report.engineReadiness.summary.notApplicableItems}`);
  lines.push(`- Score médio: ${report.engineReadiness.summary.readinessAverage}%`);
  lines.push('');
  lines.push('## Problemas');
  lines.push('');
  if (!report.issues.length) {
    lines.push('Nenhum problema detectado.');
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${severityEmoji[issue.severity]} **${issue.area}/${issue.code}**${issue.entityLabel ? ` — ${issue.entityLabel}` : ''}: ${issue.message}${issue.suggestedAction ? ` _Ação sugerida: ${issue.suggestedAction}_` : ''}`);
    }
  }
  lines.push('');
  lines.push('> Este diagnóstico é uma verificação estrutural e matemática do app. Ele não substitui revisão humana das regras importadas.');
  return lines.join('\n');
};
