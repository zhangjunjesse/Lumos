'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ReferenceImage } from '@/types';
import type { ImageProviderDefaults } from '@/lib/image/provider-defaults';
import type { ProviderParameterDef } from '@/lib/image/types';

export interface ImageProviderUiConfigResponse {
  provider: {
    id: string
    name: string
    type: string
  }
  uiConfig: {
    supportedAspectRatios: string[]
    supportedResolutions: string[]
    maxCount: number
    maxReferenceImages: number
    hint?: string
    advancedOptions: Record<string, ProviderParameterDef>
  }
  defaults?: ImageProviderDefaults
}

interface ImageGenOptionsFieldsProps {
  providerConfig: ImageProviderUiConfigResponse | null
  aspectRatio: string
  resolution: string
  count: number
  disabled?: boolean
  advancedOpen: boolean
  advancedValues: Record<string, unknown>
  referenceImages?: ReferenceImage[]
  onAspectRatioChange: (value: string) => void
  onResolutionChange: (value: string) => void
  onCountChange: (value: number) => void
  onAdvancedOpenChange: (open: boolean) => void
  onAdvancedValueChange: (key: string, value: unknown) => void
}

export function buildDefaultAdvancedValues(
  schema: Record<string, ProviderParameterDef>,
  defaults?: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, def] of Object.entries(schema)) {
    if (defaults && defaults[key] !== undefined) {
      result[key] = def.type === 'json'
        ? JSON.stringify(defaults[key], null, 2)
        : defaults[key]
      continue
    }
    if (def.defaultValue !== undefined) {
      result[key] = def.type === 'json'
        ? JSON.stringify(def.defaultValue, null, 2)
        : def.defaultValue
    }
  }

  return result
}

export function ImageGenOptionsFields({
  providerConfig,
  aspectRatio,
  resolution,
  count,
  disabled = false,
  advancedOpen,
  advancedValues,
  referenceImages,
  onAspectRatioChange,
  onResolutionChange,
  onCountChange,
  onAdvancedOpenChange,
  onAdvancedValueChange,
}: ImageGenOptionsFieldsProps) {
  const supportedAspectRatios = providerConfig?.uiConfig.supportedAspectRatios ?? []
  const supportedResolutions = providerConfig?.uiConfig.supportedResolutions ?? []
  const maxCount = providerConfig?.uiConfig.maxCount ?? 4
  const maxReferenceImages = providerConfig?.uiConfig.maxReferenceImages ?? 4
  const advancedSchema = providerConfig?.uiConfig.advancedOptions ?? {}

  return (
    <div className="space-y-3">
      {providerConfig && (
        <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground/90">当前服务商：{providerConfig.provider.name}</div>
          {providerConfig.uiConfig.hint && <div>{providerConfig.uiConfig.hint}</div>}
          <div>参考图上限：{maxReferenceImages} 张</div>
        </div>
      )}

      {referenceImages && referenceImages.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">参考图</label>
          {referenceImages.length > maxReferenceImages && (
            <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
              当前服务商建议最多使用 {maxReferenceImages} 张参考图，超出部分可能导致失败或效果不稳定。
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            {referenceImages.map((img, i) => (
              <div key={i} className="w-16 h-16 rounded-md border border-border/30 overflow-hidden bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.data
                    ? `data:${img.mimeType};base64,${img.data}`
                    : `/api/uploads?path=${encodeURIComponent(img.localPath!)}`}
                  alt={`Reference ${i + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">尺寸比例</label>
        <div className="flex flex-wrap gap-1.5">
          {supportedAspectRatios.map((ratio) => (
            <button
              key={ratio}
              type="button"
              disabled={disabled}
              onClick={() => onAspectRatioChange(ratio)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs border transition-colors',
                aspectRatio === ratio
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/40 bg-background hover:bg-muted/40',
                disabled && 'opacity-60 cursor-not-allowed',
              )}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">分辨率</label>
          <div className="flex flex-wrap gap-1.5">
            {supportedResolutions.map((item) => (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => onResolutionChange(item)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs border transition-colors',
                  resolution === item
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/40 bg-background hover:bg-muted/40',
                  disabled && 'opacity-60 cursor-not-allowed',
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">张数</label>
          <Input
            type="number"
            min={1}
            max={maxCount}
            value={count}
            disabled={disabled}
            onChange={(e) => onCountChange(Math.max(1, Math.min(maxCount, Number(e.target.value) || 1)))}
            className="h-9"
          />
        </div>
      </div>

      {Object.keys(advancedSchema).length > 0 && (
        <div className="rounded-md border border-border/40">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm"
          >
            <span>高级参数</span>
            <span className="text-xs text-muted-foreground">{advancedOpen ? '收起' : '展开'}</span>
          </button>

          {advancedOpen && (
            <div className="border-t border-border/40 px-3 py-3 space-y-3">
              {Object.entries(advancedSchema).map(([key, def]) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{def.label}</label>
                  {def.description && (
                    <p className="text-[11px] text-muted-foreground">{def.description}</p>
                  )}

                  {def.type === 'boolean' ? (
                    <Button
                      type="button"
                      variant={advancedValues[key] === true ? 'default' : 'outline'}
                      size="sm"
                      disabled={disabled}
                      onClick={() => onAdvancedValueChange(key, advancedValues[key] !== true)}
                    >
                      {advancedValues[key] === true ? '已开启' : '未开启'}
                    </Button>
                  ) : (
                    <Input
                      value={String(advancedValues[key] ?? '')}
                      disabled={disabled}
                      onChange={(e) => onAdvancedValueChange(key, e.target.value)}
                      placeholder={def.type === 'json' ? '{"key":"value"}' : def.type === 'number' ? '0' : ''}
                      className={cn(def.type === 'json' && 'font-mono text-xs')}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
