"use client";

import { useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Link2, ImageIcon, TableIcon } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  editor: Editor;
}

export function ToolbarInsert({ editor }: Props) {
  const { t } = useTranslation();
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const insertLink = useCallback(() => {
    if (!linkUrl.trim()) return;
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: linkUrl })
      .run();
    setLinkUrl("");
    setShowLinkInput(false);
  }, [editor, linkUrl]);

  const insertImage = useCallback(() => {
    const url = window.prompt("Image URL:");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  return (
    <div className="relative flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => setShowLinkInput(!showLinkInput)}
        title={t('editor.insertLink')}
      >
        <Link2 className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={insertImage}
        title={t('editor.insertImage')}
      >
        <ImageIcon className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        title={t('editor.insertTable')}
      >
        <TableIcon className="size-3.5" />
      </Button>

      {showLinkInput && (
        <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-md border bg-popover p-1.5 shadow-md">
          <input
            className="h-6 w-48 rounded border px-2 text-xs focus:outline-none"
            placeholder={t('editor.urlPlaceholder')}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && insertLink()}
            autoFocus
          />
          <Button size="sm" className="h-6 px-2 text-xs" onClick={insertLink}>
            OK
          </Button>
        </div>
      )}
    </div>
  );
}
