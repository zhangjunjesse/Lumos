"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { EditorToolbar } from "./editor-toolbar";
import { AiPanel } from "./ai-panel";

const TiptapEditor = dynamic(
  () => import("./tiptap-editor").then((m) => ({ default: m.TiptapEditor })),
  { ssr: false }
);

interface Props {
  content: string;
  aiOpen: boolean;
  selectedText: string;
  wordCount: number;
  documentTitle: string;
  onContentChange: (html: string) => void;
  onSelectionChange: (text: string) => void;
  onEditorReady: (editor: Editor) => void;
  onAiClose: () => void;
  onApplyToDocument: (content: string) => void;
}

export function DocumentEditorBody({
  content,
  aiOpen,
  selectedText,
  wordCount,
  documentTitle,
  onContentChange,
  onSelectionChange,
  onEditorReady,
  onAiClose,
  onApplyToDocument,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleEditorReady = (e: Editor) => {
    setEditor(e);
    onEditorReady(e);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Editor area */}
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-all duration-250 ease-in-out",
          aiOpen ? "w-[65%]" : "w-full"
        )}
      >
        <EditorToolbar editor={editor} className="shrink-0" />
        <div className="flex-1 overflow-y-auto">
          <TiptapEditor
            content={content}
            onChange={onContentChange}
            onSelectionChange={onSelectionChange}
            onEditorReady={handleEditorReady}
          />
        </div>
      </div>

      {/* AI Panel */}
      <div
        className={cn(
          "shrink-0 overflow-hidden transition-all duration-250 ease-in-out",
          aiOpen ? "w-[35%] opacity-100" : "w-0 opacity-0"
        )}
      >
        {aiOpen && (
          <AiPanel
            documentTitle={documentTitle}
            wordCount={wordCount}
            selectedText={selectedText}
            onClose={onAiClose}
            onApplyToDocument={onApplyToDocument}
          />
        )}
      </div>
    </div>
  );
}
