"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/lib/open-external";
import { useFavoritesStore } from "@/stores/favorites";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add,
  Favorite,
  Globe,
  Loading,
  BookOpen,
  Refresh,
  Search,
} from "@hugeicons/core-free-icons";

const DEFAULT_HOME_URL = "https://www.google.com";
const SEARCH_BASE_URL = "https://www.google.com/search?q=";
const BROWSER_BASE_WIDTH = 1366;

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const HOST_WITH_DOT_PATTERN = /^[^\s/]+\.[^\s/]+/;
const LOCALHOST_PATTERN = /^localhost(?::\d+)?(?:\/.*)?$/i;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/;

function normalizeBrowserInput(rawInput: string): string | null {
  const input = rawInput.trim();
  if (!input) return null;

  if (SCHEME_PATTERN.test(input)) {
    return input;
  }

  if (LOCALHOST_PATTERN.test(input) || IPV4_PATTERN.test(input)) {
    return `http://${input}`;
  }

  if (HOST_WITH_DOT_PATTERN.test(input) && !input.includes(" ")) {
    return `https://${input}`;
  }

  return `${SEARCH_BASE_URL}${encodeURIComponent(input)}`;
}

interface EmbeddedBrowserPanelProps {
  url?: string;
  fitWidth?: boolean;
  onUrlChange: (url: string) => void;
  onOpenInNewTab?: (url: string) => void;
  onFitWidthChange?: (fitWidth: boolean) => void;
  onAddToLibrary?: (url: string) => void;
}

