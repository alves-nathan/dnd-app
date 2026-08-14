#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const catalogPath = path.join(root, 'scripts/data/phb-2024-class-starting-equipment.json');

const usage = () => {
  console.error('Uso: node scripts/enrich-phb-class-starting-equipment.js <entrada.json> <saida.json>');
  process.exit(2);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const enrichPackage = (input, catalog) => {
  if (!input || !Array.isArray(input.items)) throw new Error('Pacote sem items[].');
  const result = clone(input);
  const classItems = result.items.filter((item) => item && item.kind === 'class');
  const touched = [];
  const missing = [];

  for (const [classId, definition] of Object.entries(catalog)) {
    const item = classItems.find((candidate) => candidate.id === classId)
      ?? classItems.find((candidate) => String(candidate.name || '').toLowerCase() === String(definition.className || '').toLowerCase());
    if (!item) {
      missing.push(classId);
      continue;
    }
    item.payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {};
    item.payload.equipmentOptions = clone(definition.equipmentOptions);
    const note = 'Equipamento inicial de classe estruturado para o fluxo de criação; confira contra a fonte legal antes de validar.';
    const notes = Array.isArray(item.payload.extractionNotes) ? item.payload.extractionNotes.filter((entry) => typeof entry === 'string') : [];
    if (!notes.includes(note)) notes.push(note);
    item.payload.extractionNotes = notes;
    touched.push(item.id);
  }

  if (missing.length) throw new Error(`Classes não encontradas: ${missing.join(', ')}`);
  result.metadata = result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata) ? result.metadata : {};
  result.metadata.classStartingEquipment = {
    rulesEdition: '2024',
    classCount: touched.length,
    classItemIds: touched,
    replacementSafe: true,
    note: 'O ID do pacote foi preservado para substituir a versão anterior sem criar pacote paralelo.'
  };
  return result;
};

if (require.main === module) {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) usage();
  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);
  const output = enrichPackage(readJson(inputPath), readJson(catalogPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Pacote enriquecido: ${outputPath}`);
  console.log(`Classes atualizadas: ${output.metadata.classStartingEquipment.classCount}`);
}

module.exports = { enrichPackage };
