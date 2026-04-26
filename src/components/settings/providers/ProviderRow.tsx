'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Edit2, Loader2, Trash2 } from 'lucide-react';
import { getProviderModelCatalogMeta } from '@/lib/model-metadata';
import {
  getModelCatalogSourceLabel,
  isLocalAuthAnthropic,
  isSystemProvider,
  type SavedConfig,
} from './shared';
import { getLocalAuthBadge } from './useLocalAuth';
import type { ClaudeLocalAuthStatus } from './shared';

interface ProviderRowProps {
  config: SavedConfig;
  isActive: boolean;
  readOnly: boolean;
  switching: boolean;
  localAuthStatus: ClaudeLocalAuthStatus | undefined;
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function getMeta(config: SavedConfig) {
  const catalog = getProviderModelCatalogMeta(config);
  return {
    count: catalog.models.length,
    sourceLabel: getModelCatalogSourceLabel(catalog.source, catalog.usesDefault),
  };
}

export function ProviderRow({
  config,
  isActive,
  readOnly,
  switching,
  localAuthStatus,
  onSwitch,
  onEdit,
  onDelete,
}: ProviderRowProps) {
  const meta = getMeta(config);
  const localAuth = isLocalAuthAnthropic(config);
  const authBadge = getLocalAuthBadge(localAuthStatus);
  const system = isSystemProvider(config);
  // system provider 永远本地只读(provisioner 下发,改了也会被覆盖)
  const canModify = !readOnly && !system;

  const wrapperClass = isActive
    ? 'rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 transition-all'
    : 'group rounded-lg border border-border/50 px-4 py-3 transition-all hover:border-border hover:shadow-sm hover:bg-accent/30';
  const dotClass = isActive
    ? 'mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0'
    : 'mt-1.5 h-2 w-2 rounded-full bg-muted-foreground/30 flex-shrink-0';
  const hoverBtn = isActive ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity';

  return (
    <div className={wrapperClass}>
      <div className="flex items-start gap-3">
        <div className={dotClass} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium text-sm truncate">{config.name}</p>
            {isActive && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                当前使用
              </Badge>
            )}
            {system && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                系统
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {localAuth ? 'Claude 本地登录' : config.base_url}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {localAuth && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${authBadge.className}`}>
                {authBadge.label}
              </span>
            )}
            <span>{meta.count} 个模型可用</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isActive && (
            <Button
              variant="outline"
              size="sm"
              className={`h-7 px-3 text-xs ${hoverBtn}`}
              onClick={onSwitch}
              disabled={switching}
            >
              {switching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  使用
                </>
              )}
            </Button>
          )}
          {canModify && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs ${isActive ? '' : hoverBtn}`}
              onClick={onEdit}
            >
              <Edit2 className={`h-3 w-3 ${isActive ? 'mr-1' : ''}`} />
              {isActive && '编辑'}
            </Button>
          )}
          {canModify && !isActive && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs text-destructive hover:text-destructive ${hoverBtn}`}
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
