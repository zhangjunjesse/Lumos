"use client";

import { useEffect, useState } from 'react';
import type { DeepSearchCookieStatus, DeepSearchSiteRecord } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/useTranslation';
import { isDeepSearchSiteLoginFree } from '@/lib/deepsearch/site-state';

interface DeepSearchSiteDialogProps {
  open: boolean;
  site: DeepSearchSiteRecord | null;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    siteKey: string;
    cookieValue: string;
    cookieStatus: DeepSearchCookieStatus;
    cookieExpiresAt: string | null;
    validationMessage: string;
    notes: string;
    minFetchCount: number;
  }) => Promise<void>;
}

export function DeepSearchSiteDialog({
  open,
  site,
  loading = false,
  onOpenChange,
  onSave,
}: DeepSearchSiteDialogProps) {
  const { t } = useTranslation();
  const [cookieValue, setCookieValue] = useState('');
  const [cookieStatus, setCookieStatus] = useState<DeepSearchCookieStatus>('missing');
  const [cookieExpiresAt, setCookieExpiresAt] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [minFetchCount, setMinFetchCount] = useState(3);

  useEffect(() => {
    if (!site) {
      return;
    }
    setCookieValue('');
    setCookieStatus(site.cookieStatus);
    setCookieExpiresAt(site.cookieExpiresAt ? site.cookieExpiresAt.slice(0, 16) : '');
    setValidationMessage(site.validationMessage);
    setNotes(site.notes);
    setMinFetchCount(site.minFetchCount ?? 3);
  }, [site, open]);

  async function handleSave() {
    if (!site) {
      return;
    }
    await onSave({
      siteKey: site.siteKey,
      cookieValue,
      cookieStatus,
      cookieExpiresAt: cookieExpiresAt.trim() ? cookieExpiresAt.trim() : null,
      validationMessage,
      notes,
      minFetchCount,
    });
  }

  async function handleClearCookie() {
    if (!site) {
      return;
    }
    setCookieValue('');
    setCookieStatus('missing');
    setCookieExpiresAt('');
    await onSave({
      siteKey: site.siteKey,
      cookieValue: '',
      cookieStatus: 'missing',
      cookieExpiresAt: null,
      validationMessage,
      notes,
      minFetchCount,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('deepsearch.siteDialogTitle')}</DialogTitle>
          <DialogDescription>
            {site ? `${site.displayName} · ${t('deepsearch.siteDialogDesc')}` : t('deepsearch.siteDialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {site && !isDeepSearchSiteLoginFree(site.siteKey) && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="deepsearch-cookie-value">{t('deepsearch.cookieValueLabel')}</Label>
                <Textarea
                  id="deepsearch-cookie-value"
                  value={cookieValue}
                  onChange={(event) => setCookieValue(event.target.value)}
                  placeholder={t('deepsearch.cookieValuePlaceholder')}
                  className="min-h-28"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>{t('deepsearch.cookieStatusLabel')}</Label>
                  <Select value={cookieStatus} onValueChange={(value) => setCookieStatus(value as DeepSearchCookieStatus)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="missing">{t('deepsearch.cookieMissing')}</SelectItem>
                      <SelectItem value="valid">{t('deepsearch.cookieValid')}</SelectItem>
                      <SelectItem value="expired">{t('deepsearch.cookieExpired')}</SelectItem>
                      <SelectItem value="unknown">{t('deepsearch.cookieUnknown')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="deepsearch-cookie-expires">{t('deepsearch.cookieExpiresAtLabel')}</Label>
                  <Input
                    id="deepsearch-cookie-expires"
                    type="datetime-local"
                    value={cookieExpiresAt}
                    onChange={(event) => setCookieExpiresAt(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="deepsearch-validation-message">{t('deepsearch.validationMessageLabel')}</Label>
                <Input
                  id="deepsearch-validation-message"
                  value={validationMessage}
                  onChange={(event) => setValidationMessage(event.target.value)}
                  placeholder={t('deepsearch.validationMessagePlaceholder')}
                />
              </div>
            </>
          )}

          <div className="grid gap-2">
            <Label htmlFor="deepsearch-min-fetch-count">最小爬取文章数</Label>
            <Input
              id="deepsearch-min-fetch-count"
              type="number"
              min={1}
              max={20}
              value={minFetchCount}
              onChange={(event) => setMinFetchCount(Math.max(1, Math.min(20, Number(event.target.value) || 3)))}
            />
            <p className="text-xs text-muted-foreground">搜索结果页自动跳转抓取的文章数量（1~20），默认 3</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="deepsearch-notes">{t('deepsearch.notes')}</Label>
            <Textarea
              id="deepsearch-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('deepsearch.notesPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          {site && !isDeepSearchSiteLoginFree(site.siteKey) ? (
            <Button variant="outline" onClick={handleClearCookie} disabled={!site || loading}>
              {t('deepsearch.clearCookie')}
            </Button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {t('settings.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!site || loading}>
              {loading ? t('deepsearch.saving') : t('deepsearch.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
