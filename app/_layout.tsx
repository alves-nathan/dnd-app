import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { useCatalogStore } from '../src/store/catalogStore';
import { usePortableRestoreEvidenceRevalidation } from '../src/backup/usePortableRestoreEvidenceRevalidation';

export default function Layout() {
  const hydrateCompendium = useCompendiumStore((state) => state.hydrate);
  const initializeCatalog = useCatalogStore((state) => state.initialize);
  usePortableRestoreEvidenceRevalidation();

  useEffect(() => {
    void hydrateCompendium();
    void initializeCatalog();
  }, [hydrateCompendium, initializeCatalog]);

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="e2e-seed" />
        <Stack.Screen name="native-performance" />
        <Stack.Screen name="beta-validation" />
        <Stack.Screen name="beta-feedback" />
        <Stack.Screen name="beta-closure" />
        <Stack.Screen name="beta-runtime" />
        <Stack.Screen name="characters/new" />
        <Stack.Screen name="characters/[id]/index" />
        <Stack.Screen name="characters/[id]/compatibility" />
        <Stack.Screen name="characters/[id]/level-up" />
        <Stack.Screen name="characters/[id]/identity" />
        <Stack.Screen name="characters/[id]/attributes" />
        <Stack.Screen name="characters/[id]/classes" />
        <Stack.Screen name="characters/[id]/equipment" />
        <Stack.Screen name="characters/[id]/spells" />
        <Stack.Screen name="characters/[id]/features" />
        <Stack.Screen name="characters/[id]/invocations" />
        <Stack.Screen name="characters/[id]/familiar" />
        <Stack.Screen name="characters/[id]/combat" />
        <Stack.Screen name="characters/[id]/rotations/new" />
        <Stack.Screen name="characters/[id]/analysis" />
        <Stack.Screen name="characters/[id]/compendium" />
        <Stack.Screen name="characters/[id]/presets" />
        <Stack.Screen name="characters/[id]/comparison" />
        <Stack.Screen name="characters/[id]/report" />
        <Stack.Screen name="characters/[id]/history" />
        <Stack.Screen name="compendium/index" />
        <Stack.Screen name="content-management" />
        <Stack.Screen name="catalog-history" />
        <Stack.Screen name="restore-session" />
        <Stack.Screen name="evidence-center" />
        <Stack.Screen name="catalog-update" />
        <Stack.Screen name="catalog-trust" />
        <Stack.Screen name="catalog-transparency" />
        <Stack.Screen name="catalog-distribution" />
        <Stack.Screen name="character-compatibility" />
        <Stack.Screen name="progression-recovery" />
        <Stack.Screen name="compendium/[itemId]" />
        <Stack.Screen name="compendium/[itemId]/mapping" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="release-candidate" />
        <Stack.Screen name="production-release" />
      </Stack>
    </SafeAreaProvider>
  );
}
