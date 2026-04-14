'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ImageGenCard } from './ImageGenCard';
import {
  buildDefaultAdvancedValues,
  ImageGenOptionsFields,
  type ImageProviderUiConfigResponse,
} from './ImageGenOptionsFields';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import type { TranslationKey } from '@/i18n';
import type { ReferenceImage } from '@/types';
import type { ImageGenResult } from '@/hooks/useImageGen';

const FALLBACK_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
] as const satisfies readonly string[];

const FALLBACK_RESOLUTIONS = ['1K', '2K', '4K'] as const satisfies readonly string[];

interface ImageGenConfirmationProps {
  messageId?: string;
  initialPrompt: string;
  initialAspectRatio: string;
  initialResolution: string;
  referenceImages?: ReferenceImage[];
}

type Status = 'idle' | 'generating' | 'completed' | 'error';

function storageKey(prompt: string, sessionId?: string): string {
  const prefix = sessionId ? `${sessionId}:` : '';
  return `imggen:${prefix}${prompt.slice(0, 80)}`;
}

export function ImageGenConfirmation({
  messageId,
  initialPrompt,
  initialAspectRatio,
  initialResolution,
  referenceImages,
}: ImageGenConfirmationProps) {
  const { t } = useTranslation();
  const { sessionId } = usePanel();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState(
    (FALLBACK_ASPECT_RATIOS as readonly string[]).includes(initialAspectRatio)
      ? initialAspectRatio
      : '1:1'
  );
  const [resolution, setResolution] = useState(
    (FALLBACK_RESOLUTIONS as readonly string[]).includes(initialResolution)
      ? initialResolution
      : '1K'
  );
  const [count, setCount] = useState(1);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ImageGenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerConfig, setProviderConfig] = useState<ImageProviderUiConfigResponse | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedValues, setAdvancedValues] = useState<Record<string, unknown>>({});
  const abortRef = useRef<AbortController | null>(null);

  const supportedAspectRatios: readonly string[] = providerConfig?.uiConfig.supportedAspectRatios?.length
    ? providerConfig.uiConfig.supportedAspectRatios
    : FALLBACK_ASPECT_RATIOS;
  const supportedResolutions: readonly string[] = providerConfig?.uiConfig.supportedResolutions?.length
    ? providerConfig.uiConfig.supportedResolutions
    : FALLBACK_RESOLUTIONS;
  const advancedSchema = useMemo(
    () => providerConfig?.uiConfig.advancedOptions ?? {},
    [providerConfig],
  );
  const maxCount = providerConfig?.uiConfig.maxCount ?? 4;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(initialPrompt, sessionId));
      if (saved) {
        const parsed: ImageGenResult = JSON.parse(saved);
        if (parsed.images && parsed.images.length > 0) {
          setResult(parsed);
          setStatus('completed');
        }
      }
    } catch {
      // ignore
    }
  }, [initialPrompt, sessionId]);

  useEffect(() => {
    let cancelled = false;

    const loadProviderConfig = async () => {
      try {
        const res = await fetch('/api/media/provider-config', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as ImageProviderUiConfigResponse;
        if (cancelled) return;
        setProviderConfig(data);
        setAspectRatio(data.defaults?.aspectRatio || initialAspectRatio || '1:1');
        setResolution(data.defaults?.resolution || initialResolution || '1K');
        setCount(data.defaults?.count || 1);
        setAdvancedValues(buildDefaultAdvancedValues(
          data.uiConfig.advancedOptions ?? {},
          data.defaults?.providerOptions,
        ));
      } catch {
        // ignore
      }
    };

    loadProviderConfig();
    return () => { cancelled = true; };
  }, [initialAspectRatio, initialResolution]);

  useEffect(() => {
    if (!supportedAspectRatios.includes(aspectRatio)) {
      setAspectRatio(supportedAspectRatios[0] || '1:1');
    }
  }, [aspectRatio, supportedAspectRatios]);

  useEffect(() => {
    if (!supportedResolutions.includes(resolution)) {
      setResolution(supportedResolutions[0] || '1K');
    }
  }, [resolution, supportedResolutions]);

  useEffect(() => {
    if (count > maxCount) {
      setCount(maxCount);
    }
  }, [count, maxCount]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus('idle');
  }, []);

  const handleGenerate = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('generating');
    setError(null);

    try {
      const providerOptions: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(advancedValues)) {
        const def = advancedSchema[key];
        if (!def) continue;

        if (def.type === 'json') {
          if (typeof value !== 'string' || !value.trim()) continue;
          try {
            providerOptions[key] = JSON.parse(value);
          } catch {
            throw new Error(`高级参数“${def.label}”不是合法 JSON`);
          }
          continue;
        }

        if (def.type === 'number') {
          if (value === '' || value === null || value === undefined) continue;
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) {
            throw new Error(`高级参数“${def.label}”不是合法数字`);
          }
          providerOptions[key] = parsed;
          continue;
        }

        if (def.type === 'boolean') {
          if (typeof value === 'boolean') providerOptions[key] = value;
          continue;
        }

        if (typeof value === 'string' && value.trim()) {
          providerOptions[key] = value.trim();
        }
      }

      const refData = referenceImages?.filter(r => r.data).map(r => ({ mimeType: r.mimeType, data: r.data! }));
      const refPaths = referenceImages?.filter(r => r.localPath).map(r => r.localPath!);

      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          imageSize: resolution,
          count,
          sessionId,
          ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
          ...(refData && refData.length > 0 ? { referenceImages: refData } : {}),
          ...(refPaths && refPaths.length > 0 ? { referenceImagePaths: refPaths } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(err.error || 'Generation failed');
      }

      const data = await res.json();
      const genResult: ImageGenResult = {
        id: data.id,
        text: data.text,
        images: data.images || [],
      };

      if (genResult.images.length > 0) {
        setResult(genResult);
        setStatus('completed');

        try {
          const storable = {
            id: genResult.id,
            text: genResult.text,
            images: genResult.images.map(img => ({
              mimeType: img.mimeType,
              localPath: img.localPath,
              data: '',
            })),
          };
          localStorage.setItem(storageKey(initialPrompt, sessionId), JSON.stringify(storable));
        } catch {
          // ignore
        }

        const resultBlock = JSON.stringify({
          status: 'completed',
          prompt,
          aspectRatio,
          resolution,
          count,
          provider: providerConfig?.provider.name || null,
          images: genResult.images.map(img => ({
            mimeType: img.mimeType,
            localPath: img.localPath,
          })),
        });
        fetch('/api/chat/messages', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message_id: messageId || '',
            content: '```image-gen-result\n' + resultBlock + '\n```',
            session_id: sessionId,
            prompt_hint: initialPrompt,
          }),
        }).catch(() => {});

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('image-gen-completed', {
            detail: {
              prompt,
              aspectRatio,
              resolution,
              count,
              id: genResult.id,
              images: genResult.images,
            },
          }));
        }, 0);
      } else {
        setError('No images were generated');
        setStatus('error');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError((err as Error).message || 'Generation failed');
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  }, [
    prompt,
    aspectRatio,
    resolution,
    count,
    initialPrompt,
    sessionId,
    referenceImages,
    advancedValues,
    advancedSchema,
    messageId,
    providerConfig?.provider.name,
  ]);

  const handleRegenerate = useCallback(() => {
    setResult(null);
    setStatus('idle');
    try {
      localStorage.removeItem(storageKey(initialPrompt, sessionId));
    } catch {
      // ignore
    }
  }, [initialPrompt, sessionId]);

  if (status === 'completed' && result && result.images.length > 0) {
    return (
      <div className="my-2">
        <ImageGenCard
          images={result.images}
          prompt={prompt}
          aspectRatio={aspectRatio}
          imageSize={resolution}
          onRegenerate={handleRegenerate}
          referenceImages={referenceImages?.filter(r => r.data).map(r => ({ mimeType: r.mimeType, data: r.data! }))}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-hidden my-2">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-muted/30">
        <span className="text-sm font-medium">{t('imageGen.confirmTitle' as TranslationKey)}</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t('imageGen.prompt' as TranslationKey)}
          </label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={status === 'generating'}
            rows={3}
            className={cn(
              'resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30',
              'disabled:opacity-60 disabled:cursor-not-allowed'
            )}
          />
        </div>

        <ImageGenOptionsFields
          providerConfig={providerConfig}
          aspectRatio={aspectRatio}
          resolution={resolution}
          count={count}
          disabled={status === 'generating'}
          advancedOpen={advancedOpen}
          advancedValues={advancedValues}
          referenceImages={referenceImages}
          onAspectRatioChange={setAspectRatio}
          onResolutionChange={setResolution}
          onCountChange={setCount}
          onAdvancedOpenChange={setAdvancedOpen}
          onAdvancedValueChange={(key, value) => setAdvancedValues((prev) => ({ ...prev, [key]: value }))}
        />

        {status === 'idle' && (
          <div className="pt-1">
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              size="sm"
              className="gap-1.5"
            >
              {t('imageGen.generateButton' as TranslationKey)}
            </Button>
          </div>
        )}

        {status === 'generating' && (
          <div className="pt-1">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">
                  {t('imageGen.generatingStatus' as TranslationKey)}
                </span>
              </div>
              <Button onClick={handleStop} variant="outline" size="sm">
                {t('imageGen.stopButton' as TranslationKey)}
              </Button>
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div className="space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button onClick={handleGenerate} variant="outline" size="sm">
              {t('imageGen.retryButton' as TranslationKey)}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
