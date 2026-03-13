"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";
import { openExternalUrl } from "@/lib/open-external";

export function UpdateDialog() {
  const { updateInfo, showDialog, dismissUpdate, downloadUpdate, quitAndInstall } = useUpdate();
  const { t } = useTranslation();

  if (!updateInfo?.updateAvailable) return null;

  const { isNativeUpdate, readyToInstall, downloadProgress } = updateInfo;
  const isDownloading = isNativeUpdate && !readyToInstall && downloadProgress != null;

  return (
    <Dialog open={showDialog} onOpenChange={(open) => {
      if (!open) dismissUpdate();
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('update.newVersionAvailable')}</DialogTitle>
          <DialogDescription>
            {updateInfo.releaseName}
            {updateInfo.publishedAt && (
              <span className="ml-2 text-xs text-muted-foreground">
                {new Date(updateInfo.publishedAt).toLocaleDateString()}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {updateInfo.releaseNotes && (
          <div
            className="max-h-60 overflow-auto rounded-md border border-border/50 bg-muted/30 p-3 text-sm prose prose-sm prose-slate dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
          />
        )}

        <p className="text-xs text-muted-foreground">
          Current: v{updateInfo.currentVersion} &rarr; Latest: v{updateInfo.latestVersion}
        </p>

        {/* Download progress bar */}
        {isDownloading && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(downloadProgress!, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('update.downloading')} {Math.round(downloadProgress!)}%
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={dismissUpdate}>
            {t('update.later')}
          </Button>
          {!isNativeUpdate ? (
            <Button
              onClick={() => {
                void openExternalUrl(updateInfo.releaseUrl);
              }}
            >
              {t('settings.viewRelease')}
            </Button>
          ) : readyToInstall ? (
            <Button onClick={quitAndInstall}>
              {t('update.restartToUpdate')}
            </Button>
          ) : isDownloading ? (
            <Button disabled>
              {t('update.downloading')}...
            </Button>
          ) : (
            <Button onClick={downloadUpdate}>
              {t('update.installUpdate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
