import { ContentPolicyService } from './contentPolicyService';
import type { RuntimeCatalogEntry } from './types';
import type { StoredCompendiumItem } from '../compendium/types';
import type {
  CharacterChoiceBlockReason,
  CharacterChoiceBridgeInput,
  CharacterChoiceItem,
  CharacterChoiceKind,
  CharacterChoiceQuery,
  CharacterChoiceQueryResult,
  CharacterChoiceResolution
} from './characterChoiceTypes';
import {
  canonicalCatalogEntityIdForItem,
  catalogEntryFallbackKey,
  collectOwnerIds,
  fallbackDeduplicationKey,
  itemAuthorizesCatalogOverride,
  localSourceBookId,
  localSourceLabel,
  mapCatalogKindToChoiceKind,
  normalizeChoiceName
} from './characterChoiceDeduplication';

const normalizedText = (value: string): string => normalizeChoiceName(value);

const sourceBookBlockReason = (entry: RuntimeCatalogEntry): CharacterChoiceBlockReason => ({
  code: 'sourceBookDisabled',
  message: `O livro ${entry.sourceBookId ?? 'da entidade'} está desativado no perfil de conteúdo.`
});

const availabilityBlockReason = (
  reason: string,
  entry: RuntimeCatalogEntry
): CharacterChoiceBlockReason => {
  if (reason === 'categoryDisabled') {
    return { code: 'categoryDisabled', message: `A categoria de ${entry.displayName} está desativada.` };
  }
  return { code: 'entityDisabled', message: `${entry.displayName} está desativado pelos filtros do catálogo.` };
};

const itemPayload = (item: StoredCompendiumItem): Record<string, unknown> => ({
  ...item.normalizedJson
});

const isTechnicalSupportLocalItem = (item: StoredCompendiumItem): boolean => {
  if (item.type !== 'feature') return false;
  const payload = itemPayload(item);
  const sourceType = typeof payload.sourceType === 'string' ? payload.sourceType.trim().toLowerCase() : '';
  const listKind = typeof payload.listKind === 'string' ? payload.listKind.trim().toLowerCase() : '';
  return sourceType === 'spelllist' || sourceType === 'importindex' || listKind === 'classspelllist';
};

const buildFallbackEntryIds = (
  input: CharacterChoiceBridgeInput
): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const entry of input.snapshot.entries) {
    const kind = mapCatalogKindToChoiceKind(entry.kind);
    if (!kind) continue;
    const key = catalogEntryFallbackKey(entry, kind);
    const values = index.get(key) ?? [];
    values.push(entry.entityId);
    index.set(key, values);
  }
  return index;
};

interface PreparedLocalItem {
  item: StoredCompendiumItem;
  canonicalCatalogEntityId?: string;
  ambiguous: boolean;
  overrideAuthorized: boolean;
}

const prepareLocalItems = (
  input: CharacterChoiceBridgeInput,
  fallbackEntryIdsByKey: ReadonlyMap<string, readonly string[]>
): PreparedLocalItem[] => input.compendiumItems.map((item) => {
  const canonical = canonicalCatalogEntityIdForItem(item, input.snapshot, fallbackEntryIdsByKey);
  return {
    item,
    canonicalCatalogEntityId: canonical.entityId,
    ambiguous: canonical.ambiguous,
    overrideAuthorized: Boolean(canonical.entityId) && itemAuthorizesCatalogOverride(item)
  };
});

const catalogChoice = (
  entry: RuntimeCatalogEntry,
  carrier: PreparedLocalItem | undefined,
  input: CharacterChoiceBridgeInput,
  policy: ContentPolicyService
): CharacterChoiceItem | undefined => {
  const kind = mapCatalogKindToChoiceKind(entry.kind, carrier?.item.type);
  if (!kind) return undefined;
  const availability = policy.evaluate(entry, input.filterState);
  const blockedReasons: CharacterChoiceBlockReason[] = [];
  if (!availability.enabled) {
    blockedReasons.push(
      availability.reason === 'sourceBookDisabled'
        ? sourceBookBlockReason(entry)
        : availabilityBlockReason(availability.reason, entry)
    );
  }
  if (!carrier) {
    blockedReasons.push({
      code: 'catalogPayloadUnavailable',
      message: 'O índice oficial existe, mas o payload mecânico necessário não está disponível neste pacote do aplicativo.'
    });
  }
  const payload = carrier ? itemPayload(carrier.item) : {};
  const sourceBookId = entry.sourceBookId ?? undefined;
  const sourceLabel = sourceBookId?.toUpperCase() ?? 'Catálogo oficial';
  const legacyItemIds = carrier
    ? Array.from(new Set([carrier.item.id, carrier.item.importItemId, entry.entityId]))
    : [entry.entityId];

  return {
    choiceId: `catalog:${entry.entityId}`,
    entityId: entry.entityId,
    kind,
    name: entry.displayName,
    summary: carrier?.item.summary,
    sourceBookId,
    sourceLabel,
    origin: 'catalog',
    catalogSnapshotId: input.snapshot.snapshotId,
    catalogEntityId: entry.entityId,
    compendiumItemId: carrier?.item.id,
    ownerIds: collectOwnerIds(payload, entry, input.snapshot),
    searchableText: [entry.searchKey, carrier?.item.summary ?? '', sourceLabel, kind].join(' '),
    available: blockedReasons.length === 0,
    blockedReasons,
    manualReviewRequired: entry.manualReviewRequired,
    payload,
    provenance: {
      origin: 'catalog',
      sourceBookId,
      sourceId: sourceBookId ?? 'catalog',
      catalogSnapshotId: input.snapshot.snapshotId,
      catalogVersion: input.snapshot.catalogVersion,
      catalogEntityId: entry.entityId,
      carrierCompendiumItemId: carrier?.item.id,
      legacyItemIds,
      overrideAuthorized: false
    }
  };
};

