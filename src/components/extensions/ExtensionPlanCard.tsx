"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';

type ExtensionPlan = {
  type?: string;
  summary?: string;
  skills?: Array<{
    name?: string;
    description?: string;
    content?: string;
  }>;
  mcpServers?: Array<{
    name?: string;
    description?: string;
    config?: {
      type?: 'stdio' | 'sse' | 'http';
      runMode?: 'on_demand' | 'keep_alive';
      runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    };
    pythonPackages?: string[];
    scriptContent?: string;
  }>;
};

type ApplyStatus = 'created' | 'updated' | 'exists' | 'error' | 'invalid';

type ApplyResult = {
  skills: Array<{ name: string; status: ApplyStatus; message?: string }>;
  mcps: Array<{ name: string; status: ApplyStatus; message?: string }>;
  messages?: string[];
  rollbackMessages?: string[];
  backupId?: string;
};

function stripSelfTestPrefix(message: string | undefined): string | undefined {
  const prefix = 'MCP self-test failed:';
  if (!message) return undefined;
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
}

function isSelfTestFailure(message: string | undefined): boolean {
  return Boolean(message?.startsWith('MCP self-test failed:'));
}

export function ExtensionPlanCard({ plan }: { plan: ExtensionPlan }) {
  const { t } = useTranslation();
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState('');
  const autoApplyStartedRef = useRef(false);

  const skills = useMemo(() => plan.skills || [], [plan.skills]);
  const mcps = useMemo(() => plan.mcpServers || [], [plan.mcpServers]);

  const skillCount = skills.length;
  const mcpCount = mcps.length;
  const autoApplySafePlan = skillCount > 0 && mcpCount === 0;

  const getStatusLabel = (item: { status: ApplyStatus; message?: string }) => {
    if (isSelfTestFailure(item.message)) return t('extensions.builderStatusSelfTestFailed');
    switch (item.status) {
      case 'created':
        return t('extensions.builderStatusCreated');
      case 'updated':
        return t('extensions.builderStatusUpdated');
      case 'exists':
        return t('extensions.builderStatusExists');
      case 'invalid':
        return t('extensions.builderStatusInvalid');
      case 'error':
      default:
        return t('extensions.builderStatusError');
    }
  };

  const getResultMessage = (item: { message?: string }) => stripSelfTestPrefix(item.message);

  const applyPlan = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    setApplyError('');
    try {
      const res = await fetch('/api/extensions/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyError(body.error || '安装失败');
        setResult(body.result || null);
        return;
      }
      setResult(body.result || { skills: [], mcps: [] });
      if ((body.result?.skills?.length || 0) > 0) {
        await fetch('/api/skills/sync', { method: 'POST' }).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('extensions-updated'));
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setApplying(false);
    }
  }, [applying, plan]);

  useEffect(() => {
    if (!autoApplySafePlan || result || applying || autoApplyStartedRef.current) return;
    autoApplyStartedRef.current = true;
    const timer = window.setTimeout(() => {
      void applyPlan();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applyPlan, applying, autoApplySafePlan, result]);

  if (skillCount === 0 && mcpCount === 0) return null;

  return (
    <Card className="mt-3 border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t('extensions.builderPlanTitle')}</CardTitle>
        <CardDescription className="text-xs">{plan.summary || t('extensions.builderPlanDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {skillCount > 0 && (
            <Badge variant="secondary">{t('extensions.builderPlanSkills', { n: skillCount })}</Badge>
          )}
          {mcpCount > 0 && (
            <Badge variant="secondary">{t('extensions.builderPlanMcps', { n: mcpCount })}</Badge>
          )}
        </div>
        {!autoApplySafePlan && (
          <Button size="sm" onClick={applyPlan} disabled={applying}>
            {applying ? t('extensions.builderApplying') : t('extensions.builderApplyPlan')}
          </Button>
        )}
        {autoApplySafePlan && !result && (
          <div className="text-xs text-muted-foreground">
            {applying ? t('extensions.builderApplying') : t('extensions.builderApplying')}
          </div>
        )}
        {applyError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs leading-5 text-rose-700">
            {applyError}
          </div>
        )}
        {result && (
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>{applyError ? '安装未完成，已按快照回滚可恢复项' : t('extensions.builderApplyDone')}</div>
            {result.skills.length > 0 && (
              <ul className="list-disc pl-4">
                {result.skills.map((item, idx) => (
                  <li key={`skill-${idx}`}>
                    {item.name}: {getStatusLabel(item)}
                    {getResultMessage(item) ? ` (${getResultMessage(item)})` : ''}
                  </li>
                ))}
              </ul>
            )}
            {result.mcps.length > 0 && (
              <ul className="list-disc pl-4">
                {result.mcps.map((item, idx) => (
                  <li key={`mcp-${idx}`}>
                    {item.name}: {getStatusLabel(item)}
                    {getResultMessage(item) ? ` (${getResultMessage(item)})` : ''}
                  </li>
                ))}
              </ul>
            )}
            {result.rollbackMessages && result.rollbackMessages.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
                {result.rollbackMessages.slice(0, 4).join('；')}
              </div>
            )}
            {result.backupId && (
              <div className="text-[11px] text-muted-foreground">治理快照：{result.backupId}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
