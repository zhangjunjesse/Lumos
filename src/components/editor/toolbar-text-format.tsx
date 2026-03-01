"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Strikethrough, Code, Underline, Highlighter } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  editor: Editor;
}

export function ToolbarTextFormat({ editor }: Props) {
  const items = [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
      title: "Bold (Cmd+B)",
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
      title: "Italic (Cmd+I)",
    },
    {
      icon: Underline,
      action: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive("underline"),
      title: "Underline (Cmd+U)",
    },
    {
      icon: Strikethrough,
      action: () => editor.chain().focus().toggleStrike().run(),
      active: editor.isActive("strike"),
      title: "Strikethrough",
    },
    {
      icon: Code,
      action: () => editor.chain().focus().toggleCode().run(),
      active: editor.isActive("code"),
      title: "Inline Code (Cmd+E)",
    },
    {
      icon: Highlighter,
      action: () => editor.chain().focus().toggleHighlight().run(),
      active: editor.isActive("highlight"),
      title: "Highlight",
    },
  ];

  return (
    <div className="flex items-center gap-0.5">
      {items.map((item) => (
        <Button
          key={item.title}
          variant="ghost"
          size="sm"
          className={cn("h-7 w-7 p-0", item.active && "bg-accent")}
          onClick={item.action}
          title={item.title}
        >
          <item.icon className="size-3.5" />
        </Button>
      ))}
    </div>
  );
}
