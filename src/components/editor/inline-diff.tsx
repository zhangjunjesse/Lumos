"use client";

import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

interface Props {
  originalText: string;
  newText: string;
  onAccept: () => void;
  onReject: () => void;
}

export function InlineDiff({ originalText, newText, onAccept, onReject }: Props) {
  return (
    <div className="relative my-2 rounded-md border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-800 dark:bg-blue-950/20">
      {/* Original text with strikethrough */}
      <div className="mb-2">
        <span className="text-red-500 line-through decoration-red-400">
          {originalText}
        </span>
      </div>

      {/* New text with green highlight */}
      <div className="mb-3">
        <span className="rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          {newText}
        </span>
      </div>

      {/* Accept / Reject buttons */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-7 gap-1 bg-green-600 px-2.5 text-xs text-white hover:bg-green-700"
          onClick={onAccept}
        >
          <Check className="size-3" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2.5 text-xs text-red-600 hover:bg-red-50"
          onClick={onReject}
        >
          <X className="size-3" />
          Reject
        </Button>
      </div>
    </div>
  );
}
