"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/hooks/useTranslation";

interface Doc {
  id: string;
  title: string;
  content: string;
  format: string;
  created_at: string;
  updated_at: string;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const router = useRouter();
  const { t } = useTranslation();

  const fetchDocs = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (res.ok) {
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : data.rows ?? []);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const createDoc = async () => {
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    if (res.ok) {
      const doc = await res.json();
      router.push(`/documents/${doc.id}`);
    }
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('documents.title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setView(view === "grid" ? "list" : "grid")}>
            {view === "grid" ? t('workspace.listView') : t('workspace.gridView')}
          </Button>
          <Button size="sm" onClick={createDoc}>{t('documents.newDocument')}</Button>
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="mb-2 text-lg">{t('documents.noDocuments')}</p>
            <Button onClick={createDoc}>{t('documents.createFirst')}</Button>
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {docs.map((doc) => (
            <DocCard key={doc.id} doc={doc} onClick={() => router.push(`/documents/${doc.id}`)} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocRow key={doc.id} doc={doc} onClick={() => router.push(`/documents/${doc.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocCard({ doc, onClick }: { doc: Doc; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Card className="cursor-pointer p-4 transition-colors hover:bg-accent" onClick={onClick}>
      <h3 className="mb-1 truncate font-medium">{doc.title || t('editor.untitledDocument')}</h3>
      <p className="line-clamp-2 text-sm text-muted-foreground">
        {doc.content?.replace(/<[^>]*>/g, '').slice(0, 100) || t('documents.emptyDocument')}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {new Date(doc.updated_at).toLocaleDateString()}
      </p>
    </Card>
  );
}

function DocRow({ doc, onClick }: { doc: Doc; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex cursor-pointer items-center gap-4 rounded-md border p-3 transition-colors hover:bg-accent" onClick={onClick}>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium">{doc.title || t('editor.untitledDocument')}</h3>
        <p className="truncate text-sm text-muted-foreground">{doc.content?.replace(/<[^>]*>/g, '').slice(0, 80) || t('workspace.empty')}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{new Date(doc.updated_at).toLocaleDateString()}</span>
    </div>
  );
}
