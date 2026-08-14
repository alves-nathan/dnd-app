export type ProductionReleaseStatus = 'PASS' | 'WARN' | 'FAIL' | 'BLOCKED';

export type ProductionReleaseArea =
  | 'integralGate'
  | 'releaseCandidate'
  | 'identity'
  | 'operations'
  | 'privacy'
  | 'support'
  | 'buildArtifact'
  | 'publication'
  | 'closure';

export interface ProductionReleaseCheck {
  id: string;
  area: ProductionReleaseArea;
  title: string;
  blocking: boolean;
  objective: string;
}

export interface ProductionReleaseSummaryCheck extends ProductionReleaseCheck {
  status: ProductionReleaseStatus;
}

export interface ProductionReleaseSummary {
  status: ProductionReleaseStatus;
  passed: number;
  warnings: number;
  failed: number;
  blocked: number;
  total: number;
  checks: ProductionReleaseSummaryCheck[];
}

export const APP30_PRODUCTION_RELEASE_CHECKS: ProductionReleaseCheck[] = [
  {
    id: 'app28-integral-gate',
    area: 'integralGate',
    title: 'Gate integral APP-28',
    blocking: true,
    objective: 'Aprovar dependências, typecheck, Jest e todos os fluxos Android na mesma fingerprint da release.'
  },
  {
    id: 'app29-release-candidate',
    area: 'releaseCandidate',
    title: 'Release candidate APP-29',
    blocking: true,
    objective: 'Aprovar hardening, migrações, instalação limpa, upgrade, desempenho e segurança na mesma fingerprint.'
  },
  {
    id: 'production-identity',
    area: 'identity',
    title: 'Identidade de produção',
    blocking: true,
    objective: 'Fixar versão pública, package Android, bundle iOS, runtimeVersion e perfil production sem seed E2E.'
  },
  {
    id: 'operations-handbook',
    area: 'operations',
    title: 'Manual operacional',
    blocking: true,
    objective: 'Entregar runbook de build, publicação, observabilidade, incidentes, rollback e continuidade.'
  },
  {
    id: 'privacy-data-handling',
    area: 'privacy',
    title: 'Privacidade e dados',
    blocking: true,
    objective: 'Documentar armazenamento local, backups, evidências opt-in e ausência de telemetria automática.'
  },
  {
    id: 'support-readiness',
    area: 'support',
    title: 'Suporte e triagem',
    blocking: true,
    objective: 'Definir coleta segura de diagnóstico, severidades, resposta e comunicação de incidentes.'
  },
  {
    id: 'production-build-artifact',
    area: 'buildArtifact',
    title: 'Artefato de produção',
    blocking: true,
    objective: 'Vincular AAB/IPA final ao build, versão, checksum e evidências APP-28/29 aprovadas.'
  },
  {
    id: 'store-publication-receipt',
    area: 'publication',
    title: 'Recibo de publicação',
    blocking: true,
    objective: 'Registrar a publicação real na loja sem confundir preparação, upload, revisão e disponibilidade pública.'
  },
  {
    id: 'release-closure',
    area: 'closure',
    title: 'Encerramento verificável',
    blocking: true,
    objective: 'Produzir pacote de entrega, inventário, checksums, pendências e recibo final de encerramento.'
  }
];

export const summarizeProductionRelease = (
  statuses: Record<string, ProductionReleaseStatus>
): ProductionReleaseSummary => {
  const checks = APP30_PRODUCTION_RELEASE_CHECKS.map((check) => ({
    ...check,
    status: statuses[check.id] ?? 'BLOCKED' as const
  }));
  const failed = checks.filter((check) => check.status === 'FAIL').length;
  const blocked = checks.filter((check) => check.status === 'BLOCKED').length;
  const warnings = checks.filter((check) => check.status === 'WARN').length;
  const passed = checks.filter((check) => check.status === 'PASS').length;
  return {
    status: failed > 0 ? 'FAIL' : blocked > 0 ? 'BLOCKED' : warnings > 0 ? 'WARN' : 'PASS',
    passed,
    warnings,
    failed,
    blocked,
    total: checks.length,
    checks
  };
};

export const isStableReleaseVersion = (version: string): boolean =>
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);

export const productionReleaseToMarkdown = (
  statuses: Record<string, ProductionReleaseStatus>,
  version: string
): string => {
  const summary = summarizeProductionRelease(statuses);
  return [
    `# APP-30 — Release de produção ${version}`,
    '',
    `Status: **${summary.status}**`,
    `Resultado: ${summary.passed} PASS · ${summary.warnings} WARN · ${summary.failed} FAIL · ${summary.blocked} BLOCKED`,
    '',
    ...summary.checks.map((check) => `- ${check.status} — ${check.title}: ${check.objective}`),
    '',
    'Nenhum artefato BLOCKED ou FAIL autoriza build, submissão ou anúncio de disponibilidade.'
  ].join('\n');
};
