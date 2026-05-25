"use client";

import { useState, useCallback, useEffect, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BuiltinAppsSection } from "./BuiltinAppsSection";
import { CheckCircle2, ChevronDown, RefreshCw, Router, ShieldOff, SquareTerminal, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Reload, Loading } from "@hugeicons/core-free-icons";
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openExternalUrl } from "@/lib/open-external";

type ProxyMode = "system" | "off" | "custom";

type ProxyTestMessage = {
  ok: boolean;
  title: string;
  detail: string;
};

const DEFAULT_LOCAL_PROXY = "http://127.0.0.1:7897";
const DEFAULT_NO_PROXY = "127.0.0.1,localhost,::1";

function ProxyModeOption({
  active,
  badge,
  description,
  icon: Icon,
  onClick,
  title,
}: {
  active: boolean;
  badge?: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[88px] rounded-md border px-3 py-2.5 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
        <span className="text-sm font-medium">{title}</span>
        {badge && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {badge}
          </span>
        )}
        {active && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-primary" />}
      </div>
      <div className="mt-1 pl-6 text-xs leading-5 text-muted-foreground">{description}</div>
    </button>
  );
}

function UpdateCard() {
  const { updateInfo, checking, checkForUpdates, downloadUpdate, quitAndInstall, setShowDialog } = useUpdate();
  const { t } = useTranslation();
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

  const isDownloading = updateInfo?.isNativeUpdate && !updateInfo.readyToInstall
    && updateInfo.downloadProgress != null;

  return (
    <div className="rounded-lg border border-border/50 p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">{t('settings.codepilot')}</h2>
          <p className="text-xs text-muted-foreground">{t('settings.version', { version: currentVersion })}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Show install/restart button when update available */}
          {updateInfo?.updateAvailable && !checking && (
            updateInfo.readyToInstall ? (
              <Button size="sm" onClick={quitAndInstall}>
                {t('update.restartToUpdate')}
              </Button>
            ) : updateInfo.isNativeUpdate && !isDownloading ? (
              <Button size="sm" onClick={downloadUpdate}>
                {t('update.installUpdate')}
              </Button>
            ) : !updateInfo.isNativeUpdate ? (
              <Button size="sm" variant="outline" onClick={() => void openExternalUrl(updateInfo.releaseUrl)}>
                {t('settings.viewRelease')}
              </Button>
            ) : null
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={checkForUpdates}
            disabled={checking}
            className="gap-2"
          >
            {checking ? (
              <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <HugeiconsIcon icon={Reload} className="h-3.5 w-3.5" />
            )}
            {checking ? t('settings.checking') : t('settings.checkForUpdates')}
          </Button>
        </div>
      </div>

      {updateInfo && !checking && (
        <div className="mt-3">
          {updateInfo.updateAvailable ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${updateInfo.readyToInstall ? 'bg-green-500' : isDownloading ? 'bg-yellow-500 animate-pulse' : 'bg-blue-500'}`} />
                <span className="text-sm">
                  {updateInfo.readyToInstall
                    ? t('update.readyToInstall', { version: updateInfo.latestVersion })
                    : isDownloading
                      ? `${t('update.downloading')} ${Math.round(updateInfo.downloadProgress!)}%`
                      : t('settings.updateAvailable', { version: updateInfo.latestVersion })}
                </span>
                {updateInfo.releaseNotes && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs text-muted-foreground"
                    onClick={() => setShowDialog(true)}
                  >
                    {t('gallery.viewDetails')}
                  </Button>
                )}
              </div>
              {/* Download progress bar */}
              {isDownloading && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(updateInfo.downloadProgress!, 100)}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings.latestVersion')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function GeneralSection() {
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyHttp, setProxyHttp] = useState("");
  const [proxyHttps, setProxyHttps] = useState("");
  const [proxyNoProxy, setProxyNoProxy] = useState("");
  const [proxyAdvancedOpen, setProxyAdvancedOpen] = useState(false);
  const [showSkipPermWarning, setShowSkipPermWarning] = useState(false);
  const [skipPermSaving, setSkipPermSaving] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyMessage, setProxyMessage] = useState<string | null>(null);
  const [proxyTestMessage, setProxyTestMessage] = useState<ProxyTestMessage | null>(null);
  const { t, locale, setLocale } = useTranslation();

  const fetchAppSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        const appSettings = data.settings || {};
        setSkipPermissions(appSettings.dangerously_skip_permissions === "true");
        setMemoryEnabled(appSettings.memory_system_enabled !== "false");
        const mode = appSettings["network.proxy.mode"];
        setProxyMode(mode === "off" || mode === "custom" ? mode : "system");
        setProxyHttp(appSettings["network.proxy.http"] || "");
        setProxyHttps(appSettings["network.proxy.https"] || "");
        setProxyNoProxy(appSettings["network.proxy.no_proxy"] || "");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchAppSettings();
  }, [fetchAppSettings]);

  const handleSkipPermToggle = (checked: boolean) => {
    if (checked) {
      setShowSkipPermWarning(true);
    } else {
      saveSkipPermissions(false);
    }
  };

  const saveAppSettings = async (settings: Record<string, string>): Promise<boolean> => {
    try {
      const res = await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const saveSkipPermissions = async (enabled: boolean) => {
    setSkipPermSaving(true);
    try {
      const ok = await saveAppSettings({
        dangerously_skip_permissions: enabled ? "true" : "",
      });
      if (ok) {
        setSkipPermissions(enabled);
      }
    } catch {
      // ignore
    } finally {
      setSkipPermSaving(false);
      setShowSkipPermWarning(false);
    }
  };

  const handleMemoryToggle = async (enabled: boolean) => {
    setMemorySaving(true);
    try {
      const ok = await saveAppSettings({
        memory_system_enabled: enabled ? "true" : "false",
      });
      if (ok) setMemoryEnabled(enabled);
    } finally {
      setMemorySaving(false);
    }
  };

  const saveProxySettings = async (): Promise<boolean> => {
    setProxySaving(true);
    setProxyMessage(null);
    try {
      const ok = await saveAppSettings({
        "network.proxy.mode": proxyMode === "system" ? "" : proxyMode,
        "network.proxy.http": proxyHttp.trim(),
        "network.proxy.https": proxyHttps.trim(),
        "network.proxy.no_proxy": proxyNoProxy.trim(),
      });
      setProxyMessage(ok ? "代理设置已保存，新请求会使用该配置" : "代理设置保存失败");
      return ok;
    } catch {
      setProxyMessage("代理设置保存失败");
      return false;
    } finally {
      setProxySaving(false);
    }
  };

  const selectProxyMode = (mode: ProxyMode) => {
    setProxyMode(mode);
    setProxyMessage(null);
    setProxyTestMessage(null);
    if (mode === "custom") {
      if (!proxyHttp.trim() && !proxyHttps.trim()) {
        setProxyHttp(DEFAULT_LOCAL_PROXY);
      }
      if (!proxyNoProxy.trim()) {
        setProxyNoProxy(DEFAULT_NO_PROXY);
      }
    }
  };

  const applyProxyPreset = (url: string) => {
    setProxyMode("custom");
    setProxyHttp(url);
    if (!proxyNoProxy.trim()) {
      setProxyNoProxy(DEFAULT_NO_PROXY);
    }
    setProxyMessage(null);
    setProxyTestMessage(null);
  };

  const testProxyConnection = async () => {
    setProxyTesting(true);
    setProxyTestMessage(null);
    try {
      if (proxyMode === "custom" && !proxyHttp.trim() && !proxyHttps.trim()) {
        setProxyTestMessage({
          ok: false,
          title: "还缺代理地址",
          detail: `先填一个本机代理地址，例如 ${DEFAULT_LOCAL_PROXY}。`,
        });
        return;
      }

      const saved = await saveProxySettings();
      if (!saved) {
        setProxyTestMessage({
          ok: false,
          title: "设置没有保存成功",
          detail: "请再保存一次，或检查设置服务是否可用。",
        });
        return;
      }

      const res = await fetch("/api/settings/network-proxy/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const via = data?.proxyUrl ? `通过 ${data.proxyUrl}` : "未使用代理";
      if (!res.ok || !data?.ok) {
        setProxyTestMessage({
          ok: false,
          title: "X 连接失败",
          detail: data?.error
            ? `本次${via}。${data.error}`
            : `本次${via}。请检查代理软件是否正在运行。`,
        });
        return;
      }
      setProxyTestMessage({
        ok: true,
        title: "X 连接已打通",
        detail: `本次${via}，耗时 ${data.elapsedMs}ms。`,
      });
    } catch (error) {
      setProxyTestMessage({
        ok: false,
        title: "X 连接失败",
        detail: error instanceof Error ? error.message : "请检查网络或代理地址。",
      });
    } finally {
      setProxyTesting(false);
    }
  };

  const proxyPrimaryUrl = proxyHttp.trim() || proxyHttps.trim();
  const proxyStatusDetail =
    proxyMode === "custom"
      ? proxyPrimaryUrl
        ? `Lumos 后台请求会通过 ${proxyPrimaryUrl}。`
        : `还没有代理地址，建议填 ${DEFAULT_LOCAL_PROXY}。`
      : proxyMode === "system"
        ? "当前读取启动 Lumos 时的网络环境；桌面图标启动时通常不会带终端代理。"
        : "当前直连外网；X 或 DeepSearch 如果加载失败，请切到本机代理。";

  return (
    <div className="max-w-3xl space-y-6">
      <UpdateCard />

      {/* Auto-approve toggle */}
      <div className={`rounded-lg border p-4 transition-shadow hover:shadow-sm ${skipPermissions ? "border-orange-500/50 bg-orange-500/5" : "border-border/50"}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t('settings.autoApproveTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('settings.autoApproveDesc')}
            </p>
          </div>
          <Switch
            checked={skipPermissions}
            onCheckedChange={handleSkipPermToggle}
            disabled={skipPermSaving}
          />
        </div>
        {skipPermissions && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-orange-500/10 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
            {t('settings.autoApproveWarning')}
          </div>
        )}
      </div>

      {/* Memory runtime toggle */}
      <div className="rounded-lg border border-border/50 p-4 transition-shadow hover:shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t('settings.memorySystemTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('settings.memorySystemDesc')}</p>
          </div>
          <Switch
            checked={memoryEnabled}
            onCheckedChange={handleMemoryToggle}
            disabled={memorySaving}
          />
        </div>
      </div>

      {/* Language picker */}
      <div className="rounded-lg border border-border/50 p-4 transition-shadow hover:shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t('settings.language')}</h2>
            <p className="text-xs text-muted-foreground">{t('settings.languageDesc')}</p>
          </div>
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Network proxy */}
      <div className="rounded-lg border border-border/50 p-4 transition-shadow hover:shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">外网连接</h2>
            <p className="text-xs text-muted-foreground">
              影响 X、DeepSearch、图片额度校验等后台请求。
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => void testProxyConnection()}
            disabled={proxySaving || proxyTesting}
            className="w-full gap-2 sm:w-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${proxyTesting ? "animate-spin" : ""}`} />
            {proxyTesting ? "正在测试..." : "保存并测试 X"}
          </Button>
        </div>

        <div className={`mt-4 rounded-md px-3 py-2.5 text-xs ${
          proxyTestMessage
            ? proxyTestMessage.ok
              ? "bg-green-500/10 text-green-700 dark:text-green-300"
              : "bg-red-500/10 text-red-600 dark:text-red-300"
            : "bg-muted/30 text-muted-foreground"
        }`}>
          <div className="flex items-start gap-2">
            {proxyTestMessage
              ? proxyTestMessage.ok
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : <Router className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-foreground">
                {proxyTestMessage?.title || "当前连接状态未测试"}
              </div>
              <div className="break-words">
                {proxyTestMessage?.detail || proxyStatusDetail}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <ProxyModeOption
            active={proxyMode === "custom"}
            badge="推荐"
            description={proxyPrimaryUrl || "适合 X / DeepSearch"}
            icon={Router}
            onClick={() => selectProxyMode("custom")}
            title="本机代理"
          />
          <ProxyModeOption
            active={proxyMode === "system"}
            description="只适合终端启动"
            icon={SquareTerminal}
            onClick={() => selectProxyMode("system")}
            title="启动环境"
          />
          <ProxyModeOption
            active={proxyMode === "off"}
            description="不走代理，直接访问"
            icon={ShieldOff}
            onClick={() => selectProxyMode("off")}
            title="直连"
          />
        </div>

        {proxyMode === "custom" && (
          <div className="mt-4 grid gap-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">本机代理地址</label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  value={proxyHttp}
                  onChange={(e) => {
                    setProxyHttp(e.target.value);
                    setProxyMessage(null);
                    setProxyTestMessage(null);
                  }}
                  placeholder={DEFAULT_LOCAL_PROXY}
                  spellCheck={false}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyProxyPreset(DEFAULT_LOCAL_PROXY)}
                  className="h-10"
                >
                  填入常用地址
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                大多数本机代理填这一项就够了，HTTP 和 HTTPS 请求都会使用它。
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  DEFAULT_LOCAL_PROXY,
                  "http://127.0.0.1:7890",
                  "http://127.0.0.1:6152",
                ].map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => applyProxyPreset(url)}
                    className={`rounded-full border px-2 py-1 text-xs transition-colors ${
                      proxyHttp.trim() === url
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    {url.replace("http://", "")}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setProxyAdvancedOpen((v) => !v)}
              className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${proxyAdvancedOpen ? "" : "-rotate-90"}`} />
              高级设置
            </button>

            {proxyAdvancedOpen && (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">单独的 HTTPS 代理</label>
                  <Input
                    value={proxyHttps}
                    onChange={(e) => {
                      setProxyHttps(e.target.value);
                      setProxyMessage(null);
                      setProxyTestMessage(null);
                    }}
                    placeholder="留空则复用上面的代理地址"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">不走代理的地址</label>
                  <Input
                    value={proxyNoProxy}
                    onChange={(e) => {
                      setProxyNoProxy(e.target.value);
                      setProxyMessage(null);
                      setProxyTestMessage(null);
                    }}
                    placeholder="127.0.0.1,localhost,::1,.internal.example.com"
                    spellCheck={false}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void saveProxySettings()} disabled={proxySaving || proxyTesting}>
            {proxySaving ? "保存中..." : "只保存设置"}
          </Button>
          {proxyMessage && !proxyTestMessage && (
            <span className={`text-xs ${proxyMessage.includes("失败") ? "text-red-500" : "text-muted-foreground"}`}>
              {proxyMessage}
            </span>
          )}
          {proxyTestMessage && (
            <span className={`inline-flex items-center gap-1 text-xs ${proxyTestMessage.ok ? "text-green-600" : "text-red-500"}`}>
              {proxyTestMessage.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {proxyTestMessage.title}
            </span>
          )}
        </div>
      </div>

      {/* Builtin apps visibility */}
      <BuiltinAppsSection />

      {/* Skip-permissions warning dialog */}
      <AlertDialog open={showSkipPermWarning} onOpenChange={setShowSkipPermWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.autoApproveDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t('settings.autoApproveDialogDesc')}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('settings.autoApproveShellCommands')}</li>
                  <li>{t('settings.autoApproveFileOps')}</li>
                  <li>{t('settings.autoApproveNetwork')}</li>
                </ul>
                <p className="font-medium text-orange-600 dark:text-orange-400">
                  {t('settings.autoApproveTrustWarning')}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => saveSkipPermissions(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {t('settings.enableAutoApprove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
