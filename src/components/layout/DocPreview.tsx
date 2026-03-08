"use client";

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel, Copy, Tick, Loading, Add, BookOpen } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { getFileCategory } from "@/lib/file-categories";
import { ImagePreview } from "@/components/preview/ImagePreview";
import { VideoPreview } from "@/components/preview/VideoPreview";
import { AudioPreview } from "@/components/preview/AudioPreview";
import { PdfPreview } from "@/components/preview/PdfPreview";
import { WordPreview } from "@/components/preview/WordPreview";
import { ExcelPreview } from "@/components/preview/ExcelPreview";
import { PowerPointPreview } from "@/components/preview/PowerPointPreview";
import type { FilePreview as FilePreviewType } from "@/types";

const streamdownPlugins = { cjk, code, math, mermaid };

type ViewMode = "source" | "rendered";

interface DocPreviewProps {
  filePath: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onClose: () => void;
  onAdd?: () => void;
  onAddToLibrary?: () => void;
  width: number;
}

/** Extensions that support a rendered preview */
const RENDERABLE_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

function isRenderable(filePath: string): boolean {
  return RENDERABLE_EXTENSIONS.has(getExtension(filePath));
}

function isHtml(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === ".html" || ext === ".htm";
}

export function DocPreview({
  filePath,
  viewMode,
  onViewModeChange,
  onClose,
  onAdd,
  onAddToLibrary,
  width,
}: DocPreviewProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const { workingDirectory } = usePanel();
  const isDark = resolvedTheme === "dark";
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}&maxLines=500${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}&_t=${Date.now()}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load file");
        }
        const data = await res.json();
        if (!cancelled) {
          setPreview(data.preview);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [filePath, workingDirectory]);

  // Auto-refresh when AI finishes editing files
  useEffect(() => {
    const handler = () => {
      setLoading(true);
      setError(null);
      fetch(
        `/api/files/preview?path=${encodeURIComponent(filePath)}&maxLines=500${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}&_t=${Date.now()}`
      )
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load file')))
        .then(data => setPreview(data.preview))
        .catch(err => setError(err instanceof Error ? err.message : 'Failed to load file'))
        .finally(() => setLoading(false));
    };
    window.addEventListener('refresh-file-tree', handler);
    return () => window.removeEventListener('refresh-file-tree', handler);
  }, [filePath, workingDirectory]);

  const handleCopyContent = async () => {
    const text = preview?.content || filePath;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fileName = filePath.split("/").pop() || filePath;

  // Build breadcrumb — show last 3 segments
  const breadcrumb = useMemo(() => {
    const segments = filePath.split("/").filter(Boolean);
    const display = segments.slice(-3);
    const prefix = display.length < segments.length ? ".../" : "";
    return prefix + display.join("/");
  }, [filePath]);

  const canRender = isRenderable(filePath);
  const fileCategory = getFileCategory(filePath);
  const isNonTextFile = fileCategory && fileCategory !== 'text';

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background"
    >
      {/* Header */}
      <div className="flex h-12 mt-5 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
        </div>

        {canRender && !isNonTextFile && (
          <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
        )}

        {!isNonTextFile && (
          <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
            {copied ? (
              <HugeiconsIcon icon={Tick} className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <HugeiconsIcon icon={Copy} className="h-3.5 w-3.5" />
            )}
            <span className="sr-only">Copy content</span>
          </Button>
        )}

        {onAdd && (
          <Button variant="ghost" size="icon-sm" onClick={onAdd}>
            <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
            <span className="sr-only">{t('common.addToChat')}</span>
          </Button>
        )}

        {onAddToLibrary && (
          <Button variant="ghost" size="icon-sm" onClick={onAddToLibrary}>
            <HugeiconsIcon icon={BookOpen} className="h-3.5 w-3.5" />
            <span className="sr-only">{t('common.addToLibrary')}</span>
          </Button>
        )}

        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <HugeiconsIcon icon={Cancel} className="h-3.5 w-3.5" />
          <span className="sr-only">Close preview</span>
        </Button>
      </div>

      {/* Breadcrumb + language — subtle, no border */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {breadcrumb}
        </p>
        {preview && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {preview.language}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isNonTextFile ? (
          // Render preview component for non-text files
          fileCategory === 'image' ? (
            <ImagePreview filePath={filePath} baseDir={workingDirectory} />
          ) : fileCategory === 'video' ? (
            <VideoPreview filePath={filePath} baseDir={workingDirectory} />
          ) : fileCategory === 'audio' ? (
            <AudioPreview filePath={filePath} baseDir={workingDirectory} />
          ) : fileCategory === 'pdf' ? (
            <PdfPreview filePath={filePath} baseDir={workingDirectory} />
          ) : fileCategory === 'word' ? (
            <WordPreview filePath={filePath} baseDir={workingDirectory} />
          ) : fileCategory === 'excel' ? (
            <ExcelPreview filePath={filePath} baseDir={workingDirectory} />
          ) : fileCategory === 'powerpoint' ? (
            <PowerPointPreview filePath={filePath} baseDir={workingDirectory} />
          ) : null
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <HugeiconsIcon
              icon={Loading}
              className="h-5 w-5 animate-spin text-muted-foreground"
            />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : preview ? (
          viewMode === "rendered" && canRender ? (
            <RenderedView content={preview.content} filePath={filePath} />
          ) : (
            <SourceView preview={preview} isDark={isDark} />
          )
        ) : null}
      </div>
    </div>
  );
}

/** Capsule toggle for Source / Preview view mode */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="flex h-6 items-center rounded-full bg-muted p-0.5 text-[11px]">
      <button
        className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
          value === "source"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("source")}
      >
        Source
      </button>
      <button
        className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
          value === "rendered"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("rendered")}
      >
        Preview
      </button>
    </div>
  );
}

/** Source code view using react-syntax-highlighter */
function SourceView({ preview, isDark }: { preview: FilePreviewType; isDark: boolean }) {
  return (
    <div className="text-xs">
      <SyntaxHighlighter
        language={preview.language}
        style={isDark ? atomOneDark : atomOneLight}
        showLineNumbers
        customStyle={{
          margin: 0,
          padding: "8px",
          borderRadius: 0,
          fontSize: "11px",
          lineHeight: "1.5",
          background: "transparent",
        }}
        lineNumberStyle={{
          minWidth: "2.5em",
          paddingRight: "8px",
          color: isDark ? "#636d83" : "#9ca3af",
          userSelect: "none",
        }}
      >
        {preview.content}
      </SyntaxHighlighter>
    </div>
  );
}

/** Rendered view for markdown / HTML files */
function RenderedView({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}) {
  const { t } = useTranslation();
  if (isHtml(filePath)) {
    return (
      <iframe
        srcDoc={content}
        sandbox=""
        className="h-full w-full border-0"
        title={t('docPreview.htmlPreview')}
      />
    );
  }

  // Markdown / MDX
  return (
    <div className="px-6 py-4 overflow-x-hidden break-words">
      <Streamdown
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
        plugins={streamdownPlugins}
      >
        {content}
      </Streamdown>
    </div>
  );
}
