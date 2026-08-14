const { listAndroidDevices, resolveAdb, resolveMaestro, resolveXcrun, runTool } = require('./lib/mobile-tools');

const platform = process.argv[2] || process.env.E2E_PLATFORM || 'android';
const problems = [];
const maestro = resolveMaestro();

if (!maestro) problems.push('Maestro CLI não encontrado. Configure MAESTRO_PATH, adicione maestro ao PATH ou instale em ~/.maestro/bin.');

if (platform === 'android') {
  const adb = resolveAdb();
  if (!adb) {
    problems.push('adb não encontrado. Configure ADB_PATH/ANDROID_SDK_ROOT ou instale platform-tools.');
  } else {
    try {
      const devices = listAndroidDevices(adb);
      if (!devices.some((entry) => entry.status === 'device')) {
        problems.push('Nenhum dispositivo/emulador Android autorizado e conectado.');
      }
    } catch (error) {
      problems.push(`Falha ao consultar adb: ${error.message}`);
    }
  }
} else if (platform === 'ios') {
  if (process.platform !== 'darwin') problems.push('Testes iOS locais exigem macOS.');
  const xcrun = resolveXcrun();
  if (!xcrun) problems.push('xcrun não encontrado.');
  else {
    const result = runTool(xcrun, ['simctl', 'list', 'devices', 'booted']);
    if (!String(result.stdout || '').includes('(Booted)')) problems.push('Nenhum simulador iOS iniciado.');
  }
} else {
  problems.push(`Plataforma inválida: ${platform}. Use android ou ios.`);
}

if (problems.length) {
  console.error(`Ambiente E2E ${platform} não está pronto:`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log(`Ambiente E2E ${platform}: OK`);
console.log(`Maestro: ${maestro}`);
if (process.env.MAESTRO_HOST) console.log(`Maestro host remoto: ${process.env.MAESTRO_HOST}`);
if (process.env.ADB_SERVER_SOCKET) console.log(`ADB server remoto: ${process.env.ADB_SERVER_SOCKET}`);
if (platform === 'android') console.log(`ADB: ${resolveAdb()}`);
if (platform === 'ios') console.log(`xcrun: ${resolveXcrun()}`);
