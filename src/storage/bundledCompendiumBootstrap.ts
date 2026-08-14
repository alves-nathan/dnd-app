import {
  BUNDLED_COMPENDIUM_PACKS,
  REQUIRED_CHARACTER_CREATION_BUNDLED_PACKS,
  serializeBundledCompendiumPack,
  type BundledCompendiumPackDefinition
} from '../compendium/bundledCompendium';
import { IMPORT_TEMPLATE_VERSION_V2 } from '../compendium/importVersions';
import { parseAndPreviewImportPack } from '../compendium/parseImportPreview';
import { prepareCoreCharacterContentSnapshot } from '../compendium/coreCharacterContentPreparation';
import type { RuleValidationIssue } from '../types';
import type { CompendiumRepository } from './compendiumRepository';
import { existingPreviewItemsFromSnapshot } from './compendiumV2Persistence';
import type { CompendiumPersistenceState } from './compendiumSnapshot';

export interface BundledCompendiumBootstrapOptions {
  packs?: readonly BundledCompendiumPackDefinition[];
  prepareCoreCharacterContent?: boolean;
  now?: string;
}

export interface BundledCompendiumBootstrapResult {
  ok: boolean;
  seeded: boolean;
  snapshot: CompendiumPersistenceState;
  importedPackIds: string[];
  importedItemCount: number;
  preparedCoreItemCount: number;
  enabledSourceCount: number;
  warningCount: number;
  issues: RuleValidationIssue[];
}

export interface BundledCompendiumReconciliationResult {
  ok: boolean;
  reconciled: boolean;
  snapshot: CompendiumPersistenceState;
  reconciledPackIds: string[];
  deferredPackIds: string[];
  contentHashesBackfilled: number;
  warningCount: number;
  issues: RuleValidationIssue[];
}

export const isCompendiumSnapshotEmpty = (
  snapshot: CompendiumPersistenceState
): boolean =>
  snapshot.sources.length === 0 &&
  snapshot.packs.length === 0 &&
  snapshot.items.length === 0 &&
  snapshot.enabledSourceIds.length === 0;

const bootstrapError = (
  code: string,
  message: string
): RuleValidationIssue => ({ severity: 'error', code, message });

const bootstrapWarning = (
  code: string,
  message: string
): RuleValidationIssue => ({ severity: 'warning', code, message });

const storedPackById = (snapshot: CompendiumPersistenceState, packId: string) =>
  snapshot.packs.find((entry) => entry.id === packId);

/**
 * Routes bundled content through the correct repository boundary. The public
 * legacy import path remains available for old bundled fixtures and V1 input,
 * while the production PHB uses the transactional V2 path.
 */
const saveBundledPack = async (
  repository: CompendiumRepository,
  pack: BundledCompendiumPackDefinition
): Promise<{
  ok: boolean;
  snapshot: CompendiumPersistenceState;
  issues: RuleValidationIssue[];
  contentHashesBackfilled: number;
}> => {
  const json = serializeBundledCompendiumPack(pack);
  if (pack.importFormat === 'v2') {
    const result = await repository.saveImportV2Json(json);
    return {
      ok: result.ok,
      snapshot: result.snapshot,
      issues: result.issues,
      contentHashesBackfilled: result.summary?.contentHashesBackfilled ?? 0
    };
  }

  const result = await repository.saveImportJson(json);
  return {
    ok: result.ok && Boolean(result.imported),
    snapshot: result.snapshot,
    issues: result.issues,
    contentHashesBackfilled: 0
  };
};

/**
 * Instala os pacotes distribuídos com o aplicativo somente em um compêndio
 * realmente vazio. Em caso de erro, restaura o snapshot original para evitar
 * uma instalação parcial. O conteúdo essencial de criação/progressão é
 * preparado automaticamente usando a mesma rotina já exposta pela UI.
 */
