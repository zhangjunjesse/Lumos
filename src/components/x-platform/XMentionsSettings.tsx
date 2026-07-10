'use client';

import { useState } from 'react';
import { AtSign, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  initialScreenName: string;
  onSaved: () => void;
}

/**
 * 「我的用户名」设置。X 只在 cookie 里给数字 id、不给用户名,所以让用户填一次
 * handle;后端用抓取库把它反查成 id、和当前登录账号比对,一致才存下,供
 * 「谁 @ 我」(x_my_mentions 工具)使用。
 */
export function XMentionsSettings({ initialScreenName, onSaved }: Props) {
  const [value, setValue] = useState(initialScreenName);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const onSave = async () => {
    const handle = value.trim().replace(/^@/, '');
    if (!handle) {
      setResult({ kind: 'error', text: '请先填用户名' });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/x/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenName: handle }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setResult({ kind: 'error', text: data?.message || `HTTP ${res.status}` });
        return;
      }
      setResult({ kind: 'ok', text: `已保存 @${data.screenName},归属校验通过` });
      onSaved();
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
      <div className="min-w-0">
        <h3 className="font-medium text-sm flex items-center gap-1.5">
          <AtSign className="h-4 w-4" /> 我的用户名
        </h3>
        <p className="text-xs text-muted-foreground">
          填一次你的 X 用户名,系统会核对是否为当前登录账号。之后在对话里让 AI「看看谁 @ 我」即可。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="@用户名"
          disabled={saving}
          className="flex-1 text-xs bg-muted/30 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <Button size="sm" onClick={() => void onSave()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
          校验并保存
        </Button>
      </div>
      {result && (
        <p className={`text-xs ${result.kind === 'error' ? 'text-red-500' : 'text-green-600'}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
