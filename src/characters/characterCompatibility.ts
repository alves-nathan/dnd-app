import { ContentPolicyService } from '../catalog/contentPolicyService';
import type { CharacterChoiceItem } from '../catalog/characterChoiceTypes';
import type { CatalogFilterState, CatalogSnapshot, EntityAvailability } from '../catalog/types';
import type { Character, CharacterCompendiumLink } from '../types';

export type CharacterCompatibilityStatus = 'compatible' | 'review' | 'blocked';
export type CharacterCompatibilityReferenceStatus = 'available' | 'review' | 'disabled' | 'missing';
export type CharacterCompatibilityIssueCode =
  | 'CHARACTER_SNAPSHOT_MISMATCH'
  | 'CHARACTER_CATALOG_ENTITY_MISSING'
  | 'CHARACTER_CATALOG_ENTITY_DISABLED'
  | 'CHARACTER_CATALOG_PAYLOAD_UNAVAILABLE'
  | 'CHARACTER_CATALOG_EDITORIAL_REVIEW'
  | 'CHARACTER_LOCAL_ITEM_MISSING'
  | 'CHARACTER_LOCAL_ITEM_DISABLED'
  | 'CHARACTER_LINK_NEEDS_REVIEW';

export interface CharacterCompatibilityResolutionAction {
  kind: 'reviewRules' | 'enableContent' | 'reviewLocalContent' | 'replaceChoice' | 'removeReference';
  label: string;
  route: 'content-management' | 'compendium' | 'character-compendium';
}

export interface CharacterCompatibilityReference {
  key: string;
  choiceId: string;
  origin: 'catalog' | 'compendium';
  role: string;
  label: string;
  entityId?: string;
  itemId?: string;
  linkId?: string;
  appliedAs?: CharacterCompendiumLink['appliedAs'];
  appliedEntityId?: string;
  kind?: string;
  sourceBookId?: string;
  sourceId?: string;
  snapshotId?: string;
  status: CharacterCompatibilityReferenceStatus;
  reason?: string;
  manualReviewRequired: boolean;
  discoveredFrom: string[];
}

export interface CharacterRulesManifest {
  schemaVersion: 'dnd-character-rules-manifest.v1';
  characterId: string;
  characterName: string;
  generatedAt: string;
  characterCatalogSnapshotId?: string;
  currentCatalogSnapshotId: string;
  currentCatalogVersion: string;
  catalogSnapshotIds: string[];
  sourceBookIds: string[];
  sourceIds: string[];
  catalogEntityIds: string[];
  compendiumItemIds: string[];
  references: CharacterCompatibilityReference[];
  counts: {
    total: number;
    available: number;
    review: number;
    disabled: number;
    missing: number;
    catalog: number;
    compendium: number;
  };
}

export interface CharacterCompatibilityIssue {
  id: string;
  severity: 'warning' | 'error';
  code: CharacterCompatibilityIssueCode;
  title: string;
  message: string;
  referenceKey?: string;
  entityId?: string;
  choiceId?: string;
  sourceBookId?: string;
  availabilityReason?: EntityAvailability['reason'];
  actions: CharacterCompatibilityResolutionAction[];
}

export interface CharacterCompatibilityReport {
  status: CharacterCompatibilityStatus;
  requiresReview: boolean;
  canOpenAfterAcknowledgement: boolean;
  manifest: CharacterRulesManifest;
  issues: CharacterCompatibilityIssue[];
  blockingIssueCount: number;
  warningCount: number;
}

export interface CharacterCompatibilityInput {
  character: Character;
  snapshot: CatalogSnapshot;
  filterState: CatalogFilterState;
  choices: readonly CharacterChoiceItem[];
  now?: () => Date;
}

interface CollectedReference {
  choiceId: string;
  role: string;
  label: string;
  discoveredFrom: string;
  link?: CharacterCompendiumLink;
}

const normalizedReference = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('catalog:') || trimmed.startsWith('compendium:')) return trimmed;
  return trimmed;
};

