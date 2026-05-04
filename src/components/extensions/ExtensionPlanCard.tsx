"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import {
  normalizePortableMcpMap,
  normalizePortableMcpValue,
} from '@/lib/mcp-config-placeholders';

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
};

type PlanMcpServer = NonNullable<ExtensionPlan['mcpServers']>[number];

function safeScriptName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildInstallMcpServer(name: string, server: PlanMcpServer) {
  const config = server.config || {};
  const type = config.type || 'stdio';
  const hasPythonScript = typeof server.scriptContent === 'string' && server.scriptContent.trim().length > 0;
  const command = hasPythonScript
    ? normalizePortableMcpValue(config.command || '[PYTHON_PATH]')
    : normalizePortableMcpValue(config.command || '');
  const args = (config.args || []).map((arg) => normalizePortableMcpValue(String(arg)));
  const normalizedArgs = hasPythonScript && args.length === 0
    ? [`[DATA_DIR]/mcp-scripts/${safeScriptName(name)}.py`]
    : args;

  return {
    command,
    args: normalizedArgs,
    env: normalizePortableMcpMap(config.env),
    type,
    runMode: config.runMode || 'on_demand',
    runtime: config.runtime || (hasPythonScript ? 'python' : 'auto'),
    url: normalizePortableMcpValue(config.url || ''),
    headers: normalizePortableMcpMap(config.headers),
    description: server.description || '',
  };
}

async function smokeTestMcpServer(name: string, server: ReturnType<typeof buildInstallMcpServer>): Promise<string | undefined> {
  if (server.type && server.type !== 'stdio') return undefined;
  try {
    const res = await fetch('/api/plugins/mcp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope: 'user', server }),
    });
    const body = await res.json().catch(() => ({}));
    if (body?.ok === false) {
      return `MCP self-test failed: ${body.error || 'unknown error'}`;
    }
  } catch (error) {
    return `MCP self-test failed: ${error instanceof Error ? error.message : 'unknown error'}`;
  }
  return undefined;
}

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const skills = useMemo(() => plan.skills || [], [plan.skills]);
  const mcps = useMemo(() => plan.mcpServers || [], [plan.mcpServers]);

  const skillCount = skills.length;
  const mcpCount = mcps.length;

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
        const payload = {
          name,
          content,
          description: skill.description || '',
        };
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          skillResults.push({ name, status: 'created' });
        } else if (res.status === 409) {
          const updateRes = await fetch('/api/skills', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (updateRes.ok) {
            skillResults.push({ name, status: 'updated' });
          } else {
            const body = await updateRes.json().catch(() => ({}));
            skillResults.push({ name, status: 'error', message: body.error || 'Failed to update skill' });
          }
        } else {
          const body = await res.json().catch(() => ({}));
          skillResults.push({ name, status: 'error', message: body.error || 'Failed to create skill' });
        }
      } catch (err) {
        skillResults.push({ name, status: 'error', message: err instanceof Error ? err.message : 'Failed to create skill' });
      }
    }

    // Initialize venv if any MCP needs Python packages or scripts
    const needsPython = mcps.some(s => s.scriptContent || (s.pythonPackages && s.pythonPackages.length > 0));
    if (needsPython) {
      await fetch('/api/python-runtime/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init' }),
      }).catch(() => {});
    }

    for (const server of mcps) {
      const name = String(server.name || '').trim();
      if (!name) {
        mcpResults.push({ name: t('extensions.builderUnnamedMcp'), status: 'invalid' });
        continue;
      }

      const installServer = buildInstallMcpServer(name, server);
      const type = installServer.type;
      const command = installServer.command;
      const url = installServer.url;

      // Validate transport type consistency
      if (type === 'stdio' && !command) {
        mcpResults.push({ name, status: 'invalid', message: t('extensions.builderMcpMissingCommand') });
        continue;
      }
      if ((type === 'sse' || type === 'http') && !url) {
        mcpResults.push({ name, status: 'invalid', message: t('extensions.builderMcpMissingUrl') });
        continue;
      }
      try {
        // Write Python script file if provided
        if (server.scriptContent) {
          const writeRes = await fetch('/api/python-runtime/packages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'write-script', name, content: server.scriptContent }),
          });
          if (!writeRes.ok) {
            const body = await writeRes.json().catch(() => ({}));
            mcpResults.push({ name, status: 'error', message: body.error || 'Failed to write script' });
            continue;
          }
        }

        // Install Python packages if specified
        let pkgFailed = false;
        if (server.pythonPackages && server.pythonPackages.length > 0) {
          for (const pkg of server.pythonPackages) {
            const pkgRes = await fetch('/api/python-runtime/packages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'install', package: pkg }),
            });
            if (!pkgRes.ok) {
              const body = await pkgRes.json().catch(() => ({}));
              mcpResults.push({ name, status: 'error', message: `Failed to install ${pkg}: ${body.error || 'unknown'}` });
              pkgFailed = true;
              break;
            }
          }
        }
        if (pkgFailed) continue;

        const res = await fetch('/api/plugins/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            server: installServer,
          }),
        });
        if (res.ok) {
          const message = await smokeTestMcpServer(name, installServer);
          mcpResults.push({ name, status: 'created', ...(message ? { message } : {}) });
        } else if (res.status === 409) {
          const updateRes = await fetch('/api/plugins/mcp', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              server: installServer,
            }),
          });
          if (updateRes.ok) {
            const message = await smokeTestMcpServer(name, installServer);
            mcpResults.push({ name, status: 'updated', ...(message ? { message } : {}) });
          } else {
            const body = await updateRes.json().catch(() => ({}));
            mcpResults.push({ name, status: 'error', message: body.error || 'Failed to update MCP server' });
          }
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
                        <li key={`skill-${idx}`}>
                          {item.name}: {getStatusLabel(item)}
                          {getResultMessage(item) ? ` (${getResultMessage(item)})` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.mcps.length > 0 && (
                  <div>
                    <div className="font-medium text-muted-foreground">{t('extensions.builderResultMcps')}</div>
                    <ul className="list-disc pl-4">
                      {result.mcps.map((item, idx) => (
                        <li key={`mcp-${idx}`}>
                          {item.name}: {getStatusLabel(item)}
                          {getResultMessage(item) ? ` (${getResultMessage(item)})` : ''}
                        </li>
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
