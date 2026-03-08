import { useCallback } from 'react';

interface OpenFileOptions {
  defaultPath?: string;
  title?: string;
  filters?: Electron.FileFilter[];
  multi?: boolean;
}

export function useNativeFilePicker() {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.dialog?.openFile;

  const openNativePicker = useCallback(async (options?: OpenFileOptions): Promise<string[] | null> => {
    if (!window.electronAPI?.dialog?.openFile) return null;
    const result = (await window.electronAPI.dialog.openFile(options)) as { canceled: boolean; filePaths: string[] } | null;
    if (!result || result.canceled) return [];
    return result.filePaths || [];
  }, []);

  return { isElectron, openNativePicker };
}
