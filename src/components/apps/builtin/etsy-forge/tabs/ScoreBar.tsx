'use client';

// 1-10 评分条:一行 10 格的细条(不挡图)。点格子打分,点当前分=清除。产品图 hover 和大图模态共用。

export function ScoreBar({ value, onPick, className }: { value: number; onPick: (n: number) => void; className?: string }) {
  return (
    <div className={`flex w-full overflow-hidden rounded-sm border bg-card/95 ${className ?? ''}`}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick(n === value ? 0 : n);
          }}
          title={n === value ? '再点一次清除评分' : `打 ${n} 分`}
          className={`flex-1 border-r py-0.5 text-center text-[10px] leading-tight last:border-r-0 ${
            n === value ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
