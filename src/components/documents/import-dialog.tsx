"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/useTranslation";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function DocumentImportDialog({
  open,
  onOpenChange,
  onImported,
}: ImportDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"file" | "feishu">("file");
  const [uploading, setUploading] = useState(false);
  const [feishuUrl, setFeishuUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setUploading(true);
      try {
        for (const file of Array.from(files).slice(0, 10)) {
          const form = new FormData();
          form.append("file", file);
          await fetch("/api/documents/upload", { method: "POST", body: form });
        }
        onImported();
        onOpenChange(false);
      } finally {
        setUploading(false);
      }
    },
    [onImported, onOpenChange]
  );

  const handleFeishuImport = useCallback(async () => {
    if (!feishuUrl.trim()) return;
    setUploading(true);
    try {
      const match = feishuUrl.match(/\/wiki\/([a-zA-Z0-9]+)/);
      const docToken = match?.[1] ?? "";
      await fetch("/api/documents/import/feishu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: feishuUrl, docToken }),
      });
      onImported();
      onOpenChange(false);
      setFeishuUrl("");
    } finally {
      setUploading(false);
    }
  }, [feishuUrl, onImported, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('docImport.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-3">
          <TabBtn active={tab === "file"} onClick={() => setTab("file")}>
            Local file
          </TabBtn>
          <TabBtn active={tab === "feishu"} onClick={() => setTab("feishu")}>
            Feishu
          </TabBtn>
        </div>

        {tab === "file" ? (
          <FileUploadArea
            fileRef={fileRef}
            uploading={uploading}
            onFiles={handleFileUpload}
          />
        ) : (
          <FeishuImportArea
            url={feishuUrl}
            onUrlChange={setFeishuUrl}
            uploading={uploading}
            onImport={handleFeishuImport}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FileUploadArea({
  fileRef,
  uploading,
  onFiles,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-border"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <p className="text-sm text-muted-foreground">
        Drag files here or click to browse
      </p>
      <p className="text-xs text-muted-foreground">
        .docx, .pdf, .xlsx, .txt, .md (max 20MB)
      </p>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".docx,.pdf,.xlsx,.txt,.md"
        multiple
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? "Uploading..." : "Choose files"}
      </Button>
    </div>
  );
}

function FeishuImportArea({
  url,
  onUrlChange,
  uploading,
  onImport,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  uploading: boolean;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 py-2">
      <input
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder={t('docImport.feishuPlaceholder')}
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onImport()}
      />
      <Button size="sm" disabled={!url.trim() || uploading} onClick={onImport}>
        {uploading ? "Importing..." : "Import"}
      </Button>
    </div>
  );
}
