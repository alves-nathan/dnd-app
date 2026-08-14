import { CatalogLoader } from './catalogLoader';
import type { CatalogSnapshot, RuntimeCatalogBundle } from './types';

declare const require: (path: string) => unknown;

/**
 * Expo/Metro entry point. The static require keeps the 10 MiB runtime bundle
 * out of the initial module graph until this function is called.
 *
 * This path assumes the overlay is copied to src/catalog and the asset to
 * assets/catalog-v4.8.0.
 */
export const initializeBundledCatalog = (): CatalogSnapshot => {
  const bundle = require('../../assets/catalog-v4.8.0/runtime-bundle-v4.8.0.json') as RuntimeCatalogBundle;
  return new CatalogLoader().initializeFromBundle(bundle);
};
