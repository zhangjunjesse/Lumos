'use client';

import * as React from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { DouyinCollectorStatus } from '../douyin-types';

interface ChecklistItem {
  done: boolean;
  title: string;
  hint: string;
  /** Optional one-click jump to the relevant settings page. PM affordance:
   *  every "you must configure X" item should answer "where" with a link,
   *  not just a sentence pointing the user at a path they have to find. */
  cta?: { label: string; href: string };
  /** Optional inline action button (no navigation) — for one-click toggle
   *  things like "open auto-transcribe" that don't need a page change. */
  inlineAction?: { label: string; onClick: () => void | Promise<void> };
}

/**
 * First-time setup guidance shown above Overview KPIs. Hides itself once
 * every step is done so it doesn't clutter the dashboard for returning
 * users. Uses real status / settings signals — no magic flag, no
 * dismiss-and-forget. If the user removes their last subscription, the
 * checklist re-appears (which is honest: they're back to "not configured").
 */
export function SetupChecklist({
  status,
  hasLibraryCollection,
  autoTranscribe,
  onEnableAutoTranscribe,
}: {
  status: DouyinCollectorStatus | null;
  hasLibraryCollection: boolean;
  autoTranscribe: boolean;
  onEnableAutoTranscribe?: () => void | Promise<void>;
}): React.ReactElement | null {
  // Round 166: per real-test verification (Rounds 160/161), 博主 /
  // 关键词的自动巡更已被抖音 anti-bot 封锁；「粘贴链接立即采集」是
  // 当前唯一稳定路径。Checklist 第一步从"订阅"改成"粘链接"——把
  // 用户引到能跑通的入口，而不是引去做一件已知会失败的事。
  const asrCta: ChecklistItem['cta'] | undefined =
    status?.transcribe?.asrReady
      ? undefined
      : status?.transcribe?.cloudLoggedIn === false
        ? { label: '去登录 Lumos 云', href: '/settings#providers' }
        : status?.transcribe?.speechProviderConfigured === false
          ? { label: '去选语音服务商', href: '/settings#providers' }
          : undefined;
  const items: ChecklistItem[] = [
    {
      done: status?.transcribe?.asrReady ?? false,
      title: '打通字幕兜底（语音 ASR）',
      hint:
        status?.transcribe?.cloudLoggedIn === false
          ? '转写要计费由 Lumos 云端统一记账，先登录账户。'
          : status?.transcribe?.speechProviderConfigured === false
            ? '在 Providers 里选语音服务商（火山引擎 ASR）。没有原生字幕的视频要靠它兜底转文字。'
            : '语音 ASR 链路就绪——没原生字幕的视频也能转文字。',
      cta: asrCta,
    },
    {
      done: !!status?.library?.videos && status.library.videos > 0,
      title: '粘贴第一条抖音视频链接',
      hint: '在「采集任务 → 粘贴链接立即采集」粘抖音视频 URL（一行一个，支持 v.douyin.com 短链）。这是目前最稳定的单条入库路径；博主全量 / 关键词搜索需要先在本应用设置里配抖音 Cookie。',
    },
    {
      done: hasLibraryCollection,
      title: '选择默认入库 collection',
      hint: '从已有 knowledge collection 里选一个；没建过的话先去 /knowledge 创建空集合。',
      cta: hasLibraryCollection ? undefined : { label: '去新建 / 选集合', href: '/knowledge' },
    },
    {
      // Onboarding gap: ASR is ready and user has videos in library, but
      // autoTranscribe is off — every new collect needs a manual click on
      // "抓字幕". Default is off; SetupChecklist nudges the user to flip
      // it once they've passed the ASR-ready gate.
      done: autoTranscribe,
      title: '开启自动转写（采集后自动抓字幕）',
      hint: autoTranscribe
        ? '已开启 — 采集到的视频会自动走一遍 ASR；失败的会留在「重跑失败」队列。'
        : '关掉时，每条新视频都要手动点「抓字幕」才有字幕。开启后，采集 → ASR → 摘要 → 入库 一条龙。',
      inlineAction:
        !autoTranscribe && status?.transcribe?.asrReady && onEnableAutoTranscribe
          ? { label: '一键开启', onClick: onEnableAutoTranscribe }
          : undefined,
    },
    {
      done: !!status?.library?.published && status.library.published > 0,
      title: '完成第一次入库（curate → publish）',
      hint: '在「整理」页改 summary / tags / 备注，确认后点「入知识库」；或在「资料库」用批量入库一次发布多条。这一步走通了，整个采集 → 整理 → 入库的闭环才完整。',
    },
  ];

  if (items.every((i) => i.done)) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">起步清单</h3>
        <p className="text-xs text-muted-foreground">
          {items.filter((i) => i.done).length} / {items.length}
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs">
            {item.done ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
            ) : (
              <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p
                className={
                  item.done
                    ? 'text-foreground line-through decoration-muted-foreground/40'
                    : 'font-medium text-foreground'
                }
              >
                {item.title}
              </p>
              {!item.done ? (
                <>
                  <p className="mt-0.5 text-muted-foreground">{item.hint}</p>
                  {item.cta ? (
                    <Link
                      href={item.cta.href}
                      className="mt-1 inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
                    >
                      {item.cta.label}
                      <ArrowRight className="size-3" />
                    </Link>
                  ) : null}
                  {item.inlineAction ? (
                    <button
                      type="button"
                      onClick={() => void item.inlineAction!.onClick()}
                      className="mt-1 inline-flex items-center gap-0.5 rounded border border-border px-2 py-0.5 text-foreground hover:bg-foreground/5"
                    >
                      {item.inlineAction.label}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
