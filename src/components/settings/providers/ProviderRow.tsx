'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Edit2, Loader2, Trash2 } from 'lucide-react';
import { getProviderModelCatalogMeta } from '@/lib/model-metadata';
import { getAdminDefaultModelFromExtraEnv } from '@/lib/claude/provider-env';
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
  savingDefaultModel: boolean;
  localAuthStatus: ClaudeLocalAuthStatus | undefined;
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefaultModel: (model: string) => void;
}

function getMeta(config: SavedConfig) {
  const catalog = getProviderModelCatalogMeta(config);
  return {
    models: catalog.models,
    sourceLabel: getModelCatalogSourceLabel(catalog.source, catalog.usesDefault),
  };
}

export function ProviderRow({
  config,
  isActive,
  readOnly,
  switching,
  savingDefaultModel,
  localAuthStatus,
  onSwitch,
  onEdit,
  onDelete,
  onSetDefaultModel,
}: ProviderRowProps) {
  const meta = getMeta(config);
  const localAuth = isLocalAuthAnthropic(config);
  const authBadge = getLocalAuthBadge(localAuthStatus);
  const system = isSystemProvider(config);
  // system provider 的连接配置(base_url / api_key / model_catalog)由
  // provisioner 下发,本地改会被同步覆盖 → 编辑/删除按钮锁。
  const canModify = !readOnly && !system;
  // default_model 是用户偏好,user 选了立刻覆盖 admin 设的;留空 = 用 admin
  // 下发的默认(从 extra_env.LUMOS_DEFAULT_MODEL 读)。即使 readOnly(管理员关闭了
  // 自定义服务商),也允许在系统服务商已下发的模型里挑默认 —— 后端 PUT 只放行
  // default_model 单字段、provisioner 不写这一列,新会话经
  // getProviderEffectiveDefaultModel 优先采用。锁的是"能否自建服务商",不是"选模型"。
  const canEditDefaultModel = meta.models.length > 0;
  const adminDefaultModel = getAdminDefaultModelFromExtraEnv(
    (() => { try { return JSON.parse(config.extra_env || '{}'); } catch { return {}; } })(),
  );
  const adminDefaultLabel = adminDefaultModel
    ? meta.models.find((m) => m.value === adminDefaultModel)?.label || adminDefaultModel
    : '';

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
            <span>{meta.models.length} 个模型可用</span>
          </div>
          {meta.models.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground whitespace-nowrap">默认模型</label>
              <select
                value={config.default_model || ''}
                onChange={(e) => onSetDefaultModel(e.target.value)}
                disabled={!canEditDefaultModel || savingDefaultModel}
                className="h-7 max-w-[260px] flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/30"
                title="新会话和 workflow agent 没显式选择时用这个模型。留空 = 跟随管理员下发的默认。"
              >
                <option value="">{adminDefaultLabel ? `默认（${adminDefaultLabel}）` : '默认'}</option>
                {meta.models.map((m) => (
                  <option key={m.value} value={m.value}>{m.label || m.value}</option>
                ))}
              </select>
              {savingDefaultModel && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
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
