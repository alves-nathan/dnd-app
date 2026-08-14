import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createCatalogRolloutHealthEvidence,
  parseSignedCatalogRolloutDirective,
  parseSignedCatalogRolloutHealthPolicy,
  resolveEffectiveCatalogRollout,
  verifySignedCatalogRolloutDirective,
  verifySignedCatalogRolloutHealthPolicy,
  type CatalogRolloutHealthEvidence,
  type CatalogRolloutSignal,
  type CatalogRolloutSignalType,
  type SignedCatalogRolloutDirective,
  type SignedCatalogRolloutHealthPolicy
} from '../catalog/catalogRolloutHealth';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import type { CatalogReleaseChannel, SignedCatalogPublication } from '../catalog/catalogPublication';
import { characterStorage } from '../storage/characterStorage';

export const CATALOG_ROLLOUT_HEALTH_STORE_VERSION = 1;

export interface CatalogRolloutHealthEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogOperationalRolloutOverride {
  authorizationId: string;
  action: 'expand' | 'pause';
  rolloutPercent: number;
  appliedAt: string;
}

export interface CatalogRolloutHealthState {
  sharingOptIn: boolean;
  policies: Record<string, SignedCatalogRolloutHealthPolicy[]>;
  directives: Record<string, SignedCatalogRolloutDirective[]>;
  operationalOverrides: Record<string, CatalogOperationalRolloutOverride[]>;
  signals: CatalogRolloutSignal[];
  evidence: CatalogRolloutHealthEvidence[];
  events: CatalogRolloutHealthEvent[];
  setSharingOptIn: (enabled: boolean) => void;
  importPolicy: (rawText: string, params: { registry: CatalogTrustRegistry; publication: SignedCatalogPublication }) => { ok: boolean; issue?: string; policy?: SignedCatalogRolloutHealthPolicy };
  importDirective: (rawText: string, params: { registry: CatalogTrustRegistry; publication: SignedCatalogPublication; targetPublication?: SignedCatalogPublication }) => { ok: boolean; issue?: string; directive?: SignedCatalogRolloutDirective };
  recordSignal: (input: { publicationId: string; publisherId: string; channel: CatalogReleaseChannel; type: CatalogRolloutSignalType; durationMs?: number; cohortScore?: number; issueCode?: string; occurredAt?: string }) => CatalogRolloutSignal;
  generateEvidence: (publication: SignedCatalogPublication) => CatalogRolloutHealthEvidence;
  effectiveRolloutFor: (publication: SignedCatalogPublication) => { rolloutPercent: number; directiveId?: string; action?: string };
  applyOperationalOverride: (publicationId: string, override: CatalogOperationalRolloutOverride) => void;
  restoreOperationalOverrides: (overrides: Record<string, CatalogOperationalRolloutOverride[]>) => void;
  clearSignals: (publicationId: string) => void;
  removeEvidence: (evidenceId: string) => void;
}

