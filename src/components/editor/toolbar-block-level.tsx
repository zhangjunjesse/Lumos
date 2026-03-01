"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Quote, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  editor: Editor;
}

export function ToolbarBlockLevel({ editor }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 w-7 p-0",
          editor.isActive("blockquote") && "bg-accent"
        )}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title={t('editor.blockquote')}
      >
        <Quote className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title={t('editor.horizontalRule')}
      >
        <Minus className="size-3.5" />
      </Button>
    </div>
  );
}
