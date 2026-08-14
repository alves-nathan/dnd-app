const fs = require('node:fs');
const path = require('node:path');

const SESSION_SCHEMA = 'dnd-combat-mobile-test-session.v1';
const CHECKLIST_SCHEMA = 'dnd-combat-mobile-manual-checklist.v1';
const PERFORMANCE_SCHEMA = 'dnd-combat-mobile-performance.v1';

const checklistDefinitions = {
  accessibility: [
    'screenReaderNavigation',
    'focusOrder',
    'labelsAndHints',
    'largeText',
    'noCriticalTruncation'
  ],
  backupRestore: [
    'backupCreated',
    'checksumVerified',
    'freshInstallOrIsolatedState',
    'restoreCompleted',
    'characterDataCompared'
  ],
  dataSafety: [
    'migrationRehearsal',
    'upgradeFromPreviousVersion',
    'rollbackPlanReviewed',
    'localOnlyDataVerified',
    'destructiveActionsConfirmed'
  ]
};

const nonEmpty = (value) => typeof value === 'string' && Boolean(value.trim());
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const createChecklist = (kind, platform, now = new Date().toISOString()) => {
  const checks = checklistDefinitions[kind];
  if (!checks) throw new Error(`Checklist desconhecido: ${kind}`);
  return {
    schemaVersion: CHECKLIST_SCHEMA,
    kind,
    platform,
    status: 'pending',
    generatedAt: now,
    reviewedAt: null,
    reviewer: null,
    device: null,
    checks: Object.fromEntries(checks.map((key) => [key, false])),
    notes: ''
  };
};

const validateChecklist = (input, expectedKind, expectedPlatform) => {
  const issues = [];
  if (!isObject(input)) return { passed: false, issues: ['Checklist deve ser um objeto JSON.'] };
  if (input.schemaVersion !== CHECKLIST_SCHEMA) issues.push(`schemaVersion deve ser ${CHECKLIST_SCHEMA}.`);
  if (input.kind !== expectedKind) issues.push(`kind deve ser ${expectedKind}.`);
  if (input.platform !== expectedPlatform) issues.push(`platform deve ser ${expectedPlatform}.`);
  if (input.status !== 'pass') issues.push('status deve ser pass após revisão manual real.');
  if (!nonEmpty(input.reviewer)) issues.push('reviewer é obrigatório.');
  if (!nonEmpty(input.device)) issues.push('device é obrigatório.');
  if (!nonEmpty(input.reviewedAt) || !Number.isFinite(Date.parse(input.reviewedAt))) issues.push('reviewedAt deve ser uma data ISO válida.');
  const required = checklistDefinitions[expectedKind] || [];
  if (!isObject(input.checks)) issues.push('checks é obrigatório.');
  else for (const key of required) if (input.checks[key] !== true) issues.push(`checks.${key} precisa ser true.`);
  return { passed: issues.length === 0, issues };
};

const parseAttributes = (tag) => {
  const result = {};
  for (const match of String(tag).matchAll(/([\w:-]+)="([^"]*)"/g)) result[match[1]] = match[2];
  return result;
};

const parseJUnitSummary = (xml) => {
  const suites = [...String(xml || '').matchAll(/<testsuite\b([^>]*)>/g)].map((match) => parseAttributes(match[1]));
  if (!suites.length) return { tests: 0, failures: 0, errors: 0, skipped: 0, passed: false };
  const sum = (key) => suites.reduce((total, suite) => total + Number(suite[key] || 0), 0);
  const tests = sum('tests');
  const failures = sum('failures');
  const errors = sum('errors');
  const skipped = sum('skipped');
  return { tests, failures, errors, skipped, passed: tests > 0 && failures === 0 && errors === 0 };
};

const parseAndroidAmStart = (text) => {
  const read = (label) => {
    const match = String(text || '').match(new RegExp(`${label}:\\s*(\\d+)`, 'i'));
    return match ? Number(match[1]) : undefined;
  };
  return { thisTimeMs: read('ThisTime'), totalTimeMs: read('TotalTime'), waitTimeMs: read('WaitTime') };
};

const parseAndroidMeminfo = (text) => {
  const source = String(text || '');
  const totalPss = source.match(/TOTAL PSS:\s*(\d+)/i)?.[1]
    ?? source.match(/^\s*TOTAL\s+(\d+)\s+/im)?.[1];
  const totalRss = source.match(/TOTAL RSS:\s*(\d+)/i)?.[1];
  return {
    totalPssKb: totalPss ? Number(totalPss) : undefined,
    totalRssKb: totalRss ? Number(totalRss) : undefined,
    peakMemoryMb: totalPss ? Number(totalPss) / 1024 : undefined
  };
};

const parseAndroidGfxInfo = (text) => {
  const source = String(text || '');
  const totalFrames = source.match(/Total frames rendered:\s*(\d+)/i)?.[1];
  const janky = source.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/i);
  return {
    totalFrames: totalFrames ? Number(totalFrames) : undefined,
    jankyFrames: janky ? Number(janky[1]) : undefined,
    droppedFramesPercent: janky ? Number(janky[2]) : undefined
  };
};

const evaluatePerformance = (metrics, thresholds = {}) => {
  const limits = {
    coldStartMs: thresholds.coldStartMs ?? 3000,
    peakMemoryMb: thresholds.peakMemoryMb ?? 512,
    droppedFramesPercent: thresholds.droppedFramesPercent ?? 8
  };
  const issues = [];
  for (const key of Object.keys(limits)) {
    const value = metrics[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(`Métrica ausente ou inválida: ${key}.`);
    else if (value > limits[key]) issues.push(`${key} ${value.toFixed(2)} excede o limite ${limits[key]}.`);
  }
  return { status: issues.length ? 'review' : 'pass', thresholds: limits, issues };
};

const loadJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

module.exports = {
  CHECKLIST_SCHEMA,
  PERFORMANCE_SCHEMA,
  SESSION_SCHEMA,
  checklistDefinitions,
  createChecklist,
  evaluatePerformance,
  loadJson,
  parseAndroidAmStart,
  parseAndroidGfxInfo,
  parseAndroidMeminfo,
  parseJUnitSummary,
  validateChecklist,
  writeJson
};
