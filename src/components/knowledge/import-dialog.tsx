"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  collectionId: string;
  onImported: () => void;
}

export function ImportDialog({ collectionId, onImported }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"text" | "file">("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        collection_id: collectionId,
        title: title || "Untitled",
      };

      if (tab === "text") {
        body.source_type = "manual";
        body.content = content;
      } else {
        body.source_type = "local_file";
        body.source_path = filePath;
      }

      const res = await fetch("/api/knowledge/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setTitle("");
        setContent("");
        setFilePath("");
        onImported();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex gap-2">
        <Button
          variant={tab === "text" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("text")}
        >
          Text
        </Button>
        <Button
          variant={tab === "file" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("file")}
        >
          File
        </Button>
      </div>

      <input
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder={t('kbImport.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {tab === "text" ? (
        <textarea
          className="h-32 w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={t('kbImport.contentPlaceholder')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      ) : (
        <input
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={t('kbImport.filePathPlaceholder')}
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
        />
      )}

      <Button size="sm" onClick={submit} disabled={loading}>
        {loading ? "Importing..." : "Import"}
      </Button>
    </div>
  );
}
