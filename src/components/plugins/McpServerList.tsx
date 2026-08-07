'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete, Pencil, ServerStack01Icon, Wifi, Globe, Loading } from "@hugeicons/core-free-icons";
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { MCPServer } from '@/types';
import type { McpTestState } from '@/components/plugins/McpManager';
import { McpAuthButton } from '@/components/plugins/McpAuthButton';

interface McpServerListProps {
  servers: Record<string, MCPServer & { scope?: string; is_enabled?: boolean }>;
  testResults?: Record<string, McpTestState>;
  onEdit: (name: string, server: MCPServer) => void;
  onDelete: (name: string) => void;
  onToggle: (name: string, scope: string, enabled: boolean) => void;
  onTest: (name: string, server: MCPServer) => void;
  /** 授权状态变化后重新拉列表(授权/撤销都会触发)。 */
  onAuthChanged: () => void;
}

function getServerTypeInfo(server: MCPServer) {
  const type = server.type || 'stdio';
  switch (type) {
    case 'sse':
      return { label: 'SSE', icon: Wifi, color: 'text-blue-500' };
    case 'http':
      return { label: 'HTTP', icon: Globe, color: 'text-green-500' };
    default:
      return { label: 'stdio', icon: ServerStack01Icon, color: 'text-muted-foreground' };
  }
}

function getRuntimeLabel(server: MCPServer, t: ReturnType<typeof useTranslation>['t']) {
  switch (server.runtime || 'auto') {
    case 'node':
      return 'Node';
    case 'python':
      return 'Python';
    case 'bun':
      return 'Bun';
    case 'custom':
      return t('mcp.runtimeCustom');
    case 'auto':
    default:
      return t('mcp.runtimeAuto');
  }
}

function renderTestBadge(result: McpTestState | undefined, t: ReturnType<typeof useTranslation>['t']) {
  if (!result) {
    return (
      <Badge variant="outline" className="gap-1 text-xs shrink-0">
        {t('mcp.statusNotChecked')}
      </Badge>
    );
  }

  if (result.status === 'checking') {
    return (
      <Badge variant="outline" className="gap-1 text-xs shrink-0">
        <HugeiconsIcon icon={Loading} className="h-3 w-3 animate-spin" />
        {t('mcp.statusChecking')}
      </Badge>
    );
  }

  if (result.status === 'ok') {
    return (
      <Badge variant="secondary" className="gap-1 text-xs shrink-0 text-green-700 dark:text-green-300">
        <CheckCircle2 className="h-3 w-3" />
        {t('mcp.statusOk')}
      </Badge>
    );
  }

  if (result.status === 'skipped') {
    return (
      <Badge variant="outline" className="gap-1 text-xs shrink-0">
        {t('mcp.statusSkipped')}
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className="gap-1 text-xs shrink-0">
      <AlertCircle className="h-3 w-3" />
      {t('mcp.statusFailed')}
    </Badge>
  );
}

function formatCheckedAt(value: string | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function McpServerList({ servers, testResults = {}, onEdit, onDelete, onToggle, onTest, onAuthChanged }: McpServerListProps) {
  const { t } = useTranslation();
  const entries = Object.entries(servers);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <HugeiconsIcon icon={ServerStack01Icon} className="h-10 w-10 mb-3 opacity-50" />
        <p className="text-sm">{t('mcp.noServers')}</p>
        <p className="text-xs mt-1">
          {t('mcp.noServersDesc')}
        </p>
      </div>
    );
  }

  // Group servers by scope
  const builtinServers = entries.filter(([, server]) => server.scope === 'builtin');
  const userServers = entries.filter(([, server]) => server.scope === 'user');

  const renderServerCard = (name: string, server: MCPServer & { scope?: string; is_enabled?: boolean }) => {
    const typeInfo = getServerTypeInfo(server);
    const isBuiltin = server.scope === 'builtin';
    const isEnabled = server.is_enabled !== false;
    const testResult = testResults[name];

    return (
      <Card key={name} className={!isEnabled ? 'opacity-60' : ''}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center gap-2 mb-1">
              <HugeiconsIcon icon={typeInfo.icon} className={`h-4 w-4 shrink-0 ${typeInfo.color}`} />
              <CardTitle className="text-sm font-medium">{name}</CardTitle>
              <Badge variant="outline" className="text-xs shrink-0">
                {typeInfo.label}
              </Badge>
              {isBuiltin && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  Built-in
                </Badge>
              )}
              <Badge variant="outline" className="text-xs shrink-0">
                {getRuntimeLabel(server, t)}
              </Badge>
              <Badge
                variant={server.runMode === 'keep_alive' ? 'secondary' : 'outline'}
                className="text-xs shrink-0"
              >
                {server.runMode === 'keep_alive' ? t('mcp.runModeKeepAlive') : t('mcp.runModeOnDemand')}
              </Badge>
              {renderTestBadge(testResult, t)}
            </div>
            {server.description && (
              <CardDescription className="text-xs mt-1">
                {server.description}
              </CardDescription>
            )}
            <CardDescription className="text-xs mt-1 font-mono">
              {server.url
                ? server.url
                : `${server.command} ${server.args?.join(' ') || ''}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => onToggle(name, server.scope || 'user', checked)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onTest(name, server)}
              disabled={testResult?.status === 'checking'}
              title={t('mcp.testServer')}
            >
              {testResult?.status === 'checking' ? (
                <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
            {isBuiltin ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(name, server)}
                >
                  <HugeiconsIcon icon={Pencil} className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(name, server)}
                >
                  <HugeiconsIcon icon={Pencil} className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(name)}
                >
                  <HugeiconsIcon icon={Delete} className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        {server.id && server.authStatus && server.authStatus.state !== 'not-required' && (
          <CardContent className="pt-0 pb-2 flex justify-end">
            <McpAuthButton
              serverId={server.id}
              status={server.authStatus}
              onChanged={onAuthChanged}
            />
          </CardContent>
        )}
        {testResult && testResult.status !== 'checking' && (
          <CardContent className="pt-0 pb-2">
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div>
                {testResult.status === 'ok'
                  ? (testResult.message || t('mcp.testOkDetail', { n: testResult.tools?.length || 0 }))
                  : testResult.status === 'skipped'
                    ? (testResult.message || t('mcp.testSkippedDetail'))
                    : (testResult.message || t('mcp.testFailed'))}
              </div>
              {testResult.checkedAt && (
                <div className="mt-1 text-[11px] opacity-80">
                  {t('mcp.lastCheckedAt', { time: formatCheckedAt(testResult.checkedAt) })}
                </div>
              )}
            </div>
          </CardContent>
        )}
        {(server.env && Object.keys(server.env).length > 0) ||
        (server.args && server.args.length > 0) ? (
          <CardContent className="pt-0">
            {server.args && server.args.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-muted-foreground mb-1">{t('mcp.arguments')}</p>
                <div className="flex gap-1 flex-wrap">
                  {server.args.map((arg, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-mono">
                      {arg}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {server.env && Object.keys(server.env).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('mcp.environment')}</p>
                <div className="flex gap-1 flex-wrap">
                  {Object.keys(server.env).map((key) => (
                    <Badge key={key} variant="outline" className="text-xs font-mono">
                      {key}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        ) : null}
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {builtinServers.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">Built-in Servers</h4>
          <div className="space-y-3">
            {builtinServers.map(([name, server]) => renderServerCard(name, server))}
          </div>
        </div>
      )}

      {userServers.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">User Servers</h4>
          <div className="space-y-3">
            {userServers.map(([name, server]) => renderServerCard(name, server))}
          </div>
        </div>
      )}
    </div>
  );
}