const collectCharacterReferences = (character: Character): CollectedReference[] => {
  const references: CollectedReference[] = [];
  const push = (value: string | undefined, role: string, label: string, discoveredFrom: string, link?: CharacterCompendiumLink) => {
    const choiceId = normalizedReference(value);
    if (choiceId) references.push({ choiceId, role, label, discoveredFrom, link });
  };

  for (const link of character.compendiumLinks ?? []) {
    if (link.status === 'removed') continue;
    push(link.choiceId ?? link.itemId, link.appliedAs, link.appliedEntityName, 'compendiumLinks', link);
  }

  push(character.originFeatId, 'originFeat', 'Origin Feat', 'originFeatId');
  push(character.buildChoices?.startingClassItemId, 'class', 'Classe inicial', 'buildChoices.startingClassItemId');
  for (const choice of character.buildChoices?.speciesChoices ?? []) {
    push(choice.speciesItemId, 'species', 'Espécie', 'buildChoices.speciesChoices.speciesItemId');
    push(choice.featureItemId, 'feature', 'Opção de espécie', 'buildChoices.speciesChoices.featureItemId');
  }
  for (const choice of character.buildChoices?.subclassChoices ?? []) {
    push(choice.subclassItemId, 'subclass', 'Configuração de subclasse', 'buildChoices.subclassChoices.subclassItemId');
  }
  for (const [source, target] of Object.entries(character.buildChoices?.spellAssignments ?? {})) {
    push(source, 'spellSource', 'Origem de magia', 'buildChoices.spellAssignments.key');
    push(target, 'spell', 'Magia atribuída', 'buildChoices.spellAssignments.value');
  }
  for (const [source, target] of Object.entries(character.buildChoices?.spellbookAssignments ?? {})) {
    push(source, 'spellbookSource', 'Origem de spellbook', 'buildChoices.spellbookAssignments.key');
    push(target, 'spell', 'Magia do spellbook', 'buildChoices.spellbookAssignments.value');
  }
  for (const selection of character.buildChoices?.equipmentSelections ?? []) {
    push(selection.sourceItemId, 'equipmentSource', 'Origem de equipamento', 'buildChoices.equipmentSelections.sourceItemId');
    for (const item of selection.items ?? []) push(item.compendiumItemId, 'equipment', item.label, 'buildChoices.equipmentSelections.items');
  }
  for (const invocation of character.buildChoices?.eldritchInvocationChoices ?? []) {
    push(invocation.invocationItemId, 'invocation', 'Eldritch Invocation', 'buildChoices.eldritchInvocationChoices.invocationItemId');
    for (const id of invocation.cantripItemIds ?? []) push(id, 'spell', 'Cantrip de invocação', 'buildChoices.eldritchInvocationChoices.cantripItemIds');
    for (const id of invocation.ritualSpellItemIds ?? []) push(id, 'spell', 'Ritual de invocação', 'buildChoices.eldritchInvocationChoices.ritualSpellItemIds');
    push(invocation.targetCantripItemId, 'spell', 'Cantrip alvo', 'buildChoices.eldritchInvocationChoices.targetCantripItemId');
    push(invocation.originFeatItemId, 'feat', 'Feat concedido', 'buildChoices.eldritchInvocationChoices.originFeatItemId');
    push(invocation.familiarCreatureItemId, 'creature', 'Familiar', 'buildChoices.eldritchInvocationChoices.familiarCreatureItemId');
  }
  push(character.buildChoices?.pactWeapon?.sourceWeaponItemId, 'weapon', 'Arma de pacto', 'buildChoices.pactWeapon.sourceWeaponItemId');
  push(character.buildChoices?.gazeOfTwoMinds?.invocationItemId, 'invocation', 'Gaze of Two Minds', 'buildChoices.gazeOfTwoMinds.invocationItemId');
  push(character.buildChoices?.giftOfProtectors?.invocationItemId, 'invocation', 'Gift of the Protectors', 'buildChoices.giftOfProtectors.invocationItemId');
  push(character.buildChoices?.oneWithShadows?.invocationItemId, 'invocation', 'One with Shadows', 'buildChoices.oneWithShadows.invocationItemId');

  for (const feat of character.featChoices ?? []) {
    push(feat.featItemId, 'feat', 'Feat', 'featChoices.featItemId');
    for (const id of feat.spellItemIds ?? []) push(id, 'spell', 'Magia de feat', 'featChoices.spellItemIds');
    for (const id of feat.weaponItemIds ?? []) push(id, 'weapon', 'Arma de feat', 'featChoices.weaponItemIds');
    push(feat.fightingStyleItemId, 'feature', 'Fighting Style', 'featChoices.fightingStyleItemId');
  }
  for (const entry of character.spellbookEntries ?? []) {
    push(entry.classItemId, 'class', 'Classe do spellbook', 'spellbookEntries.classItemId');
    push(entry.spellItemId, 'spell', entry.spellName, 'spellbookEntries.spellItemId');
  }
  for (const mastery of character.weaponMasteries ?? []) {
    push(mastery.sourceItemId, 'masterySource', 'Origem de mastery', 'weaponMasteries.sourceItemId');
    push(mastery.weaponItemId, 'weapon', mastery.weaponName, 'weaponMasteries.weaponItemId');
  }
  for (const pending of character.pendingChoices ?? []) {
    if (pending.status === 'pending') push(pending.sourceItemId, 'pendingChoice', pending.title, 'pendingChoices.sourceItemId');
  }

  return references;
};

