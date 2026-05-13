'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Compass,
  MessageCircleHeart,
  ShoppingBag,
  Sparkles,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import { StatusDot } from './AppCard';

interface BuiltinWeChatStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  export?: { ready: boolean; phase: string; supported: boolean; keyCount?: number };
  im?: { enabled: boolean; configured: boolean; isDefault: boolean };
}

export function BuiltinWeChatCard({
  status,
}: {
  status: BuiltinWeChatStatus | null;
}): React.ReactElement {
  const ready = !!status?.export?.ready;
  const phase = status?.export?.phase;
  return (
    <Link
      href="/apps/wechat-assistant"
      className="group block rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
          <MessageCircleHeart className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight tracking-tight">
              微信助手
            </h3>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 微信
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 shrink-0">
            <span className="inline-flex items-center gap-1">
              打开
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Button>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        本机读取微信消息，提炼今日重点、画像、待办与定时任务
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={ready ? 'ok' : 'warn'} />
          <span className="text-muted-foreground">
            {ready ? '已就绪' : phaseLabel(phase)}
          </span>
        </span>
        {status?.export?.keyCount ? (
          <span className="text-muted-foreground tabular-nums">
            · {status.export.keyCount} 个密钥
          </span>
        ) : null}
        {status?.im?.enabled ? (
          <span className="text-muted-foreground">· IM 已启用</span>
        ) : null}
      </div>
    </Link>
  );
}

function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-consent':
      return '需要授权';
    case 'needs-env':
      return '环境准备中';
    case 'needs-resign':
      return '需要重签名';
    case 'needs-extract':
      return '恢复密钥';
    case 'needs-restore':
      return '恢复消息';
    case 'unsupported':
      return '平台不支持';
    default:
      return '检测中';
  }
}

interface BuiltinGoofishStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  auth?: { ready: boolean; accountCount: number; loggedInCount: number };
  ready?: boolean;
  phase?: string;
}

export function BuiltinGoofishCard({
  status,
}: {
  status: BuiltinGoofishStatus | null;
}): React.ReactElement {
  const ready = !!status?.ready;
  const phase = status?.phase;
  const accountCount = status?.auth?.accountCount ?? 0;
  const loggedInCount = status?.auth?.loggedInCount ?? 0;
  return (
    <Link
      href="/apps/goofish-assistant"
      className="group block rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-sm">
          <ShoppingBag className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight tracking-tight">
              闲鱼助手
            </h3>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 闲鱼
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 shrink-0">
            <span className="inline-flex items-center gap-1">
              打开
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Button>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        管理闲鱼买家会话、AI 草稿、白名单自动回复、多渠道提醒和市场搜索
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={ready ? 'ok' : 'warn'} />
          <span className="text-muted-foreground">
            {ready ? '已就绪' : goofishPhaseLabel(phase)}
          </span>
        </span>
        {accountCount > 0 ? (
          <span className="text-muted-foreground tabular-nums">
            · {loggedInCount}/{accountCount} 账号在线
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function goofishPhaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-install':
      return '应用未安装';
    case 'needs-auth':
      return '需要登录闲鱼账号';
    default:
      return '检测中';
  }
}

interface BuiltinEcommerceStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  providers?: { analysis: { ok: boolean }; image: { ok: boolean } };
  inventory?: { runningJobs: number; inputCount: number };
  ready?: boolean;
  phase?: string;
}

export function BuiltinEcommerceCard({
  status,
}: {
  status: BuiltinEcommerceStatus | null;
}): React.ReactElement {
  const ready = !!status?.ready;
  const phase = status?.phase;
  const running = status?.inventory?.runningJobs ?? 0;
  const inputs = status?.inventory?.inputCount ?? 0;
  return (
    <Link
      href="/apps/ecommerce-assistant"
      className="group block rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white shadow-sm">
          <Sparkles className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight tracking-tight">
              电商商品助手
            </h3>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 电商
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 shrink-0">
            <span className="inline-flex items-center gap-1">
              打开
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Button>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        一键生成电商商品图、识别商品资料，含 SOP 流程、3 方向评分、终版精修和白底兜底
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={ready ? 'ok' : 'warn'} />
          <span className="text-muted-foreground">{ready ? '已就绪' : ecommercePhaseLabel(phase)}</span>
        </span>
        {inputs > 0 ? (
          <span className="text-muted-foreground tabular-nums">· {inputs} 个商品输入</span>
        ) : null}
        {running > 0 ? (
          <span className="text-muted-foreground tabular-nums">· {running} 个任务进行中</span>
        ) : null}
      </div>
    </Link>
  );
}

function ecommercePhaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-install':
      return '应用未安装';
    case 'needs-image-provider':
      return '需要图像服务商';
    case 'needs-analysis-provider':
      return '需要分析 provider';
    case 'failed':
      return '应用数据层失败';
    default:
      return '检测中';
  }
}

interface BuiltinDouyinCollectorStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  auth?: { ready: boolean; cookieValid: boolean; lastCheckedAt: string | null };
  sources?: { creators: number; keywords: number };
  queue?: { runningJobs: number; pendingJobs: number; lastRunFailure: string | null };
  library?: { videos: number; drafts: number; published: number };
  ready?: boolean;
  phase?: string;
}

export function BuiltinDouyinCollectorCard({
  status,
}: {
  status: BuiltinDouyinCollectorStatus | null;
}): React.ReactElement {
  const ready = !!status?.ready;
  const phase = status?.phase;
  const creators = status?.sources?.creators ?? 0;
  const keywords = status?.sources?.keywords ?? 0;
  const videos = status?.library?.videos ?? 0;
  return (
    <Link
      href="/apps/douyin-collector"
      className="group block rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-sm">
          <Video className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight tracking-tight">
              抖音采集器
            </h3>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 知识采集
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 shrink-0">
            <span className="inline-flex items-center gap-1">
              打开
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Button>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        按博主或关键词采集抖音视频，抓字幕、做摘要、入知识库；长视频自动分段转写
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={ready ? 'ok' : 'warn'} />
          <span className="text-muted-foreground">
            {ready ? '已就绪' : douyinPhaseLabel(phase)}
          </span>
        </span>
        {creators + keywords > 0 ? (
          <span className="text-muted-foreground tabular-nums">
            · {creators} 博主 / {keywords} 关键词
          </span>
        ) : null}
        {videos > 0 ? (
          <span className="text-muted-foreground tabular-nums">· {videos} 条已采集</span>
        ) : null}
      </div>
    </Link>
  );
}

function douyinPhaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'not_configured':
      return '尚未配置';
    case 'needs-install':
      return '应用未安装';
    case 'needs_auth':
      return '需要登录抖音 Cookie';
    case 'syncing':
      return '采集进行中';
    case 'failed':
      return '上次运行失败';
    default:
      return '检测中';
  }
}

interface BuiltinDeepResearchStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  install?: { installed: boolean; version: string | null };
  tasks?: { total: number; active: number; paused: number; delivered: number; failed: number };
  library?: { evidence: number; reports: number };
  ready?: boolean;
  phase?: string;
}

export function BuiltinDeepResearchCard({
  status,
}: {
  status: BuiltinDeepResearchStatus | null;
}): React.ReactElement {
  const ready = !!status?.ready;
  const phase = status?.phase;
  const total = status?.tasks?.total ?? 0;
  const active = status?.tasks?.active ?? 0;
  const delivered = status?.tasks?.delivered ?? 0;
  return (
    <Link
      href="/apps/deep-research"
      className="group block rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm">
          <Compass className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight tracking-tight">
              深度调研
            </h3>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 知识采集
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 shrink-0">
            <span className="inline-flex items-center gap-1">
              打开
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Button>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        对话驱动的端到端调研工作台：澄清 → 目标 → 拆解 → 风险 → 采集 → 综合 → 报告 → 自检
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={ready ? 'ok' : 'warn'} />
          <span className="text-muted-foreground">
            {ready ? '已就绪' : deepResearchPhaseLabel(phase)}
          </span>
        </span>
        {total > 0 ? (
          <span className="text-muted-foreground tabular-nums">
            · {active}/{total} 进行中
          </span>
        ) : null}
        {delivered > 0 ? (
          <span className="text-muted-foreground tabular-nums">· {delivered} 已交付</span>
        ) : null}
      </div>
    </Link>
  );
}

function deepResearchPhaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'not_configured':
      return '尚未创建任务';
    case 'needs-install':
      return '应用未安装';
    case 'syncing':
      return '调研进行中';
    case 'failed':
      return '有任务失败';
    default:
      return '检测中';
  }
}