const event = (type: string, details?: Record<string, unknown>): CatalogRolloutHealthEvent => ({
  id: `rollout-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: new Date().toISOString(),
  type,
  ...(details ? { details } : {})
});
const appendEvent = (events: CatalogRolloutHealthEvent[], next: CatalogRolloutHealthEvent): CatalogRolloutHealthEvent[] => [...events, next].slice(-300);
const latestPolicy = (policies: SignedCatalogRolloutHealthPolicy[] = []): SignedCatalogRolloutHealthPolicy | undefined => [...policies].sort((a, b) => b.revision - a.revision)[0];

export const useCatalogRolloutHealthStore = create<CatalogRolloutHealthState>()(
  persist(
    (set, get) => ({
      sharingOptIn: false,
      policies: {},
      directives: {},
      operationalOverrides: {},
      signals: [],
      evidence: [],
      events: [],
      setSharingOptIn: (enabled) => set({
        sharingOptIn: enabled,
        events: appendEvent(get().events, event(enabled ? 'rolloutHealthSharingEnabled' : 'rolloutHealthSharingDisabled'))
      }),
      importPolicy: (rawText, params) => {
        try {
          const policy = parseSignedCatalogRolloutHealthPolicy(rawText);
          const previousPolicies = get().policies[policy.publicationId] ?? [];
          const verified = verifySignedCatalogRolloutHealthPolicy({ policy, ...params, previousPolicies });
          set({
            policies: { ...get().policies, [verified.publicationId]: [...previousPolicies, verified] },
            events: appendEvent(get().events, event('rolloutHealthPolicyAccepted', { publicationId: verified.publicationId, policyId: verified.policyId, revision: verified.revision }))
          });
          return { ok: true, policy: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A política de saúde foi rejeitada.';
          set({ events: appendEvent(get().events, event('rolloutHealthPolicyRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      importDirective: (rawText, params) => {
        try {
          const directive = parseSignedCatalogRolloutDirective(rawText);
          const previousDirectives = get().directives[directive.publicationId] ?? [];
          const policy = latestPolicy(get().policies[directive.publicationId]);
          if (!policy) throw new Error('Nenhuma política de saúde assinada está ativa para a publicação.');
          const evidence = [...get().evidence].reverse().find((entry) => entry.publicationId === directive.publicationId && entry.checksum === directive.healthEvidenceChecksum);
          if (!evidence) throw new Error('A evidência de saúde referenciada não está disponível neste dispositivo.');
          const verified = verifySignedCatalogRolloutDirective({ directive, ...params, policy, evidence, previousDirectives });
          set({
            directives: { ...get().directives, [directive.publicationId]: [...previousDirectives, directive] },
            events: appendEvent(get().events, event('rolloutDirectiveAccepted', { publicationId: directive.publicationId, directiveId: directive.directiveId, action: verified.action, rolloutPercent: verified.effectiveRolloutPercent, targetPublicationId: verified.targetPublicationId }))
          });
          return { ok: true, directive };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A diretriz de rollout foi rejeitada.';
          set({ events: appendEvent(get().events, event('rolloutDirectiveRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      recordSignal: (input) => {
        const signal: CatalogRolloutSignal = {
          id: `rollout-signal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          publicationId: input.publicationId,
          publisherId: input.publisherId,
          channel: input.channel,
          type: input.type,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
          ...(Number.isFinite(input.durationMs) ? { durationMs: input.durationMs } : {}),
          ...(Number.isFinite(input.cohortScore) ? { cohortScore: input.cohortScore } : {}),
          ...(input.issueCode ? { issueCode: input.issueCode } : {})
        };
        set({ signals: [...get().signals, signal].slice(-1000) });
        return signal;
      },
      generateEvidence: (publication) => {
        const policy = latestPolicy(get().policies[publication.publicationId]);
        if (!policy) throw new Error('Importe uma política de saúde assinada antes de gerar a evidência.');
        const effective = resolveEffectiveCatalogRollout(publication, get().directives[publication.publicationId] ?? []);
        const evidence = createCatalogRolloutHealthEvidence({
          publication,
          policy,
          signals: get().signals,
          effectiveRolloutPercent: effective.rolloutPercent,
          optInConfirmed: get().sharingOptIn
        });
        set({
          evidence: [...get().evidence.filter((entry) => entry.evidenceId !== evidence.evidenceId), evidence].slice(-100),
          events: appendEvent(get().events, event('rolloutHealthEvidenceGenerated', { publicationId: publication.publicationId, evidenceId: evidence.evidenceId, status: evidence.status, recommendation: evidence.recommendation }))
        });
        return evidence;
      },
      effectiveRolloutFor: (publication) => {
        const base = resolveEffectiveCatalogRollout(publication, get().directives[publication.publicationId] ?? []);
        const override = [...(get().operationalOverrides?.[publication.publicationId] ?? [])].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0];
        return override ? { rolloutPercent: override.rolloutPercent, directiveId: override.authorizationId, action: override.action } : base;
      },
      applyOperationalOverride: (publicationId, override) => set({
        operationalOverrides: {
          ...(get().operationalOverrides ?? {}),
          [publicationId]: [...((get().operationalOverrides ?? {})[publicationId] ?? []).filter((entry) => entry.authorizationId !== override.authorizationId), override].slice(-50)
        },
        events: appendEvent(get().events, event('rolloutOperationalOverrideApplied', { publicationId, authorizationId: override.authorizationId, action: override.action, rolloutPercent: override.rolloutPercent }))
      }),
      restoreOperationalOverrides: (overrides) => set({
        operationalOverrides: JSON.parse(JSON.stringify(overrides)) as Record<string, CatalogOperationalRolloutOverride[]>,
        events: appendEvent(get().events, event('rolloutOperationalOverridesRestored'))
      }),
      clearSignals: (publicationId) => set({
        signals: get().signals.filter((entry) => entry.publicationId !== publicationId),
        events: appendEvent(get().events, event('rolloutHealthSignalsCleared', { publicationId }))
      }),
      removeEvidence: (evidenceId) => set({ evidence: get().evidence.filter((entry) => entry.evidenceId !== evidenceId) })
    }),
    {
      name: '@dnd-combat-math/catalog-rollout-health/v1',
      version: CATALOG_ROLLOUT_HEALTH_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state: CatalogRolloutHealthState) => ({
        sharingOptIn: state.sharingOptIn,
        policies: state.policies,
        directives: state.directives,
        operationalOverrides: state.operationalOverrides,
        signals: state.signals,
        evidence: state.evidence,
        events: state.events
      })
    }
  )
);
