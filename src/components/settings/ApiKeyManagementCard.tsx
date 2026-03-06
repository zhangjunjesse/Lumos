'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from '@/hooks/useTranslation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

interface Provider {
  id: number;
  name: string;
  base_url: string;
  is_enabled: boolean;
}

export function ApiKeyManagementCard() {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.anthropic.com');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.json())
      .then(data => {
        const providers = data.providers || [];
        const enabled = providers.find((p: Provider) => p.is_enabled);
        if (enabled) {
          setProvider(enabled);
          setUseCustom(true);
          setBaseUrl(enabled.base_url);
        }
      })
      .catch(console.error);
  }, []);

  const handleTest = async () => {
    if (!apiKey) {
      setMessage({ type: 'error', text: t('provider.apiKeyRequired') });
      return;
    }

    setTesting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: 'success', text: t('provider.testSuccess') });
      } else {
        setMessage({ type: 'error', text: data.error || t('provider.testFailed') });
      }
    } catch (error) {
      setMessage({ type: 'error', text: t('provider.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey) {
      setMessage({ type: 'error', text: t('provider.apiKeyRequired') });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const method = provider ? 'PUT' : 'POST';
      const url = provider ? `/api/providers/${provider.id}` : '/api/providers';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Custom Claude API',
          provider_type: 'anthropic',
          api_key: apiKey,
          base_url: baseUrl,
          model_name: 'claude-opus-4-6',
          is_enabled: true,
        }),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: t('provider.saveSuccess') });
        setTimeout(() => window.location.reload(), 1000);
      } else {
        const data = await res.json();
        setMessage({ type: 'error', text: data.error || t('provider.saveFailed') });
      }
    } catch (error) {
      setMessage({ type: 'error', text: t('provider.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {t('provider.apiKeyManagement')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">{t('provider.useCustomKey')}</span>
          <Switch checked={useCustom} onCheckedChange={setUseCustom} />
        </div>

        {!useCustom && (
          <p className="text-sm text-muted-foreground">
            {t('provider.usingBuiltin')}
          </p>
        )}

        {useCustom && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <div className="flex gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Base URL <span className="text-muted-foreground">({t('provider.optional')})</span>
              </label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
              />
            </div>

            {message && (
              <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || saving}
              >
                {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('provider.testConnection')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={testing || saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('provider.saveConfig')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