export const initializeBundledCompendium = async (
  repository: CompendiumRepository,
  options: BundledCompendiumBootstrapOptions = {}
): Promise<BundledCompendiumBootstrapResult> => {
  const initialSnapshot = await repository.loadSnapshot();
  const packs = options.packs ?? BUNDLED_COMPENDIUM_PACKS;

  if (!isCompendiumSnapshotEmpty(initialSnapshot) || packs.length === 0) {
    return {
      ok: true,
      seeded: false,
      snapshot: initialSnapshot,
      importedPackIds: [],
      importedItemCount: 0,
      preparedCoreItemCount: 0,
      enabledSourceCount: 0,
      warningCount: 0,
      issues: []
    };
  }

  const importedPackIds: string[] = [];
  let warningCount = 0;
  let currentSnapshot = initialSnapshot;

  try {
    for (const pack of packs) {
      const result = await saveBundledPack(repository, pack);

      warningCount += result.issues.filter(
        (issue) => issue.severity === 'warning'
      ).length;

      if (!result.ok) {
        const errors = result.issues.filter(
          (issue) => issue.severity === 'error'
        );
        await repository.saveSnapshot(initialSnapshot);
        return {
          ok: false,
          seeded: false,
          snapshot: initialSnapshot,
          importedPackIds: [],
          importedItemCount: 0,
          preparedCoreItemCount: 0,
          enabledSourceCount: 0,
          warningCount,
          issues: errors.length
            ? errors
            : [
                bootstrapError(
                  'BUNDLED_COMPENDIUM_IMPORT_FAILED',
                  `O pacote incluído "${pack.label}" não pôde ser importado.`
                )
              ]
        };
      }

      const persistedPack = storedPackById(result.snapshot, pack.id);
      if (!persistedPack) {
        await repository.saveSnapshot(initialSnapshot);
        return {
          ok: false,
          seeded: false,
          snapshot: initialSnapshot,
          importedPackIds: [],
          importedItemCount: 0,
          preparedCoreItemCount: 0,
          enabledSourceCount: 0,
          warningCount,
          issues: [
            bootstrapError(
              'BUNDLED_COMPENDIUM_PACK_ID_MISMATCH',
              `O arquivo "${pack.fileName}" não persistiu o pacote esperado "${pack.id}".`
            )
          ]
        };
      }

      if (pack.importFormat === 'v2' && persistedPack.schemaVersion !== IMPORT_TEMPLATE_VERSION_V2) {
        await repository.saveSnapshot(initialSnapshot);
        return {
          ok: false,
          seeded: false,
          snapshot: initialSnapshot,
          importedPackIds: [],
          importedItemCount: 0,
          preparedCoreItemCount: 0,
          enabledSourceCount: 0,
          warningCount,
          issues: [
            bootstrapError(
              'BUNDLED_COMPENDIUM_SCHEMA_VERSION_MISMATCH',
              `O pacote "${pack.label}" deveria ser persistido como ${IMPORT_TEMPLATE_VERSION_V2}, mas resultou em ${persistedPack.schemaVersion}.`
            )
          ]
        };
      }

      importedPackIds.push(pack.id);
      currentSnapshot = result.snapshot;
    }

    let preparedCoreItemCount = 0;
    let enabledSourceCount = 0;

    if (options.prepareCoreCharacterContent !== false) {
      const prepared = prepareCoreCharacterContentSnapshot(currentSnapshot, {
        now: options.now,
        reviewedBy: 'Bootstrap do compêndio incluído no aplicativo'
      });
      currentSnapshot = prepared.snapshot;
      preparedCoreItemCount = prepared.newlyValidatedItemCount;
      enabledSourceCount = prepared.enabledSourceCount;
      await repository.saveSnapshot(currentSnapshot);
    }

    return {
      ok: true,
      seeded: true,
      snapshot: currentSnapshot,
      importedPackIds,
      importedItemCount: currentSnapshot.items.length,
      preparedCoreItemCount,
      enabledSourceCount,
      warningCount,
      issues: []
    };
  } catch (error) {
    try {
      await repository.saveSnapshot(initialSnapshot);
    } catch {
      // Mantém o erro original; a hidratação exibirá a falha ao usuário.
    }

    return {
      ok: false,
      seeded: false,
      snapshot: initialSnapshot,
      importedPackIds: [],
      importedItemCount: 0,
      preparedCoreItemCount: 0,
      enabledSourceCount: 0,
      warningCount,
      issues: [
        bootstrapError(
          'BUNDLED_COMPENDIUM_BOOTSTRAP_FAILED',
          error instanceof Error
            ? `Falha ao instalar o compêndio incluído: ${error.message}`
            : 'Falha inesperada ao instalar o compêndio incluído.'
        )
      ]
    };
  }
};

export interface RequiredBundledCompendiumRepairResult {
  ok: boolean;
  snapshot: CompendiumPersistenceState;
  restoredPackIds: string[];
  warningCount: number;
  issues: RuleValidationIssue[];
}

/**
 * Ensures the minimal bundled payload required by character creation exists in
 * an already-populated repository. Unlike initializeBundledCompendium, this
 * repair is intentionally additive: unrelated/user packs are preserved and
 * only missing required bundled packs are restored.
 */
