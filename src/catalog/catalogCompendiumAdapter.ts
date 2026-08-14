import type { StoredCompendiumItem } from '../compendium/types';
import type { CompendiumItemInput } from '../compendium/schemas';
import type { CharacterChoiceItem } from './characterChoiceTypes';

const catalogMetadata = (choice: CharacterChoiceItem): Record<string, unknown> => ({
  origin: choice.origin,
  choiceId: choice.choiceId,
  entityId: choice.entityId,
  catalogEntityId: choice.catalogEntityId,
  catalogSnapshotId: choice.catalogSnapshotId,
  manualReviewRequired: choice.manualReviewRequired,
  provenance: choice.provenance
});

export const characterChoiceToMapperItem = (
  choice: CharacterChoiceItem,
  originalItem?: StoredCompendiumItem
): StoredCompendiumItem => {
  if (choice.origin === 'compendium' && originalItem) {
    return {
      ...originalItem,
      id: choice.choiceId,
      normalizedJson: {
        ...originalItem.normalizedJson,
        __characterChoice: catalogMetadata(choice),
        originalCompendiumItemId: originalItem.id
      }
    };
  }

  if (choice.origin === 'compendium') {
    const sourceId = choice.provenance.sourceId;
    const rawJson: CompendiumItemInput = {
      id: choice.entityId,
      kind: choice.kind,
      name: choice.name,
      summary: choice.summary,
      source: {
        id: sourceId,
        book: choice.sourceLabel,
        status: 'active',
        confidence: 'exact',
        notes: 'Conteúdo local materializado pela ponte de escolhas; o registro original continua pertencendo ao compêndio.'
      },
      payload: { ...choice.payload }
    };
    const now = new Date(0).toISOString();
    return {
      id: choice.choiceId,
      importItemId: choice.entityId,
      packId: choice.provenance.packId ?? 'compendium:runtime',
      sourceId,
      type: choice.kind,
      name: choice.name,
      summary: choice.summary,
      rawJson,
      normalizedJson: {
        ...choice.payload,
        id: choice.entityId,
        name: choice.name,
        type: choice.kind,
        sourceId,
        sourceStatus: 'active',
        sourceConfidence: 'exact',
        requiresReview: choice.manualReviewRequired,
        __characterChoice: catalogMetadata(choice)
      },
      tags: Array.from(new Set([choice.kind, choice.name.toLowerCase(), sourceId, 'compendium'])),
      status: choice.available ? 'validated' : 'disabled',
      reviewDecision: choice.available ? 'approved' : 'rejected',
      reviewNotes: choice.manualReviewRequired
        ? 'Item local exige revisão antes da aplicação.'
        : 'Item local validado no compêndio.',
      reviewedBy: 'Compêndio local',
      reviewedAt: now,
      createdAt: now,
      updatedAt: now
    };
  }

  const source = {
    id: choice.sourceBookId ?? 'catalog',
    book: choice.sourceBookId ?? choice.sourceLabel,
    version: choice.provenance.catalogVersion,
    status: 'active' as const,
    confidence: 'exact' as const,
    notes: choice.manualReviewRequired
      ? 'Entidade oficial disponível com revisão editorial preservada pelo catálogo.'
      : 'Entidade oficial materializada transitoriamente pelo catálogo; não persistir no compêndio local.'
  };
  const rawJson: CompendiumItemInput = {
    id: choice.entityId,
    kind: choice.kind,
    name: choice.name,
    summary: choice.summary,
    source,
    payload: { ...choice.payload }
  };
  const now = new Date(0).toISOString();
  return {
    id: choice.choiceId,
    importItemId: choice.entityId,
    packId: `catalog:${choice.catalogSnapshotId ?? 'runtime'}`,
    sourceId: `catalog:${choice.sourceBookId ?? 'unscoped'}`,
    type: choice.kind,
    name: choice.name,
    summary: choice.summary,
    version: choice.provenance.catalogVersion,
    rawJson,
    normalizedJson: {
      ...choice.payload,
      id: choice.entityId,
      name: choice.name,
      type: choice.kind,
      sourceId: source.id,
      sourceStatus: 'active',
      sourceConfidence: 'exact',
      requiresReview: choice.manualReviewRequired,
      __characterChoice: catalogMetadata(choice)
    },
    tags: Array.from(new Set([
      choice.kind,
      choice.name.toLowerCase(),
      choice.sourceBookId ?? 'catalog',
      'catalog'
    ])),
    status: choice.available ? 'validated' : 'disabled',
    reviewDecision: choice.available ? 'approved' : 'rejected',
    reviewNotes: choice.manualReviewRequired
      ? 'Revisão editorial sinalizada no catálogo; uso permitido com aviso.'
      : 'Validado estruturalmente pelo catálogo consolidado.',
    reviewedBy: 'Catálogo consolidado',
    reviewedAt: now,
    createdAt: now,
    updatedAt: now
  };
};
