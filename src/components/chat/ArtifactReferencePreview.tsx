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
  model?: string;
  provider?: string;
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
  if (['pdf', 'word', 'excel', 'powerpoint'].includes(ref.category ?? '')) return true;
  return DOCUMENT_EXTS.has(getExt(ref.path));
}

const isAbsolutePath = (s: string) => s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s);
const hasLikelyFileName = (s: string) => /\.[a-zA-Z0-9]{1,16}$/.test(s.replace(/\\/g, '/').split('/').pop() || '');

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
  // Reject API/URL paths — these are serve endpoints, not file system paths
  if (candidate.startsWith('/api/')) return null;

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

function extractRefsFromImageToolResults(
  tools: ToolSummary[] = [],
): Array<{ path: string; model?: string; provider?: string }> {
  const refs: Array<{ path: string; model?: string; provider?: string }> = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const n = tool.name.toLowerCase();
    if (!tool.result || tool.isError || (!n.includes('gemini-image') && !n.includes('generate_image'))) continue;
    try {
      const p = JSON.parse(tool.result) as Record<string, unknown>;
      const model = typeof p.model === 'string' ? p.model : undefined;
      const provider = typeof p.provider === 'string' ? p.provider : undefined;
      for (const img of (Array.isArray(p.images) ? p.images : [])) {
        const raw = typeof img === 'string' ? img
          : (img as Record<string, unknown>)?.path ?? (img as Record<string, unknown>)?.localPath ?? '';
        const cleaned = cleanPathCandidate(String(raw));
        if (cleaned && !seen.has(cleaned)) { seen.add(cleaned); refs.push({ path: cleaned, model, provider }); }
      }
    } catch { /* ignore */ }
  }
  return refs;
}

function toArtifactRefs(paths: string[]): ArtifactRef[] {
  return paths.map((p) => ({
    path: p,
    category: getFileCategory(p),
    previewUrl: `/api/media/serve?path=${encodeURIComponent(p)}`,
  }));
}

export function ArtifactReferencePreview({ text, tools }: ArtifactReferencePreviewProps) {
  const { t } = useTranslation();
  const { setPreviewFile, setContentPanelOpen } = usePanel();

  const refs = useMemo(() => {
    const toolRefs = extractRefsFromImageToolResults(tools);
    const toolPaths = new Set(toolRefs.map((r) => r.path));

    // Text-extracted paths (dedup against tool refs)
    const textRefs = toArtifactRefs(
      extractPathCandidatesFromText(text).filter((p) => !toolPaths.has(p))
    );

    // Tool refs with model/provider metadata
    const enrichedToolRefs: ArtifactRef[] = toolRefs.map((r) => ({
      path: r.path,
      category: getFileCategory(r.path),
      previewUrl: `/api/media/serve?path=${encodeURIComponent(r.path)}`,
      model: r.model,
      provider: r.provider,
    }));

    return [...enrichedToolRefs, ...textRefs];
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
                    <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1.5">
                      <span className="truncate text-[11px] text-muted-foreground group-hover:text-foreground flex-1">
                        {fileName}
                      </span>
                      {ref.model && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                          {ref.model.length > 20 ? ref.model.slice(0, 20) + '…' : ref.model}
                        </span>
                      )}
                      {ref.provider && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary/70">
                          {ref.provider}
                        </span>
                      )}
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
