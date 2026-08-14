import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../..');

it('keeps the destructive E2E seed implementation connected to its button', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app/e2e-seed.tsx'), 'utf8');

  expect(source).toContain('const seed = async () =>');
  expect(source).toContain('await characterCreationDraftRepository.clear()');
  expect(source).toContain('setCharacters([])');
  expect(source).toContain('await clearCompendium()');
  expect(source).toContain('saveImportJson(JSON.stringify(e2eCharacterCreationFixture))');
  expect(source).toContain("setStatus('Ambiente E2E preparado.')");
  expect(source).toContain('void seed()');
});

it('uses an Ionicons name supported by the installed typings for operational audit', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app/settings.tsx'), 'utf8');

  expect(source).not.toContain('shield-search-outline');
  expect(source).toContain('label="Auditoria operacional externa" icon="search-outline"');
});
