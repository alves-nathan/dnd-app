import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  catalogRolloutAggregateReportChecksum,
  createCatalogReleaseQuorumDecision,
  createCatalogRolloutHealthSubmission,
  parseSignedCatalogReleaseApproval,
  parseSignedCatalogRolloutAggregateReport,
  parseSignedCatalogRolloutAggregationPolicy,
  verifySignedCatalogReleaseApproval,
  verifySignedCatalogRolloutAggregateReport,
  verifySignedCatalogRolloutAggregationPolicy,
  type CatalogReleaseDecisionAction,
  type CatalogReleaseQuorumDecision,
  type CatalogRolloutHealthSubmission,
  type SignedCatalogReleaseApproval,
  type SignedCatalogRolloutAggregateReport,
  type SignedCatalogRolloutAggregationPolicy
} from '../catalog/catalogRolloutAggregation';
import { sha256Hex } from '../catalog/catalogBundleDigest';
import type { CatalogRolloutHealthEvidence } from '../catalog/catalogRolloutHealth';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import type { CatalogReleaseChannel, SignedCatalogPublication } from '../catalog/catalogPublication';
import { characterStorage } from '../storage/characterStorage';

export const CATALOG_ROLLOUT_AGGREGATION_STORE_VERSION = 1;

export interface CatalogRolloutAggregationEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogRolloutAggregationState {
  contributorSecret: string;
  policies: Record<string, SignedCatalogRolloutAggregationPolicy[]>;
  submissions: CatalogRolloutHealthSubmission[];
  reports: SignedCatalogRolloutAggregateReport[];
  approvals: Record<string, SignedCatalogReleaseApproval[]>;
  decisions: CatalogReleaseQuorumDecision[];
  events: CatalogRolloutAggregationEvent[];
  createSubmission: (evidence: CatalogRolloutHealthEvidence) => CatalogRolloutHealthSubmission;
  importPolicy: (rawText: string, params: { registry: CatalogTrustRegistry; publication: SignedCatalogPublication }) => { ok: boolean; issue?: string; policy?: SignedCatalogRolloutAggregationPolicy };
  importReport: (rawText: string, params: { registry: CatalogTrustRegistry; publication: SignedCatalogPublication }) => { ok: boolean; issue?: string; report?: SignedCatalogRolloutAggregateReport };
  importApproval: (rawText: string, params: { registry: CatalogTrustRegistry; publication: SignedCatalogPublication }) => { ok: boolean; issue?: string; approval?: SignedCatalogReleaseApproval };
  evaluateDecision: (params: { reportId: string; registry: CatalogTrustRegistry; action: CatalogReleaseDecisionAction; targetRolloutPercent?: number; targetChannel?: CatalogReleaseChannel }) => CatalogReleaseQuorumDecision;
  removeSubmission: (submissionId: string) => void;
  removeReport: (reportId: string) => void;
}

