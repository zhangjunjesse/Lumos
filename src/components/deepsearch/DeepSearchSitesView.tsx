"use client";

import { ExternalLink, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import type { DeepSearchSiteRecord } from './deepsearch-types';
import { getCookieVariant, getLoginStateVariant } from './deepsearch-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { getDeepSearchSiteVisibleLastError, isDeepSearchSiteLoginFree, isDeepSearchSiteReady } from '@/lib/deepsearch/site-state';

interface Props {
  sites: DeepSearchSiteRecord[];
  siteRecheckingKey: string;
  siteOpeningKey: string;
  onOpenLoginSite: (siteKey: string) => void;
  onRecheckSite: (siteKey: string) => void;
  onConfigureSite: (site: DeepSearchSiteRecord) => void;
}

export function DeepSearchSitesView({
  sites,
  siteRecheckingKey,
  siteOpeningKey,
  onOpenLoginSite,
  onRecheckSite,
  onConfigureSite,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {sites.map((site) => {
        const loginFree = isDeepSearchSiteLoginFree(site.siteKey);
        const ready = isDeepSearchSiteReady(site);
        const visibleError = getDeepSearchSiteVisibleLastError(site.liveState);

        return (
          <div key={site.siteKey} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start gap-3 justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{site.displayName}</span>
                  {loginFree ? (
                    <Badge variant="default" className="text-xs">公开可用</Badge>
                  ) : (
                    <>
                      <Badge variant={ready ? 'default' : 'outline'} className="text-xs">
                        {site.liveState
                          ? t(`deepsearch.loginState${site.liveState.loginState.split('_').map((w) => (w as string).charAt(0).toUpperCase() + (w as string).slice(1)).join('')}` as Parameters<typeof t>[0])
                          : t('deepsearch.loginStateMissing')}
                      </Badge>
                      <Badge variant={getCookieVariant(site.cookieStatus)} className="text-xs">
                        {t(`deepsearch.cookie${site.cookieStatus.charAt(0).toUpperCase()}${site.cookieStatus.slice(1)}` as Parameters<typeof t>[0])}
                      </Badge>
                    </>
                  )}
                </div>
                <a
                  href={site.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {site.baseUrl}
                  <ExternalLink className="h-3 w-3" />
                </a>
                {loginFree ? (
                  <p className="mt-1 text-xs text-muted-foreground">无需登录，通过百度搜索 + 浏览器渲染获取公开文章</p>
                ) : (
                  <>
                    {site.liveState?.lastCheckedAt ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t('deepsearch.lastChecked')}: {new Date(site.liveState.lastCheckedAt.replace(' ', 'T')).toLocaleString()}
                      </div>
                    ) : null}
                    {site.liveState?.blockingReason ? (
                      <p className="mt-1 text-xs text-muted-foreground">{site.liveState.blockingReason}</p>
                    ) : null}
                    {visibleError ? (
                      <p className="mt-1 text-xs text-destructive">{visibleError}</p>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                {!loginFree && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onOpenLoginSite(site.siteKey)}
                      disabled={siteOpeningKey === site.siteKey}
                    >
                      {siteOpeningKey === site.siteKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                      {t('deepsearch.openLoginPage')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onRecheckSite(site.siteKey)}
                      disabled={siteRecheckingKey === site.siteKey}
                    >
                      {siteRecheckingKey === site.siteKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {t('deepsearch.recheckLoginState')}
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onConfigureSite(site)}
                >
                  {loginFree ? '设置' : t('deepsearch.configureCookie')}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
