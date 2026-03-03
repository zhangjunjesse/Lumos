/**
 * Platform-specific layout configuration
 */

export interface PlatformLayoutConfig {
  titleBarHeight: number;
  toolbarHeight: number;
  hasNativeTitleBar: boolean;
  windowControlsOverlay?: boolean;
}

export const PLATFORM_LAYOUTS: Record<NodeJS.Platform, PlatformLayoutConfig> = {
  darwin: {
    titleBarHeight: 28, // macOS hiddenInset style
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  win32: {
    titleBarHeight: 32, // Custom titlebar with window controls
    toolbarHeight: 48,
    hasNativeTitleBar: false,
    windowControlsOverlay: true,
  },
  linux: {
    titleBarHeight: 0, // Native window manager handles titlebar
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  // Fallback for other platforms
  aix: {
    titleBarHeight: 0,
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  android: {
    titleBarHeight: 0,
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  freebsd: {
    titleBarHeight: 0,
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  openbsd: {
    titleBarHeight: 0,
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  sunos: {
    titleBarHeight: 0,
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
  cygwin: {
    titleBarHeight: 32,
    toolbarHeight: 48,
    hasNativeTitleBar: false,
    windowControlsOverlay: true,
  },
  netbsd: {
    titleBarHeight: 0,
    toolbarHeight: 48,
    hasNativeTitleBar: true,
    windowControlsOverlay: false,
  },
};

export function getPlatformLayout(): PlatformLayoutConfig {
  return PLATFORM_LAYOUTS[process.platform] || PLATFORM_LAYOUTS.linux;
}
