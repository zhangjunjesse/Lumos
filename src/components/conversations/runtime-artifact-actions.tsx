'use client'

import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RuntimeArtifactPreviewKind, StageArtifactProjectionV1 } from '@/types'
import { useTranslation } from '@/hooks/useTranslation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import {
  normalizeRuntimeArtifactPreviewContent,
  parseRuntimeArtifactCsv,
} from '@/lib/team-run/runtime-artifact-preview'

interface RuntimeArtifactActionsProps {
  runId: string
  artifact: StageArtifactProjectionV1
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function previewKindLabel(kind: RuntimeArtifactPreviewKind, t: ReturnType<typeof useTranslation>['t']): string {
  switch (kind) {
    case 'csv':
      return t('artifactPreview.kindCsv')
    case 'image':
      return t('artifactPreview.kindImage')
    case 'markdown':
      return t('artifactPreview.kindMarkdown')
    case 'json':
      return t('artifactPreview.kindJson')
    case 'pdf':
      return t('artifactPreview.kindPdf')
    case 'text':
    default:
      return t('artifactPreview.kindText')
  }
}

function buildArtifactUrl(runId: string, artifactId: string, download: boolean = false): string {
  const base = `/api/team-runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`
  return download ? `${base}?download=1` : base
}

export function RuntimeArtifactActions({ runId, artifact }: RuntimeArtifactActionsProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [content, setContent] = useState('')
  const [csvRows, setCsvRows] = useState<string[][]>([])
  const [resolvedKind, setResolvedKind] = useState<RuntimeArtifactPreviewKind | null>(null)
  const previewKind = useMemo(
    () => (artifact.previewable ? artifact.previewKind || null : null),
    [artifact.previewKind, artifact.previewable],
  )

  useEffect(() => {
    if (!open || !previewKind) {
      setResolvedKind(previewKind || null)
      setLoading(false)
      setError('')
      setContent('')
      setCsvRows([])
      return
    }

    setResolvedKind(previewKind)
    setError('')

    if (previewKind === 'image' || previewKind === 'pdf') {
      setLoading(false)
      setContent('')
      setCsvRows([])
      return
    }

    const controller = new AbortController()

    async function loadPreview() {
      setLoading(true)
      setError('')
      setContent('')
      setCsvRows([])

      try {
        const response = await fetch(buildArtifactUrl(runId, artifact.artifactId), {
          cache: 'no-store',
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(t('artifactPreview.failed'))
        }

        const responseKind = previewKind
        const rawContent = await response.text()

        if (!responseKind) {
          throw new Error(t('artifactPreview.failed'))
        }

        setResolvedKind(responseKind)
        if (responseKind === 'csv') {
          setCsvRows(parseRuntimeArtifactCsv(rawContent))
          return
        }

        setContent(normalizeRuntimeArtifactPreviewContent(rawContent, responseKind))
      } catch (nextError) {
        if (controller.signal.aborted) {
          return
        }
        setError(nextError instanceof Error ? nextError.message : t('artifactPreview.failed'))
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadPreview()

    return () => controller.abort()
  }, [artifact.artifactId, open, previewKind, runId, t])

  const activeKind = previewKind || resolvedKind
  const artifactUrl = buildArtifactUrl(runId, artifact.artifactId)

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {previewKind ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {t('artifactPreview.preview')}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" asChild>
          <a
            href={buildArtifactUrl(runId, artifact.artifactId)}
            target="_blank"
            rel="noreferrer"
          >
            {t('artifactPreview.openRaw')}
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={buildArtifactUrl(runId, artifact.artifactId, true)}>
            {t('artifactPreview.download')}
          </a>
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] w-[94vw] max-w-4xl overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>{artifact.title}</DialogTitle>
            <DialogDescription>
              {[
                artifact.stageTitle,
                previewKind ? previewKindLabel(previewKind, t) : null,
                artifact.contentType,
                formatBytes(artifact.size),
              ].filter(Boolean).join(' • ')}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 px-6 pb-2">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/10">
              {loading ? (
                <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <span>{t('artifactPreview.loading')}</span>
                </div>
              ) : error ? (
                <div className="flex h-[60vh] items-center justify-center px-6 text-sm text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              ) : activeKind === 'image' ? (
                <ScrollArea className="h-[60vh]">
                  <div className="flex min-h-[60vh] items-center justify-center p-4">
                    <img
                      src={artifactUrl}
                      alt={artifact.title}
                      className="max-w-full max-h-[56vh] object-contain"
                    />
                  </div>
                </ScrollArea>
              ) : activeKind === 'pdf' ? (
                <iframe
                  src={artifactUrl}
                  title={artifact.title}
                  className="h-[60vh] w-full border-0 bg-background"
                />
              ) : activeKind === 'csv' ? (
                <ScrollArea className="h-[60vh]">
                  <div className="min-w-max p-4">
                    {csvRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('artifactPreview.empty')}</p>
                    ) : (
                      <table className="border-collapse text-sm">
                        <tbody>
                          {csvRows.map((row, rowIndex) => (
                            <tr key={`row-${rowIndex}`} className="align-top">
                              {row.map((cell, cellIndex) => {
                                const CellTag = rowIndex === 0 ? 'th' : 'td'
                                return (
                                  <CellTag
                                    key={`cell-${rowIndex}-${cellIndex}`}
                                    className="border border-border/60 px-3 py-2 text-left whitespace-pre-wrap break-words"
                                  >
                                    {cell || ''}
                                  </CellTag>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="h-[60vh]">
                  {activeKind === 'markdown' ? (
                    content ? (
                      <div className="prose prose-sm max-w-none p-4 dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="flex h-[60vh] items-center justify-center px-6 text-sm text-muted-foreground">
                        {t('artifactPreview.empty')}
                      </div>
                    )
                  ) : (
                    content ? (
                      <pre className="overflow-x-auto p-4 text-sm leading-6 whitespace-pre-wrap break-words text-foreground">
                        {content}
                      </pre>
                    ) : (
                      <div className="flex h-[60vh] items-center justify-center px-6 text-sm text-muted-foreground">
                        {t('artifactPreview.empty')}
                      </div>
                    )
                  )}
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" asChild>
              <a
                href={buildArtifactUrl(runId, artifact.artifactId)}
                target="_blank"
                rel="noreferrer"
              >
                {t('artifactPreview.openRaw')}
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={buildArtifactUrl(runId, artifact.artifactId, true)}>
                {t('artifactPreview.download')}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
