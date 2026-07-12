'use client';

// 来源缩略图:点图统一放大;有外链(原商品 Etsy)时角上放个 ↗ 单独跳。缺图显示占位。

export function SrcThumb({ label, url, caption, href, placeholder, onZoom }: { label: string; url: string | null; caption?: string | null; href?: string | null; placeholder?: string; onZoom: (u: string) => void }) {
  const inner = url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
  ) : (
    <span className="line-clamp-3 flex h-full w-full items-center justify-center p-1 text-center text-[9px] leading-tight text-muted-foreground">{placeholder || '无'}</span>
  );
  return (
    <div className="w-16 shrink-0 text-center">
      <div className="relative size-16">
        <button
          type="button"
          disabled={!url}
          onClick={() => url && onZoom(url)}
          title={caption || `${label}（点击放大）`}
          className="block size-16 overflow-hidden rounded-md border hover:ring-1 hover:ring-foreground disabled:cursor-default"
        >
          {inner}
        </button>
        {url && href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="在 Etsy 打开"
            className="absolute right-0.5 top-0.5 rounded bg-black/55 px-1 text-[9px] leading-tight text-white hover:bg-black/75"
          >
            ↗
          </a>
        )}
      </div>
      <div className="mt-0.5 text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}
