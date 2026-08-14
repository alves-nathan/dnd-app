import type { RuleValidationIssue } from '../types';

export type ReleaseBuildProfile = 'development' | 'development-simulator' | 'preview' | 'beta' | 'beta-candidate' | 'production';
export type ReleasePlatform = 'android' | 'ios' | 'all';
export type ReleaseCheckStatus = 'pass' | 'warn' | 'fail';

export interface ReleaseCommand {
  id: string;
  label: string;
  command: string;
  purpose: string;
  profile?: ReleaseBuildProfile;
  platform?: ReleasePlatform;
}

export interface ReleaseChecklistItem {
  id: string;
  title: string;
  status: ReleaseCheckStatus;
  description: string;
  blocking: boolean;
  action?: string;
}

export interface ReleasePlanInput {
  appName: string;
  appSlug: string;
  version: string;
  androidPackage?: string;
  androidVersionCode?: number;
  iosBundleIdentifier?: string;
  iosBuildNumber?: string;
  hasEasJson: boolean;
  hasExpoDevClient: boolean;
  hasReleaseScripts: boolean;
  hasPinnedEasCli?: boolean;
  hasBetaProfile?: boolean;
  hasBetaCandidateProfile?: boolean;
  hasProjectId?: boolean;
  validationScore?: number;
  compatibilityGate?: 'ready' | 'needsReview' | 'blocked';
}

export interface ReleasePlan {
  generatedAt: string;
  app: {
    name: string;
    slug: string;
    version: string;
    androidPackage?: string;
    androidVersionCode?: number;
    iosBundleIdentifier?: string;
    iosBuildNumber?: string;
  };
  gate: 'ready' | 'needsReview' | 'blocked';
  checklist: ReleaseChecklistItem[];
  commands: ReleaseCommand[];
  issues: RuleValidationIssue[];
  markdown: string;
}

export const RELEASE_BUILD_PROFILES: ReleaseCommand[] = [
  {
    id: 'validate.local',
    label: 'Validação local completa',
    command: 'npm run release:validate',
    purpose: 'Executa shape check, typecheck, testes CI e readiness de release antes de gerar build.'
  },
  {
    id: 'eas.login',
    label: 'Login EAS',
    command: 'npm run eas:login',
    purpose: 'Autentica no Expo Application Services antes do primeiro build.'
  },
  {
    id: 'eas.init',
    label: 'Inicializar projeto EAS',
    command: 'npm run eas:init',
    purpose: 'Cria/vincula o projeto EAS e adiciona projectId ao app config quando necessário.'
  },
  {
    id: 'build.dev.android',
    label: 'Dev build Android',
    command: 'npm run build:dev:android',
    purpose: 'Gera APK interno com development client para testar native modules e SQLite/document picker em aparelho real.',
    profile: 'development',
    platform: 'android'
  },
  {
    id: 'build.dev.ios.simulator',
    label: 'Dev build iOS Simulator',
    command: 'npm run build:dev:ios-simulator',
    purpose: 'Gera build de desenvolvimento para simulador iOS.',
    profile: 'development-simulator',
    platform: 'ios'
  },
  {
    id: 'build.preview.android',
    label: 'Preview Android',
    command: 'npm run build:preview:android',
    purpose: 'Gera APK interno sem ferramentas de desenvolvimento para teste próximo de produção.',
    profile: 'preview',
    platform: 'android'
  },
  {
    id: 'build.preview.ios',
    label: 'Preview iOS',
    command: 'npm run build:preview:ios',
    purpose: 'Gera build interno iOS para testers cadastrados/ad hoc conforme configuração da conta Apple.',
    profile: 'preview',
    platform: 'ios'
  },
  {
    id: 'build.beta.android',
    label: 'Beta Android',
    command: 'npm run build:beta:android',
    purpose: 'Gera APK assinado para distribuição interna ao grupo beta.',
    profile: 'beta',
    platform: 'android'
  },
  {
    id: 'build.beta.ios',
    label: 'Beta iOS',
    command: 'npm run build:beta:ios',
    purpose: 'Gera build iOS interna para o grupo beta conforme credenciais da conta Apple.',
    profile: 'beta',
    platform: 'ios'
  },
  {
    id: 'build.beta-candidate.android',
    label: 'Candidata beta Android',
    command: 'npm run build:beta-candidate:android',
    purpose: 'Gera o APK candidato somente após o gate local e o manifesto de evidências.',
    profile: 'beta-candidate',
    platform: 'android'
  },
  {
    id: 'build.beta-candidate.ios',
    label: 'Candidata beta iOS',
    command: 'npm run build:beta-candidate:ios',
    purpose: 'Gera a build iOS candidata para validação final em ambiente Apple.',
    profile: 'beta-candidate',
    platform: 'ios'
  },
  {
    id: 'beta.evidence.validate',
    label: 'Validar evidências nativas',
    command: 'npm run beta:evidence:validate',
    purpose: 'Confere contrato v3, hashes, versão, commit e validade temporal das evidências Android/iOS.'
  },
  {
    id: 'beta.promotion.report',
    label: 'Relatório de promoção beta',
    command: 'npm run beta:promotion:report',
    purpose: 'Combina gate local, evidências nativas e feedback exportado antes da promoção.'
  },
  {
    id: 'beta.promotion.plan',
    label: 'Plano de promoção beta',
    command: 'npm run beta:promotion:plan',
    purpose: 'Gera um dry-run auditável dos builds beta sem executar publicação.'
  },
  {
    id: 'build.production.android',
    label: 'Production Android',
    command: 'npm run build:production:android',
    purpose: 'Gera AAB para Google Play quando o app estiver pronto para distribuição.',
    profile: 'production',
    platform: 'android'
  },
  {
    id: 'build.production.ios',
    label: 'Production iOS',
    command: 'npm run build:production:ios',
    purpose: 'Gera build iOS de produção para TestFlight/App Store quando o app estiver pronto.',
    profile: 'production',
    platform: 'ios'
  }
];

