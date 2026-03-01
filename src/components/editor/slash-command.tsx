"use client";

import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  List,
  Brain,
  Globe,
  FileText,
  Palette,
  Table,
  Code,
  Minus,
  BookOpen,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

export interface SlashCommandItem {
  key: string;
  label: string;
  alias?: string;
  desc: string;
  icon: React.ElementType;
  category: "ai" | "knowledge" | "content";
}

interface CommandDef {
  key: string;
  label: string;
  alias?: string;
  descKey: string;
  icon: React.ElementType;
  category: "ai" | "knowledge" | "content";
}

const commandDefs: CommandDef[] = [
  { key: "continue", label: "/Continue", alias: "/xuxie", descKey: "editor.slashContinueDesc", icon: Sparkles, category: "ai" },
  { key: "outline", label: "/Outline", alias: "/dagang", descKey: "editor.slashOutlineDesc", icon: List, category: "ai" },
  { key: "brainstorm", label: "/Brainstorm", alias: "/brain", descKey: "editor.slashBrainstormDesc", icon: Brain, category: "ai" },
  { key: "translate", label: "/Translate", alias: "/fanyi", descKey: "editor.slashTranslateDesc", icon: Globe, category: "ai" },
  { key: "summarize", label: "/Summarize", alias: "/summary", descKey: "editor.slashSummarizeDesc", icon: FileText, category: "ai" },
  { key: "restyle", label: "/Restyle", alias: "/style", descKey: "editor.slashRestyleDesc", icon: Palette, category: "ai" },
  { key: "cite", label: "/Cite", descKey: "editor.slashCiteDesc", icon: BookOpen, category: "knowledge" },
  { key: "kb-write", label: "/KB Write", descKey: "editor.slashKbWriteDesc", icon: Brain, category: "knowledge" },
  { key: "table", label: "/Table", descKey: "editor.slashTableDesc", icon: Table, category: "content" },
  { key: "codeblock", label: "/Code Block", descKey: "editor.slashCodeBlockDesc", icon: Code, category: "content" },
  { key: "divider", label: "/Divider", descKey: "editor.slashDividerDesc", icon: Minus, category: "content" },
];

interface Props {
  visible: boolean;
  position: { top: number; left: number } | null;
  onSelect: (command: SlashCommandItem) => void;
  onClose: () => void;
  filter: string;
}

export function SlashCommand({ visible, position, onSelect, onClose, filter }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const commands: SlashCommandItem[] = commandDefs.map((d) => ({
    key: d.key,
    label: d.label,
    alias: d.alias,
    desc: t(d.descKey as Parameters<typeof t>[0]),
    icon: d.icon,
    category: d.category,
  }));

  const filtered = filterCommands(commands, filter);

  // Reset index when filter changes
  useEffect(() => { setActiveIndex(0); }, [filter]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[activeIndex]) onSelect(filtered[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, filtered, activeIndex, onSelect, onClose]);

  if (!visible || !position || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-50 w-64 rounded-md border bg-popover p-1 shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      <CommandList
        items={filtered}
        activeIndex={activeIndex}
        onSelect={onSelect}
        onHover={setActiveIndex}
      />
    </div>
  );
}

function CommandList({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: SlashCommandItem[];
  activeIndex: number;
  onSelect: (cmd: SlashCommandItem) => void;
  onHover: (i: number) => void;
}) {
  const { t } = useTranslation();
  let lastCategory = "";

  const categoryKeys: Record<string, string> = {
    ai: "editor.categoryAi",
    knowledge: "editor.categoryKnowledge",
    content: "editor.categoryContent",
  };

  return (
    <>
      {items.map((cmd, i) => {
        const showHeader = cmd.category !== lastCategory;
        lastCategory = cmd.category;
        const categoryLabel = t(categoryKeys[cmd.category] as Parameters<typeof t>[0]);

        return (
          <div key={cmd.key}>
            {showHeader && (
              <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                {categoryLabel}
              </div>
            )}
            <button
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm ${
                i === activeIndex ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => onHover(i)}
            >
              <cmd.icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{cmd.label}</span>
              <span className="truncate text-xs text-muted-foreground">{cmd.desc}</span>
            </button>
          </div>
        );
      })}
    </>
  );
}

function filterCommands(cmds: SlashCommandItem[], query: string): SlashCommandItem[] {
  if (!query) return cmds;
  const q = query.toLowerCase().replace(/^\//, "");
  return cmds.filter((c) => {
    const haystack = `${c.label} ${c.alias || ""} ${c.desc}`.toLowerCase();
    return fuzzyMatch(q, haystack);
  });
}

function fuzzyMatch(needle: string, haystack: string): boolean {
  let ni = 0;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    if (needle[ni] === haystack[hi]) ni++;
  }
  return ni === needle.length;
}
