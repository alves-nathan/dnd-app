#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const packPath = path.join(root, 'assets/compendium/phb-2024-full-consolidated-import-pack-v2-canonical.json');
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const spells = pack.items.filter((item) => item.kind === 'spell');
const areaSpells = spells.filter((item) => item.payload && item.payload.area && typeof item.payload.area === 'object' && Object.keys(item.payload.area).length);
const counts = {};
for (const spell of areaSpells) {
  const shape = spell.payload.area.shape || 'unknown';
  counts[shape] = (counts[shape] || 0) + 1;
}

const requiredShapes = ['line', 'cone', 'cube', 'sphere', 'cylinder'];
const missingShapes = requiredShapes.filter((shape) => !counts[shape]);
const sourceFiles = {
  types: fs.readFileSync(path.join(root, 'src/types/index.ts'), 'utf8'),
  areaRules: fs.readFileSync(path.join(root, 'src/rules-engine/targeting/areaTemplates.ts'), 'utf8'),
  tactical: fs.readFileSync(path.join(root, 'src/rules-engine/turns/tacticalCombat.ts'), 'utf8'),
  ui: fs.readFileSync(path.join(root, 'app/characters/[id]/tactical.tsx'), 'utf8')
};
const contracts = [
  ['TacticalAreaTemplate type', sourceFiles.types.includes('interface TacticalAreaTemplate')],
  ['Per-target resolution', sourceFiles.types.includes('targetResults?: TacticalTargetResolution[]')],
  ['Save-adjusted damage', sourceFiles.tactical.includes('saveAdjustedDamage')],
  ['Cleave adjacency gate', sourceFiles.tactical.includes('TACTICAL_CLEAVE_TARGET_NOT_ADJACENT')],
  ['Manual area membership notice', sourceFiles.ui.includes('marque manualmente quem está dentro da área')],
  ['Per-target save UI', sourceFiles.ui.includes('Salvaguarda de {entry.action.saveAbility}')],
  ['Per-target damage UI', sourceFiles.ui.includes('Dano total rolado/declarado')],
  ['Target selection helper', sourceFiles.areaRules.includes('toggleTacticalTargetId')]
];
const failedContracts = contracts.filter(([, ok]) => !ok).map(([name]) => name);

const report = {
  schemaVersion: 'dnd-combat-tactical-area-multitarget-audit.v1',
  generatedAt: new Date().toISOString(),
  phb: {
    spells: spells.length,
    areaSpells: areaSpells.length,
    areaShapes: counts,
    requiredShapes,
    missingRequiredShapes: missingShapes
  },
  contracts: Object.fromEntries(contracts),
  status: missingShapes.length || failedContracts.length ? 'FAIL' : 'PASS'
};

const artifactDir = path.join(root, 'artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, 'tactical-area-multitarget-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exit(1);