const issue = (severity: RuleValidationIssue['severity'], code: string, message: string): RuleValidationIssue => ({ severity, code, message });

const statusFromBlocking = (blocking: boolean, ok: boolean, warnWhenMissing = false): ReleaseCheckStatus => {
  if (ok) return 'pass';
  if (blocking) return 'fail';
  return warnWhenMissing ? 'warn' : 'pass';
};

const item = (
  id: string,
  title: string,
  ok: boolean,
  description: string,
  blocking: boolean,
  action?: string,
  warnWhenMissing = true
): ReleaseChecklistItem => ({
  id,
  title,
  status: statusFromBlocking(blocking, ok, warnWhenMissing),
  description,
  blocking,
  action: ok ? undefined : action
});

const gateFor = (items: ReleaseChecklistItem[], compatibilityGate?: ReleasePlanInput['compatibilityGate']): ReleasePlan['gate'] => {
  if (items.some((entry) => entry.status === 'fail')) return 'blocked';
  if (compatibilityGate === 'blocked') return 'blocked';
  if (items.some((entry) => entry.status === 'warn')) return 'needsReview';
  if (compatibilityGate === 'needsReview') return 'needsReview';
  return 'ready';
};

export const createReleasePlan = (input: ReleasePlanInput): ReleasePlan => {
  const checklist: ReleaseChecklistItem[] = [
    item('app.identity.name', 'Nome e slug definidos', Boolean(input.appName && input.appSlug), `App ${input.appName || '-'} · slug ${input.appSlug || '-'}.`, true, 'Preencha expo.name e expo.slug em app.json.'),
    item('app.identity.android', 'Identificador Android definido', Boolean(input.androidPackage), `Package Android: ${input.androidPackage || '-'}.`, true, 'Preencha expo.android.package antes de build nativo.'),
    item('app.identity.ios', 'Bundle identifier iOS definido', Boolean(input.iosBundleIdentifier), `Bundle iOS: ${input.iosBundleIdentifier || '-'}.`, true, 'Preencha expo.ios.bundleIdentifier antes de build nativo.'),
    item('app.version.android', 'VersionCode Android definido', typeof input.androidVersionCode === 'number' && input.androidVersionCode > 0, `VersionCode Android: ${input.androidVersionCode ?? '-'}.`, true, 'Defina expo.android.versionCode inteiro positivo.'),
    item('app.version.ios', 'Build number iOS definido', Boolean(input.iosBuildNumber), `BuildNumber iOS: ${input.iosBuildNumber || '-'}.`, true, 'Defina expo.ios.buildNumber.'),
    item('eas.config', 'eas.json presente', input.hasEasJson, 'Perfis development, preview, beta e production configurados.', true, 'Crie eas.json com perfis de build.'),
    item('dev.client', 'expo-dev-client instalado', input.hasExpoDevClient, 'Necessário para development builds com cliente nativo.', true, 'Instale expo-dev-client e rode npx expo install --fix.'),
    item('scripts.release', 'Scripts de release disponíveis', input.hasReleaseScripts, 'Scripts npm cobrem validação, dev build, preview, production e submit.', true, 'Adicione scripts release/build no package.json.'),
    item('eas.cli.pinned', 'EAS CLI reproduzível', Boolean(input.hasPinnedEasCli), 'Os comandos usam npx com uma versão exata, sem instalar eas-cli no projeto.', true, 'Defina config.easCliVersion e use npx eas-cli@<versão> nos scripts.'),
    item('eas.beta.profile', 'Perfil beta interno disponível', Boolean(input.hasBetaProfile), 'O perfil beta deve usar distribuição interna.', true, 'Adicione build.beta ao eas.json.'),
    item('eas.betaCandidate.profile', 'Perfil de candidata beta disponível', Boolean(input.hasBetaCandidateProfile), 'A candidata usa canal e perfil separados da beta corrente.', true, 'Adicione build.beta-candidate ao eas.json.'),
    item('eas.projectId', 'Projeto EAS vinculado', Boolean(input.hasProjectId), 'O projectId pode ser preenchido automaticamente após eas init.', false, 'Rode npm run eas:init antes do primeiro build cloud.', true),
    item('quality.compatibility', 'Gate lógico de compatibilidade', input.compatibilityGate !== 'blocked', `Gate atual: ${input.compatibilityGate ?? 'não informado'} · score ${input.validationScore ?? '-'}.`, false, 'Abra Hardening / compatibilidade e corrija fails antes de builds de produção.', true)
  ];

  const issues: RuleValidationIssue[] = checklist
    .filter((entry) => entry.status !== 'pass')
    .map((entry) => issue(entry.status === 'fail' ? 'error' : 'warning', `RELEASE_${entry.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`, entry.action ?? entry.description));

  const gate = gateFor(checklist, input.compatibilityGate);
  const planWithoutMarkdown = {
    generatedAt: new Date().toISOString(),
    app: {
      name: input.appName,
      slug: input.appSlug,
      version: input.version,
      androidPackage: input.androidPackage,
      androidVersionCode: input.androidVersionCode,
      iosBundleIdentifier: input.iosBundleIdentifier,
      iosBuildNumber: input.iosBuildNumber
    },
    gate,
    checklist,
    commands: RELEASE_BUILD_PROFILES,
    issues
  };

  return { ...planWithoutMarkdown, markdown: releasePlanToMarkdown(planWithoutMarkdown) };
};

