'use client';

import { Button } from '@/components/ui/button';
import { Edit2, Trash2 } from 'lucide-react';
import { parseModelCatalog, type ProviderOption } from './module-override-config';

interface ImageProviderDetailProps {
  provider: ProviderOption;
  onEdit: () => void;
  onDelete: () => void;
}

export function ImageProviderDetail({ provider, onEdit, onDelete }: ImageProviderDetailProps) {
  const modelCount = parseModelCatalog(provider.model_catalog).length;
  const hasKey = provider.auth_mode !== 'local_auth';

  return (
    <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
              {provider.provider_type}
            </span>
            <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
              {modelCount} 个模型
            </span>
            {hasKey && (
              <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5">
                API Key
              </span>
            )}
          </div>
        </div>
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
      </div>
    </div>
  );
}
