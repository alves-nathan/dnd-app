import 'react-native-gesture-handler';
import { useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCompendiumStore } from '../src/store/compendiumStore';
import { useCatalogStore } from '../src/store/catalogStore';
import { usePortableRestoreEvidenceRevalidation } from '../src/backup/usePortableRestoreEvidenceRevalidation';
import { useCharacterStore } from '../src/store/characterStore';
import { createCharacterLinkCatalogFingerprint } from '../src/characters/catalogAwareCharacterReconciliation';
import { CHARACTER_CATALOG_RECONCILIATION_VERSION } from '../src/storage/characterCatalogReconciliationState';

export default function Layout() {
  const hydrateCompendium = useCompendiumStore((state) => state.hydrate);
  const initializeCatalog = useCatalogStore((state) => state.initialize);
  const compendiumHydrated = useCompendiumStore((state) => state.isHydrated);
  const compendiumItems = useCompendiumStore((state) => state.items);
  const reconcileCatalogAwareCharacters = useCharacterStore((state) => state.reconcileCatalogAwareCharacters);
  const catalogAwareVersion = useCharacterStore((state) => state.catalogAwareReconciliation.version);
  const catalogAwareFingerprint = useCharacterStore((state) => state.catalogAwareReconciliation.catalogFingerprint);
  const [characterStoreHydrated, setCharacterStoreHydrated] = useState(() => useCharacterStore.persist.hasHydrated());
  const currentCatalogFingerprint = useMemo(
    () => compendiumHydrated ? createCharacterLinkCatalogFingerprint(compendiumItems) : undefined,
    [compendiumHydrated, compendiumItems]
  );
  const characterSnapshotsReady = Boolean(
    compendiumHydrated
    && characterStoreHydrated
    && currentCatalogFingerprint
    && catalogAwareVersion >= CHARACTER_CATALOG_RECONCILIATION_VERSION
    && catalogAwareFingerprint === currentCatalogFingerprint
  );
  usePortableRestoreEvidenceRevalidation();

  useEffect(() => {
    void hydrateCompendium();
    void initializeCatalog();
  }, [hydrateCompendium, initializeCatalog]);

  useEffect(() => {
    if (useCharacterStore.persist.hasHydrated()) {
      setCharacterStoreHydrated(true);
      return undefined;
    }
    return useCharacterStore.persist.onFinishHydration(() => setCharacterStoreHydrated(true));
  }, []);

  useEffect(() => {
    if (!compendiumHydrated || !characterStoreHydrated || !currentCatalogFingerprint) return;
    // Reconcile only when character-link identity changed or the character
    // collection explicitly invalidated the previous pass. Editorial changes
    // keep the same identity fingerprint and therefore do not mutate sheets.
    reconcileCatalogAwareCharacters(useCompendiumStore.getState().items);
  }, [
    compendiumHydrated,
    characterStoreHydrated,
    currentCatalogFingerprint,
    catalogAwareVersion,
    catalogAwareFingerprint,
    reconcileCatalogAwareCharacters
  ]);

  return (
    <SafeAreaProvider>
      {characterSnapshotsReady ? (
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
          <Stack.Screen name="compendium/maintenance" />
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
      ) : null}
    </SafeAreaProvider>
  );
}
