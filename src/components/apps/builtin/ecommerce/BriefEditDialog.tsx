'use client';

import * as React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';

interface BriefShape {
  product_type?: string | null;
  category_bucket?: string | null;
  size_class?: string | null;
  recommended_aspect_ratio?: string | null;
  core_selling_points?: string | null;
  target_audience?: string | null;
  avoid_elements?: string | null;
  confidence?: number | null;
  raw_brief?: string | null;
}

interface BriefEditDialogProps {
  open: boolean;
  inputId: string;
  productTitle: string;
  onClose: () => void;
  onSaved: () => void;
}

export function BriefEditDialog({
  open,
  inputId,
  productTitle,
  onClose,
  onSaved,
}: BriefEditDialogProps): React.ReactElement {
  const [brief, setBrief] = React.useState<BriefShape | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    product_type: '',
    category_bucket: '',
    size_class: 'medium',
    recommended_aspect_ratio: '4:5',
    selling_points: '',
    target_audience: '',
    avoid_elements: '',
  });

  // load brief whenever dialog opens
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/apps/builtin/ecommerce/inputs/${inputId}/brief`);
        const json = (await res.json().catch(() => ({}))) as {
          brief?: BriefShape | null;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `加载 brief 失败 (${res.status})`);
          return;
        }
        const b = json.brief;
        setBrief(b ?? null);
        setForm({
          product_type: b?.product_type ?? '',
          category_bucket: b?.category_bucket ?? '',
          size_class: (b?.size_class as string) ?? 'medium',
          recommended_aspect_ratio: b?.recommended_aspect_ratio ?? '4:5',
          selling_points: parseList(b?.core_selling_points).join('\n'),
          target_audience: parseList(b?.target_audience).join('\n'),
          avoid_elements: parseList(b?.avoid_elements).join('\n'),
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, inputId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        product_type: form.product_type.trim(),
        category_bucket: form.category_bucket.trim(),
        size_class: form.size_class,
        recommended_aspect_ratio: form.recommended_aspect_ratio.trim() || '4:5',
        core_selling_points: form.selling_points.split('\n').map((s) => s.trim()).filter(Boolean),
        target_audience: form.target_audience.split('\n').map((s) => s.trim()).filter(Boolean),
        avoid_elements: form.avoid_elements.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch(`/api/apps/builtin/ecommerce/inputs/${inputId}/brief`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `保存失败 (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑 brief：{productTitle}</DialogTitle>
          <DialogDescription>
            brief 是 listing 起草和出图 SOP 的依据。AI 识别的可能不准，建议核对后保存。保存后 confidence 会标为 9（用户校准）。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> 加载中…
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {brief?.confidence != null ? (
              <p className="text-[11px] text-muted-foreground">
                当前 confidence: {brief.confidence}/9 ·{' '}
                {brief.confidence >= 8
                  ? '高（用户校准或图像识别）'
                  : brief.confidence >= 6
                    ? '中（图像识别）'
                    : '低（合成自候选信息，强烈建议校验）'}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">产品类型 *</Label>
                <Input
                  className="mt-1"
                  value={form.product_type}
                  onChange={(e) => setForm((f) => ({ ...f, product_type: e.target.value }))}
                  disabled={saving}
                  placeholder="16oz Travel Mug"
                />
              </div>
              <div>
                <Label className="text-xs">类目</Label>
                <Input
                  className="mt-1"
                  value={form.category_bucket}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category_bucket: e.target.value }))
                  }
                  disabled={saving}
                  placeholder="kitchen-drinkware"
                />
              </div>
              <div>
                <Label className="text-xs">体积</Label>
                <select
                  value={form.size_class}
                  onChange={(e) => setForm((f) => ({ ...f, size_class: e.target.value }))}
                  disabled={saving}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large">large</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">推荐画面比例</Label>
                <Input
                  className="mt-1"
                  value={form.recommended_aspect_ratio}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recommended_aspect_ratio: e.target.value }))
                  }
                  disabled={saving}
                  placeholder="4:5 / 1:1 / 16:9"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">核心卖点（每行一条，影响 listing 标题/bullets/图片描述）</Label>
              <Textarea
                className="mt-1 text-xs"
                value={form.selling_points}
                onChange={(e) => setForm((f) => ({ ...f, selling_points: e.target.value }))}
                disabled={saving}
                rows={4}
                placeholder="leak-proof slide lid&#10;keeps hot 12h / cold 24h&#10;fits standard car cup holders"
              />
            </div>

            <div>
              <Label className="text-xs">目标用户（每行一条，影响 listing 文案语气）</Label>
              <Textarea
                className="mt-1 text-xs"
                value={form.target_audience}
                onChange={(e) => setForm((f) => ({ ...f, target_audience: e.target.value }))}
                disabled={saving}
                rows={3}
                placeholder="commuter&#10;outdoor enthusiast&#10;office worker"
              />
            </div>

            <div>
              <Label className="text-xs">禁止元素（每行一条，影响出图 SOP 与 listing 合规）</Label>
              <Textarea
                className="mt-1 text-xs"
                value={form.avoid_elements}
                onChange={(e) => setForm((f) => ({ ...f, avoid_elements: e.target.value }))}
                disabled={saving}
                rows={3}
                placeholder="liquid splash&#10;competitor brand&#10;medical claims"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={save} disabled={saving || loading || !!error}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}
