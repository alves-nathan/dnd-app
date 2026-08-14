import { preferredCompendiumRepositoryKindForPlatform } from '../storage/activeCompendiumRepository';

describe('compendium persistence boundary by platform', () => {
  it('uses IndexedDB on Web instead of expo-sqlite OPFS or localStorage', () => {
    expect(preferredCompendiumRepositoryKindForPlatform('web')).toBe('web');
  });

  it('keeps SQLite as the preferred native repository', () => {
    expect(preferredCompendiumRepositoryKindForPlatform('android')).toBe('sqlite');
    expect(preferredCompendiumRepositoryKindForPlatform('ios')).toBe('sqlite');
  });
});