const localChoice = (
  prepared: PreparedLocalItem,
  input: CharacterChoiceBridgeInput
): CharacterChoiceItem => {
  const { item } = prepared;
  const sourceEnabled = input.enabledSourceIds.includes(item.sourceId);
  const blockedReasons: CharacterChoiceBlockReason[] = [];
  if (!sourceEnabled) {
    blockedReasons.push({
      code: 'localSourceDisabled',
      message: `A fonte local ${localSourceLabel(item)} está desativada.`
    });
  }
  // Character usage and compendium editorial approval are intentionally
  // separate concerns. Active local/imported records may remain needsReview
  // or draft and still be chosen explicitly by a character; the review flag
  // is preserved as provenance and never promoted here. Only disabled content
  // is mechanically unavailable.
  if (item.status === 'disabled') {
    blockedReasons.push({
      code: 'localItemNotValidated',
      message: `O item local está desativado e não pode ser aplicado à ficha.`
    });
  }
  if (isTechnicalSupportLocalItem(item)) {
    blockedReasons.push({
      code: 'unsupportedKind',
      message: 'Este registro é suporte técnico do compêndio e não representa uma escolha aplicável à ficha.'
    });
  }
  if (prepared.ambiguous) {
    blockedReasons.push({
      code: 'ambiguousCollision',
      message: 'Há mais de uma entidade oficial possível para esta combinação de nome, tipo e fonte; a escolha local foi preservada separadamente.'
    });
  }
  const payload = itemPayload(item);
  const sourceBookId = localSourceBookId(item, input.snapshot);
  const entityId = prepared.overrideAuthorized && prepared.canonicalCatalogEntityId
    ? prepared.canonicalCatalogEntityId
    : item.importItemId;

  return {
    choiceId: `compendium:${item.id}`,
    entityId,
    kind: item.type,
    name: item.name,
    summary: item.summary,
    sourceBookId,
    sourceLabel: localSourceLabel(item),
    origin: 'compendium',
    catalogSnapshotId: prepared.overrideAuthorized ? input.snapshot.snapshotId : undefined,
    catalogEntityId: prepared.overrideAuthorized ? prepared.canonicalCatalogEntityId : undefined,
    compendiumItemId: item.id,
    ownerIds: collectOwnerIds(payload, undefined, input.snapshot),
    searchableText: [item.name, item.summary ?? '', item.type, item.sourceId, ...item.tags].join(' '),
    available: blockedReasons.every((reason) => reason.code === 'ambiguousCollision'),
    blockedReasons,
    manualReviewRequired: item.status !== 'validated',
    payload,
    provenance: {
      origin: 'compendium',
      sourceBookId,
      sourceId: item.sourceId,
      packId: item.packId,
      catalogSnapshotId: prepared.overrideAuthorized ? input.snapshot.snapshotId : undefined,
      catalogVersion: prepared.overrideAuthorized ? input.snapshot.catalogVersion : undefined,
      catalogEntityId: prepared.overrideAuthorized ? prepared.canonicalCatalogEntityId : undefined,
      compendiumItemId: item.id,
      legacyItemIds: [item.id, item.importItemId],
      overrideAuthorized: prepared.overrideAuthorized
    }
  };
};

