const fs = require('node:fs');
const path = require('node:path');

const BUILD_ARTIFACT_SCHEMA = 'dnd-combat-eas-build-artifact.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{7,64}$/i;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asString = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseJsonOutput = (input) => {
  const text = String(input || '').trim();
  if (!text) throw new Error('Saída JSON do EAS está vazia.');
  try {
    return JSON.parse(text);
  } catch {
    const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0).sort((a, b) => a - b);
    for (const start of starts) {
      const opener = text[start];
      const closer = opener === '[' ? ']' : '}';
      const end = text.lastIndexOf(closer);
      if (end <= start) continue;
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Try the next candidate.
      }
    }
    throw new Error('Não foi possível interpretar a saída JSON do EAS.');
  }
};

const selectBuild = (value) => {
  if (Array.isArray(value)) {
    if (!value.length) throw new Error('O EAS não retornou nenhuma build.');
    return value[0];
  }
  if (isObject(value) && Array.isArray(value.builds)) {
    if (!value.builds.length) throw new Error('O EAS não retornou nenhuma build.');
    return value.builds[0];
  }
  if (isObject(value)) return value;
  throw new Error('Formato de build EAS não reconhecido.');
};

const normalizeEasBuild = (input) => {
  const build = selectBuild(input);
  const artifacts = isObject(build.artifacts) ? build.artifacts : {};
  const metadata = isObject(build.metadata) ? build.metadata : {};
  const project = isObject(build.project) ? build.project : {};
  return {
    id: asString(build.id),
    status: asString(build.status)?.toLowerCase(),
    platform: asString(build.platform)?.toLowerCase(),
    buildProfile: asString(build.buildProfile) || asString(metadata.buildProfile),
    distribution: asString(build.distribution),
    appVersion: asString(build.appVersion),
    appBuildVersion: asString(build.appBuildVersion),
    gitCommitHash: asString(build.gitCommitHash) || asString(metadata.gitCommitHash),
    artifactUrl: asString(artifacts.buildUrl) || asString(build.artifactUrl),
    projectId: asString(project.id) || asString(build.projectId),
    createdAt: asString(build.createdAt),
    completedAt: asString(build.completedAt),
    raw: build
  };
};

const validateCandidateBuild = (build, options = {}) => {
  const issues = [];
  const expectedPlatform = options.platform || 'android';
  const expectedProfile = options.profile || 'beta-candidate';
  if (!build.id) issues.push('Build ID ausente.');
  if (build.status !== 'finished') issues.push(`Status da build deve ser finished; recebido: ${build.status || 'ausente'}.`);
  if (build.platform !== expectedPlatform) issues.push(`Plataforma deve ser ${expectedPlatform}; recebida: ${build.platform || 'ausente'}.`);
  if (build.buildProfile && build.buildProfile !== expectedProfile) issues.push(`Perfil deve ser ${expectedProfile}; recebido: ${build.buildProfile}.`);
  if (!build.appVersion) issues.push('Versão do app ausente na build.');
  if (!build.appBuildVersion) issues.push('Número nativo da build ausente.');
  if (!build.gitCommitHash || !SHA.test(build.gitCommitHash)) issues.push('Commit Git da build ausente ou inválido.');
  if (!build.artifactUrl) issues.push('URL do artefato APK ausente.');
  else {
    try {
      const url = new URL(build.artifactUrl);
      if (url.protocol !== 'https:') issues.push('URL do artefato deve usar HTTPS.');
    } catch {
      issues.push('URL do artefato é inválida.');
    }
  }
  return { valid: issues.length === 0, issues };
};

const readProjectId = (appJsonPath) => {
  const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const projectId = app?.expo?.extra?.eas?.projectId;
  return typeof projectId === 'string' && UUID.test(projectId) ? projectId : undefined;
};

const redactUrl = (value) => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
};

const safeSegment = (value, fallback = 'unknown') => String(value || fallback)
  .trim()
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '') || fallback;

const createBuildArtifactManifest = ({ build, binaryPath, binarySha256, generatedAt = new Date().toISOString(), root = process.cwd() }) => {
  const relative = path.relative(root, path.resolve(binaryPath));
  return {
    schemaVersion: BUILD_ARTIFACT_SCHEMA,
    generatedAt,
    platform: build.platform,
    profile: build.buildProfile || 'beta-candidate',
    buildId: build.id,
    appVersion: build.appVersion,
    buildNumber: build.appBuildVersion,
    gitSha: build.gitCommitHash,
    projectId: build.projectId,
    completedAt: build.completedAt,
    binary: {
      location: relative.startsWith('..') ? path.resolve(binaryPath) : relative.split(path.sep).join('/'),
      sha256: binarySha256
    },
    artifactSource: redactUrl(build.artifactUrl)
  };
};

const validateBuildArtifactManifest = (manifest) => {
  const issues = [];
  if (!isObject(manifest)) return { valid: false, issues: ['Manifesto deve ser um objeto.'] };
  if (manifest.schemaVersion !== BUILD_ARTIFACT_SCHEMA) issues.push(`schemaVersion deve ser ${BUILD_ARTIFACT_SCHEMA}.`);
  if (manifest.platform !== 'android') issues.push('Somente artefatos Android são aceitos nesta fase.');
  if (manifest.profile !== 'beta-candidate') issues.push('profile deve ser beta-candidate.');
  for (const field of ['buildId', 'appVersion', 'buildNumber', 'gitSha']) if (!asString(manifest[field])) issues.push(`${field} é obrigatório.`);
  if (!isObject(manifest.binary)) issues.push('binary é obrigatório.');
  else {
    if (!asString(manifest.binary.location)) issues.push('binary.location é obrigatório.');
    if (!/^[a-f0-9]{64}$/i.test(manifest.binary.sha256 || '')) issues.push('binary.sha256 deve ser SHA-256.');
  }
  return { valid: issues.length === 0, issues };
};

module.exports = {
  BUILD_ARTIFACT_SCHEMA,
  UUID,
  createBuildArtifactManifest,
  normalizeEasBuild,
  parseJsonOutput,
  readProjectId,
  redactUrl,
  safeSegment,
  selectBuild,
  validateBuildArtifactManifest,
  validateCandidateBuild
};
