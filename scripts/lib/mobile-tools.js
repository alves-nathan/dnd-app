const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executableExists = (candidate) => {
  if (!candidate) return false;
  if (candidate.includes(path.sep) || candidate.includes('/')) {
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); }
    catch { return false; }
  }
  return spawnSync('sh', ['-lc', `command -v "${candidate.replace(/"/g, '\\"')}"`], { encoding: 'utf8' }).status === 0;
};

const commandOnPath = (command) => {
  const result = spawnSync('sh', ['-lc', `command -v "${command.replace(/"/g, '\\"')}"`], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim() : undefined;
};

const androidSdkCandidates = (env = process.env) => {
  const candidates = [];
  const roots = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME].filter(Boolean);
  for (const root of roots) {
    candidates.push(path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'));
    candidates.push(path.join(root, 'platform-tools', 'adb.exe'));
  }

  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  }

  if (process.platform === 'linux') {
    const usersRoot = '/mnt/c/Users';
    try {
      for (const user of fs.readdirSync(usersRoot)) {
        candidates.push(path.join(usersRoot, user, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
      }
    } catch {
      // Not running under WSL or Windows drive is not mounted.
    }
    candidates.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'));
  }

  if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
  }

  return candidates;
};

const resolveAdb = (env = process.env) => {
  const explicit = env.ADB_PATH;
  if (executableExists(explicit)) return explicit;
  const fromPath = commandOnPath('adb');
  if (fromPath) return fromPath;
  return androidSdkCandidates(env).find(executableExists);
};

const maestroCandidates = (env = process.env) => {
  const home = env.HOME || os.homedir();
  const candidates = [];
  if (home) {
    candidates.push(path.join(home, '.maestro', 'bin', process.platform === 'win32' ? 'maestro.bat' : 'maestro'));
    candidates.push(path.join(home, '.maestro', 'bin', 'maestro.bat'));
  }
  return candidates;
};

const resolveMaestro = (env = process.env) => {
  const explicit = env.MAESTRO_PATH;
  if (executableExists(explicit)) return explicit;
  const fromPath = commandOnPath('maestro');
  if (fromPath) return fromPath;
  return maestroCandidates(env).find(executableExists);
};

const resolveXcrun = () => commandOnPath('xcrun');

const parseAdbDevices = (output) => String(output || '')
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [serial, status, ...details] = line.split(/\s+/);
    return { serial, status, details: details.join(' ') };
  })
  .filter((entry) => entry.serial && entry.status);

const runTool = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  ...options
});

const listAndroidDevices = (adb, env = process.env) => {
  const result = runTool(adb, ['devices', '-l'], { env });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'adb devices falhou').trim());
  }
  return parseAdbDevices(result.stdout);
};

module.exports = {
  androidSdkCandidates,
  executableExists,
  listAndroidDevices,
  maestroCandidates,
  parseAdbDevices,
  resolveAdb,
  resolveMaestro,
  resolveXcrun,
  runTool
};
