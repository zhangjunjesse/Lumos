"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BrowserIcon } from "@hugeicons/core-free-icons";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Toast } from "@/components/ui/toast";
import type { BrowserProviderConfigView, BrowserProvidersResponse } from "@/types";

interface BrowserContextSelectorProps {
  sessionId: string;
  value: string;
  disabled?: boolean;
  onChange: (contextId: string) => void;
}

interface BrowserContextOption {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
}

function getConfigLabel(config: BrowserProviderConfigView): string {
  const prefix = config.provider_type === "adspower" ? "AdsPower" : "CDP";
  return `${prefix} · ${config.display_name}`;
}

function toConfigOption(config: BrowserProviderConfigView): BrowserContextOption {
  return {
    id: config.context_id,
    label: getConfigLabel(config),
    description: config.provider_type === "adspower"
      ? `Profile: ${config.profile_id || "未填写"}`
      : config.cdp_endpoint || "未填写 CDP 地址",
    disabled: config.enabled !== 1,
  };
}

export function BrowserContextSelector({
  sessionId,
  value,
  disabled = false,
  onChange,
}: BrowserContextSelectorProps) {
  const [configs, setConfigs] = useState<BrowserProviderConfigView[]>([]);
  const [localChrome, setLocalChrome] = useState<BrowserProvidersResponse["local_chrome_context"]>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadContexts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/browser-providers", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json() as BrowserProvidersResponse;
      setConfigs(payload.configs || []);
      setLocalChrome(payload.local_chrome_context ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContexts();
  }, [loadContexts]);

  const options = useMemo(() => {
    const base: BrowserContextOption[] = [{
      id: "embedded:default",
      label: "内置浏览器",
      description: "Lumos 内置浏览器登录态",
    }];
    if (localChrome) {
      base.push({
        id: localChrome.id,
        label: localChrome.display_name,
        description: "用你电脑上的 Chrome，反爬更稳",
      });
    }
    for (const config of configs) {
      base.push(toConfigOption(config));
    }
    if (value && !base.some((option) => option.id === value)) {
      base.push({
        id: value,
        label: "未知浏览器上下文",
        description: value,
        disabled: true,
      });
    }
    return base;
  }, [configs, value, localChrome]);

  const selected = options.find((option) => option.id === value) || options[0];

  const handleChange = useCallback(async (nextContextId: string) => {
    if (!nextContextId || nextContextId === value || saving) {
      return;
    }
    const nextOption = options.find((option) => option.id === nextContextId);
    if (nextOption?.disabled) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser_context_id: nextContextId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "浏览器上下文切换失败");
      }
      onChange(nextContextId);
      setNotice({ type: "success", message: `已切换到 ${nextOption?.label || nextContextId}` });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "浏览器上下文切换失败",
      });
    } finally {
      setSaving(false);
    }
  }, [onChange, options, saving, sessionId, value]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1">
            <HugeiconsIcon icon={BrowserIcon} className="h-3.5 w-3.5 text-muted-foreground" />
            <Select
              value={selected?.id || "embedded:default"}
              onValueChange={(next) => void handleChange(next)}
              disabled={disabled || loading || saving}
            >
              <SelectTrigger
                size="sm"
                className="h-7 max-w-48 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:bg-muted"
                style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
              >
                <SelectValue placeholder="浏览器" />
              </SelectTrigger>
              <SelectContent align="center">
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id} disabled={option.disabled}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{selected?.label || "内置浏览器"}</p>
          <p className="mt-0.5 max-w-72 break-all text-[10px] text-muted-foreground">
            {selected?.description || value}
          </p>
          {disabled ? (
            <p className="mt-1 text-[10px] text-muted-foreground">回复中暂时不能切换。</p>
          ) : null}
        </TooltipContent>
      </Tooltip>

      {notice ? (
        <Toast
          type={notice.type}
          message={notice.message}
          duration={2400}
          onClose={() => setNotice(null)}
        />
      ) : null}
    </>
  );
}
