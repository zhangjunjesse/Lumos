'use client';

// AI 评论分析结果展示：客户画像（性别占比 + Who/When/Where/What）+ 优点/缺点/期望/动机（Topic 英文 + Reason 中文）。

import type { ReviewAnalysis, ReviewTopic } from '../api-client';

export function ReviewAnalysisView({ analysis }: { analysis: ReviewAnalysis }) {
  const cp = analysis.customerProfile;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <h3 className="mb-3 text-sm font-medium">客户画像 · Customer Profile</h3>
        <div className="mb-4 flex items-center justify-center gap-3 text-sm">
          <span className="text-blue-500">男 {cp.genderMalePct}%</span>
          <div className="flex h-2.5 w-44 overflow-hidden rounded-full bg-muted">
            <div className="bg-blue-500" style={{ width: `${cp.genderMalePct}%` }} />
            <div className="bg-pink-500" style={{ width: `${cp.genderFemalePct}%` }} />
          </div>
          <span className="text-pink-500">女 {cp.genderFemalePct}%</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Profile label="Who" value={cp.who} />
          <Profile label="When" value={cp.when} />
          <Profile label="Where" value={cp.where} />
          <Profile label="What" value={cp.what} />
        </div>
      </section>

      <TopicSection title="优点 · Pros" items={analysis.pros} dot="bg-emerald-500" />
      <TopicSection title="缺点 · Cons" items={analysis.cons} dot="bg-rose-500" />
      <TopicSection title="消费者期望 · Consumer Expectations" items={analysis.expectations} dot="bg-fuchsia-500" />
      <TopicSection title="购买动机 · Purchase Motivations" items={analysis.motivations} dot="bg-amber-500" />
    </div>
  );
}

function Profile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] font-medium text-foreground">{label}</div>
      <div className="mt-0.5 text-muted-foreground">{value || '—'}</div>
    </div>
  );
}

function TopicSection({ title, items, dot }: { title: string; items: ReviewTopic[]; dot: string }) {
  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm font-medium">
        <span className={`size-2 rounded-full ${dot}`} />
        {title}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">—</p>
      ) : (
        <div className="divide-y">
          <div className="grid grid-cols-[140px_1fr] gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span>Topic</span>
            <span>Reason</span>
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2 text-xs">
              <span className="font-medium text-foreground">{it.topic || '—'}</span>
              <span className="text-muted-foreground">{it.reason || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
