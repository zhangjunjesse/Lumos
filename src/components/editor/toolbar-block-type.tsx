"use client";

import type { Editor } from "@tiptap/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

interface Props {
  editor: Editor;
}

const blockTypes = [
  { label: "Paragraph", value: "paragraph" },
  { label: "Heading 1", value: "h1" },
  { label: "Heading 2", value: "h2" },
  { label: "Heading 3", value: "h3" },
  { label: "Code Block", value: "codeBlock" },
  { label: "Blockquote", value: "blockquote" },
] as const;

type BlockValue = (typeof blockTypes)[number]["value"];

function getActiveBlock(editor: Editor): string {
  if (editor.isActive("heading", { level: 1 })) return "Heading 1";
  if (editor.isActive("heading", { level: 2 })) return "Heading 2";
  if (editor.isActive("heading", { level: 3 })) return "Heading 3";
  if (editor.isActive("codeBlock")) return "Code Block";
  if (editor.isActive("blockquote")) return "Blockquote";
  return "Paragraph";
}

function applyBlock(editor: Editor, value: BlockValue) {
  const chain = editor.chain().focus();
  switch (value) {
    case "paragraph":
      chain.setParagraph().run();
      break;
    case "h1":
      chain.toggleHeading({ level: 1 }).run();
      break;
    case "h2":
      chain.toggleHeading({ level: 2 }).run();
      break;
    case "h3":
      chain.toggleHeading({ level: 3 }).run();
      break;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      break;
    case "blockquote":
      chain.toggleBlockquote().run();
      break;
  }
}

export function ToolbarBlockType({ editor }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
          {getActiveBlock(editor)}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {blockTypes.map((bt) => (
          <DropdownMenuItem
            key={bt.value}
            onClick={() => applyBlock(editor, bt.value)}
          >
            {bt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
