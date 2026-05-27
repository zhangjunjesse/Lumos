/**
 * Etsy AI 出图 应用识别 helper — 仿 isXRadarNativeApp。
 * 不硬比 manifest.id；按 id/name/description/tags 综合识别（用户改 id 也能认出来）。
 */
import type { AppManifest } from './manifest/types';

export function isEtsyForgeNativeApp(manifest: AppManifest): boolean {
  const text = [
    manifest.id,
    manifest.name,
    manifest.description ?? '',
    ...(manifest.tags ?? []),
  ].join('\n');
  return /(etsy[- ]?forge|etsy.*ai.*出图|etsy.*pod|etsy.*ai.*image)/i.test(text);
}