export const ensureRequiredCharacterCreationCompendium = async (
  repository: CompendiumRepository,
  options: Pick<BundledCompendiumBootstrapOptions, 'packs'> = {}
): Promise<RequiredBundledCompendiumRepairResult> => {
  const initialSnapshot = await repository.loadSnapshot();
  const packs = options.packs ?? REQUIRED_CHARACTER_CREATION_BUNDLED_PACKS;
  let currentSnapshot = initialSnapshot;
  const restoredPackIds: string[] = [];
  const issues: RuleValidationIssue[] = [];

  try {
    for (const pack of packs) {
      const serialized = serializeBundledCompendiumPack(pack);
      const parsed = parseAndPreviewImportPack(
        serialized,
        existingPreviewItemsFromSnapshot(currentSnapshot)
      );

      if (!parsed.parse.ok || !parsed.preview || !parsed.preview.valid) {
        return {
          ok: false,
          snapshot: currentSnapshot,
          restoredPackIds,
          warningCount: issues.filter((issue) => issue.severity === 'warning').length,
          issues: [
            ...issues,
            bootstrapError(
              'REQUIRED_BUNDLED_COMPENDIUM_REPAIR_PARSE_FAILED',
              `O conteúdo básico "${pack.label}" não pôde ser verificado contra o compêndio local.`
            )
          ]
        };
      }

      const installedPack = storedPackById(currentSnapshot, pack.id);
      const needsPersistenceRepair = !installedPack || parsed.preview.creates > 0;

      // Existing local edits always win. A missing required row can still be
      // supplied non-persistently by the character-choice bridge, but the
      // automatic repair must never overwrite an update/conflict.
      if (needsPersistenceRepair && (parsed.preview.updates > 0 || parsed.preview.conflicts > 0)) {
        return {
          ok: false,
          snapshot: currentSnapshot,
          restoredPackIds,
          warningCount: issues.filter((issue) => issue.severity === 'warning').length,
          issues: [
            ...issues,
            bootstrapError(
              'REQUIRED_BUNDLED_COMPENDIUM_REPAIR_CONFLICT',
              `O conteúdo básico "${pack.label}" possui ${parsed.preview.creates} item(ns) ausente(s), mas existem alterações locais nos mesmos dados. Os itens locais foram preservados e o fallback mecânico do aplicativo será usado para a criação.`
            )
          ]
        };
      }

      if (needsPersistenceRepair) {
        const result = await saveBundledPack(repository, pack);
        issues.push(...result.issues.filter((issue) => issue.severity === 'warning'));

        if (!result.ok || !storedPackById(result.snapshot, pack.id)) {
          return {
            ok: false,
            snapshot: currentSnapshot,
            restoredPackIds,
            warningCount: issues.filter((issue) => issue.severity === 'warning').length,
            issues: [
              ...issues,
              ...result.issues.filter((issue) => issue.severity === 'error'),
              bootstrapError(
                'REQUIRED_BUNDLED_COMPENDIUM_REPAIR_FAILED',
                `O conteúdo básico incluído "${pack.label}" não pôde ser restaurado sem alterar os dados existentes.`
              )
            ]
          };
        }

        currentSnapshot = result.snapshot;
        restoredPackIds.push(pack.id);
      }

      // Old snapshots can retain the pack row while its creation items are
      // unreviewed/disabled by an obsolete import phase. Re-prepare only this
      // required bundled pack; unrelated homebrew/editorial state is untouched.
      const prepared = prepareCoreCharacterContentSnapshot(currentSnapshot, {
        reviewedBy: 'Reparo do conteúdo básico de criação',
        packIds: [pack.id]
      });
      if (
        prepared.newlyValidatedItemCount > 0 ||
        prepared.enabledSourceCount > 0
      ) {
        currentSnapshot = prepared.snapshot;
        await repository.saveSnapshot(currentSnapshot);
      }
    }

    return {
      ok: true,
      snapshot: currentSnapshot,
      restoredPackIds,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      issues
    };
  } catch (error) {
    return {
      ok: false,
      snapshot: currentSnapshot,
      restoredPackIds,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      issues: [
        ...issues,
        bootstrapError(
          'REQUIRED_BUNDLED_COMPENDIUM_REPAIR_FAILED',
          error instanceof Error
            ? `Falha ao restaurar o conteúdo básico incluído: ${error.message}`
            : 'Falha inesperada ao restaurar o conteúdo básico incluído.'
        )
      ]
    };
  }
};

