"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { List, ListOrdered, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  editor: Editor;
}

export function ToolbarList({ editor }: Props) {
  const items = [
    {
      icon: ListOrdered,
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
      title: "Ordered List",
    },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
      title: "Bullet List",
    },
    {
      icon: ListChecks,
      action: () => editor.chain().focus().toggleTaskList().run(),
      active: editor.isActive("taskList"),
      title: "Task List",
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
