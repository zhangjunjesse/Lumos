'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n/client';

interface Provider {
  id: number;
  name: string;
  base_url: string;
  model_name: string;
  is_enabled: boolean;
}

export function CurrentConfigCard() {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<Provider | null>(null);

  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.json())
      .then(data => {
        const enabled = data.find((p: Provider) => p.is_enabled);
        setProvider(enabled || null);
      })
      .catch(console.error);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {t('provider.currentConfig')}
          </CardTitle>
          <Badge variant={provider ? 'default' : 'secondary'}>
            {provider ? t('provider.configured') : t('provider.notConfigured')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {provider ? (
          <div className="space-y-2">
            <div>
              <p className="font-medium">{provider.name}</p>
              <p className="text-xs text-muted-foreground">{provider.base_url}</p>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{t('provider.model')}: </span>
              <span>{provider.model_name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('provider.status')}: </span>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span>{t('provider.connected')}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('provider.usingBuiltin')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