export interface BundledCompendiumInstallResult {
  ok: boolean;
  snapshot: CompendiumPersistenceState;
  packId?: string;
  itemCount: number;
  alreadyInstalled: boolean;
  issues: RuleValidationIssue[];
}

/** Installs one known bundled supplement without overwriting local changes. */
export const installBundledCompendiumPack = async (
  repository: CompendiumRepository,
  packId: string,
  packs: readonly BundledCompendiumPackDefinition[] = BUNDLED_COMPENDIUM_PACKS
): Promise<BundledCompendiumInstallResult> => {
  const initialSnapshot = await repository.loadSnapshot();
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) {
    return {
      ok: false,
      snapshot: initialSnapshot,
      itemCount: 0,
      alreadyInstalled: false,
      issues: [bootstrapError('BUNDLED_COMPENDIUM_PACK_NOT_FOUND', `Pacote incluído não encontrado: ${packId}.`)]
    };
  }
  if (storedPackById(initialSnapshot, pack.id)) {
    return {
      ok: true,
      snapshot: initialSnapshot,
      packId: pack.id,
      itemCount: initialSnapshot.items.filter((item) => item.packId === pack.id).length,
      alreadyInstalled: true,
      issues: []
    };
  }

  const parsed = parseAndPreviewImportPack(
    serializeBundledCompendiumPack(pack),
    existingPreviewItemsFromSnapshot(initialSnapshot)
  );
  const predecessorPackIds = new Set(pack.predecessorPackIds ?? []);
  const existingByStorageId = new Map(initialSnapshot.items.map((item) => [item.id, item]));
  const existingDecisions = parsed.preview?.decisions.filter((entry) => entry.disposition !== 'create' && entry.disposition !== 'conflict') ?? [];
  const managedPredecessorUpgrade = Boolean(
    parsed.preview &&
    predecessorPackIds.size > 0 &&
    existingDecisions.length > 0 &&
    parsed.preview.conflicts === 0 &&
    existingDecisions.every((decision) => {
      const existing = decision.existingStorageId ? existingByStorageId.get(decision.existingStorageId) : undefined;
      return Boolean(existing && predecessorPackIds.has(existing.packId));
    })
  );

  if (
    !parsed.parse.ok ||
    !parsed.parse.data ||
    !parsed.preview ||
    !parsed.preview.valid ||
    parsed.preview.conflicts > 0 ||
    (parsed.preview.updates > 0 && !managedPredecessorUpgrade)
  ) {
    return {
      ok: false,
      snapshot: initialSnapshot,
      itemCount: 0,
      alreadyInstalled: false,
      issues: [bootstrapError(
        'BUNDLED_COMPENDIUM_INSTALL_CONFLICT',
        `"${pack.label}" não foi instalado porque substituiria conteúdo local existente. Revise os conflitos no compêndio antes de instalar.`
      )]
    };
  }

  const saved = await saveBundledPack(repository, pack);
  if (!saved.ok) {
    return {
      ok: false,
      snapshot: initialSnapshot,
      itemCount: 0,
      alreadyInstalled: false,
      issues: saved.issues
    };
  }

  let installedSnapshot = saved.snapshot;
  const installIssues = saved.issues.filter((issue) => issue.severity !== 'error');

  if (managedPredecessorUpgrade) {
    const retainedIds = new Set(parsed.parse.data.items.map((item) => item.id));
    installedSnapshot = {
      ...installedSnapshot,
      packs: installedSnapshot.packs.filter((storedPack) => !predecessorPackIds.has(storedPack.id)),
      items: installedSnapshot.items
        .filter((item) => !predecessorPackIds.has(item.packId) || retainedIds.has(item.importItemId))
        .map((item) =>
          predecessorPackIds.has(item.packId) && retainedIds.has(item.importItemId)
            ? { ...item, packId: pack.id }
            : item
        )
    };
    await repository.saveSnapshot(installedSnapshot);
    installIssues.push(bootstrapWarning(
      'BUNDLED_COMPENDIUM_MANAGED_PREDECESSOR_UPGRADED',
      `O conteúdo anterior de "${pack.label}" foi migrado para o perfil incluído atual; itens suprimidos pela política 2024-first foram removidos e referências de storage dos itens retidos foram preservadas.`
    ));
  }

  const prepared = prepareCoreCharacterContentSnapshot(installedSnapshot, {
    reviewedBy: managedPredecessorUpgrade ? 'Migração de suplemento incluído' : 'Instalação de suplemento incluído',
    packIds: [pack.id]
  });
  await repository.saveSnapshot(prepared.snapshot);

  return {
    ok: true,
    snapshot: prepared.snapshot,
    packId: pack.id,
    itemCount: prepared.snapshot.items.filter((item) => item.packId === pack.id).length,
    alreadyInstalled: false,
    issues: installIssues
  };
};

