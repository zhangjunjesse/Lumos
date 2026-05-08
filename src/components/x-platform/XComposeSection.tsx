'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2, Send, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { XAuthExpiredHint } from './XAuthExpiredHint';

const TWEET_LIMIT = 280;
const MAX_IMAGES = 4;
const MAX_BYTES = 5 * 1024 * 1024;

interface PendingImage {
  /** 用 ObjectURL 让 <img> 直接渲染 (revoke 在卸载时)。 */
  preview: string;
  filename: string;
  /** 上传成功拿到的 X media_id。null = 还在上传/上传失败。 */
  mediaId: string | null;
  /** 行内错误信息。 */
  error?: string;
}

export function XComposeSection() {
  const [text, setText] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; message: string; url?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = TWEET_LIMIT - text.length;
  const tooLong = remaining < 0;
  const readyMediaIds = images.filter((i) => i.mediaId).map((i) => i.mediaId!) as string[];
  const hasUploadingImage = images.some((i) => !i.mediaId && !i.error);
  const canSend = (text.trim().length > 0 || readyMediaIds.length > 0)
    && !sending && !tooLong && !authExpired && !hasUploadingImage;

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const slots = MAX_IMAGES - images.length;
    if (slots <= 0) return;
    const accepted = Array.from(files).slice(0, slots);
    setUploading(true);

    const additions: PendingImage[] = accepted.map((f) => ({
      preview: URL.createObjectURL(f),
      filename: f.name,
      mediaId: null,
    }));
    setImages((prev) => [...prev, ...additions]);

    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      const slot = images.length + i;
      try {
        if (file.size > MAX_BYTES) {
          throw new Error(`超过 5MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        }
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/x/media', { method: 'POST', body: form });
        const data = await res.json();
        if (res.status === 401 && data?.code === 'X_AUTH_EXPIRED') {
          setAuthExpired(true);
          setImages((prev) => prev.filter((_, idx) => idx !== slot));
          break;
        }
        if (!res.ok || !data?.ok) throw new Error(data?.message || `HTTP ${res.status}`);
        setImages((prev) => prev.map((p, idx) =>
          idx === slot ? { ...p, mediaId: data.mediaId as string } : p,
        ));
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传失败';
        setImages((prev) => prev.map((p, idx) =>
          idx === slot ? { ...p, error: msg } : p,
        ));
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/x/tweets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), mediaIds: readyMediaIds }),
      });
      const data = await res.json();
      if (res.status === 401 && data?.code === 'X_AUTH_EXPIRED') {
        setAuthExpired(true);
        return;
      }
      if (!res.ok || !data?.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      setResult({ kind: 'ok', message: '已发布', url: data.tweet?.url });
      setText('');
      images.forEach((i) => { if (i.preview) URL.revokeObjectURL(i.preview); });
      setImages([]);
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : '发推失败' });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={authExpired ? '登录已过期,无法发推' : '想说点什么?'}
        rows={4}
        disabled={sending || authExpired}
        className="w-full text-sm bg-muted/30 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
      />

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.preview} alt={img.filename} className="w-full h-20 object-cover rounded-md" />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute top-1 right-1 h-5 w-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="移除"
              >
                <X className="h-3 w-3" />
              </button>
              {!img.mediaId && !img.error && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-md">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
              )}
              {img.error && (
                <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center rounded-md text-white text-[10px] text-center px-1">
                  {img.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
            disabled={sending || authExpired || images.length >= MAX_IMAGES}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploading || authExpired || images.length >= MAX_IMAGES}
            title={`最多 ${MAX_IMAGES} 张图片,5MB/张`}
          >
            <ImageIcon className="h-4 w-4 mr-1" />
            图片 ({images.length}/{MAX_IMAGES})
          </Button>
          <span className={`text-xs ${tooLong ? 'text-red-500' : 'text-muted-foreground'}`}>
            {remaining}
          </span>
        </div>
        <Button size="sm" onClick={() => void send()} disabled={!canSend}>
          {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          发推
        </Button>
      </div>

      {authExpired && <XAuthExpiredHint />}
      {result && !authExpired && (
        <Alert className={result.kind === 'error' ? 'border-red-500/50' : 'border-green-500/40'}>
          <AlertDescription className="text-xs">
            {result.message}
            {result.url && (
              <>
                {' '}
                <a href={result.url} target="_blank" rel="noreferrer" className="underline">查看</a>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
