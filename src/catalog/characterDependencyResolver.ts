import type { Character, CharacterPendingChoice, RuleValidationIssue } from '../types';
import type { CharacterChoiceItem, CharacterChoiceKind } from './characterChoiceTypes';
import type { CatalogSnapshot, DependencyEdge } from './types';

export type PendingChoiceResolutionMode = 'dependency' | 'owner' | 'kindFallback' | 'unresolved';

export interface CharacterPendingChoiceResolution {
  pendingChoiceId: string;
  catalogSnapshotId: string;
  mode: PendingChoiceResolutionMode;
  sourceCatalogEntityIds: string[];
  relationTypes: string[];
  candidateChoices: CharacterChoiceItem[];
  availableCandidateChoices: CharacterChoiceItem[];
  blockedCandidateChoices: CharacterChoiceItem[];
  totalCandidateCount: number;
  issues: RuleValidationIssue[];
}

export interface CharacterPendingChoiceResolutionInput {
  character: Character;
  pendingChoice: CharacterPendingChoice;
  choices: readonly CharacterChoiceItem[];
  snapshot: CatalogSnapshot;
  maxCandidates?: number;
}

const DIRECT_TRAVERSAL_RELATIONS = new Set([
  'offersChoice',
  'grantsFeature',
  'usesProvider',
  'dependsOnProvider',
  'dependsOn',
  'definedBy'
]);

const CONTRACT_CANDIDATE_RELATIONS = new Set([
  'references',
  'referencesSpell',
  'allowsCandidate',
  'usesProvider',
  'dependsOnProvider',
  'grantsFeature',
  'dependsOn'
]);

const OWNERSHIP_RELATIONS = new Set([
  'belongsToClass',
  'belongsToSubclass',
  'belongsToFeat',
  'belongsToSpecies',
  'belongsToFeature',
  'availableToClass'
]);

const candidateKindsForPendingChoice = (kind: CharacterPendingChoice['kind']): CharacterChoiceKind[] => {
  if (kind === 'subclass') return ['subclass'];
  if (kind === 'subclassOptions') return ['feature'];
  if (kind === 'feat') return ['feat'];
  if (kind === 'featOptions') return ['spell', 'equipment', 'weapon', 'feature'];
  if (kind === 'spellSelection' || kind === 'spellReplacement') return ['spell'];
  if (kind === 'equipment') return ['equipment', 'weapon', 'armor', 'magicItem'];
  if (kind === 'speciesOption') return ['feature', 'spell'];
  if (kind === 'eldritchInvocation' || kind === 'eldritchInvocationOptions') return ['feature', 'spell'];
  if (kind === 'pactWeapon') return ['weapon'];
  if (kind === 'warlockSpecial') return ['feature', 'spell', 'creatureStatBlock'];
  if (kind === 'proficiency') return ['equipment', 'feature'];
  return [];
};

const stripCatalogPrefix = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return value.startsWith('catalog:') ? value.slice('catalog:'.length) : value;
};

const unique = <T>(values: Iterable<T>): T[] => Array.from(new Set(values));

const choiceIndex = (choices: readonly CharacterChoiceItem[]): Map<string, CharacterChoiceItem> => {
  const index = new Map<string, CharacterChoiceItem>();
  for (const choice of choices) {
    index.set(choice.choiceId, choice);
    index.set(choice.entityId, choice);
    if (choice.catalogEntityId) index.set(choice.catalogEntityId, choice);
    if (choice.compendiumItemId) index.set(choice.compendiumItemId, choice);
    for (const legacyId of choice.provenance.legacyItemIds) index.set(legacyId, choice);
  }
  return index;
};

const resolveCatalogEntityId = (
  value: string | undefined,
  snapshot: CatalogSnapshot,
  choicesByReference: ReadonlyMap<string, CharacterChoiceItem>
): string | undefined => {
  if (!value) return undefined;
  const choice = choicesByReference.get(value) ?? choicesByReference.get(stripCatalogPrefix(value) ?? value);
  const candidate = choice?.catalogEntityId ?? stripCatalogPrefix(value);
  if (!candidate) return undefined;
  if (snapshot.entryById.has(candidate)) return candidate;
  const alias = snapshot.aliases.get(candidate);
  return alias?.status === 'active' && snapshot.entryById.has(alias.to) ? alias.to : undefined;
};