const createSecret = (): string => sha256Hex(`rollout-aggregation-secret:${Date.now()}:${Math.random()}:${Math.random()}`);
const event = (type: string, details?: Record<string, unknown>): CatalogRolloutAggregationEvent => ({
  id: `rollout-aggregation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: new Date().toISOString(),
  type,
  ...(details ? { details } : {})
});
const appendEvent = (events: CatalogRolloutAggregationEvent[], next: CatalogRolloutAggregationEvent): CatalogRolloutAggregationEvent[] => [...events, next].slice(-400);
const latestPolicy = (policies: SignedCatalogRolloutAggregationPolicy[] = []): SignedCatalogRolloutAggregationPolicy | undefined => [...policies].sort((a, b) => b.revision - a.revision)[0];

export const useCatalogRolloutAggregationStore = create<CatalogRolloutAggregationState>()(
  persist(
    (set, get) => ({
      contributorSecret: createSecret(),
      policies: {},
      submissions: [],
      reports: [],
      approvals: {},
      decisions: [],
      events: [],
      createSubmission: (evidence) => {
        const submission = createCatalogRolloutHealthSubmission({ evidence, contributorSecret: get().contributorSecret });
        set({
          submissions: [...get().submissions.filter((entry) => entry.submissionId !== submission.submissionId), submission].slice(-100),
          events: appendEvent(get().events, event('rolloutAggregationSubmissionCreated', { submissionId: submission.submissionId, publicationId: evidence.publicationId }))
        });
        return submission;
      },
      importPolicy: (rawText, params) => {
        try {
          const policy = parseSignedCatalogRolloutAggregationPolicy(rawText);
          const previousPolicies = get().policies[policy.publicationId] ?? [];
          const verified = verifySignedCatalogRolloutAggregationPolicy({ policy, ...params, previousPolicies });
          set({
            policies: { ...get().policies, [verified.publicationId]: [...previousPolicies, verified] },
            events: appendEvent(get().events, event('rolloutAggregationPolicyAccepted', { publicationId: verified.publicationId, policyId: verified.aggregationPolicyId, revision: verified.revision }))
          });
          return { ok: true, policy: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A política de agregação foi rejeitada.';
          set({ events: appendEvent(get().events, event('rolloutAggregationPolicyRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      importReport: (rawText, params) => {
        try {
          const report = parseSignedCatalogRolloutAggregateReport(rawText);
          const policy = latestPolicy(get().policies[report.publicationId]);
          if (!policy) throw new Error('Importe primeiro a política de agregação assinada.');
          const verified = verifySignedCatalogRolloutAggregateReport({ report, ...params, policy });
          set({
            reports: [...get().reports.filter((entry) => entry.reportId !== verified.reportId), verified].slice(-100),
            events: appendEvent(get().events, event('rolloutAggregateReportAccepted', { reportId: verified.reportId, publicationId: verified.publicationId, contributors: verified.uniqueContributors, status: verified.status }))
          });
          return { ok: true, report: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O relatório agregado foi rejeitado.';
          set({ events: appendEvent(get().events, event('rolloutAggregateReportRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      importApproval: (rawText, params) => {
        try {
          const approval = parseSignedCatalogReleaseApproval(rawText);
          const report = get().reports.find((entry) => entry.publicationId === approval.publicationId && catalogRolloutAggregateReportChecksum(entry) === approval.aggregateReportChecksum);
          if (!report) throw new Error('O relatório agregado referenciado não está disponível.');
          const policy = latestPolicy(get().policies[approval.publicationId]);
          if (!policy) throw new Error('A política de agregação não está disponível.');
          const verified = verifySignedCatalogReleaseApproval({ approval, registry: params.registry, policy, report });
          const key = approval.aggregateReportChecksum;
          const previous = get().approvals[key] ?? [];
          set({
            approvals: { ...get().approvals, [key]: [...previous.filter((entry) => entry.approvalId !== verified.approvalId), verified] },
            events: appendEvent(get().events, event('catalogReleaseApprovalAccepted', { approvalId: verified.approvalId, reportId: report.reportId, vote: verified.vote, action: verified.action }))
          });
          return { ok: true, approval: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'A aprovação foi rejeitada.';
          set({ events: appendEvent(get().events, event('catalogReleaseApprovalRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      evaluateDecision: (params) => {
        const report = get().reports.find((entry) => entry.reportId === params.reportId);
        if (!report) throw new Error('Relatório agregado não encontrado.');
        const policy = latestPolicy(get().policies[report.publicationId]);
        if (!policy) throw new Error('Política de agregação não encontrada.');
        const reportChecksum = catalogRolloutAggregateReportChecksum(report);
        const approvals = Object.values(get().approvals).flat().filter((entry) => entry.aggregateReportChecksum === reportChecksum);
        const decision = createCatalogReleaseQuorumDecision({ ...params, report, policy, approvals });
        set({
          decisions: [...get().decisions.filter((entry) => entry.decisionId !== decision.decisionId), decision].slice(-100),
          events: appendEvent(get().events, event('catalogReleaseQuorumEvaluated', { reportId: report.reportId, decisionId: decision.decisionId, status: decision.status, approvals: decision.approvalCount, rejections: decision.rejectionCount }))
        });
        return decision;
      },
      removeSubmission: (submissionId) => set({ submissions: get().submissions.filter((entry) => entry.submissionId !== submissionId) }),
      removeReport: (reportId) => set({ reports: get().reports.filter((entry) => entry.reportId !== reportId) })
    }),
    {
      name: '@dnd-combat-math/catalog-rollout-aggregation/v1',
      version: CATALOG_ROLLOUT_AGGREGATION_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state: CatalogRolloutAggregationState) => ({
        contributorSecret: state.contributorSecret,
        policies: state.policies,
        submissions: state.submissions,
        reports: state.reports,
        approvals: state.approvals,
        decisions: state.decisions,
        events: state.events
      })
    }
  )
);
