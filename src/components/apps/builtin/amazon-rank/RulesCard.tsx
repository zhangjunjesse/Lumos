'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { api } from './api';
import type { RulesDto } from './types';

/**
 * 解析规则卡片：展示当前生效版本；AI 生成的修复草稿在此确认采用/忽略；
 * 可随时回滚出厂基线。草稿绝不自动生效——先草稿后确认。
 */
export function RulesCard(): React.ReactElement {
  const [rules, setRules] = React.useState<RulesDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setRules(await api.rules());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (action: 'adopt' | 'dismiss' | 'rollback', id?: string) => {
    setBusy(true);
    try {
      setRules(await api.rulesAction(action, id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!rules) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载解析规则…
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">页面解析规则</div>
          <div className="text-xs text-muted-foreground">
            当前生效：{rules.active.source === 'builtin' ? '出厂基线（v0）' : `AI 修复版 v${rules.active.version}`}
            {rules.openTickets > 0 ? `　·　${rules.openTickets} 个关键词等待修复` : ''}
          </div>
        </div>
        {rules.active.source === 'ai' ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('rollback')}>
            回滚出厂
          </Button>
        ) : null}
      </div>

      {rules.draft ? (
        <Alert>
          <AlertDescription className="space-y-2">
            <div>
              AI 生成了规则修复草稿 v{rules.draft.version}
              ，已在 {rules.draft.validatedKeywords.length} 个关键词的真实页面上验证一致
              {rules.draft.note ? `：${rules.draft.note}` : '。'}
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void act('adopt', rules.draft!.id)}>
                采用
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('dismiss', rules.draft!.id)}>
                忽略
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