const resolveCatalogAlias = (snapshot: CatalogSnapshot, initialId: string): string => {
  const visited = new Set<string>();
  let current = initialId;
  while (!visited.has(current)) {
    visited.add(current);
    const alias = snapshot.aliases.get(current);
    if (!alias || alias.status !== 'active') break;
    current = alias.to;
  }
  return current;
};

const actionsForCatalog = (missing: boolean): CharacterCompatibilityResolutionAction[] => [
  { kind: missing ? 'reviewRules' : 'enableContent', label: missing ? 'Revisar catálogo e snapshot' : 'Revisar livros e filtros', route: 'content-management' },
  { kind: 'replaceChoice', label: 'Escolher substituição', route: 'character-compendium' },
  { kind: 'removeReference', label: 'Revisar remoção manual', route: 'character-compendium' }
];

const actionsForLocal = (): CharacterCompatibilityResolutionAction[] => [
  { kind: 'reviewLocalContent', label: 'Revisar conteúdo local', route: 'compendium' },
  { kind: 'replaceChoice', label: 'Escolher substituição', route: 'character-compendium' },
  { kind: 'removeReference', label: 'Revisar remoção manual', route: 'character-compendium' }
];

const deduplicateCollectedReferences = (references: CollectedReference[]): CollectedReference[] => {
  const byKey = new Map<string, CollectedReference>();
  for (const reference of references) {
    const linkIdentity = reference.link?.catalogEntityId ?? reference.link?.itemId ?? reference.choiceId;
    const key = `${reference.choiceId}|${linkIdentity}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, reference);
      continue;
    }
    existing.discoveredFrom = `${existing.discoveredFrom},${reference.discoveredFrom}`;
  }
  return Array.from(byKey.values());
};

export const buildCharacterCompatibilityReport = (input: CharacterCompatibilityInput): CharacterCompatibilityReport => {
  const now = input.now ?? (() => new Date());
  const policy = new ContentPolicyService(input.snapshot);
  const choiceById = new Map<string, CharacterChoiceItem>();
  for (const choice of input.choices) {
    for (const id of [choice.choiceId, choice.entityId, choice.catalogEntityId, choice.compendiumItemId, ...choice.provenance.legacyItemIds]) {
      if (id) choiceById.set(id, choice);
    }
  }

  const issues: CharacterCompatibilityIssue[] = [];
  const references: CharacterCompatibilityReference[] = [];
  const collected = deduplicateCollectedReferences(collectCharacterReferences(input.character));

  if (input.character.catalogSnapshotId && input.character.catalogSnapshotId !== input.snapshot.snapshotId) {
    issues.push({
      id: 'snapshot-mismatch',
      severity: 'warning',
      code: 'CHARACTER_SNAPSHOT_MISMATCH',
      title: 'Snapshot do catálogo diferente',
      message: `A ficha foi registrada em ${input.character.catalogSnapshotId}, enquanto o aplicativo usa ${input.snapshot.snapshotId}. Nenhuma escolha será migrada automaticamente.`,
      actions: [{ kind: 'reviewRules', label: 'Comparar regras atuais', route: 'content-management' }]
    });
  }

  for (const collectedReference of collected) {
    const linkedCatalogId = collectedReference.link?.catalogEntityId;
    const rawCatalogId = linkedCatalogId
      ?? (collectedReference.choiceId.startsWith('catalog:') ? collectedReference.choiceId.slice('catalog:'.length) : undefined);
    const isCatalog = Boolean(rawCatalogId) || collectedReference.link?.origin === 'catalog';
    const discoveredFrom = collectedReference.discoveredFrom.split(',').filter(Boolean);

    if (isCatalog) {
      const initialEntityId = rawCatalogId ?? collectedReference.choiceId;
      const entityId = resolveCatalogAlias(input.snapshot, initialEntityId);
      const entry = input.snapshot.entryById.get(entityId);
      if (!entry) {
        const reference: CharacterCompatibilityReference = {
          key: `catalog:${initialEntityId}`,
          choiceId: collectedReference.choiceId,
          origin: 'catalog',
          role: collectedReference.role,
          label: collectedReference.label,
          entityId: initialEntityId,
          linkId: collectedReference.link?.id,
          appliedAs: collectedReference.link?.appliedAs,
          appliedEntityId: collectedReference.link?.appliedEntityId,
          sourceBookId: collectedReference.link?.sourceId && input.snapshot.manifest.sourceBooks.includes(collectedReference.link.sourceId) ? collectedReference.link.sourceId : undefined,
          sourceId: collectedReference.link?.sourceId,
          snapshotId: collectedReference.link?.catalogSnapshotId ?? input.character.catalogSnapshotId,
          status: 'missing',
          reason: 'A entidade não existe no catálogo atual.',
          manualReviewRequired: false,
          discoveredFrom
        };
        references.push(reference);
        issues.push({
          id: `catalog-missing:${initialEntityId}`,
          severity: 'error',
          code: 'CHARACTER_CATALOG_ENTITY_MISSING',
          title: `${collectedReference.label} não existe no catálogo atual`,
          message: `A referência ${initialEntityId} foi preservada na ficha, mas não foi encontrada no snapshot ${input.snapshot.snapshotId}.`,
          referenceKey: reference.key,
          entityId: initialEntityId,
          choiceId: collectedReference.choiceId,
          actions: actionsForCatalog(true)
        });
        continue;
      }

      const availability = policy.evaluate(entry, input.filterState);
      const choice = choiceById.get(`catalog:${entry.entityId}`) ?? choiceById.get(entry.entityId);
      const payloadUnavailable = choice?.blockedReasons.some((reason) => reason.code === 'catalogPayloadUnavailable') ?? false;
      const manualReview = entry.manualReviewRequired || Boolean(collectedReference.link?.manualReviewRequired) || Boolean(choice?.manualReviewRequired);
      const status: CharacterCompatibilityReferenceStatus = !availability.enabled
        ? 'disabled'
        : manualReview || payloadUnavailable || collectedReference.link?.status === 'needsReview'
          ? 'review'
          : 'available';
      const reference: CharacterCompatibilityReference = {
        key: `catalog:${entry.entityId}`,
        choiceId: `catalog:${entry.entityId}`,
        origin: 'catalog',
        role: collectedReference.role,
        label: entry.displayName || collectedReference.label,
        entityId: entry.entityId,
        linkId: collectedReference.link?.id,
        appliedAs: collectedReference.link?.appliedAs,
        appliedEntityId: collectedReference.link?.appliedEntityId,
        kind: entry.kind,
        sourceBookId: entry.sourceBookId ?? undefined,
        sourceId: entry.sourceBookId ?? 'catalog',
        snapshotId: collectedReference.link?.catalogSnapshotId ?? input.character.catalogSnapshotId,
        status,
        reason: !availability.enabled ? availability.reason : payloadUnavailable ? 'Payload mecânico indisponível.' : manualReview ? 'Revisão editorial necessária.' : undefined,
        manualReviewRequired: manualReview,
        discoveredFrom
      };
      references.push(reference);

      if (!availability.enabled) {
        issues.push({
          id: `catalog-disabled:${entry.entityId}`,
          severity: 'error',
          code: 'CHARACTER_CATALOG_ENTITY_DISABLED',
          title: `${entry.displayName} está desativado`,
          message: `A ficha utiliza ${entry.displayName}, mas os filtros atuais o bloquearam (${availability.reason}).`,
          referenceKey: reference.key,
          entityId: entry.entityId,
          choiceId: reference.choiceId,
          sourceBookId: entry.sourceBookId ?? undefined,
          availabilityReason: availability.reason,
          actions: actionsForCatalog(false)
        });
      }
      if (payloadUnavailable) {
        issues.push({
          id: `catalog-payload:${entry.entityId}`,
          severity: 'warning',
          code: 'CHARACTER_CATALOG_PAYLOAD_UNAVAILABLE',
          title: `Payload de ${entry.displayName} indisponível`,
          message: 'A referência oficial existe, mas o pacote mecânico atual não contém os dados necessários para reaplicá-la.',
          referenceKey: reference.key,
          entityId: entry.entityId,
          choiceId: reference.choiceId,
          sourceBookId: entry.sourceBookId ?? undefined,
          actions: actionsForCatalog(true)
        });
      }
      if (manualReview) {
        issues.push({
          id: `catalog-review:${entry.entityId}`,
          severity: 'warning',
          code: 'CHARACTER_CATALOG_EDITORIAL_REVIEW',
          title: `${entry.displayName} requer revisão`,
          message: 'A entidade continua utilizável, mas mantém sinalização editorial ou um vínculo marcado para revisão.',
          referenceKey: reference.key,
          entityId: entry.entityId,
          choiceId: reference.choiceId,
          sourceBookId: entry.sourceBookId ?? undefined,
          actions: [{ kind: 'reviewRules', label: 'Revisar regra e origem', route: 'content-management' }]
        });
      } else if (collectedReference.link?.status === 'needsReview') {
        issues.push({
          id: `link-review:${entry.entityId}`,
          severity: 'warning',
          code: 'CHARACTER_LINK_NEEDS_REVIEW',
          title: `${entry.displayName} possui vínculo pendente`,
          message: 'O vínculo aplicado à ficha foi marcado como needsReview e deve ser conferido manualmente.',
          referenceKey: reference.key,
          entityId: entry.entityId,
          choiceId: reference.choiceId,
          actions: [{ kind: 'replaceChoice', label: 'Revisar na ficha', route: 'character-compendium' }]
        });
      }
      continue;
    }

    const localChoice = choiceById.get(collectedReference.choiceId)
      ?? choiceById.get(collectedReference.choiceId.replace(/^compendium:/, ''))
      ?? (collectedReference.link ? choiceById.get(collectedReference.link.itemId) : undefined);
    if (!localChoice) {
      const itemId = collectedReference.choiceId.replace(/^compendium:/, '');
      const reference: CharacterCompatibilityReference = {
        key: `compendium:${itemId}`,
        choiceId: collectedReference.choiceId,
        origin: 'compendium',
        role: collectedReference.role,
        label: collectedReference.label,
        itemId,
        linkId: collectedReference.link?.id,
        appliedAs: collectedReference.link?.appliedAs,
        appliedEntityId: collectedReference.link?.appliedEntityId,
        sourceId: collectedReference.link?.sourceId,
        status: 'missing',
        reason: 'O item local não está disponível no compêndio atual.',
        manualReviewRequired: false,
        discoveredFrom
      };
      references.push(reference);
      issues.push({
        id: `local-missing:${itemId}`,
        severity: 'error',
        code: 'CHARACTER_LOCAL_ITEM_MISSING',
        title: `${collectedReference.label} não está no compêndio`,
        message: `A ficha preserva a referência ${collectedReference.choiceId}, mas o item local não foi encontrado.`,
        referenceKey: reference.key,
        choiceId: collectedReference.choiceId,
        actions: actionsForLocal()
      });
      continue;
    }

    const localStatus: CharacterCompatibilityReferenceStatus = localChoice.available
      ? localChoice.manualReviewRequired || collectedReference.link?.status === 'needsReview' ? 'review' : 'available'
      : 'disabled';
    const reference: CharacterCompatibilityReference = {
      key: localChoice.choiceId,
      choiceId: localChoice.choiceId,
      origin: 'compendium',
      role: collectedReference.role,
      label: localChoice.name,
      entityId: localChoice.catalogEntityId,
      itemId: localChoice.compendiumItemId,
      linkId: collectedReference.link?.id,
      appliedAs: collectedReference.link?.appliedAs,
      appliedEntityId: collectedReference.link?.appliedEntityId,
      kind: localChoice.kind,
      sourceBookId: localChoice.sourceBookId,
      sourceId: localChoice.provenance.sourceId,
      snapshotId: localChoice.catalogSnapshotId,
      status: localStatus,
      reason: localChoice.blockedReasons.map((reason) => reason.message).join(' ') || undefined,
      manualReviewRequired: localChoice.manualReviewRequired,
      discoveredFrom
    };
    references.push(reference);
    if (!localChoice.available) {
      issues.push({
        id: `local-disabled:${localChoice.choiceId}`,
        severity: 'error',
        code: 'CHARACTER_LOCAL_ITEM_DISABLED',
        title: `${localChoice.name} não está disponível`,
        message: localChoice.blockedReasons.map((reason) => reason.message).join(' ') || 'A fonte local ou o status de revisão bloqueia este conteúdo.',
        referenceKey: reference.key,
        entityId: localChoice.catalogEntityId,
        choiceId: localChoice.choiceId,
        sourceBookId: localChoice.sourceBookId,
        actions: actionsForLocal()
      });
    } else if (localStatus === 'review') {
      issues.push({
        id: `local-review:${localChoice.choiceId}`,
        severity: 'warning',
        code: 'CHARACTER_LINK_NEEDS_REVIEW',
        title: `${localChoice.name} precisa de conferência`,
        message: 'O conteúdo local ou o vínculo aplicado à ficha está marcado para revisão.',
        referenceKey: reference.key,
        choiceId: localChoice.choiceId,
        actions: actionsForLocal()
      });
    }
  }

  const uniqueIssues = Array.from(new Map(issues.map((issue) => [issue.id, issue])).values());
  const uniqueReferences = Array.from(new Map(references.map((reference) => [reference.key, reference])).values());
  const blockingIssueCount = uniqueIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = uniqueIssues.filter((issue) => issue.severity === 'warning').length;
  const status: CharacterCompatibilityStatus = blockingIssueCount > 0 ? 'blocked' : warningCount > 0 ? 'review' : 'compatible';
  const catalogSnapshotIds = Array.from(new Set([
    input.character.catalogSnapshotId,
    ...uniqueReferences.map((reference) => reference.snapshotId)
  ].filter((value): value is string => Boolean(value)))).sort();

  const manifest: CharacterRulesManifest = {
    schemaVersion: 'dnd-character-rules-manifest.v1',
    characterId: input.character.id,
    characterName: input.character.name,
    generatedAt: now().toISOString(),
    characterCatalogSnapshotId: input.character.catalogSnapshotId,
    currentCatalogSnapshotId: input.snapshot.snapshotId,
    currentCatalogVersion: input.snapshot.catalogVersion,
    catalogSnapshotIds,
    sourceBookIds: Array.from(new Set(uniqueReferences.map((reference) => reference.sourceBookId).filter((value): value is string => Boolean(value)))).sort(),
    sourceIds: Array.from(new Set(uniqueReferences.map((reference) => reference.sourceId).filter((value): value is string => Boolean(value)))).sort(),
    catalogEntityIds: Array.from(new Set(uniqueReferences.map((reference) => reference.entityId).filter((value): value is string => Boolean(value)))).sort(),
    compendiumItemIds: Array.from(new Set(uniqueReferences.map((reference) => reference.itemId).filter((value): value is string => Boolean(value)))).sort(),
    references: uniqueReferences.sort((left, right) => left.label.localeCompare(right.label)),
    counts: {
      total: uniqueReferences.length,
      available: uniqueReferences.filter((reference) => reference.status === 'available').length,
      review: uniqueReferences.filter((reference) => reference.status === 'review').length,
      disabled: uniqueReferences.filter((reference) => reference.status === 'disabled').length,
      missing: uniqueReferences.filter((reference) => reference.status === 'missing').length,
      catalog: uniqueReferences.filter((reference) => reference.origin === 'catalog').length,
      compendium: uniqueReferences.filter((reference) => reference.origin === 'compendium').length
    }
  };

  return {
    status,
    requiresReview: status !== 'compatible',
    canOpenAfterAcknowledgement: true,
    manifest,
    issues: uniqueIssues,
    blockingIssueCount,
    warningCount
  };
};
