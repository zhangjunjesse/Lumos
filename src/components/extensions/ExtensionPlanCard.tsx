"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    };
  }>;
};

type ApplyResult = {
  skills: Array<{ name: string; status: 'created' | 'exists' | 'error' | 'invalid'; message?: string }>;
  mcps: Array<{ name: string; status: 'created' | 'exists' | 'error' | 'invalid'; message?: string }>;
};

export function ExtensionPlanCard({ plan }: { plan: ExtensionPlan }) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const skills = useMemo(() => plan.skills || [], [plan.skills]);
  const mcps = useMemo(() => plan.mcpServers || [], [plan.mcpServers]);

  const skillCount = skills.length;
  const mcpCount = mcps.length;

  const applyPlan = async () => {
    if (applying) return;
    setApplying(true);
    const skillResults: ApplyResult['skills'] = [];
    const mcpResults: ApplyResult['mcps'] = [];

    for (const skill of skills) {
      const name = String(skill.name || '').trim();
      const content = typeof skill.content === 'string' ? skill.content : '';
      if (!name || !content) {
        skillResults.push({ name: name || t('extensions.builderUnnamedSkill'), status: 'invalid' });
        continue;
      }
      try {
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            content,
            description: skill.description || '',
          }),
        });
        if (res.ok) {
          skillResults.push({ name, status: 'created' });
        } else if (res.status === 409) {
          skillResults.push({ name, status: 'exists' });
        } else {
          const body = await res.json().catch(() => ({}));
          skillResults.push({ name, status: 'error', message: body.error || 'Failed to create skill' });
        }
      } catch (err) {
        skillResults.push({ name, status: 'error', message: err instanceof Error ? err.message : 'Failed to create skill' });
      }
    }

    for (const server of mcps) {
      const name = String(server.name || '').trim();
      const config = server.config || {};
      if (!name) {
        mcpResults.push({ name: t('extensions.builderUnnamedMcp'), status: 'invalid' });
        continue;
      }

      const type = config.type || 'stdio';
      const command = config.command || '';
      const url = config.url || '';

      if (type === 'stdio' && !command) {
        mcpResults.push({ name, status: 'invalid', message: t('extensions.builderMcpMissingCommand') });
        continue;
      }
      if ((type === 'sse' || type === 'http') && !url) {
        mcpResults.push({ name, status: 'invalid', message: t('extensions.builderMcpMissingUrl') });
        continue;
      }

      try {
        const res = await fetch('/api/plugins/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            server: {
              command,
              args: config.args || [],
              env: config.env || {},
              type,
              url,
              headers: config.headers || {},
              description: server.description || '',
            },
          }),
        });
        if (res.ok) {
          mcpResults.push({ name, status: 'created' });
        } else if (res.status === 409) {
          mcpResults.push({ name, status: 'exists' });
        } else {
          const body = await res.json().catch(() => ({}));
          mcpResults.push({ name, status: 'error', message: body.error || 'Failed to create MCP server' });
        }
      } catch (err) {
        mcpResults.push({ name, status: 'error', message: err instanceof Error ? err.message : 'Failed to create MCP server' });
      }
    }

    if (skillResults.length > 0) {
      await fetch('/api/skills/sync', { method: 'POST' }).catch(() => {});
    }

    window.dispatchEvent(new CustomEvent('extensions-updated'));
    setResult({ skills: skillResults, mcps: mcpResults });
    setApplying(false);
  };

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
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {t('extensions.builderApplyPlan')}
        </Button>
        {result && (
          <div className="text-xs text-muted-foreground">
            {t('extensions.builderApplyDone')}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('extensions.builderApplyConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t('extensions.builderApplyConfirmDesc')}</p>
            {skillCount > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">{t('extensions.builderPlanSkills', { n: skillCount })}</div>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill, idx) => (
                    <Badge key={`${skill.name || 'skill'}-${idx}`} variant="outline">{skill.name || t('extensions.builderUnnamedSkill')}</Badge>
                  ))}
                </div>
              </div>
            )}
            {mcpCount > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">{t('extensions.builderPlanMcps', { n: mcpCount })}</div>
                <div className="flex flex-wrap gap-1.5">
                  {mcps.map((server, idx) => (
                    <Badge key={`${server.name || 'mcp'}-${idx}`} variant="outline">{server.name || t('extensions.builderUnnamedMcp')}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result && (
              <div className="space-y-2 text-xs">
                {result.skills.length > 0 && (
                  <div>
                    <div className="font-medium text-muted-foreground">{t('extensions.builderResultSkills')}</div>
                    <ul className="list-disc pl-4">
                      {result.skills.map((item, idx) => (
                        <li key={`skill-${idx}`}>{item.name}: {item.status}{item.message ? ` (${item.message})` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.mcps.length > 0 && (
                  <div>
                    <div className="font-medium text-muted-foreground">{t('extensions.builderResultMcps')}</div>
                    <ul className="list-disc pl-4">
                      {result.mcps.map((item, idx) => (
                        <li key={`mcp-${idx}`}>{item.name}: {item.status}{item.message ? ` (${item.message})` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={applying}>
              {t('common.cancel')}
            </Button>
            <Button onClick={applyPlan} disabled={applying}>
              {applying ? t('extensions.builderApplying') : t('extensions.builderApplyAndSync')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
