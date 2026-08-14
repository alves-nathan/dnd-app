import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  assessCatalogChannelMigration,
  evaluateCatalogPublicationEligibility,
  findCatalogPublicationForDistribution,
  parseSignedCatalogPublication,
  parseSignedCatalogPublicationControl,
  verifySignedCatalogPublication,
  verifySignedCatalogPublicationControl,
  type CatalogChannelMigrationAssessment,
  type CatalogPublicationEligibilityEvidence,
  type CatalogReleaseChannel,
  type SignedCatalogPublication,
  type SignedCatalogPublicationControl
} from '../catalog/catalogPublication';
import type { SignedCatalogDistributionManifest } from '../catalog/catalogDistribution';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import { CURRENT_APP_VERSION } from '../config/appMetadata';
import { characterStorage } from '../storage/characterStorage';
import { useCatalogRolloutHealthStore } from './catalogRolloutHealthStore';

export const CATALOG_PUBLICATION_STORE_VERSION = 1;

export interface CatalogPublicationEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogPublicationState {
  selectedChannel: CatalogReleaseChannel;
  cohortId: string;
  publications: Record<string, SignedCatalogPublication>;
  controls: Record<string, SignedCatalogPublicationControl[]>;
  eligibilityEvidence: CatalogPublicationEligibilityEvidence[];
  events: CatalogPublicationEvent[];
  setSelectedChannel: (channel: CatalogReleaseChannel, confirmed?: boolean) => { ok: boolean; assessment: CatalogChannelMigrationAssessment; issue?: string };
  importPublication: (rawText: string, params: { registry: CatalogTrustRegistry; distributionManifest?: SignedCatalogDistributionManifest }) => { ok: boolean; issue?: string; publication?: SignedCatalogPublication };
  importControl: (rawText: string, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; control?: SignedCatalogPublicationControl };
  evaluatePublication: (publicationId: string, distributionManifest?: SignedCatalogDistributionManifest) => CatalogPublicationEligibilityEvidence;
  evaluateDistribution: (manifest: SignedCatalogDistributionManifest) => { publication?: SignedCatalogPublication; evidence?: CatalogPublicationEligibilityEvidence; issue?: string };
  assertDistributionEligible: (manifest: SignedCatalogDistributionManifest) => CatalogPublicationEligibilityEvidence;
  removePublication: (publicationId: string) => void;
}