export function EmbeddedBrowserPanel({
  url,
  fitWidth,
  onUrlChange,
  onOpenInNewTab,
  onFitWidthChange,
  onAddToLibrary,
}: EmbeddedBrowserPanelProps) {
  const { t } = useTranslation();
  const resolvedUrl = url?.trim() || DEFAULT_HOME_URL;
  const toggleUrlFavorite = useFavoritesStore((state) => state.toggleUrl);
  const favorited = useFavoritesStore((state) => state.isUrlFavorited(resolvedUrl));
  const shouldFitWidth = fitWidth !== false;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState(resolvedUrl);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewportSize({ width, height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const iframeKey = useMemo(
    () => `${resolvedUrl}::${reloadNonce}`,
    [resolvedUrl, reloadNonce],
  );
  const fitScale = useMemo(() => {
    if (!shouldFitWidth) return 1;
    if (!viewportSize.width) return 1;
    return Math.min(1, viewportSize.width / BROWSER_BASE_WIDTH);
  }, [shouldFitWidth, viewportSize.width]);
  const fittedHeight = useMemo(() => {
    if (!shouldFitWidth || fitScale >= 1) return "100%";
    if (!viewportSize.height) return "100%";
    return `${Math.round(viewportSize.height / fitScale)}px`;
  }, [fitScale, shouldFitWidth, viewportSize.height]);

  const handleNavigateCurrent = useCallback(() => {
    const normalized = normalizeBrowserInput(inputValue);
    if (!normalized) return;

    setInputValue(normalized);
    setIsLoading(true);

    if (normalized === resolvedUrl) {
      setReloadNonce((value) => value + 1);
      return;
    }

    onUrlChange(normalized);
  }, [inputValue, onUrlChange, resolvedUrl]);

  const handleNavigate = useCallback(() => {
    const normalized = normalizeBrowserInput(inputValue);
    if (!normalized) return;

    const hasInitializedUrl = Boolean(url?.trim());
    if (!hasInitializedUrl || normalized === resolvedUrl) {
      handleNavigateCurrent();
      return;
    }

    onOpenInNewTab?.(normalized);
  }, [handleNavigateCurrent, inputValue, onOpenInNewTab, resolvedUrl, url]);

  const handleOpenInNewTab = useCallback(() => {
    const normalized = normalizeBrowserInput(inputValue);
    if (!normalized) return;
    onOpenInNewTab?.(normalized);
  }, [inputValue, onOpenInNewTab]);

  const handleReload = useCallback(() => {
    setIsLoading(true);
    setReloadNonce((value) => value + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    void openExternalUrl(resolvedUrl);
  }, [resolvedUrl]);

  const handleToggleFavorite = useCallback(() => {
    let title = resolvedUrl;
    try {
      title = new URL(resolvedUrl).hostname.replace(/^www\./, "") || resolvedUrl;
    } catch {
      // Keep fallback title
    }
    toggleUrlFavorite({ url: resolvedUrl, title });
  }, [resolvedUrl, toggleUrlFavorite]);

  const handleToggleFitWidth = useCallback(() => {
    onFitWidthChange?.(!shouldFitWidth);
  }, [onFitWidthChange, shouldFitWidth]);

  const handleAddToLibrary = useCallback(() => {
    if (!resolvedUrl) return;
    onAddToLibrary?.(resolvedUrl);
  }, [onAddToLibrary, resolvedUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <form
        className="shrink-0 border-b px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          handleNavigate();
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <HugeiconsIcon
              icon={Search}
              className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={t("browser.urlPlaceholder")}
              className="h-8 pl-7 text-xs"
            />
          </div>

          <Button type="submit" size="sm" className="h-8 px-3 text-xs">
            {t("browser.open")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0"
            onClick={handleOpenInNewTab}
            title={t("browser.openInNewTab")}
          >
            <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
            <span className="sr-only">{t("browser.openInNewTab")}</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0"
            onClick={handleReload}
            title={t("browser.reload")}
          >
            <HugeiconsIcon icon={Refresh} className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            <span className="sr-only">{t("browser.reload")}</span>
          </Button>

          {onAddToLibrary && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8 shrink-0"
              onClick={handleAddToLibrary}
              title={t("common.addToLibrary")}
            >
              <HugeiconsIcon icon={BookOpen} className="h-3.5 w-3.5" />
              <span className="sr-only">{t("common.addToLibrary")}</span>
            </Button>
          )}
        </div>
      </form>

      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon icon={Globe} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{resolvedUrl}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6"
            onClick={handleToggleFavorite}
            title={favorited ? t("common.removeFromFavorites") : t("common.addToFavorites")}
            aria-label={favorited ? t("common.removeFromFavorites") : t("common.addToFavorites")}
          >
            <HugeiconsIcon
              icon={Favorite}
              className={cn("h-3.5 w-3.5", favorited ? "text-amber-500" : "text-muted-foreground")}
              fill={favorited ? "currentColor" : "none"}
            />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 px-2 text-[11px]"
            onClick={handleToggleFitWidth}
          >
            {shouldFitWidth ? t("browser.fixedWidth") : t("browser.fitWidth")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 px-2 text-[11px]"
            onClick={handleOpenExternal}
          >
            {t("browser.openExternal")}
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={cn(
          "relative min-h-0 flex-1 bg-muted/10",
          shouldFitWidth ? "overflow-hidden" : "overflow-auto",
        )}
      >
        <div
          className={cn(
            "origin-top-left",
            shouldFitWidth ? "min-w-0" : "h-full",
          )}
          style={
            shouldFitWidth
              ? {
                  width: `${BROWSER_BASE_WIDTH}px`,
                  height: fittedHeight,
                  transform: `scale(${fitScale})`,
                }
              : {
                  width: `${BROWSER_BASE_WIDTH}px`,
                  minWidth: `${BROWSER_BASE_WIDTH}px`,
                  height: "100%",
                }
          }
        >
          <iframe
            key={iframeKey}
            title={t("tab.browser")}
            src={resolvedUrl}
            className="border-0 bg-background"
            style={{
              width: `${BROWSER_BASE_WIDTH}px`,
              height: shouldFitWidth ? fittedHeight : "100%",
            }}
            onLoad={() => setIsLoading(false)}
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        {isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {t("browser.embedHint")}
      </div>
    </div>
  );
}
