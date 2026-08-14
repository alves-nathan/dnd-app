#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveEasCli } = require('./lib/eas-cli-command');
const { readProjectId } = require('./lib/eas-beta-build');
const { listAndroidDevices, resolveAdb, resolveMaestro } = require('./lib/mobile-tools');
const { writeJson } = require('./lib/mobile-test-session');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const allowBlocked = args.has('--allow-blocked');
const reportPath = path.join(root, 'artifacts', 'native-owner', 'preflight.json');
const checks = [];
const add = (id, status, message, details) => checks.push({ id, status, message, ...(details ? { details } : {}) });
const run = (command, commandArgs) => spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 20 * 1024 * 1024 });
const runInvocation = (invocation, commandArgs) => run(invocation.command, [...invocation.prefixArgs, ...commandArgs]);

try {
  const appPath = path.join(root, 'app.json');
  const projectId = readProjectId(appPath);
  add('easProjectId', projectId ? 'pass' : 'blocked', projectId ? `Projeto EAS configurado: ${projectId}` : 'extra.eas.projectId ainda não foi configurado.');

  const eas = resolveEasCli(root);
  add('easCli', 'pass', `EAS CLI configurado via ${eas.source}: ${eas.display}.`);

  if (!offline) {
    const whoami = runInvocation(eas, ['whoami']);
    const username = String(whoami.stdout || '').trim();
    add('easAuthentication', whoami.status === 0 && username ? 'pass' : 'blocked', whoami.status === 0 && username ? `Autenticado no EAS como ${username}.` : 'Sessão EAS ausente ou inválida.', String(whoami.stderr || '').trim() || undefined);

    if (projectId && whoami.status === 0) {
      const info = runInvocation(eas, ['project:info']);
      add('easProjectAccess', info.status === 0 ? 'pass' : 'blocked', info.status === 0 ? 'A conta autenticada acessa o projeto configurado.' : 'Não foi possível confirmar acesso ao projeto EAS.', String(info.stderr || info.stdout || '').trim() || undefined);
    }
  } else {
    add('easAuthentication', 'pending', 'Verificação online ignorada por --offline.');
    add('easProjectAccess', 'pending', 'Verificação online ignorada por --offline.');
  }

  const git = run('git', ['rev-parse', 'HEAD']);
  const gitSha = git.status === 0 ? String(git.stdout || '').trim() : process.env.BETA_GIT_SHA;
  add('gitCommit', gitSha ? 'pass' : 'blocked', gitSha ? `Commit identificado: ${gitSha}` : 'Commit Git indisponível; execute dentro do repositório ou defina BETA_GIT_SHA.');
  if (git.status === 0) {
    const dirty = run('git', ['status', '--porcelain']);
    add('gitWorkingTree', String(dirty.stdout || '').trim() ? 'review' : 'pass', String(dirty.stdout || '').trim() ? 'Há alterações locais não commitadas; a build pode não corresponder ao código revisado.' : 'Working tree limpa.');
  } else {
    add('gitWorkingTree', 'pending', 'Repositório Git não detectado neste diretório.');
  }

  const adb = resolveAdb();
  add('adb', adb ? 'pass' : 'blocked', adb ? `ADB encontrado: ${adb}` : 'ADB não encontrado. Configure ADB_PATH ou ANDROID_SDK_ROOT.');
  let devices = [];
  if (adb) {
    try {
      devices = listAndroidDevices(adb);
      const authorized = devices.filter((entry) => entry.status === 'device');
      add('androidDevice', authorized.length ? 'pass' : 'blocked', authorized.length ? `${authorized.length} dispositivo(s) Android autorizado(s).` : 'Nenhum dispositivo Android autorizado.', devices);
    } catch (error) {
      add('androidDevice', 'blocked', error.message);
    }
  } else add('androidDevice', 'blocked', 'ADB indisponível.');

  const maestro = resolveMaestro();
  add('maestro', maestro ? 'pass' : 'blocked', maestro ? `Maestro encontrado: ${maestro}` : 'Maestro não encontrado. Configure MAESTRO_PATH.');

  const statuses = checks.map((entry) => entry.status);
  const status = statuses.includes('blocked') ? 'blocked' : statuses.includes('review') || statuses.includes('pending') ? 'needsReview' : 'ready';
  const report = {
    schemaVersion: 'dnd-combat-native-owner-preflight.v1',
    generatedAt: new Date().toISOString(),
    status,
    offline,
    projectId,
    gitSha,
    tools: { eas: eas.display, easSource: eas.source, adb, maestro },
    devices,
    checks
  };
  writeJson(reportPath, report);
  console.log(`Preflight ${status}: ${path.relative(root, reportPath)}`);
  checks.forEach((entry) => console.log(`[${entry.status.toUpperCase()}] ${entry.message}`));
  if (status === 'blocked' && !allowBlocked) process.exit(2);
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