const createCohortId = (): string => `catalog-cohort-${sha256Hex(`${Date.now()}:${Math.random()}:${Math.random()}`).slice(0, 24)}`;
const event = (type: string, details?: Record<string, unknown>): CatalogPublicationEvent => ({
  id: `publication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: new Date().toISOString(),
  type,
  ...(details ? { details } : {})
});
const appendEvent = (events: CatalogPublicationEvent[], next: CatalogPublicationEvent): CatalogPublicationEvent[] => [...events, next].slice(-250);

export const useCatalogPublicationStore = create<CatalogPublicationState>()(
  persist(
    (set, get) => ({
      selectedChannel: 'stable',
      cohortId: createCohortId(),
      publications: {},
      controls: {},
      eligibilityEvidence: [],
      events: [],
      setSelectedChannel: (channel, confirmed = false) => {
        const assessment = assessCatalogChannelMigration(get().selectedChannel, channel);
        if (assessment.requiresConfirmation && !confirmed) return { ok: false, assessment, issue: assessment.explanation };
        if (channel !== get().selectedChannel) {
          set({
            selectedChannel: channel,
            events: appendEvent(get().events, event('publicationChannelChanged', { from: assessment.from, to: assessment.to, direction: assessment.direction }))
          });
        }
        return { ok: true, assessment };
      },
      importPublication: (rawText, params) => {
        try {
          const publication = parseSignedCatalogPublication(rawText);
          const existing = get().publications[publication.publicationId];
          if (existing && JSON.stringify(existing) !== JSON.stringify(publication)) throw new Error('Já existe outra publicação com o mesmo identificador.');
          const sameChannelSequence = Object.values(get().publications).find((entry) => entry.publisherId === publication.publisherId && entry.channel === publication.channel && entry.sequence === publication.sequence && entry.publicationId !== publication.publicationId);
          if (sameChannelSequence) throw new Error('Já existe outra publicação do mesmo canal e sequência.');
          const verification = verifySignedCatalogPublication({ publication, ...params });
          set({
            publications: { ...get().publications, [publication.publicationId]: publication },
            events: appendEvent(get().events, event('catalogPublicationAccepted', { publicationId: publication.publicationId, publisherId: verification.publisherId, channel: verification.channel, rolloutPercent: verification.rolloutPercent }))
          });
          return { ok: true, publication };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A publicação foi rejeitada.';
          set({ events: appendEvent(get().events, event('catalogPublicationRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      importControl: (rawText, registry) => {
        try {
          const control = parseSignedCatalogPublicationControl(rawText);
          const publication = get().publications[control.publicationId];
          if (!publication) throw new Error('A publicação controlada ainda não foi importada.');
          const previousControls = get().controls[control.publicationId] ?? [];
          const verification = verifySignedCatalogPublicationControl({ control, publication, registry, previousControls });
          set({
            controls: { ...get().controls, [control.publicationId]: [...previousControls, control] },
            events: appendEvent(get().events, event('catalogPublicationControlled', { publicationId: control.publicationId, action: verification.action, revision: verification.revision }))
          });
          return { ok: true, control };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O controle da publicação foi rejeitado.';
          set({ events: appendEvent(get().events, event('catalogPublicationControlRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      evaluatePublication: (publicationId, distributionManifest) => {
        const publication = get().publications[publicationId];
        if (!publication) throw new Error('Publicação não encontrada.');
        const effective = useCatalogRolloutHealthStore.getState().effectiveRolloutFor(publication);
        const evidence = evaluateCatalogPublicationEligibility({
          publication,
          controls: get().controls[publicationId] ?? [],
          selectedChannel: get().selectedChannel,
          appVersion: CURRENT_APP_VERSION,
          cohortId: get().cohortId,
          distributionManifest,
          rolloutPercentOverride: effective.rolloutPercent,
          rolloutDirectiveId: effective.directiveId
        });
        useCatalogRolloutHealthStore.getState().recordSignal({
          publicationId: publication.publicationId,
          publisherId: publication.publisherId,
          channel: publication.channel,
          type: 'eligibilityObserved',
          cohortScore: evidence.cohortScore,
          issueCode: evidence.reason
        });
        set({
          eligibilityEvidence: [...get().eligibilityEvidence.filter((entry) => entry.evidenceId !== evidence.evidenceId), evidence].slice(-100),
          events: appendEvent(get().events, event('catalogPublicationEligibilityEvaluated', { publicationId, eligible: evidence.eligible, reason: evidence.reason, cohortScore: evidence.cohortScore }))
        });
        return evidence;
      },
      evaluateDistribution: (manifest) => {
        const publication = findCatalogPublicationForDistribution(get().publications, manifest, get().selectedChannel);
        if (!publication) return { issue: 'Nenhuma publicação assinada corresponde a este manifesto de distribuição.' };
        try {
          return { publication, evidence: get().evaluatePublication(publication.publicationId, manifest) };
        } catch (error) {
          return { publication, issue: error instanceof Error ? error.message : 'A elegibilidade da publicação não pôde ser avaliada.' };
        }
      },
      assertDistributionEligible: (manifest) => {
        const result = get().evaluateDistribution(manifest);
        if (!result.publication || !result.evidence) throw new Error(result.issue ?? 'A publicação correspondente não foi encontrada.');
        if (!result.evidence.eligible) {
          const labels: Record<string, string> = {
            channelMismatch: 'A publicação pertence a outro canal.',
            appTooOld: 'Esta versão do aplicativo é antiga demais para a publicação.',
            appTooNew: 'Esta versão do aplicativo é mais nova que o limite permitido.',
            outsideRollout: 'Este dispositivo ainda não faz parte do rollout gradual.',
            paused: 'A publicação foi pausada pelo publicador.',
            withdrawn: 'A publicação foi retirada pelo publicador.',
            expired: 'A publicação expirou.',
            distributionMismatch: 'A distribuição não corresponde à publicação assinada.'
          };
          throw new Error(labels[result.evidence.reason] ?? 'A publicação não está elegível neste dispositivo.');
        }
        return result.evidence;
      },
      removePublication: (publicationId) => {
        const publications = { ...get().publications };
        const controls = { ...get().controls };
        delete publications[publicationId];
        delete controls[publicationId];
        set({ publications, controls, events: appendEvent(get().events, event('catalogPublicationRemoved', { publicationId })) });
      }
    }),
    {
      name: '@dnd-combat-math/catalog-publication/v1',
      version: CATALOG_PUBLICATION_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state: CatalogPublicationState) => ({
        selectedChannel: state.selectedChannel,
        cohortId: state.cohortId,
        publications: state.publications,
        controls: state.controls,
        eligibilityEvidence: state.eligibilityEvidence,
        events: state.events
      })
    }
  )
);
