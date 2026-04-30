"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading, CheckmarkCircle02Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { SchemaForm } from "./schema-form";
import type { IMProviderManifest } from "@/lib/im";

interface ProviderState {
  manifest: IMProviderManifest;
  configured: boolean;
  enabled: boolean;
  isDefault: boolean;
}

interface ImProviderCardProps {
  state: ProviderState;
  onChanged: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ProbeStatus = "idle" | "probing" | "ok" | "error";

export function ImProviderCard({ state, onChanged }: ImProviderCardProps) {
  const { manifest, configured, enabled } = state;

  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("idle");
  const [probeMsg, setProbeMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/im/config/${manifest.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "load failed");
      setValues(data.config ?? {});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [manifest.id]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/im/config/${manifest.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setSaveStatus("saved");
      onChanged();
    } catch (err) {
      setSaveStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "save failed");
    }
  }, [manifest.id, values, onChanged]);

  const handleEnabledChange = useCallback(
    async (checked: boolean) => {
      setErrorMsg("");
      try {
        const res = await fetch(`/api/im/enable/${manifest.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: checked }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "toggle failed");
        }
        onChanged();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "toggle failed");
      }
    },
    [manifest.id, onChanged],
  );

  const handleProbe = useCallback(async () => {
    setProbeStatus("probing");
    setProbeMsg("");
    try {
      const res = await fetch(`/api/im/probe/${manifest.id}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setProbeStatus("ok");
        setProbeMsg(`OK${data.latencyMs != null ? ` (${data.latencyMs}ms)` : ""}`);
      } else {
        setProbeStatus("error");
        setProbeMsg(data.error || "probe failed");
      }
    } catch (err) {
      setProbeStatus("error");
      setProbeMsg(err instanceof Error ? err.message : "probe failed");
    }
  }, [manifest.id]);

  return (
    <div className="rounded-lg border border-border/50 p-5 transition-shadow hover:shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-medium">{manifest.label}</h3>
            <ConfigStatusBadge configured={configured} enabled={enabled} />
          </div>
          <p className="text-xs text-muted-foreground">{manifest.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">启用</span>
          <Switch
            checked={enabled}
            onCheckedChange={handleEnabledChange}
            disabled={!configured}
            aria-label="enable provider"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin" />
          加载配置中…
        </div>
      ) : (
        <SchemaForm
          fields={manifest.configSchema}
          values={values}
          onChange={handleFieldChange}
          disabled={saveStatus === "saving"}
        />
      )}

      {errorMsg && (
        <p className="mt-3 text-sm text-destructive">{errorMsg}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={handleSave} disabled={saveStatus === "saving" || loading} size="sm">
          {saveStatus === "saving" ? "保存中…" : saveStatus === "saved" ? "已保存" : "保存配置"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleProbe}
          disabled={probeStatus === "probing" || !configured}
        >
          {probeStatus === "probing" ? "测试中…" : "测试连接"}
        </Button>
        {probeStatus !== "idle" && probeStatus !== "probing" && (
          <span
            className={
              probeStatus === "ok"
                ? "flex items-center gap-1 text-xs text-green-600"
                : "flex items-center gap-1 text-xs text-destructive"
            }
          >
            <HugeiconsIcon
              icon={probeStatus === "ok" ? CheckmarkCircle02Icon : AlertCircleIcon}
              className="h-3.5 w-3.5"
            />
            {probeMsg}
          </span>
        )}
        {manifest.docsUrl && (
          <a
            href={manifest.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            开放平台文档 →
          </a>
        )}
      </div>
    </div>
  );
}

function ConfigStatusBadge({ configured, enabled }: { configured: boolean; enabled: boolean }) {
  if (!configured) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        未配置
      </span>
    );
  }
  if (!enabled) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        已配置 / 未启用
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
      已启用
    </span>
  );
}
