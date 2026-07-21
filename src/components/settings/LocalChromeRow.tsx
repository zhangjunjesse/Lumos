"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface LocalChromeSettings {
  enabled: boolean;
  profileMode: "default" | "dedicated";
  headless: boolean;
  chromePath?: string;
}

interface LocalChromeResponse {
  settings: LocalChromeSettings;
  chrome_detected: boolean;
  chrome_path: string | null;
}

const API = "/api/browser-providers/local-chrome";

// 与「浏览器接入」卡里内置浏览器/第三方浏览器同款的行样式;本地 Chrome 本就是一个浏览器上下文。
export function LocalChromeRow(): React.ReactElement | null {
  const [data, setData] = React.useState<LocalChromeResponse | null>(null);

  React.useEffect(() => {
    void fetch(API, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<LocalChromeResponse>) : null))
      .then((d) => d && setData(d))
      .catch(() => undefined);
  }, []);

  if (!data) return null;

  const { settings, chrome_detected: detected, chrome_path: chromePath } = data;
  const active = settings.enabled && detected;

  const persist = (patch: Partial<LocalChromeSettings>) => {
    const nextSettings = { ...settings, ...patch };
    setData({ ...data, settings: nextSettings });
    void fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextSettings),
    })
      .then((r) => (r.ok ? (r.json() as Promise<LocalChromeResponse>) : null))
      .then((d) => d && setData(d))
      .catch(() => undefined);
  };

  return (
    <div className="rounded-lg border border-border/50 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className={cn("mt-1.5 size-2 rounded-full", active ? "bg-primary" : "bg-muted-foreground/40")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">本地 Chrome</p>
            <Badge variant="outline" className="text-[10px]">本地</Badge>
            {!detected && <span className="text-[10px] text-muted-foreground">未检测到 Chrome</span>}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Context: local-chrome:default · {detected ? "用你电脑上的 Chrome 跑，反爬更稳" : "安装 Chrome 后此选项才可用"}
          </p>

          {settings.enabled && detected && (
            <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium">配置文件</p>
                  <p className="text-[11px] text-muted-foreground">
                    {settings.profileMode === "default"
                      ? "默认 profile：跑之前需彻底退出 Chrome（含后台），否则接管失败"
                      : "专用 profile：独立稳定，在里面登录一次即长期保留"}
                  </p>
                </div>
                <Select value={settings.profileMode} onValueChange={(v) => persist({ profileMode: v as "default" | "dedicated" })}>
                  <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dedicated">Lumos 专用 profile（推荐）</SelectItem>
                    <SelectItem value="default">默认 profile（需先关 Chrome）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium">可见窗口</p>
                  <p className="text-[11px] text-muted-foreground">关闭为后台无头，更易被站点识别为机器人</p>
                </div>
                <Switch checked={!settings.headless} onCheckedChange={(v) => persist({ headless: !v })} />
              </div>
            </div>
          )}

          {settings.enabled && detected && chromePath && (
            <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground/70">{chromePath}</p>
          )}
        </div>

        <Switch checked={settings.enabled} onCheckedChange={(v) => persist({ enabled: v })} />
      </div>
    </div>
  );
}
