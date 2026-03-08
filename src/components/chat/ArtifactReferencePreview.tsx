'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { usePanel } from '@/hooks/usePanel';
import { getFileCategory, type FileCategory } from '@/lib/file-categories';
import { useTranslation } from '@/hooks/useTranslation';

interface ToolSummary {
  name: string;
  result?: string;
  isError?: boolean;
}

interface ArtifactReferencePreviewProps {
  text: string;
  tools?: ToolSummary[];
}

interface ArtifactRef {
  path: string;
  category: FileCategory | null;
  previewUrl: string;
}

const DOCUMENT_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
  '.md', '.mdx', '.txt', '.rtf',
]);

function getExt(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function isDocumentRef(ref: ArtifactRef): boolean {
  if (
    ref.category === 'pdf' ||
    ref.category === 'word' ||
    ref.category === 'excel' ||
    ref.category === 'powerpoint'
  ) {
    return true;
  }
  return DOCUMENT_EXTS.has(getExt(ref.path));
}

function isAbsolutePath(input: string): boolean {
  return input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input);
}

function hasLikelyFileName(input: string): boolean {
  const normalized = input.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  return /\.[a-zA-Z0-9]{1,16}$/.test(fileName);
}

function cleanPathCandidate(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate) return null;

  candidate = candidate
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[),.;!?，。；：]+$/g, '');

  if (candidate.startsWith('file://')) {
    candidate = decodeURIComponent(candidate.slice('file://'.length));
  }

  if (!isAbsolutePath(candidate)) return null;
  if (!hasLikelyFileName(candidate)) return null;
  if (candidate.includes('\n') || candidate.includes('\r')) return null;

  return candidate;
}

function extractPathCandidatesFromText(text: string): string[] {
  const candidates = new Set<string>();

  // Backtick-enclosed paths: `/abs/path/file.ext` (supports spaces)
  const backtickRegex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  // FEISHU directive lines
  const feishuRegex = /^FEISHU_SEND_FILE::(.+)$/gm;
  while ((match = feishuRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  // Quoted absolute paths
  const quotedRegex = /["']((?:\/|[a-zA-Z]:[\\/])[^"'\n]+?\.[a-zA-Z0-9]{1,16})["']/g;
  while ((match = quotedRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  // Bare absolute paths (no spaces)
  const bareRegex = /(?:^|[\s(])((?:\/|[a-zA-Z]:[\\/])[^\s'"`<>]+?\.[a-zA-Z0-9]{1,16})(?=$|[\s),.;!?，。；：])/g;
  while ((match = bareRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  return Array.from(candidates);
}

function extractPathCandidatesFromGeminiToolResult(tools: ToolSummary[] = []): string[] {
  const paths = new Set<string>();

  for (const tool of tools) {
    const toolName = tool.name.toLowerCase();
    if (
      !tool.result ||
      tool.isError ||
      (!toolName.includes('gemini-image') && !toolName.includes('generate_image'))
    ) {
      continue;
    }

    try {
      const parsed = JSON.parse(tool.result) as Record<string, unknown>;
      const images = Array.isArray(parsed.images) ? parsed.images : [];
      for (const image of images) {
        if (typeof image === 'string') {
          const cleaned = cleanPathCandidate(image);
          if (cleaned) paths.add(cleaned);
          continue;
        }
        if (image && typeof image === 'object') {
          const obj = image as Record<string, unknown>;
          const cleaned = cleanPathCandidate(
            typeof obj.path === 'string'
              ? obj.path
              : typeof obj.localPath === 'string'
                ? obj.localPath
                : typeof obj.filePath === 'string'
                  ? obj.filePath
                  : ''
          );
          if (cleaned) paths.add(cleaned);
        }
      }
    } catch {
      // ignore malformed result payloads
    }
  }

  return Array.from(paths);
}

function toArtifactRefs(paths: string[]): ArtifactRef[] {
  return paths.map((p) => ({
    path: p,
    category: getFileCategory(p),
    previewUrl: `/api/files/raw?path=${encodeURIComponent(p)}`,
  }));
}

export function ArtifactReferencePreview({ text, tools }: ArtifactReferencePreviewProps) {
  const { t } = useTranslation();
  const { setPreviewFile, setContentPanelOpen } = usePanel();

  const refs = useMemo(() => {
    const allPaths = new Set<string>();
    for (const p of extractPathCandidatesFromText(text)) allPaths.add(p);
    for (const p of extractPathCandidatesFromGeminiToolResult(tools)) allPaths.add(p);
    return toArtifactRefs(Array.from(allPaths));
  }, [text, tools]);

  const mediaRefs = refs.filter((ref) =>
    ref.category === 'image' || ref.category === 'video' || ref.category === 'audio'
  );
  const docRefs = refs.filter((ref) => isDocumentRef(ref));

  if (refs.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">
        {t('artifact.generatedFiles')}
      </div>

      {mediaRefs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">{t('artifact.mediaPreview')}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {mediaRefs.map((ref) => {
              const fileName = ref.path.split(/[\\/]/).pop() || ref.path;
              if (ref.category === 'image') {
                return (
                  <button
                    key={ref.path}
                    type="button"
                    className="group overflow-hidden rounded-md border border-border/60 text-left"
                    onClick={() => {
                      setContentPanelOpen(true);
                      setPreviewFile(ref.path);
                    }}
                  >
                    <Image
                      src={ref.previewUrl}
                      alt={fileName}
                      width={640}
                      height={420}
                      unoptimized
                      className="h-44 w-full object-cover"
                    />
                    <div className="truncate border-t border-border/60 px-2 py-1 text-[11px] text-muted-foreground group-hover:text-foreground">
                      {fileName}
                    </div>
                  </button>
                );
              }

              if (ref.category === 'video') {
                return (
                  <div key={ref.path} className="space-y-1 rounded-md border border-border/60 p-2">
                    <video controls preload="metadata" className="h-auto w-full rounded">
                      <source src={ref.previewUrl} />
                    </video>
                    <div className="truncate text-[11px] text-muted-foreground">{fileName}</div>
                  </div>
                );
              }

              return (
                <div key={ref.path} className="space-y-1 rounded-md border border-border/60 p-2">
                  <audio controls className="w-full">
                    <source src={ref.previewUrl} />
                  </audio>
                  <div className="truncate text-[11px] text-muted-foreground">{fileName}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {docRefs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">{t('artifact.documentRefs')}</div>
          <div className="space-y-2">
            {docRefs.map((ref) => {
              const fileName = ref.path.split(/[\\/]/).pop() || ref.path;
              return (
                <div
                  key={ref.path}
                  className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/60 p-2"
                >
                  <div className="truncate text-xs font-medium">{fileName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{ref.path}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setContentPanelOpen(true);
                        setPreviewFile(ref.path);
                      }}
                    >
                      {t('artifact.openPreview')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('attach-file-to-chat', { detail: { path: ref.path } })
                        );
                      }}
                    >
                      {t('common.addToChat')}
                    </Button>
                    <a
                      href={ref.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      {t('artifact.openRaw')}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
