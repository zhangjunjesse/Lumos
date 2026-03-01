"use client";

import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { ToolbarBlockType } from "./toolbar-block-type";
import { ToolbarTextFormat } from "./toolbar-text-format";
import { ToolbarInsert } from "./toolbar-insert";
import { ToolbarList } from "./toolbar-list";
import { ToolbarBlockLevel } from "./toolbar-block-level";

interface Props {
  editor: Editor | null;
  className?: string;
}

export function EditorToolbar({ editor, className }: Props) {
  if (!editor) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 border-b bg-background px-2 py-1",
        "sticky top-0 z-10",
        className
      )}
    >
      <ToolbarBlockType editor={editor} />
      <Divider />
      <ToolbarTextFormat editor={editor} />
      <Divider />
      <ToolbarInsert editor={editor} />
      <Divider />
      <ToolbarList editor={editor} />
      <Divider />
      <ToolbarBlockLevel editor={editor} />
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}
