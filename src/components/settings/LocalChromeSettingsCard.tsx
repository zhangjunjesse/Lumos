"use client";

import * as React from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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

export function LocalChromeSettingsCard(): React.ReactElement {
  const [state, setState] = React.useState<LocalChromeResponse | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    void fetch(API, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<LocalChromeResponse>) : null))
      .then((data) => data && setState(data))
      .catch(() => setState(null));
  }, []);

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载本地 Chrome 设置…
      </div>
    );
  }

  const { settings } = state;
  const patch = (p: Partial<LocalChromeSettings>) => {
    setState({ ...state, settings: { ...settings, ...p } });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setState(await res.json());
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">本地 Chrome</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          用你电脑上装的 Google Chrome 跑自动化。是真实浏览器、真实网络，比内置浏览器更不容易被亚马逊等站点风控。
        </p>
      </div>

      {state.chrome_detected ? (
        <p className="text-xs text-muted-foreground">
          已检测到 Chrome：<span className="font-mono">{state.chrome_path}</span>
        </p>
      ) : (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>未检测到本地 Google Chrome。请先安装 Chrome，安装后此选项才会出现在浏览器选择里。</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <Label>启用本地 Chrome</Label>
          <p className="text-xs text-muted-foreground">关闭后，浏览器选择里不再出现「本地 Chrome」。</p>
        </div>
        <Switch checked={settings.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
      </div>

      <div className="space-y-1.5">
        <Label>配置文件（profile）</Label>
        <Select value={settings.profileMode} onValueChange={(v) => patch({ profileMode: v as "default" | "dedicated" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">默认 profile（用你日常 Chrome 的登录态）</SelectItem>
            <SelectItem value="dedicated">Lumos 专用 profile（独立、不干扰日常 Chrome）</SelectItem>
          </SelectContent>
        </Select>
        {settings.profileMode === "default" ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            注意：默认 profile 需要你的 Chrome 当时是<b>关闭</b>的——Chrome 正开着时无法被接管调试。若提示接管失败，请先完全退出 Chrome，或改用专用 profile。
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">专用 profile 永远可用；在里面登录一次亚马逊会一直记住。</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>可见窗口</Label>
          <p className="text-xs text-muted-foreground">开：弹真实 Chrome 窗口，可手动登录/过验证码，反爬最稳。关：后台无头，更容易被识别为机器人。</p>
        </div>
        <Switch checked={!settings.headless} onCheckedChange={(v) => patch({ headless: !v })} />
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : "保存"}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <Check className="size-3.5" /> 已保存
          </span>
        )}
      </div>
    </div>
  );
}
