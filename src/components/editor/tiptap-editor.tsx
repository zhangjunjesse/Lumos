"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { common, createLowlight } from "lowlight";
import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "@/hooks/useTranslation";

const lowlight = createLowlight(common);

export interface TiptapEditorProps {
  content: string;
  onChange?: (html: string) => void;
  onSelectionChange?: (text: string) => void;
  onEditorReady?: (editor: Editor) => void;
  editable?: boolean;
}

export function TiptapEditor({
  content,
  onChange,
  onSelectionChange,
  onEditorReady,
  editable = true,
}: TiptapEditorProps) {
  const { t } = useTranslation();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: t('editor.placeholder'),
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-blue-500 underline cursor-pointer" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight.configure({ multicolor: true }),
      Typography,
    ],
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML()),
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection;
      onSelectionChange?.(from !== to ? e.state.doc.textBetween(from, to) : "");
    },
    editorProps: {
      attributes: {
        class:
          "prose dark:prose-invert max-w-none min-h-[400px] px-6 py-4 focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // Sync external content changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="editor-content-wrapper mx-auto w-full max-w-[720px]">
      <EditorContent editor={editor} />
    </div>
  );
}