/**
 * Controlled V1 -> V2 bundled cutover for an already-installed logical pack.
 *
 * Safety rule: automatic reconciliation is allowed only when every bundled V2
 * item is semantically unchanged relative to the installed catalog. This
 * permits contentHash backfill and pack-schema promotion without overwriting
 * local mappings/review decisions. If the preview sees creates, updates or
 * conflicts, reconciliation is deferred and the user's persisted content wins.
 */
export const reconcileBundledCompendium = async (
  repository: CompendiumRepository,
  options: BundledCompendiumBootstrapOptions = {}
): Promise<BundledCompendiumReconciliationResult> => {
  const initialSnapshot = await repository.loadSnapshot();
  const packs = options.packs ?? BUNDLED_COMPENDIUM_PACKS;
  let currentSnapshot = initialSnapshot;
  const reconciledPackIds: string[] = [];
  const deferredPackIds: string[] = [];
  const issues: RuleValidationIssue[] = [];
  let contentHashesBackfilled = 0;

  for (const pack of packs) {
    if (pack.importFormat !== 'v2') continue;
    const installedPack = storedPackById(currentSnapshot, pack.id);
    if (!installedPack) continue;

    // A pack already promoted to V2 does not need a bootstrap-time replay.
    // Future content releases must use the explicit catalog update workflow.
    if (installedPack.schemaVersion === IMPORT_TEMPLATE_VERSION_V2) continue;

    const parsed = parseAndPreviewImportPack(
      serializeBundledCompendiumPack(pack),
      existingPreviewItemsFromSnapshot(currentSnapshot)
    );

    if (!parsed.parse.ok || !parsed.parse.data || !parsed.preview) {
      deferredPackIds.push(pack.id);
      issues.push(
        bootstrapWarning(
          'BUNDLED_COMPENDIUM_V2_RECONCILIATION_PARSE_FAILED',
          `A migração automática de "${pack.label}" para Import V2 foi adiada porque o preview canônico não pôde ser produzido.`
        )
      );
      continue;
    }

    const preview = parsed.preview;
    if (!preview.valid || preview.creates > 0 || preview.updates > 0 || preview.conflicts > 0) {
      deferredPackIds.push(pack.id);
      issues.push(
        bootstrapWarning(
          'BUNDLED_COMPENDIUM_V2_RECONCILIATION_DEFERRED',
          `A migração automática de "${pack.label}" para Import V2 foi adiada para preservar conteúdo local: ` +
          `${preview.creates} create(s), ${preview.updates} update(s), ${preview.conflicts} conflito(s).`
        )
      );
      continue;
    }

    const result = await repository.saveImportV2Json(
      serializeBundledCompendiumPack(pack)
    );
    if (!result.ok) {
      deferredPackIds.push(pack.id);
      issues.push(
        bootstrapWarning(
          'BUNDLED_COMPENDIUM_V2_RECONCILIATION_SAVE_FAILED',
          `A migração automática de "${pack.label}" para Import V2 foi adiada porque a persistência transacional falhou.`
        )
      );
      continue;
    }

    const promotedPack = storedPackById(result.snapshot, pack.id);
    if (!promotedPack || promotedPack.schemaVersion !== IMPORT_TEMPLATE_VERSION_V2) {
      deferredPackIds.push(pack.id);
      issues.push(
        bootstrapWarning(
          'BUNDLED_COMPENDIUM_V2_RECONCILIATION_SCHEMA_FAILED',
          `A migração automática de "${pack.label}" não confirmou ${IMPORT_TEMPLATE_VERSION_V2}; o snapshot anterior será mantido na próxima tentativa.`
        )
      );
      continue;
    }

    currentSnapshot = result.snapshot;
    reconciledPackIds.push(pack.id);
    contentHashesBackfilled += result.summary?.contentHashesBackfilled ?? 0;
  }

  return {
    ok: issues.every((entry) => entry.severity !== 'error'),
    reconciled: reconciledPackIds.length > 0,
    snapshot: currentSnapshot,
    reconciledPackIds,
    deferredPackIds,
    contentHashesBackfilled,
    warningCount: issues.filter((entry) => entry.severity === 'warning').length,
    issues
  };
};
