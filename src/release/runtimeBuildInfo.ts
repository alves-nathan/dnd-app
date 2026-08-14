import Constants from 'expo-constants';
import { Platform } from 'react-native';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean => value === true;

export interface RuntimeBuildInfo {
  appName: string;
  appVersion: string;
  nativeBuildVersion: string;
  platform: string;
  releaseStage: string;
  buildProfile: string;
  buildId?: string;
  gitSha?: string;
  testRunId?: string;
  e2eSeedEnabled: boolean;
}

export const getRuntimeBuildInfo = (): RuntimeBuildInfo => {
  const expoConfig = Constants.expoConfig;
  const extra = asRecord(expoConfig?.extra);
  const release = asRecord(extra.release);

  return {
    appName: expoConfig?.name ?? 'D&D Combat',
    appVersion: expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown',
    nativeBuildVersion: Constants.nativeBuildVersion ?? 'unknown',
    platform: Platform.OS,
    releaseStage: asString(release.stage) ?? (__DEV__ ? 'development' : 'unknown'),
    buildProfile: asString(release.buildProfile) ?? 'unknown',
    buildId: asString(release.buildId),
    gitSha: asString(release.gitSha),
    testRunId: asString(release.testRunId),
    e2eSeedEnabled: asBoolean(release.e2eSeedEnabled)
  };
};

export const formatRuntimeBuildInfo = (info: RuntimeBuildInfo): string => [
  `${info.appName} ${info.appVersion} (${info.nativeBuildVersion})`,
  `Plataforma: ${info.platform}`,
  `Estágio: ${info.releaseStage}`,
  `Perfil: ${info.buildProfile}`,
  `Build ID: ${info.buildId ?? 'não informado'}`,
  `Commit: ${info.gitSha ?? 'não informado'}`,
  `Execução E2E: ${info.testRunId ?? 'não informada'}`,
  `Fixture E2E interna: ${info.e2eSeedEnabled ? 'habilitada' : 'desabilitada'}`
].join('\n');
