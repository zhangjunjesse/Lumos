import type { AppManifest } from './manifest/types';

export const BUILTIN_AMAZON_RANK_APP_ID = 'amazon-rank';
export const BUILTIN_AMAZON_RANK_VERSION = '0.1.0';

export function isAmazonRankNativeApp(manifest: AppManifest | null | undefined): boolean {
  return manifest?.id === BUILTIN_AMAZON_RANK_APP_ID;
}