const defaultLinkKinds = (kind: CharacterPendingChoice['kind']): Set<string> => {
  if (kind === 'subclass' || kind === 'subclassOptions' || kind === 'spellSelection' || kind === 'spellReplacement' || kind === 'eldritchInvocation' || kind === 'eldritchInvocationOptions' || kind === 'pactWeapon' || kind === 'warlockSpecial') {
    return new Set(['class', 'subclass']);
  }
  if (kind === 'feat' || kind === 'featOptions') return new Set(['feat']);
  if (kind === 'speciesOption') return new Set(['species']);
  if (kind === 'equipment') return new Set(['class', 'background']);
  return new Set();
};

const collectSourceCatalogEntityIds = (
  input: CharacterPendingChoiceResolutionInput,
  choicesByReference: ReadonlyMap<string, CharacterChoiceItem>
): string[] => {
  const result = new Set<string>();
  const add = (value: string | undefined) => {
    const resolved = resolveCatalogEntityId(value, input.snapshot, choicesByReference);
    if (resolved) result.add(resolved);
  };

  add(input.pendingChoice.sourceItemId);
  add(input.pendingChoice.sourceEntityId);

  const activeLinks = (input.character.compendiumLinks ?? []).filter((link) => link.status === 'active');
  for (const link of activeLinks) {
    const explicitlyMatches = [
      link.itemId,
      link.importItemId,
      link.choiceId,
      link.catalogEntityId,
      link.appliedEntityId
    ].some((value) => value && (value === input.pendingChoice.sourceItemId || value === input.pendingChoice.sourceEntityId));
    if (explicitlyMatches) {
      add(link.catalogEntityId);
      add(link.choiceId);
      add(link.itemId);
      add(link.importItemId);
    }
  }

  if (!result.size) {
    const allowedKinds = defaultLinkKinds(input.pendingChoice.kind);
    for (const link of activeLinks) {
      if (!allowedKinds.has(link.appliedAs)) continue;
      add(link.catalogEntityId);
      add(link.choiceId);
      add(link.itemId);
      add(link.importItemId);
    }
  }

  return Array.from(result);
};

const relatedEdges = (
  entityId: string,
  snapshot: CatalogSnapshot
): Array<{ edge: DependencyEdge; direction: 'outgoing' | 'incoming'; relatedId: string }> => [
  ...(snapshot.dependenciesFrom.get(entityId) ?? []).map((edge) => ({ edge, direction: 'outgoing' as const, relatedId: edge.toId })),
  ...(snapshot.dependenciesTo.get(entityId) ?? []).map((edge) => ({ edge, direction: 'incoming' as const, relatedId: edge.fromId }))
];

const dependencyCandidates = (
  sourceEntityIds: readonly string[],
  choicesByCatalogEntityId: ReadonlyMap<string, CharacterChoiceItem>,
  snapshot: CatalogSnapshot,
  desiredKinds: ReadonlySet<CharacterChoiceKind>
): { choices: CharacterChoiceItem[]; relationTypes: string[] } => {
  const candidateById = new Map<string, CharacterChoiceItem>();
  const relations = new Set<string>();
  const queue = sourceEntityIds.map((entityId) => ({ entityId, depth: 0, pathRelations: [] as string[] }));
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(`${current.entityId}:${current.depth}`)) continue;
    visited.add(`${current.entityId}:${current.depth}`);
    if (current.depth > 2) continue;

    for (const { edge, direction, relatedId } of relatedEdges(current.entityId, snapshot)) {
      if (edge.status !== 'resolved') continue;
      const directCandidate = choicesByCatalogEntityId.get(relatedId);
      const isOwnershipCandidate = direction === 'incoming' && OWNERSHIP_RELATIONS.has(edge.relation);
      const isContractCandidate = direction === 'outgoing' && CONTRACT_CANDIDATE_RELATIONS.has(edge.relation);
      if (directCandidate && desiredKinds.has(directCandidate.kind) && (isOwnershipCandidate || isContractCandidate)) {
        candidateById.set(directCandidate.choiceId, directCandidate);
        [...current.pathRelations, edge.relation].forEach((relation) => relations.add(relation));
      }

      const shouldTraverse = current.depth < 2 && (
        (direction === 'outgoing' && DIRECT_TRAVERSAL_RELATIONS.has(edge.relation)) ||
        (direction === 'incoming' && OWNERSHIP_RELATIONS.has(edge.relation) && !directCandidate)
      );
      if (shouldTraverse) {
        queue.push({
          entityId: relatedId,
          depth: current.depth + 1,
          pathRelations: [...current.pathRelations, edge.relation]
        });
      }
    }
  }

  return { choices: Array.from(candidateById.values()), relationTypes: Array.from(relations).sort() };
};

