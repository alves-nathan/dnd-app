import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  compareCatalogOperationalAuditPackages,
  parseCatalogOperationalAuditPackage,
  verifyCatalogOperationalAuditPackage,
  verifySignedCatalogOperationalAuditReport,
  type CatalogOperationalAuditComparison,
  type CatalogOperationalAuditPackage,
  type CatalogOperationalAuditVerification,
  type SignedCatalogOperationalAuditReport
} from '../catalog/catalogOperationalAudit';
import type { CatalogTrustRegistry } from '../catalog/catalogTrust';
import { characterStorage } from '../storage/characterStorage';

export const CATALOG_OPERATIONAL_AUDIT_STORE_VERSION = 1;

export interface CatalogOperationalImportedAudit {
  recordId: string;
  importedAt: string;
  sourceLabel?: string;
  auditPackage: CatalogOperationalAuditPackage;
  verification: CatalogOperationalAuditVerification;
  signedReport?: SignedCatalogOperationalAuditReport;
  readOnly: true;
}

export interface CatalogOperationalAuditEvent {
  id: string;
  at: string;
  type: string;
  details?: Record<string, unknown>;
}

export interface CatalogOperationalAuditState {
  importedAudits: CatalogOperationalImportedAudit[];
  events: CatalogOperationalAuditEvent[];
  importAuditPackage: (rawText: string, sourceLabel?: string) => { ok: boolean; issue?: string; record?: CatalogOperationalImportedAudit };
  importSignedReport: (recordId: string, rawText: string, registry: CatalogTrustRegistry) => { ok: boolean; issue?: string; report?: SignedCatalogOperationalAuditReport };
  compareImportedWithLocal: (recordId: string, local: CatalogOperationalAuditPackage) => CatalogOperationalAuditComparison | undefined;
  removeImportedAudit: (recordId: string) => boolean;
  clearImportedAudits: () => void;
}

const event = (type: string, details?: Record<string, unknown>): CatalogOperationalAuditEvent => ({
  id: `catalog-operational-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: new Date().toISOString(),
  type,
  ...(details ? { details } : {})
});
const appendEvent = (events: CatalogOperationalAuditEvent[], next: CatalogOperationalAuditEvent): CatalogOperationalAuditEvent[] => [...events, next].slice(-300);

export const useCatalogOperationalAuditStore = create<CatalogOperationalAuditState>()(
  persist(
    (set, get) => ({
      importedAudits: [],
      events: [],
      importAuditPackage: (rawText, sourceLabel) => {
        try {
          const auditPackage = parseCatalogOperationalAuditPackage(rawText);
          const verification = verifyCatalogOperationalAuditPackage(auditPackage);
          if (verification.status === 'rejected') throw new Error(verification.findings.filter((entry) => entry.severity === 'error').map((entry) => `${entry.code}: ${entry.message}`).join('\n') || 'O pacote de auditoria foi rejeitado.');
          const record: CatalogOperationalImportedAudit = {
            recordId: `imported-operational-audit-${auditPackage.packageId}`,
            importedAt: new Date().toISOString(),
            ...(sourceLabel?.trim() ? { sourceLabel: sourceLabel.trim() } : {}),
            auditPackage,
            verification,
            readOnly: true
          };
          set({
            importedAudits: [...get().importedAudits.filter((entry) => entry.recordId !== record.recordId), record].slice(-50),
            events: appendEvent(get().events, event('catalogOperationalAuditImported', { packageId: auditPackage.packageId, status: verification.status, readOnly: true }))
          });
          return { ok: true, record };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O pacote de auditoria não pôde ser importado.';
          set({ events: appendEvent(get().events, event('catalogOperationalAuditRejected', { issue })) });
          return { ok: false, issue };
        }
      },
      importSignedReport: (recordId, rawText, registry) => {
        try {
          const record = get().importedAudits.find((entry) => entry.recordId === recordId);
          if (!record) throw new Error('O pacote auditado não está disponível.');
          const report = JSON.parse(rawText) as SignedCatalogOperationalAuditReport;
          const verified = verifySignedCatalogOperationalAuditReport({ report, auditPackage: record.auditPackage, registry });
          set({
            importedAudits: get().importedAudits.map((entry) => entry.recordId === recordId ? { ...entry, signedReport: verified } : entry),
            events: appendEvent(get().events, event('catalogOperationalAuditReportAccepted', { recordId, reportId: verified.reportId, status: verified.auditStatus }))
          });
          return { ok: true, report: verified };
        } catch (error) {
          const issue = error instanceof Error ? error.message : 'O relatório de auditoria foi rejeitado.';
          set({ events: appendEvent(get().events, event('catalogOperationalAuditReportRejected', { recordId, issue })) });
          return { ok: false, issue };
        }
      },
      compareImportedWithLocal: (recordId, local) => {
        const record = get().importedAudits.find((entry) => entry.recordId === recordId);
        return record ? compareCatalogOperationalAuditPackages(local, record.auditPackage) : undefined;
      },
      removeImportedAudit: (recordId) => {
        if (!get().importedAudits.some((entry) => entry.recordId === recordId)) return false;
        set({
          importedAudits: get().importedAudits.filter((entry) => entry.recordId !== recordId),
          events: appendEvent(get().events, event('catalogOperationalAuditRemoved', { recordId }))
        });
        return true;
      },
      clearImportedAudits: () => set({ importedAudits: [], events: appendEvent(get().events, event('catalogOperationalAuditsCleared')) })
    }),
    {
      name: '@dnd-combat-math/catalog-operational-audit/v1',
      version: CATALOG_OPERATIONAL_AUDIT_STORE_VERSION,
      storage: createJSONStorage(() => characterStorage),
      partialize: (state: CatalogOperationalAuditState) => ({ importedAudits: state.importedAudits, events: state.events })
    }
  )
);
