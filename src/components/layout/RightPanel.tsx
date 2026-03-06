"use client";

import { useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StructureFolderIcon, PanelRightClose, FolderOpen } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { FileTree } from "@/components/project/FileTree";
import { isPreviewable } from "@/lib/file-categories";

interface RightPanelProps {
  width?: number;
}

export function RightPanel({ width }: RightPanelProps) {
  const { panelOpen, setPanelOpen, workingDirectory, setPreviewFile } = usePanel();
  const { t } = useTranslation();

  console.log('[RightPanel] Render:', { panelOpen, workingDirectory, width });

  const handleFileAdd = useCallback((path: string) => {
    window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    console.log('[RightPanel] handleFileSelect called:', path);
    // Check if file is previewable using centralized utility
    if (!isPreviewable(path)) {
      console.log('[RightPanel] File is not previewable:', path);
      return;
    }

    console.log('[RightPanel] Calling setPreviewFile:', path);
    // Add to ContentPanel as temporary tab
    setPreviewFile(path);
  }, [setPreviewFile]);

  const handleOpenFolder = useCallback(async () => {
    if (!workingDirectory) return;

    try {
      if (window.electronAPI?.shell?.openPath) {
        await window.electronAPI.shell.openPath(workingDirectory);
      }
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  }, [workingDirectory]);

  if (!panelOpen) {
    return (
      <div className="flex flex-col items-center gap-2 bg-background p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPanelOpen(true)}
            >
              <HugeiconsIcon icon={StructureFolderIcon} className="h-4 w-4" />
              <span className="sr-only">{t('panel.openPanel')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('panel.openPanel')}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <aside className="flex h-full shrink-0 flex-col overflow-hidden bg-background" style={{ width: width ?? 288 }}>
      {/* Header - draggable title bar */}
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        {/* Draggable area - takes up most of the header */}
        <div
          className="flex-1 flex items-center min-w-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('panel.files')}</span>
        </div>
        {/* Button area - not draggable */}
        <div className="shrink-0 flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {workingDirectory && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleOpenFolder}
                >
                  <HugeiconsIcon icon={FolderOpen} className="h-4 w-4" />
                  <span className="sr-only">{t('panel.openFolder')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t('panel.openFolder')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPanelOpen(false)}
              >
                <HugeiconsIcon icon={PanelRightClose} className="h-4 w-4" />
                <span className="sr-only">{t('panel.closePanel')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{t('panel.closePanel')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Body — no-drag ensures Electron doesn't swallow clicks */}
      <div
        className="flex flex-1 flex-col min-h-0 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <FileTree
          workingDirectory={workingDirectory}
          onFileSelect={handleFileSelect}
          onFileAdd={handleFileAdd}
        />
      </div>
    </aside>
  );
}
