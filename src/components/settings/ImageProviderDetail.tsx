'use client';

import { Button } from '@/components/ui/button';
import { Edit2, Trash2 } from 'lucide-react';
import { formatYuanPerImage } from '@/lib/pricing';
import { parseModelCatalog, type ProviderOption } from './module-override-config';

interface ImageProviderDetailProps {
  provider: ProviderOption;
  onEdit: () => void;
  onDelete: () => void;
  /** When true (either admin disabled custom media or provider is system-origin),
   *  hide edit/delete controls. */
  readOnly?: boolean;
}

export function ImageProviderDetail({ provider, onEdit, onDelete, readOnly = false }: ImageProviderDetailProps) {
  const models = parseModelCatalog(provider.model_catalog);
  const hasKey = provider.auth_mode !== 'local_auth';
  const locked = readOnly || provider.provider_origin === 'system';
  const anyPriced = models.some((m) => m.price_per_image && m.price_per_image > 0);

  return (
    <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
              {provider.provider_type}
            </span>
            <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
              {models.length} 个模型
            </span>
            {hasKey && (
              <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
                API Key
              </span>
            )}
          </div>
        </div>
        {!locked && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onEdit}>
              <Edit2 className="h-3 w-3 mr-1" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {models.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-border/30 pt-2">
          {models.map((model) => {
            const price = formatYuanPerImage(model.price_per_image);
            return (
              <li
                key={model.value}
                className="flex items-center justify-between gap-3 text-[11px]"
              >
                <span className="font-mono text-foreground/90 truncate" title={model.label}>
                  {model.label}
                </span>
                {price ? (
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {price}
                    <span className="text-muted-foreground/60"> / 张</span>
                  </span>
                ) : anyPriced ? (
                  // Keep alignment when other models in the list show pricing.
                  <span className="shrink-0 text-muted-foreground/50">价格未定</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
