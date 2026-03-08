"use client";

import Link from "next/link";

export default function KnowledgePage() {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-center px-8 py-12">
      <section className="w-full rounded-3xl border bg-gradient-to-br from-sky-50 via-background to-emerald-50 p-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Knowledge Space</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">知识库页面正在开发中</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          当前版本先聚焦资料库体验。知识检索策略已迁移到设置页，可在设置中调整模式、语义扩展与召回数量。
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/settings#knowledge"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            打开知识库设置
          </Link>
          <Link
            href="/library"
            className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            返回资料库
          </Link>
        </div>
      </section>
    </div>
  );
}
