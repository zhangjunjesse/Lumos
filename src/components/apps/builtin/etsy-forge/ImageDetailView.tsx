'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  etsyForgeApi,
  type DetailResponse,
  type RemixResult,
} from './api-client';

type RemixAction = 'recolor' | 'restyle' | 'resubject' | 'series' | 'resize' | 'removebg';

const REMIX_ACTIONS: Array<{ id: RemixAction; label: string; description: string }> = [
  { id: 'recolor', label: '换色', description: '保留构图，替换主色' },
  { id: 'restyle', label: '换风格', description: '保留主题，调整画风' },
  { id: 'resubject', label: '换主体', description: '保留销售方向，替换主体' },
  { id: 'series', label: '做系列', description: '生成同主题系列款' },
  { id: 'resize', label: '改尺寸', description: '未接入图片处理后端' },
  { id: 'removebg', label: '去背景', description: '未接入图片处理后端' },
];

export function ImageDetailView({ imageId }: { imageId: string }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remixing, setRemixing] = useState<RemixAction | null>(null);
  const [remixResult, setRemixResult] = useState<RemixResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await etsyForgeApi.detail(imageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runRemix = async (action: RemixAction) => {
    setRemixing(action);
    setRemixResult(null);
    setError(null);
    try {
      const result = await etsyForgeApi.remix(imageId, action);
      setRemixResult(result);
      if (!result.notImplemented) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemixing(null);
    }
  };

  const deleteImage = async () => {
    if (!confirm('确认从图库删除这张图？本地文件不会被删除。')) return;
    try {
      await etsyForgeApi.deleteImage(imageId);
      window.location.href = '/apps/etsy-forge/library';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadCurrent = () => {
    if (!detail) return;
    const a = document.createElement('a');
    a.href = detail.image.url;
    a.download = detail.image.file_path.split(/[\\/]/).pop() ?? `${detail.image.id}.png`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-medium">图片详情</h1>
          <p className="text-xs text-zinc-500">查看原图、衍生图和二创动作</p>
        </div>
        <Link
          href="/apps/etsy-forge/library"
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          返回图库
        </Link>
      </header>

      <main className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-[520px] items-center justify-center rounded-md border border-zinc-800 bg-black">
          {loading && <p className="text-sm text-zinc-400">加载中...</p>}
          {!loading && error && <p className="max-w-md break-words text-sm text-red-400">{error}</p>}
          {!loading && !error && detail && (
            <img
              src={detail.image.url}
              alt={detail.image.theme}
              className="max-h-[78vh] max-w-full object-contain"
              draggable={false}
            />
          )}
        </section>

        <aside className="space-y-5">
          {detail && (
            <>
              <section className="rounded-md border border-zinc-800 p-4">
                <h2 className="mb-3 text-sm font-medium">作品信息</h2>
                <dl className="space-y-2 text-xs text-zinc-400">
                  <InfoRow label="主题" value={detail.image.theme} />
                  <InfoRow label="风格" value={detail.image.style} />
                  <InfoRow label="类型" value={detail.image.source_type === 'remixed' ? '二创图' : '原图'} />
                  <InfoRow label="AI 标注" value={detail.image.ai_generated_tag ? '需要标注' : '未启用'} />
                  <InfoRow label="创建时间" value={new Date(detail.image.created_at).toLocaleString()} />
                </dl>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={downloadCurrent}
                    className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900"
                  >
                    下载原图
                  </button>
                  <button
                    type="button"
                    onClick={deleteImage}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    删除
                  </button>
                </div>
              </section>

              <section className="rounded-md border border-zinc-800 p-4">
                <h2 className="mb-3 text-sm font-medium">AI 二创</h2>
                <div className="grid grid-cols-2 gap-2">
                  {REMIX_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => void runRemix(action.id)}
                      disabled={remixing !== null}
                      title={action.description}
                      className="rounded-md border border-zinc-700 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="block font-medium">{remixing === action.id ? '生成中...' : action.label}</span>
                      <span className="mt-1 block text-[11px] text-zinc-500">{action.description}</span>
                    </button>
                  ))}
                </div>
                {remixResult && (
                  <p className="mt-3 rounded-md bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                    {remixResult.notImplemented
                      ? remixResult.notImplementedReason
                      : `生成 ${remixResult.succeededCount} 张，失败 ${remixResult.failedCount} 张。`}
                  </p>
                )}
              </section>

              <section className="rounded-md border border-zinc-800 p-4">
                <h2 className="mb-3 text-sm font-medium">衍生图</h2>
                {detail.derivatives.length === 0 ? (
                  <p className="text-xs text-zinc-500">还没有衍生图。</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {detail.derivatives.map((item) => (
                      <Link
                        key={item.id}
                        href={`/apps/etsy-forge/library/${encodeURIComponent(item.id)}`}
                        className="aspect-square overflow-hidden rounded-md border border-zinc-800 bg-black"
                        title={item.remix_action ?? 'remix'}
                      >
                        <img src={item.url} alt={item.remix_action ?? item.id} className="h-full w-full object-cover" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="break-words text-zinc-300">{value}</dd>
    </div>
  );
}
