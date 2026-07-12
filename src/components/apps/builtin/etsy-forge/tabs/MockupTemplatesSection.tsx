'use client';

// T恤模板管理:一键出品第⑧步 sharp 程序合成的底图库。卡片=底图缩略图(印花区叠框)+名称+启用+编辑/删除。
// 上传本地图 → base64 新建;编辑走框选弹层改印花区。内置模板可停用不可删。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { etsyForgeApi, type MockupTemplate, type PrintArea } from '../api-client';
import { MockupTemplateCropDialog } from './MockupTemplateCropDialog';

const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

// dataURL → 纯 base64(去掉 "data:image/png;base64," 前缀)。
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''));
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(file);
  });
}

export function MockupTemplatesSection() {
  const [templates, setTemplates] = useState<MockupTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<MockupTemplate | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTemplates((await etsyForgeApi.listMockupTemplates()).templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      await etsyForgeApi.createMockupTemplate({ name: uploadName.trim() || file.name.replace(/\.[^.]+$/, ''), base_image_base64: base64 });
      setUploadName('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const toggleEnabled = async (t: MockupTemplate, enabled: boolean) => {
    setTemplates((rows) => rows.map((r) => (r.id === t.id ? { ...r, enabled } : r)));
    try {
      await etsyForgeApi.updateMockupTemplate(t.id, { enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    }
  };
  const saveArea = async (t: MockupTemplate, area: PrintArea) => {
    setEditing(null);
    try {
      await etsyForgeApi.updateMockupTemplate(t.id, { print_area: area });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const del = async (t: MockupTemplate) => {
    if (!confirm(`删除模板「${t.name}」？其底图一并删除,不可恢复。`)) return;
    try {
      await etsyForgeApi.deleteMockupTemplate(t.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="text-sm font-medium">T恤模板</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">一键出品的产品图 = 印花 × 启用的模板,本地 sharp 合成零 token。</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={uploadName}
          onChange={(e) => setUploadName(e.target.value)}
          placeholder="模板名(选填,留空用文件名)"
          className="h-8 w-52 rounded-md border border-input bg-background px-2 text-xs"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0])}
        />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '上传中…' : '＋ 上传模板'}
        </Button>
      </div>

      {error && <p className="mb-3 rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : templates.length === 0 ? (
        <p className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">还没有模板,「上传模板」加一个。</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} onToggle={toggleEnabled} onEdit={setEditing} onDelete={del} />
          ))}
        </div>
      )}

      {editing && (
        <MockupTemplateCropDialog
          template={editing}
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          onSave={(area) => void saveArea(editing, area)}
        />
      )}
    </section>
  );
}

function TemplateCard({
  template,
  onToggle,
  onEdit,
  onDelete,
}: {
  template: MockupTemplate;
  onToggle: (t: MockupTemplate, enabled: boolean) => void;
  onEdit: (t: MockupTemplate) => void;
  onDelete: (t: MockupTemplate) => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const a = template.print_area;
  // 印花区叠框:按缩略图相对原图的比例换算成百分比定位(不依赖具体展示像素)。
  const box = nat
    ? { left: `${(a.x / nat.w) * 100}%`, top: `${(a.y / nat.h) * 100}%`, width: `${(a.w / nat.w) * 100}%`, height: `${(a.h / nat.h) * 100}%` }
    : null;

  return (
    <div className={`rounded-lg border p-2 ${template.enabled ? '' : 'opacity-60'}`}>
      {/* 底图按原始比例展示,容器紧贴图片 —— 印花区叠框用百分比定位才能对齐任意比例的底图。 */}
      <div className="relative overflow-hidden rounded bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={serve(template.base_path)}
          alt={template.name}
          loading="lazy"
          decoding="async"
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          className="block h-auto w-full"
        />
        {box && <div className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/10 ring-1 ring-inset ring-white/50" style={box} />}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={template.name}>
          {template.name}
        </span>
        {template.builtin && <span className="shrink-0 rounded bg-foreground px-1 text-[9px] text-background">内置</span>}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={template.enabled} onCheckedChange={(v) => onToggle(template, v)} />
          {template.enabled ? '启用' : '停用'}
        </label>
        <div className="flex items-center gap-2 text-[11px]">
          <button type="button" onClick={() => onEdit(template)} className="text-sky-600 hover:underline">
            编辑
          </button>
          {!template.builtin && (
            <button type="button" onClick={() => onDelete(template)} className="text-destructive hover:underline">
              删
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
