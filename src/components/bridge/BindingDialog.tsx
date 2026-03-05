"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRBindingCard } from "./QRBindingCard";
import { ErrorAlert } from "./ErrorAlert";

interface BindingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  onSuccess?: () => void;
}

export function BindingDialog({ open, onOpenChange, sessionId, onSuccess }: BindingDialogProps) {
  const [error, setError] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>同步到飞书</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <ErrorAlert message={error} onDismiss={() => setError("")} />}
          <QRBindingCard sessionId={sessionId} onBind={onSuccess} />
          <p className="text-xs text-muted-foreground">
            扫码后将自动创建飞书群组，消息将实时同步
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
