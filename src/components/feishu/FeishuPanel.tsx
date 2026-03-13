"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { FeishuContext } from "@/hooks/useFeishu";
import type { FeishuAuthState, FeishuContextValue } from "@/hooks/useFeishu";
import { usePanel } from "@/hooks/usePanel";
import { FeishuConfigCard } from "@/components/feishu/FeishuConfigCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openExternalUrl } from "@/lib/open-external";
import { openAuthUrl } from "@/lib/open-auth";
import { useFavoritesStore } from "@/stores/favorites";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add,
  Favorite,
  File,
  Loading,
  Login,
  Logout,
  BookOpen,
  Refresh,
  Search,
} from "@hugeicons/core-free-icons";

export interface FeishuDocItem {
  token: string;
  title: string;
  type: string;
  url: string;
  updatedTime?: number;
}

interface FeishuPanelProps {
  onOpenDoc?: (doc: FeishuDocItem) => void;
  onAddToLibrary?: (doc: FeishuDocItem) => Promise<void> | void;
  showConfigCard?: boolean;
}

const feishuDocsCache = new Map<string, FeishuDocItem[]>();

function cacheKeyFor(userId: string, query: string): string {
  return `${userId}:${query.trim().toLowerCase()}`;
}

export function FeishuPanel({
  onOpenDoc,
  onAddToLibrary,
  showConfigCard = true,
}: FeishuPanelProps) {
  const { t } = useTranslation();
  const { sessionId } = usePanel();
  const toggleFeishuDocFavorite = useFavoritesStore((state) => state.toggleFeishuDoc);
  const favoriteItems = useFavoritesStore((state) => state.items);
  const feishuFavoriteKeySet = useMemo(() => {
    return new Set(
      favoriteItems
        .filter((item) => item.type === "feishu-doc")
        .map((item) => `${item.docType}:${item.token}`)
    );
  }, [favoriteItems]);
  const [auth, setAuth] = useState<FeishuAuthState>({
    authenticated: false,
    user: null,
    loading: true,
  });
  const [docs, setDocs] = useState<FeishuDocItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [attachingToken, setAttachingToken] = useState<string | null>(null);
  const [importingToken, setImportingToken] = useState<string | null>(null);
  const [attachMessage, setAttachMessage] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/status");
      const data = await res.json();
      setAuth({
        authenticated: !!data.authenticated,
        user: data.user ?? null,
        loading: false,
      });
    } catch {
      setAuth({ authenticated: false, user: null, loading: false });
    }
  }, []);

  const fetchDocs = useCallback(async (query?: string, options?: { force?: boolean }) => {
    if (!auth.authenticated) {
      return;
    }

    const q = (query ?? searchQuery).trim();
    const userId = auth.user?.userId || auth.user?.name || 'default';
    const key = cacheKeyFor(userId, q);

    if (!options?.force) {
      const cached = feishuDocsCache.get(key);
      if (cached) {
        setDocs(cached);
        setDocsError(null);
        return;
      }
    }

    setDocsLoading(true);
    setDocsError(null);
    setAttachMessage(null);
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await fetch(`/api/feishu/docs${qs}`);
      const data = await res.json();
      if (!res.ok) {
        setDocs([]);
        setDocsError(data?.message || data?.error || t("feishu.docsLoadFailed"));
        return;
      }
      const nextDocs = Array.isArray(data.items) ? data.items : [];
      setDocs(nextDocs);
      feishuDocsCache.set(key, nextDocs);
    } catch (error) {
      console.error("Failed to load Feishu docs:", error);
      setDocs([]);
      setDocsError(t("feishu.docsLoadFailed"));
    } finally {
      setDocsLoading(false);
    }
  }, [auth.authenticated, auth.user?.name, auth.user?.userId, searchQuery, t]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const onAuthSuccess = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === "feishu-auth-success") {
        refreshAuth();
      }
    };
    window.addEventListener("message", onAuthSuccess);
    return () => window.removeEventListener("message", onAuthSuccess);
  }, [refreshAuth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (auth.authenticated) {
      fetchDocs(searchQuery);
    } else {
      setDocs([]);
      setDocsError(null);
      setAttachMessage(null);
      setSearchInput('');
      setSearchQuery('');
    }
  }, [auth.authenticated, fetchDocs, searchQuery]);

  const login = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/login");
      const data = await res.json();
      if (data.url) {
        await openAuthUrl(data.url);
        // 轮询等待授权完成
        let count = 0;
        const timer = setInterval(async () => {
          count++;
          await refreshAuth();
          if (count >= 60) clearInterval(timer);
        }, 3000);
        setTimeout(() => refreshAuth(), 5000);
      }
    } catch (err) {
      console.error("Feishu login failed:", err);
    }
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/feishu/auth/logout", { method: "POST" });
      setAuth({ authenticated: false, user: null, loading: false });
      setDocs([]);
      feishuDocsCache.clear();
      setDocsError(null);
      setAttachMessage(null);
      setSearchInput('');
      setSearchQuery('');
    } catch (err) {
      console.error("Feishu logout failed:", err);
    }
  }, []);

  const handleLogin = useCallback(async () => {
    await login();
  }, [login]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const handleOpenDoc = useCallback((doc: FeishuDocItem) => {
    if (onOpenDoc) {
      onOpenDoc(doc);
      return;
    }
    void openExternalUrl(doc.url);
  }, [onOpenDoc]);

  const handleAddDocToChat = useCallback(async (doc: FeishuDocItem) => {
    if (!sessionId) {
      setAttachMessage(t('feishu.attachSessionRequired'));
      return;
    }

    setAttachingToken(doc.token);
    setAttachMessage(null);
    try {
      const res = await fetch('/api/feishu/docs/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          token: doc.token,
          type: doc.type,
          title: doc.title,
          url: doc.url,
          mode: 'reference',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAttachMessage(data?.message || data?.error || t('feishu.attachFailed'));
        return;
      }

      if (data.filePath) {
        window.dispatchEvent(
          new CustomEvent('attach-file-to-chat', { detail: { path: data.filePath } }),
        );
        setAttachMessage(t('feishu.attachSuccess').replace('{name}', doc.title));
      } else {
        setAttachMessage(t('feishu.attachFailed'));
      }
    } catch (error) {
      console.error('Failed to attach Feishu doc:', error);
      setAttachMessage(t('feishu.attachFailed'));
    } finally {
      setAttachingToken(null);
    }
  }, [sessionId, t]);

  const handleAddDocToLibrary = useCallback(async (doc: FeishuDocItem) => {
    if (!onAddToLibrary) return;
    setImportingToken(doc.token);
    setAttachMessage(null);
    try {
      await onAddToLibrary(doc);
      setAttachMessage(`已加入资料库：${doc.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('feishu.attachFailed');
      setAttachMessage(message);
    } finally {
      setImportingToken(null);
    }
  }, [onAddToLibrary, t]);

  const handleToggleFavorite = useCallback((doc: FeishuDocItem) => {
    toggleFeishuDocFavorite({
      token: doc.token,
      type: doc.type,
      title: doc.title || "Feishu Doc",
      url: doc.url,
      updatedTime: doc.updatedTime,
    });
  }, [toggleFeishuDocFavorite]);

  const formatUpdatedTime = useCallback((timestamp?: number) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const ctxValue: FeishuContextValue = { auth, login, logout, refreshAuth };

  return (
    <FeishuContext.Provider value={ctxValue}>
      <div className="h-full overflow-auto">
        <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{t("feishu.title")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {auth.authenticated ? t("feishu.docsDesc") : t("feishu.loginHint")}
              </p>
            </div>

            {auth.loading ? (
              <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : auth.authenticated ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={handleLogout}
              >
                <HugeiconsIcon icon={Logout} className="h-3.5 w-3.5" />
                {t("feishu.logout")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={handleLogin}
              >
                <HugeiconsIcon icon={Login} className="h-3.5 w-3.5" />
                {t("feishu.login")}
              </Button>
            )}
          </div>
        </div>

        <div className="p-3">
          {showConfigCard ? <FeishuConfigCard /> : null}

          {auth.loading ? (
            <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            </div>
          ) : !auth.authenticated ? (
            <div className="rounded-xl border bg-card p-6 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <HugeiconsIcon icon={File} className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium">{t("feishu.docsLoginRequired")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("feishu.docsLoginHint")}</p>
              <Button type="button" size="sm" className="mt-4 gap-1.5" onClick={handleLogin}>
                <HugeiconsIcon icon={Login} className="h-3.5 w-3.5" />
                {t("feishu.login")}
              </Button>
            </div>
          ) : (
            <>
              {auth.user && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {auth.user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={auth.user.avatarUrl}
                        alt={auth.user.name}
                        className="h-7 w-7 shrink-0 rounded-full border object-cover"
                      />
                    ) : (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {(auth.user.name || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{auth.user.name}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{t("feishu.connected")}</span>
                </div>
              )}

              <div className="mb-3 flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <HugeiconsIcon icon={Search} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={t('feishu.searchPlaceholder')}
                    className="h-9 pl-9 text-sm"
                  />
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => fetchDocs(searchQuery, { force: true })}
                  disabled={docsLoading}
                  className="h-9 w-9 shrink-0"
                  title={t("feishu.docsRefresh")}
                >
                  <HugeiconsIcon icon={Refresh} className={docsLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  <span className="sr-only">{t("feishu.docsRefresh")}</span>
                </Button>
              </div>

              {attachMessage && (
                <div className="mb-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {attachMessage}
                </div>
              )}

              {docsLoading ? (
                <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
                    <span>{t("feishu.docsLoading")}</span>
                  </div>
                </div>
              ) : docsError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {docsError}
                </div>
              ) : docs.length === 0 ? (
                <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                  {t("feishu.docsEmpty")}
                </div>
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => {
                    const favorited = feishuFavoriteKeySet.has(`${doc.type}:${doc.token}`);
                    return (
                    <div
                      key={`${doc.type}:${doc.token}`}
                      onClick={() => handleOpenDoc(doc)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenDoc(doc);
                        }
                      }}
                      className="group/doc flex w-full cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {doc.type}
                          {doc.updatedTime ? ` · ${formatUpdatedTime(doc.updatedTime)}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/doc:opacity-100 focus-visible:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(doc);
                        }}
                        title={favorited ? t("common.removeFromFavorites") : t("common.addToFavorites")}
                        aria-label={favorited ? t("common.removeFromFavorites") : t("common.addToFavorites")}
                      >
                        <HugeiconsIcon
                          icon={Favorite}
                          className={favorited ? "size-3 text-amber-500" : "size-3 text-muted-foreground"}
                          fill={favorited ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        type="button"
                        className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/doc:opacity-100 focus-visible:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddDocToChat(doc);
                        }}
                        disabled={attachingToken === doc.token}
                        title={t('common.addToChat')}
                        aria-label={t('common.addToChat')}
                      >
                        {attachingToken === doc.token ? (
                          <HugeiconsIcon icon={Loading} className="size-3 animate-spin text-muted-foreground" />
                        ) : (
                          <HugeiconsIcon icon={Add} className="size-3 text-muted-foreground" />
                        )}
                      </button>
                      {onAddToLibrary && (
                        <button
                          type="button"
                          className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/doc:opacity-100 focus-visible:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddDocToLibrary(doc);
                          }}
                          disabled={importingToken === doc.token}
                          title={t('common.addToLibrary')}
                          aria-label={t('common.addToLibrary')}
                        >
                          {importingToken === doc.token ? (
                            <HugeiconsIcon icon={Loading} className="size-3 animate-spin text-muted-foreground" />
                          ) : (
                            <HugeiconsIcon icon={BookOpen} className="size-3 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </FeishuContext.Provider>
  );
}
