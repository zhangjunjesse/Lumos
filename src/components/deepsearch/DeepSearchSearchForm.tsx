"use client";

import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeepSearchSiteRecord } from './deepsearch-types';
import { getLoginStateVariant, getCookieVariant } from './deepsearch-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
import { isDeepSearchSiteReady } from '@/lib/deepsearch/site-state';

interface Props {
  sites: DeepSearchSiteRecord[];
  queryText: string;
  selectedSiteKeys: string[];
  loading: boolean;
  onQueryChange: (value: string) => void;
  onToggleSite: (siteKey: string, checked: boolean) => void;
  onSubmit: () => void;
}

export function DeepSearchSearchForm({
  sites,
  queryText,
  selectedSiteKeys,
  loading,
  onQueryChange,
  onToggleSite,
  onSubmit,
}: Props) {
  const { t } = useTranslation();

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="deepsearch-query">{t('deepsearch.queryLabel')}</Label>
        <Textarea
          id="deepsearch-query"
          value={queryText}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('deepsearch.queryPlaceholder')}
          className="min-h-24 resize-none"
        />
      </div>

      <div className="grid gap-2">
        <Label>{t('deepsearch.sitesLabel')}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {sites.map((site) => {
            const ready = isDeepSearchSiteReady(site);
            return (
              <label
                key={site.siteKey}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-muted/30",
                  selectedSiteKeys.includes(site.siteKey) && "border-primary bg-primary/5",
                )}
              >
                <Checkbox
                  checked={selectedSiteKeys.includes(site.siteKey)}
                  onCheckedChange={(checked) => onToggleSite(site.siteKey, checked === true)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{site.displayName}</span>
                    {site.liveState ? (
                      <Badge variant={getLoginStateVariant(site.liveState.loginState)} className="h-5 text-xs">
                        {ready ? t('deepsearch.loginStateConnected') : site.liveState.loginState === 'missing' ? t('deepsearch.loginStateMissing') : t('deepsearch.loginStateSuspectedExpired')}
                      </Badge>
                    ) : (
                      <Badge variant={getCookieVariant(site.cookieStatus)} className="h-5 text-xs">
                        {t(`deepsearch.cookie${site.cookieStatus.charAt(0).toUpperCase()}${site.cookieStatus.slice(1)}` as Parameters<typeof t>[0])}
                      </Badge>
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <Button onClick={onSubmit} disabled={loading} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {loading ? t('deepsearch.creatingRun') : t('deepsearch.createRun')}
      </Button>
    </div>
  );
}