const createAllChoices = (input: CharacterChoiceBridgeInput): {
  choices: CharacterChoiceItem[];
  hiddenDuplicateCount: number;
  ambiguousCollisionCount: number;
} => {
  const fallbackEntryIdsByKey = buildFallbackEntryIds(input);
  const preparedItems = prepareLocalItems(input, fallbackEntryIdsByKey);
  const policy = new ContentPolicyService(input.snapshot);
  const carriersByEntityId = new Map<string, PreparedLocalItem>();
  const overridesByEntityId = new Map<string, PreparedLocalItem>();
  for (const prepared of preparedItems) {
    if (!prepared.canonicalCatalogEntityId) continue;
    const target = prepared.overrideAuthorized ? overridesByEntityId : carriersByEntityId;
    const existing = target.get(prepared.canonicalCatalogEntityId);
    if (!existing || (existing.item.status !== 'validated' && prepared.item.status === 'validated')) {
      target.set(prepared.canonicalCatalogEntityId, prepared);
    }
  }

  const choices: CharacterChoiceItem[] = [];
  let hiddenDuplicateCount = 0;
  let ambiguousCollisionCount = 0;
  const representedLocalIds = new Set<string>();

  for (const entry of input.snapshot.entries) {
    const override = overridesByEntityId.get(entry.entityId);
    if (override) {
      choices.push(localChoice(override, input));
      representedLocalIds.add(override.item.id);
      hiddenDuplicateCount += 1;
      continue;
    }
    const carrier = carriersByEntityId.get(entry.entityId);
    const choice = catalogChoice(entry, carrier, input, policy);
    if (choice) choices.push(choice);
    if (carrier) {
      representedLocalIds.add(carrier.item.id);
      hiddenDuplicateCount += 1;
    }
  }

  const officialFallbackKeys = new Set(
    choices
      .filter((choice) => choice.origin === 'catalog')
      .map((choice) => fallbackDeduplicationKey(choice.kind, choice.sourceBookId, choice.name))
  );

  for (const prepared of preparedItems) {
    if (representedLocalIds.has(prepared.item.id)) continue;
    const choice = localChoice(prepared, input);
    const key = fallbackDeduplicationKey(choice.kind, choice.sourceBookId, choice.name);
    if (
      !prepared.ambiguous &&
      !prepared.overrideAuthorized &&
      prepared.canonicalCatalogEntityId &&
      officialFallbackKeys.has(key)
    ) {
      hiddenDuplicateCount += 1;
      continue;
    }
    if (prepared.ambiguous) ambiguousCollisionCount += 1;
    choices.push(choice);
  }

  return { choices, hiddenDuplicateCount, ambiguousCollisionCount };
};

const choiceMatchesQuery = (
  choice: CharacterChoiceItem,
  query: CharacterChoiceQuery
): boolean => {
  if (!query.includeUnavailable && !choice.available) return false;
  if (query.includeManualReview === false && choice.manualReviewRequired) return false;
  if (query.kinds?.length && !query.kinds.includes(choice.kind)) return false;
  if (query.origins?.length && !query.origins.includes(choice.origin)) return false;
  if (query.sourceBookIds?.length && (!choice.sourceBookId || !query.sourceBookIds.includes(choice.sourceBookId))) return false;
  const text = normalizedText(query.text ?? '');
  if (!text) return true;
  const haystack = normalizedText(`${choice.name} ${choice.entityId} ${choice.searchableText}`);
  return text.split(' ').filter(Boolean).every((token) => haystack.includes(token));
};

export const listCharacterChoices = (
  input: CharacterChoiceBridgeInput,
  query: CharacterChoiceQuery = {}
): CharacterChoiceQueryResult => {
  const all = createAllChoices(input);
  const unavailableCount = all.choices.filter((choice) => !choice.available).length;
  const filtered = all.choices
    .filter((choice) => choiceMatchesQuery(choice, query))
    .sort((left, right) => left.name.localeCompare(right.name) || left.sourceLabel.localeCompare(right.sourceLabel));
  const totalBeforeLimit = filtered.length;
  const limit = Math.max(1, query.limit ?? Number.MAX_SAFE_INTEGER);
  return {
    choices: filtered.slice(0, limit),
    totalBeforeLimit,
    hiddenDuplicateCount: all.hiddenDuplicateCount,
    unavailableCount,
    ambiguousCollisionCount: all.ambiguousCollisionCount
  };
};

export const resolveCharacterChoice = (
  choiceId: string,
  input: CharacterChoiceBridgeInput
): CharacterChoiceResolution => {
  const result = listCharacterChoices(input, { includeUnavailable: true });
  const direct = result.choices.find((choice) => choice.choiceId === choiceId);
  const legacy = direct ?? result.choices.find((choice) => choice.provenance.legacyItemIds.includes(choiceId));
  if (!legacy) {
    return {
      ok: false,
      issues: [{ severity: 'error', code: 'CHARACTER_CHOICE_NOT_FOUND', message: `Escolha não encontrada: ${choiceId}.` }]
    };
  }
  return {
    ok: legacy.available,
    choice: legacy,
    canonicalChoiceId: legacy.choiceId,
    issues: legacy.blockedReasons.map((reason) => ({
      severity: reason.code === 'ambiguousCollision' ? 'warning' as const : 'error' as const,
      code: `CHARACTER_CHOICE_${reason.code.toUpperCase()}`,
      message: reason.message
    }))
  };
};

export const normalizeCharacterChoiceReference = (reference: string): string => {
  if (reference.startsWith('catalog:') || reference.startsWith('compendium:')) return reference;
  const officialMatch = reference.match(/((?:phb-2024|dmg-2024|mm-2025)-[^:]+)$/);
  if (officialMatch?.[1]) return `catalog:${officialMatch[1]}`;
  return reference.includes(':') ? `compendium:${reference}` : reference;
};
