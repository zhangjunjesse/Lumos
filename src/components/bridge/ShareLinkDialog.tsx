"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { generateQrCodeDataUrl } from "@/lib/qr-code";

export interface ShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareLink: string;
}

export function ShareLinkDialog({ open, onOpenChange, shareLink }: ShareLinkDialogProps) {
  const [qrState, setQrState] = useState({ source: "", dataUrl: "" });
  const qrImageUrl = qrState.source === shareLink ? qrState.dataUrl : "";

  useEffect(() => {
    let cancelled = false;

    if (!shareLink) {
      return;
    }

    generateQrCodeDataUrl(shareLink, 240)
      .then((dataUrl) => {
        if (!cancelled) {
          setQrState({ source: shareLink, dataUrl });
        }
      })
      .catch((error) => {
        console.error("[ShareLinkDialog] Failed to generate QR code:", error);
        if (!cancelled) {
          setQrState((current) => (current.source === shareLink ? { source: shareLink, dataUrl: "" } : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shareLink]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">同步到飞书</DialogTitle>
          <DialogDescription>
            使用飞书扫描二维码，加入群组后消息将实时同步。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground text-center">
            使用飞书扫描二维码，加入群组后消息将实时同步
          </p>
          <div className="flex justify-center">
            {qrImageUrl ? (
              <div className="p-4 bg-white rounded-lg">
                <Image
                  src={qrImageUrl}
                  alt="飞书群组二维码"
                  width={240}
                  height={240}
                  unoptimized
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
