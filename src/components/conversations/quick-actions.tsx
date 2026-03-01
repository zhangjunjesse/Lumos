"use client";

interface QuickActionsProps {
  onAction: (text: string) => void;
  disabled: boolean;
}

const actions = [
  { label: "Summarize", prompt: "Please summarize our conversation so far." },
  { label: "To document", prompt: "Convert this conversation into a structured document." },
  { label: "Go deeper", prompt: "Let's explore this topic in more depth." },
];

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="flex gap-2 border-t px-4 py-2">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={disabled}
          className="cursor-pointer rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
          onClick={() => onAction(a.prompt)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
