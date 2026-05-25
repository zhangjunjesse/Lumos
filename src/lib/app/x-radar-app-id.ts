/**
 * X 雷达应用识别 helper — 仿 isGoofishNativeApp。
 * 不硬比 manifest.id，因为用户可能改 ID；按 id/name/description/tags 综合识别。
 */
import type { AppManifest } from './manifest/types';

export function isXRadarNativeApp(manifest: AppManifest): boolean {
  const text = [
    manifest.id,
    manifest.name,
    manifest.description ?? '',
    ...(manifest.tags ?? []),
  ].join('\n');
  return /(x[- ]?radar|x[- ]?雷达|twitter)/i.test(text);
}
