export type ReleaseCandidateHardeningArea =
  | 'integralGate'
  | 'performance'
  | 'accessibility'
  | 'security'
  | 'migration'
  | 'cleanInstall'
  | 'upgrade'
  | 'releaseConfiguration';

export type ReleaseCandidateCheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'BLOCKED';

export interface ReleaseCandidateHardeningCheck {
  id: string;
  area: ReleaseCandidateHardeningArea;
  title: string;
  blocking: boolean;
  objective: string;
}

export const APP29_RELEASE_CANDIDATE_CHECKS: ReleaseCandidateHardeningCheck[] = [
  { id: 'app28-integral-gate', area: 'integralGate', title: 'Gate integral APP-28', blocking: true, objective: 'Vincular dependências, typecheck, Jest e 83 fluxos Android à codebase final.' },
  { id: 'performance-budget', area: 'performance', title: 'Orçamento de desempenho', blocking: true, objective: 'Medir o bundle real do catálogo e impedir regressões patológicas de parse e integridade.' },
  { id: 'accessibility-contracts', area: 'accessibility', title: 'Contratos de acessibilidade', blocking: true, objective: 'Garantir alvos mínimos, papéis, rótulos, estados e navegação de retorno.' },
  { id: 'security-hardening', area: 'security', title: 'Hardening de segurança', blocking: true, objective: 'Bloquear segredos, HTTP em runtime, execução dinâmica e permissões móveis desnecessárias.' },
  { id: 'migration-contracts', area: 'migration', title: 'Contratos de migração', blocking: true, objective: 'Toda store versionada precisa preservar ou descartar estado de forma deliberada.' },
  { id: 'clean-install-rehearsal', area: 'cleanInstall', title: 'Instalação limpa', blocking: true, objective: 'Validar estados iniciais vazios e determinísticos sem dados preexistentes.' },
  { id: 'upgrade-rehearsal', area: 'upgrade', title: 'Upgrade', blocking: true, objective: 'Preservar presets e histórico, descartando somente sessões antigas inseguras.' },
  { id: 'release-readiness', area: 'releaseConfiguration', title: 'Configuração de release', blocking: true, objective: 'Validar identificadores, perfis EAS, runtimeVersion e documentação operacional.' }
];

export const summarizeReleaseCandidateChecks = (statuses: Record<string, ReleaseCandidateCheckStatus>) => {
  const resolved = APP29_RELEASE_CANDIDATE_CHECKS.map((check) => ({ ...check, status: statuses[check.id] ?? 'BLOCKED' as const }));
  const failed = resolved.filter((check) => check.status === 'FAIL').length;
  const blocked = resolved.filter((check) => check.status === 'BLOCKED').length;
  const warnings = resolved.filter((check) => check.status === 'WARN').length;
  const passed = resolved.filter((check) => check.status === 'PASS').length;
  return {
    status: failed > 0 ? 'FAIL' as const : blocked > 0 ? 'BLOCKED' as const : warnings > 0 ? 'WARN' as const : 'PASS' as const,
    passed,
    warnings,
    failed,
    blocked,
    total: resolved.length,
    checks: resolved
  };
};

export const releaseCandidateHardeningToMarkdown = (statuses: Record<string, ReleaseCandidateCheckStatus>): string => {
  const summary = summarizeReleaseCandidateChecks(statuses);
  return [
    '# APP-29 — Hardening do release candidate',
    '',
    `Status: **${summary.status}**`,
    `Resultado: ${summary.passed} PASS · ${summary.warnings} WARN · ${summary.failed} FAIL · ${summary.blocked} BLOCKED`,
    '',
    ...summary.checks.map((check) => `- ${check.status} — ${check.title}: ${check.objective}`),
    '',
    'Nenhum resultado BLOCKED ou FAIL autoriza o release candidate.'
  ].join('\n');
};
