'use client';

import { ArrowLeft, ArrowRight, Globe2, Plus, RotateCw, Square } from 'lucide-react';
import type { BrowserTab } from '@/types/browser';
import { Button } from '@/components/ui/button';
import { URLAutocomplete, type URLSuggestion } from './URLAutocomplete';
import { useTranslation } from '@/hooks/useTranslation';

export interface BrowserToolbarProps {
  activeTab?: BrowserTab;
  urlValue: string;
  isLoading: boolean;
  suggestions?: URLSuggestion[];
  onUrlChange: (value: string) => void;
  onNavigate: (value: string) => void;
  onCreateTab: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
}

export function BrowserToolbar({
  activeTab,
  urlValue,
  isLoading,
  suggestions = [],
  onUrlChange,
  onNavigate,
  onCreateTab,
  onBack,
  onForward,
  onReload,
  onStop,
}: BrowserToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border/60 bg-background/95 px-4 pb-3 pt-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-full border border-border/60 bg-muted/50 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            disabled={!activeTab?.canGoBack}
            onClick={onBack}
            title={t('browser.back')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            disabled={!activeTab?.canGoForward}
            onClick={onForward}
            title={t('browser.forward')}
          >
            <ArrowRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            disabled={!activeTab}
            onClick={isLoading ? onStop : onReload}
            title={isLoading ? t('browser.stopLoading') : t('browser.reload')}
          >
            {isLoading ? <Square className="size-3.5 fill-current" /> : <RotateCw className="size-4" />}
          </Button>
        </div>

        <div className="relative min-w-[280px] flex-1">
          <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground">
            <Globe2 className="size-4" />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onNavigate(urlValue);
            }}
          >
            <URLAutocomplete
              value={urlValue}
              suggestions={suggestions}
              placeholder={t('browser.urlPlaceholder')}
              className="w-full"
              onChange={onUrlChange}
              onSubmit={onNavigate}
              inputClassName="pl-10"
            />
          </form>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={onCreateTab}
        >
          <Plus className="size-4" />
          {t('browser.newTab')}
        </Button>
      </div>
    </div>
  );
}
