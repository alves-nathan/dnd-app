#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const appPath = path.join(root, 'app.json');
const projectId = process.argv[2] || process.env.EAS_PROJECT_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!projectId || !uuid.test(projectId)) {
  console.error('Informe um EAS project ID UUID válido: npm run eas:configure-project -- <project-id>');
  process.exit(2);
}

const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
app.expo = app.expo || {};
app.expo.extra = app.expo.extra || {};
app.expo.extra.eas = { ...(app.expo.extra.eas || {}), projectId };
app.expo.extra.releaseChannelNote = 'Projeto vinculado ao EAS. Builds beta usam o perfil beta e distribuição interna.';
fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
console.log(`extra.eas.projectId configurado em app.json: ${projectId}`);