export const releasePlanToMarkdown = (plan: Omit<ReleasePlan, 'markdown'>): string => {
  const lines: string[] = [];
  lines.push(`# Plano de release/dev build — ${plan.app.name}`);
  lines.push('');
  lines.push(`Gerado em: ${plan.generatedAt}`);
  lines.push(`Gate: **${plan.gate}**`);
  lines.push(`Versão: ${plan.app.version}`);
  lines.push(`Android package: ${plan.app.androidPackage ?? '-'}`);
  lines.push(`Android versionCode: ${plan.app.androidVersionCode ?? '-'}`);
  lines.push(`iOS bundleIdentifier: ${plan.app.iosBundleIdentifier ?? '-'}`);
  lines.push(`iOS buildNumber: ${plan.app.iosBuildNumber ?? '-'}`);
  lines.push('');
  lines.push('## Checklist');
  for (const check of plan.checklist) {
    lines.push(`- [${check.status === 'pass' ? 'x' : ' '}] **${check.status.toUpperCase()}** ${check.title} — ${check.description}`);
    if (check.action) lines.push(`  - Ação: ${check.action}`);
  }
  lines.push('');
  lines.push('## Comandos');
  for (const command of plan.commands) {
    lines.push(`### ${command.label}`);
    lines.push('```bash');
    lines.push(command.command);
    lines.push('```');
    lines.push(command.purpose);
    lines.push('');
  }
  lines.push('## Observações de conteúdo');
  lines.push('- O app não empacota regras oficiais protegidas; conteúdo deve vir de importações locais do usuário.');
  lines.push('- Antes de distribuir builds para terceiros, revise backups, compêndio importado e dados pessoais salvos localmente.');
  return lines.join('\n');
};

export const defaultReleasePlanInput: ReleasePlanInput = {
  appName: 'D&D Combat Math MVP',
  appSlug: 'dnd-combat-math-mvp',
  version: '1.0.0',
  androidPackage: 'com.nalves.dndcombatmathmvp',
  androidVersionCode: 2,
  iosBundleIdentifier: 'com.nalves.dndcombatmathmvp',
  iosBuildNumber: '1',
  hasEasJson: true,
  hasExpoDevClient: true,
  hasReleaseScripts: true,
  hasPinnedEasCli: true,
  hasBetaProfile: true,
  hasBetaCandidateProfile: true,
  hasProjectId: false,
  compatibilityGate: 'needsReview'
};
