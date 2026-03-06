"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareLink: string;
}

export function ShareLinkDialog({ open, onOpenChange, shareLink }: ShareLinkDialogProps) {
  const qrImageUrl = useMemo(() => {
    if (!shareLink) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(shareLink)}&size=240x240`;
  }, [shareLink]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">同步到飞书</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground text-center">
            使用飞书扫描二维码，加入群组后消息将实时同步
          </p>
          <div className="flex justify-center">
            {qrImageUrl ? (
              <div className="p-4 bg-white rounded-lg">
                <img
                  src={qrImageUrl}
                  alt="飞书群组二维码"
                  className="w-[240px] h-[240px]"
                />
              </div>
            ) : (
              <div className="w-[240px] h-[240px] bg-muted animate-pulse rounded-lg" />
            )}
          </div>
          <div className="flex justify-center">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
