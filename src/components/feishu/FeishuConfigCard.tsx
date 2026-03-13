"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/hooks/useTranslation";

interface FeishuConfigResponse {
  configured: boolean;
  settings?: {
    appId?: string;
    appSecret?: string;
    redirectUri?: string;
    oauthScopes?: string;
  };
  effectiveRedirectUri?: string;
}

export function FeishuConfigCard() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [oauthScopes, setOauthScopes] = useState("");
  const [effectiveRedirectUri, setEffectiveRedirectUri] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feishu/config");
      const data = await res.json() as FeishuConfigResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to load Feishu config");
      }

      setConfigured(Boolean(data.configured));
      setAppId(data.settings?.appId || "");
      setAppSecret(data.settings?.appSecret || "");
      setRedirectUri(data.settings?.redirectUri || "");
      setOauthScopes(data.settings?.oauthScopes || "");
      setEffectiveRedirectUri(data.effectiveRedirectUri || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feishu.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/feishu/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            appId,
            appSecret,
            redirectUri,
            oauthScopes,
          },
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to save Feishu config");
      }

      setMessage(t("feishu.configSaved"));
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feishu.configSaveFailed"));
    } finally {
      setSaving(false);
    }
  }, [appId, appSecret, loadConfig, oauthScopes, redirectUri, t]);

  return (
    <div className="mb-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">{t("feishu.configTitle")}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{t("feishu.configDesc")}</p>
        </div>
        <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
          {configured ? t("feishu.configReady") : t("feishu.configMissing")}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
          <span>{t("common.loading")}</span>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="feishu-app-id" className="text-xs text-muted-foreground">
                {t("feishu.configAppId")}
              </Label>
              <Input
                id="feishu-app-id"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feishu-app-secret" className="text-xs text-muted-foreground">
                {t("feishu.configAppSecret")}
              </Label>
              <Input
                id="feishu-app-secret"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feishu-redirect-uri" className="text-xs text-muted-foreground">
                {t("feishu.configRedirectUri")}
              </Label>
              <Input
                id="feishu-redirect-uri"
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
                className="h-9 text-sm"
                placeholder={effectiveRedirectUri || t("feishu.configRedirectAutoPlaceholder")}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("feishu.configRedirectHint")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("feishu.configEffectiveRedirect")} {effectiveRedirectUri || "—"}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="feishu-oauth-scopes" className="text-xs text-muted-foreground">
                {t("feishu.configScopes")}
              </Label>
              <Textarea
                id="feishu-oauth-scopes"
                value={oauthScopes}
                onChange={(event) => setOauthScopes(event.target.value)}
                className="min-h-20 text-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-h-5 text-xs">
              {error ? (
                <span className="text-red-500">{error}</span>
              ) : message ? (
                <span className="text-emerald-600 dark:text-emerald-400">{message}</span>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving && <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />}
              {t("common.save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
