"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add, ListVideo, Code, Loading } from "@hugeicons/core-free-icons";
import { RefreshCw } from "lucide-react";
import { McpServerList } from "@/components/plugins/McpServerList";
import { McpServerEditor } from "@/components/plugins/McpServerEditor";
import { ConfigEditor } from "@/components/plugins/ConfigEditor";
import { useTranslation } from "@/hooks/useTranslation";
import type { MCPServer } from "@/types";

interface McpManagerProps {
  refreshKey?: number;
}

export type McpTestState = {
  status: "checking" | "ok" | "failed" | "skipped";
  message?: string;
  tools?: string[];
  checkedAt?: string;
};

function healthToTestState(server: MCPServer): McpTestState | undefined {
  const health = server.health;
  if (!health || health.status === 'unknown') return undefined;
  return {
    status: health.status,
    message: health.status === 'failed'
      ? (health.error || health.message)
      : health.message,
    tools: health.tools || [],
    checkedAt: health.checkedAt,
  };
}

export function McpManager({ refreshKey = 0 }: McpManagerProps) {
  const { t } = useTranslation();
  const [servers, setServers] = useState<Record<string, MCPServer & { scope?: string; is_enabled?: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [checkingAll, setCheckingAll] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, McpTestState>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | undefined>();
  const [editingServer, setEditingServer] = useState<MCPServer | undefined>();
  const [tab, setTab] = useState<"list" | "json">("list");
  const [error, setError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/plugins/mcp");
      const data = await res.json();
      if (data.mcpServers) {
        setServers(data.mcpServers);
        const persistedResults = Object.fromEntries(
          Object.entries(data.mcpServers as Record<string, MCPServer>)
            .map(([name, server]) => [name, healthToTestState(server)] as const)
            .filter((entry): entry is readonly [string, McpTestState] => Boolean(entry[1])),
        );
        setTestResults(prev => {
          const checking = Object.fromEntries(
            Object.entries(prev).filter(([, result]) => result.status === 'checking'),
          );
          return { ...persistedResults, ...checking };
        });
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      console.error("Failed to fetch MCP servers:", err);
      setError("Failed to connect to API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers, refreshKey]);

  function handleEdit(name: string, server: MCPServer) {
    setEditingName(name);
    setEditingServer(server);
    setEditorOpen(true);
  }

  function handleAdd() {
    setEditingName(undefined);
    setEditingServer(undefined);
    setEditorOpen(true);
  }

  async function handleToggle(name: string, scope: string, enabled: boolean) {
    try {
      await fetch("/api/plugins/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope, is_enabled: enabled }),
      });
      setServers(prev => ({
        ...prev,
        [name]: { ...prev[name], is_enabled: enabled },
      }));
    } catch (err) {
      console.error("Failed to toggle MCP server:", err);
    }
  }

  async function handleDelete(name: string) {
    try {
      const res = await fetch(`/api/plugins/mcp/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchServers();
      } else {
        const data = await res.json();
        console.error("Failed to delete MCP server:", data.error);
      }
    } catch (err) {
      console.error("Failed to delete MCP server:", err);
    }
  }

  async function testMcpServer(name: string, server: MCPServer) {
    setTestResults(prev => ({
      ...prev,
      [name]: { status: "checking" },
    }));

    try {
      const res = await fetch("/api/plugins/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope: server.scope || 'user', server }),
      });
      const data = await res.json().catch(() => ({}));
      const checkedAt = new Date().toISOString();
      if (data?.ok === true) {
        setTestResults(prev => ({
          ...prev,
          [name]: {
            status: data.skipped ? "skipped" : "ok",
            message: data.reason,
            tools: Array.isArray(data.tools) ? data.tools : [],
            checkedAt,
          },
        }));
      } else {
        setTestResults(prev => ({
          ...prev,
          [name]: {
            status: "failed",
            message: data?.error || t("mcp.testFailed"),
            checkedAt,
          },
        }));
      }
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [name]: {
          status: "failed",
          message: err instanceof Error ? err.message : t("mcp.testFailed"),
          checkedAt: new Date().toISOString(),
        },
      }));
    }
  }

  async function handleTestAll() {
    setCheckingAll(true);
    try {
      for (const [name, server] of Object.entries(servers)) {
        if (server.is_enabled === false) continue;
        await testMcpServer(name, server);
      }
    } finally {
      setCheckingAll(false);
    }
  }

  async function handleSave(name: string, server: MCPServer) {
    if (editingName && editingName !== name) {
      // Rename: delete old and create new
      try {
        const deleteRes = await fetch(`/api/plugins/mcp/${encodeURIComponent(editingName)}`, {
          method: "DELETE",
        });
        if (!deleteRes.ok) {
          const data = await deleteRes.json().catch(() => ({}));
          setError(data.error || "Failed to delete old MCP server");
          return;
        }
        const createRes = await fetch("/api/plugins/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, server }),
        });
        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          setError(data.error || "Failed to rename MCP server");
          await fetchServers();
          return;
        }
        await fetchServers();
        await testMcpServer(name, server);
      } catch (err) {
        console.error("Failed to rename MCP server:", err);
      }
    } else if (editingName) {
      // Update existing
      try {
        const res = await fetch("/api/plugins/mcp", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, server }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to update MCP server");
          return;
        }
        await fetchServers();
        await testMcpServer(name, server);
      } catch (err) {
        console.error("Failed to update MCP server:", err);
      }
    } else {
      // Create new
      try {
        const res = await fetch("/api/plugins/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, server }),
        });
        if (res.ok) {
          await fetchServers();
          await testMcpServer(name, server);
        } else if (res.status === 409) {
          const updateRes = await fetch("/api/plugins/mcp", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, server }),
          });
          if (updateRes.ok) {
            await fetchServers();
            await testMcpServer(name, server);
          } else {
            const data = await updateRes.json();
            console.error("Failed to update MCP server:", data.error);
          }
        } else {
          const data = await res.json();
          console.error("Failed to add MCP server:", data.error);
        }
      } catch (err) {
        console.error("Failed to add MCP server:", err);
      }
    }
  }

  async function handleJsonSave(jsonStr: string) {
    try {
      JSON.parse(jsonStr);
      // JSON save is not supported in the new architecture
      console.error("JSON save is not supported");
    } catch (err) {
      console.error("Failed to save MCP config:", err);
    }
  }

  const serverCount = Object.keys(servers).length;

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{t('extensions.mcpServers')}</h3>
            {serverCount > 0 && (
              <span className="text-sm text-muted-foreground">
                ({serverCount})
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure Model Context Protocol servers for Claude
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={handleTestAll}
            disabled={checkingAll || loading || serverCount === 0}
          >
            {checkingAll ? (
              <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t('mcp.testAll')}
          </Button>
          <Button size="sm" className="gap-1" onClick={handleAdd}>
            <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
            {t('mcp.addServer')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 mb-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "json")}>
        <TabsList>
          <TabsTrigger value="list" className="gap-1.5">
            <HugeiconsIcon icon={ListVideo} className="h-3.5 w-3.5" />
            {t('mcp.listTab')}
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1.5">
            <HugeiconsIcon icon={Code} className="h-3.5 w-3.5" />
            {t('mcp.jsonTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin" />
              <p className="text-sm">{t('mcp.loadingServers')}</p>
            </div>
          ) : (
            <McpServerList
              servers={servers}
              testResults={testResults}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onTest={testMcpServer}
              onAuthChanged={fetchServers}
            />
          )}
        </TabsContent>

        <TabsContent value="json" className="mt-4">
          <ConfigEditor
            value={JSON.stringify(servers, null, 2)}
            onSave={handleJsonSave}
            label={t('mcp.serverConfig')}
          />
        </TabsContent>
      </Tabs>

      <McpServerEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        name={editingName}
        server={editingServer}
        onSave={handleSave}
      />
    </div>
  );
}
