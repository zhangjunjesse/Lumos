"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useTranslation } from "@/hooks/useTranslation";
import { DocumentEditorBody } from "./document-editor-body";

interface Doc {
  id: string;
  title: string;
  content: string;
}

export function DocumentEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [aiOpen, setAiOpen] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);

  // Fetch document
  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setDoc(d);
          setTitle(d.title);
          setContent(d.content || "");
        }
      });
  }, [id]);

  // Auto-save
  const { status, markChanged, saveNow } = useAutoSave({
    onSave: async (html) => {
      await fetch(`/api/documents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: html }),
      });
    },
    backupKey: `doc-backup-${id}`,
  });

  const handleContentChange = useCallback(
    (html: string) => {
      setContent(html);
      markChanged(html);
    },
    [markChanged]
  );

  // Cmd+L toggle AI panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        setAiOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Apply AI content to document
  const handleApplyToDocument = useCallback(
    (text: string) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      if (from !== to) {
        editor.chain().focus().deleteRange({ from, to }).insertContent(text).run();
      } else {
        editor.chain().focus().insertContent(text).run();
      }
    },
    [editor]
  );

  // Save title on blur
  const handleTitleBlur = useCallback(() => {
    saveNow();
  }, [saveNow]);

  const wordCount = content.replace(/<[^>]*>/g, "").length;

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <DocumentTopBar
        title={title}
        onTitleChange={setTitle}
        onTitleBlur={handleTitleBlur}
        onBack={() => router.push("/documents")}
        saveStatus={status}
      />

      {/* Editor + AI panel */}
      <DocumentEditorBody
        content={content}
        aiOpen={aiOpen}
        selectedText={selectedText}
        wordCount={wordCount}
        documentTitle={title}
        onContentChange={handleContentChange}
        onSelectionChange={setSelectedText}
        onEditorReady={setEditor}
        onAiClose={() => setAiOpen(false)}
        onApplyToDocument={handleApplyToDocument}
      />

      {/* Floating AI button when panel is closed */}
      {!aiOpen && (
        <button
          className="fixed bottom-6 right-6 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition-transform hover:scale-110"
          onClick={() => setAiOpen(true)}
          title={t('editor.openAiPanel')}
        >
          <Sparkles className="size-5" />
        </button>
      )}
    </div>
  );
}

function DocumentTopBar({
  title,
  onTitleChange,
  onTitleBlur,
  onBack,
  saveStatus,
}: {
  title: string;
  onTitleChange: (t: string) => void;
  onTitleBlur: () => void;
  onBack: () => void;
  saveStatus: string;
}) {
  const { t } = useTranslation();
  const statusLabel: Record<string, string> = {
    idle: "",
    unsaved: t('editor.unsaved'),
    saving: t('editor.saving'),
    saved: t('editor.saved'),
    error: t('editor.saveFailed'),
  };

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1 size-4" />
        {t('editor.back')}
      </Button>
      <input
        className="flex-1 bg-transparent text-lg font-medium focus:outline-none"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleBlur}
        placeholder={t('editor.untitledDocument')}
      />
      {statusLabel[saveStatus] && (
        <span
          className={cn(
            "text-xs",
            saveStatus === "saved" && "text-green-500",
            saveStatus === "error" && "text-red-500",
            (saveStatus === "unsaved" || saveStatus === "saving") &&
              "text-muted-foreground"
          )}
        >
          {statusLabel[saveStatus]}
        </span>
      )}
    </div>
  );
}
