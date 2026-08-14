export interface ExpoAssetHandle {
  localUri?: string | null;
  uri: string;
  downloadAsync(): Promise<unknown>;
}

export interface ExpoAssetCatalogDependencies {
  assetFromModule(moduleId: number): ExpoAssetHandle;
  readAsStringAsync(uri: string): Promise<string>;
}

export const readBundledCatalogAsset = async (
  moduleId: number,
  dependencies: ExpoAssetCatalogDependencies
): Promise<string> => {
  const asset = dependencies.assetFromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('O asset do catálogo não possui URI legível.');
  return dependencies.readAsStringAsync(uri);
};