const sortChoices = (choices: readonly CharacterChoiceItem[]): CharacterChoiceItem[] => [...choices].sort((left, right) =>
  Number(right.available) - Number(left.available) ||
  Number(left.manualReviewRequired) - Number(right.manualReviewRequired) ||
  left.name.localeCompare(right.name) ||
  left.choiceId.localeCompare(right.choiceId)
);

export const resolveCharacterPendingChoice = (
  input: CharacterPendingChoiceResolutionInput
): CharacterPendingChoiceResolution => {
  const choicesByReference = choiceIndex(input.choices);
  const choicesByCatalogEntityId = new Map(
    input.choices
      .filter((choice): choice is CharacterChoiceItem & { catalogEntityId: string } => Boolean(choice.catalogEntityId))
      .map((choice) => [choice.catalogEntityId, choice])
  );
  const sourceCatalogEntityIds = collectSourceCatalogEntityIds(input, choicesByReference);
  const desiredKinds = new Set(candidateKindsForPendingChoice(input.pendingChoice.kind));
  const dependency = dependencyCandidates(sourceCatalogEntityIds, choicesByCatalogEntityId, input.snapshot, desiredKinds);
  let mode: PendingChoiceResolutionMode = 'dependency';
  let candidates = dependency.choices;

  if (!candidates.length && sourceCatalogEntityIds.length) {
    candidates = input.choices.filter((choice) =>
      desiredKinds.has(choice.kind) && choice.ownerIds.some((ownerId) => sourceCatalogEntityIds.includes(ownerId))
    );
    mode = candidates.length ? 'owner' : 'kindFallback';
  }

  if (!candidates.length && desiredKinds.size) {
    candidates = input.choices.filter((choice) => desiredKinds.has(choice.kind));
    mode = candidates.length ? 'kindFallback' : 'unresolved';
  }

  if (!candidates.length) mode = 'unresolved';
  const sorted = sortChoices(unique(candidates.map((choice) => choice.choiceId)).map((id) => choicesByReference.get(id)!).filter(Boolean));
  const totalCandidateCount = sorted.length;
  const limited = sorted.slice(0, Math.max(1, input.maxCandidates ?? 250));
  const availableCandidateChoices = limited.filter((choice) => choice.available);
  const blockedCandidateChoices = limited.filter((choice) => !choice.available);
  const issues: RuleValidationIssue[] = [];

  if (!sourceCatalogEntityIds.length) {
    issues.push({
      severity: 'warning',
      code: 'CATALOG_PENDING_CHOICE_SOURCE_UNRESOLVED',
      message: 'A origem canônica desta pendência não pôde ser determinada; as opções foram filtradas apenas pelo tipo.'
    });
  }
  if (mode === 'kindFallback') {
    issues.push({
      severity: 'info',
      code: 'CATALOG_PENDING_CHOICE_KIND_FALLBACK',
      message: 'O grafo não declarou candidatos diretos para esta pendência; foi usada uma busca compatível por tipo.'
    });
  }
  if (blockedCandidateChoices.length) {
    issues.push({
      severity: 'warning',
      code: 'CATALOG_PENDING_CHOICE_BLOCKED_CANDIDATES',
      message: `${blockedCandidateChoices.length} opção(ões) relacionada(s) estão bloqueadas pelos filtros de conteúdo ou sem payload mecânico.`
    });
  }
  if (!availableCandidateChoices.length) {
    issues.push({
      severity: 'error',
      code: 'CATALOG_PENDING_CHOICE_NO_AVAILABLE_CANDIDATE',
      message: 'Nenhuma opção aplicável está disponível para resolver esta pendência no snapshot atual.'
    });
  }

  return {
    pendingChoiceId: input.pendingChoice.id,
    catalogSnapshotId: input.snapshot.snapshotId,
    mode,
    sourceCatalogEntityIds,
    relationTypes: dependency.relationTypes,
    candidateChoices: limited,
    availableCandidateChoices,
    blockedCandidateChoices,
    totalCandidateCount,
    issues
  };
};
