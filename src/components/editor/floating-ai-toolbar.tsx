"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Globe,
  FileText,
  Expand,
  Lightbulb,
  Keyboard,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  selectedText: string;
  selectionRect: { top: number; left: number; width: number } | null;
  onAction: (action: string, customPrompt?: string) => void;
}

const actionDefs = [
  { key: "polish", labelKey: "editor.polish" as const, icon: Sparkles },
  { key: "translate", labelKey: "editor.translate" as const, icon: Globe },
  { key: "summarize", labelKey: "editor.summarize" as const, icon: FileText },
  { key: "expand", labelKey: "editor.expand" as const, icon: Expand },
  { key: "explain", labelKey: "editor.explain" as const, icon: Lightbulb },
  { key: "custom", labelKey: "editor.custom" as const, icon: Keyboard },
];

export function FloatingAiToolbar({
  selectedText,
  selectionRect,
  onAction,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Show after 200ms delay when text selected
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (selectedText.length >= 2 && selectionRect) {
      timerRef.current = setTimeout(() => setVisible(true), 200);
    } else {
      setVisible(false);
      setShowCustom(false);
      setCustomPrompt("");
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [selectedText, selectionRect]);

  if (!visible || !selectionRect) return null;

  const style: React.CSSProperties = {
    position: "absolute",
    top: selectionRect.top - 44,
    left: selectionRect.left + selectionRect.width / 2,
    transform: "translateX(-50%)",
    zIndex: 50,
  };

  const handleAction = (key: string) => {
    if (key === "custom") {
      setShowCustom(true);
      return;
    }
    onAction(key);
  };

  const submitCustom = () => {
    if (customPrompt.trim()) {
      onAction("custom", customPrompt.trim());
      setShowCustom(false);
      setCustomPrompt("");
    }
  };

  return (
    <div style={style}>
      <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg">
        {showCustom ? (
          <CustomInput
            value={customPrompt}
            onChange={setCustomPrompt}
            onSubmit={submitCustom}
            onCancel={() => setShowCustom(false)}
          />
        ) : (
          actionDefs.map((a) => (
            <Button
              key={a.key}
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => handleAction(a.key)}
            >
              <a.icon className="size-3" />
              {t(a.labelKey)}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}

function CustomInput({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <input
        className="h-6 w-[200px] rounded border px-2 text-xs focus:outline-none"
        placeholder={t('editor.customInstruction')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
      />
      <Button size="sm" className="h-6 px-2 text-xs" onClick={onSubmit}>
        {t('editor.go')}
      </Button>
    </div>
  );
}
