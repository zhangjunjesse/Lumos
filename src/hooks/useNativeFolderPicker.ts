import { useCallback } from 'react';

/**
 * Hook that provides native folder picker functionality in Electron,
 * with detection for browser fallback.
 */
export function useNativeFolderPicker() {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.dialog?.openFolder;

  const openNativePicker = useCallback(
    async (options?: { defaultPath?: string; title?: string }): Promise<string | null> => {
      if (!window.electronAPI?.dialog?.openFolder) return null;
      const result = (await window.electronAPI.dialog.openFolder(options)) as { canceled: boolean; filePaths: string[] } | null;
      return result && !result.canceled ? result.filePaths[0] ?? null : null;
    },
    []
  );

  return { isElectron, openNativePicker };
}
