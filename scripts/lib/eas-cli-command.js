const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executable = (name) => process.platform === 'win32' ? `${name}.cmd` : name;

const canExecute = (command, args = ['--version'], cwd = process.cwd()) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'ignore',
    env: process.env,
    timeout: 15000
  });
  return result.status === 0;
};

const readPinnedVersion = (root) => {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return packageJson?.config?.easCliVersion || 'latest';
  } catch {
    return 'latest';
  }
};

const resolveEasCli = (root = process.cwd(), options = {}) => {
  const configuredPath = process.env.EAS_CLI_PATH;
  if (configuredPath) {
    const resolved = path.resolve(root, configuredPath);
    if (!fs.existsSync(resolved)) throw new Error(`EAS_CLI_PATH não encontrado: ${resolved}`);
    return { command: resolved, prefixArgs: [], source: 'environment', display: resolved };
  }

  const globalCommand = executable('eas');
  if (options.preferGlobal !== false && canExecute(globalCommand, ['--version'], root)) {
    return { command: globalCommand, prefixArgs: [], source: 'global', display: globalCommand };
  }

  const version = readPinnedVersion(root);
  const npxCommand = executable('npx');
  return {
    command: npxCommand,
    prefixArgs: ['--yes', `eas-cli@${version}`],
    source: 'npx',
    version,
    display: `${npxCommand} --yes eas-cli@${version}`
  };
};

const spawnEas = (root, args, options = {}) => {
  const invocation = resolveEasCli(root, options);
  return {
    invocation,
    result: spawnSync(invocation.command, [...invocation.prefixArgs, ...args], {
      cwd: root,
      env: process.env,
      ...options.spawnOptions
    })
  };
};

module.exports = { readPinnedVersion, resolveEasCli, spawnEas };
