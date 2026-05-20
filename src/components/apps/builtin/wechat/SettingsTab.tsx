'use client';

import * as React from 'react';
import { AlertCircle, Loader2, Plus, RefreshCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { SettingsExcludedDialog } from './SettingsExcludedDialog';
import { SettingsPrompts } from './SettingsPrompts';
import { SettingsGroupTags } from './SettingsGroupTags';
import { SettingsTopicWhitelistDialog } from './SettingsTopicWhitelistDialog';
import { displayWechatName } from './display-helpers';
import type { PromptKey } from './default-prompts';
import {
  ANALYSIS_WINDOW_LABEL,
  SENSITIVITY_HINT,
  SENSITIVITY_LABEL,
  TOPIC_BATCH_SIZES,
  TOPIC_MIN_CHAT_MESSAGES,
  type AISensitivity,
  type AnalysisWindow,
  type AppSettings,
  type ProviderOption,
  type TopicBatchSize,
  type TopicMinChatMessages,
} from './app-settings';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WINDOWS: AnalysisWindow[] = [1, 7, 14, 30, 60];
const SENSITIVITIES: AISensitivity[] = ['strict', 'balanced', 'loose'];

const FOLLOW_GLOBAL = '__follow_global__';
const FOLLOW_PROVIDER = '__follow_provider__';

export function SettingsTab({
  settings,
  providers,
  saving,
  error,
  onChange,
  onRetrySave,
}: {
  settings: AppSettings;
  providers: ProviderOption[];
  saving: boolean;
  error: string | null;
  onChange: (next: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  onRetrySave: () => Promise<void> | void;
}): React.ReactElement {
  const [excludedOpen, setExcludedOpen] = React.useState(false);
  const [includedOpen, setIncludedOpen] = React.useState(false);
  const [topicPersonalOpen, setTopicPersonalOpen] = React.useState(false);
  const [topicGroupOpen, setTopicGroupOpen] = React.useState(false);

  const selectedProvider = settings.ai.providerId
    ? providers.find((p) => p.id === settings.ai.providerId) ?? null
    : null;
  const selectedProviderMissing = Boolean(settings.ai.providerId && !selectedProvider);

  const setProviderId = (id: string) => {
    onChange((prev) => ({
      ...prev,
      ai: {
        ...prev.ai,
        providerId: id === FOLLOW_GLOBAL ? null : id,
        model: null, // model resets when provider changes
      },
    }));
  };

  const setModel = (value: string) => {
    onChange((prev) => ({
      ...prev,
      ai: { ...prev.ai, model: value === FOLLOW_PROVIDER ? null : value },
    }));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-12">
      <SaveBanner saving={saving} error={error} onRetry={onRetrySave} />

      <Section
        title="AI"
        description="决定 AI 用什么模型分析消息、看多远的历史、多敏感地识别跟进。"
      >
        <Field
          label="服务商"
          hint={
            selectedProviderMissing
              ? '当前保存的服务商不可用，可能是本地登录授权或已被删除'
              : '跟随全局即与 Lumos 主对话同源'
          }
        >
          <div className="flex flex-col gap-2">
            <Select value={settings.ai.providerId ?? FOLLOW_GLOBAL} onValueChange={setProviderId}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_GLOBAL}>跟随 Lumos 全局默认</SelectItem>
                {selectedProviderMissing ? (
                  <SelectItem value={settings.ai.providerId!} disabled>
                    当前选择不可用
                  </SelectItem>
                ) : null}
                {providers.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    暂无支持文本生成的 API Key 服务商
                  </SelectItem>
                ) : (
                  providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? ' · 全局默认' : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedProviderMissing ? (
              <div className="flex max-w-md items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0">
                  <p>微信助手需要 API Key 类型的文本生成服务商，本地登录授权服务商不能用于这里。</p>
                  <button
                    type="button"
                    className="mt-1 font-medium underline-offset-4 hover:underline"
                    onClick={() => setProviderId(FOLLOW_GLOBAL)}
                  >
                    改为跟随全局默认
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Field>

        <Field
          label="模型"
          hint={
            selectedProvider
              ? undefined
              : selectedProviderMissing
                ? '当前服务商不可用，请先切换服务商'
                : '锁定服务商后才能选具体模型'
          }
        >
          <Select
            value={settings.ai.model ?? FOLLOW_PROVIDER}
            onValueChange={setModel}
            disabled={!selectedProvider}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FOLLOW_PROVIDER}>跟随服务商默认</SelectItem>
              {selectedProvider?.models.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="分析窗口" hint="AI 往前看多久的消息">
          <Select
            value={String(settings.ai.windowDays)}
            onValueChange={(value) =>
              onChange((prev) => ({
                ...prev,
                ai: { ...prev.ai, windowDays: Number(value) as AnalysisWindow },
              }))
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {ANALYSIS_WINDOW_LABEL[w]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="灵敏度" hint={SENSITIVITY_HINT[settings.ai.sensitivity]} align="top">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {SENSITIVITIES.map((s) => {
              const active = settings.ai.sensitivity === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      ai: { ...prev.ai, sensitivity: s },
                    }))
                  }
                  className={cn(
                    'rounded px-3 py-1 text-xs transition-colors',
                    active
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {SENSITIVITY_LABEL[s]}
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      <Section
        title="AI 提示词"
        description="AI 用这些指令分析消息。改了立即生效，可随时重置为默认。"
      >
        <SettingsPrompts
          prompts={settings.ai.prompts}
          onChange={(key: PromptKey, value: string) =>
            onChange((prev) => ({
              ...prev,
              ai: { ...prev.ai, prompts: { ...prev.ai.prompts, [key]: value } },
            }))
          }
        />
      </Section>

      <Section title="概况" description="选择默认要展示的报表。关掉的报表不会出现在概况页。">
        <Field label="互动 Top">
          <Switch
            checked={settings.overview.showInteractionRank}
            onCheckedChange={(checked) =>
              onChange((prev) => ({
                ...prev,
                overview: { ...prev.overview, showInteractionRank: checked },
              }))
            }
          />
        </Field>
        <Field label="久未联系">
          <Switch
            checked={settings.overview.showHeatmap}
            onCheckedChange={(checked) =>
              onChange((prev) => ({
                ...prev,
                overview: { ...prev.overview, showHeatmap: checked },
              }))
            }
          />
        </Field>
        <Field label="近期话题">
          <Switch
            checked={settings.overview.showTopics}
            onCheckedChange={(checked) =>
              onChange((prev) => ({
                ...prev,
                overview: { ...prev.overview, showTopics: checked },
              }))
            }
          />
        </Field>
      </Section>

      <Section
        title="近期话题分析"
        description="AI 只会分析下面白名单里的对话。默认空 = 不分析任何聊天。窗口和服务商沿用上面的「AI」设置。"
      >
        <Field label="私聊白名单" hint={`已选 ${settings.topicAnalysis.whitelistPersonal.length} 个`} align="top">
          <Button variant="outline" size="sm" onClick={() => setTopicPersonalOpen(true)} className="gap-1.5">
            <Plus className="size-3.5" />
            选择私聊
          </Button>
        </Field>
        <Field label="群聊白名单" hint={`已选 ${settings.topicAnalysis.whitelistGroups.length} 个`} align="top">
          <Button variant="outline" size="sm" onClick={() => setTopicGroupOpen(true)} className="gap-1.5">
            <Plus className="size-3.5" />
            选择群聊
          </Button>
        </Field>
        <Field label="单批消息上限" hint="每次送给 AI 的最多消息条数。越大越准但也越贵">
          <Select
            value={String(settings.topicAnalysis.maxMessagesPerCall)}
            onValueChange={(value) =>
              onChange((prev) => ({
                ...prev,
                topicAnalysis: {
                  ...prev.topicAnalysis,
                  maxMessagesPerCall: Number(value) as TopicBatchSize,
                },
              }))
            }
          >
            <SelectTrigger className="w-32 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOPIC_BATCH_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)} className="tabular-nums">
                  {n} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="单聊最小消息数" hint="一个对话至少有几条消息才会进 AI 分析（防止给两条 hi 也跑一次）">
          <Select
            value={String(settings.topicAnalysis.minChatMessages)}
            onValueChange={(value) =>
              onChange((prev) => ({
                ...prev,
                topicAnalysis: {
                  ...prev.topicAnalysis,
                  minChatMessages: Number(value) as TopicMinChatMessages,
                },
              }))
            }
          >
            <SelectTrigger className="w-32 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOPIC_MIN_CHAT_MESSAGES.map((n) => (
                <SelectItem key={n} value={String(n)} className="tabular-nums">
                  ≥ {n} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section
        title="只分析这些对话(白名单)"
        description="勾中后,只有这里列出的人 / 群会进入 AI 分析。留空 = 不限,默认全分析。优先级高于黑名单。"
      >
        <ExcludedSection
          excludedIds={settings.includedPersonIds}
          onOpen={() => setIncludedOpen(true)}
          onRemove={(id) =>
            onChange((prev) => ({
              ...prev,
              includedPersonIds: prev.includedPersonIds.filter((x) => x !== id),
            }))
          }
        />
      </Section>

      <Section
        title="不分析的对话(黑名单)"
        description="勾中的人和群消息不会进入 AI 分析、不会出现在概况报表里。白名单为空时此项才会生效。"
      >
        <ExcludedSection
          excludedIds={settings.excludedPersonIds}
          onOpen={() => setExcludedOpen(true)}
          onRemove={(id) =>
            onChange((prev) => ({
              ...prev,
              excludedPersonIds: prev.excludedPersonIds.filter((x) => x !== id),
            }))
          }
        />
      </Section>

      <Section title="跟进与提醒">
        <Field label="默认提醒时段" hint="新建提醒时默认填进的时间">
          <Select
            value={String(settings.followups.defaultReminderHour)}
            onValueChange={(value) =>
              onChange((prev) => ({
                ...prev,
                followups: { ...prev.followups, defaultReminderHour: Number(value) },
              }))
            }
          >
            <SelectTrigger className="w-28 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)} className="tabular-nums">
                  {String(h).padStart(2, '0')}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section
        title="群标签"
        description="把「工作群」等分类沉淀成可复用规则（如 工作群 = 刘总所在的群）。之后可让 AI「总结工作群」，或给每日总结按标签限定群范围。"
      >
        <SettingsGroupTags
          tags={settings.groupTags}
          onChange={(next) => onChange((prev) => ({ ...prev, groupTags: next }))}
        />
      </Section>

      <SettingsExcludedDialog
        open={includedOpen}
        selectedIds={settings.includedPersonIds}
        onOpenChange={setIncludedOpen}
        title="选择只分析的对话(白名单)"
        description="勾中的人 / 群是 AI 分析的唯一范围;留空 = 不限,默认全分析。"
        confirmLabel="保存白名单（已选 {count}）"
        onConfirm={(ids) => {
          onChange((prev) => ({ ...prev, includedPersonIds: ids }));
          setIncludedOpen(false);
        }}
      />
      <SettingsExcludedDialog
        open={excludedOpen}
        selectedIds={settings.excludedPersonIds}
        onOpenChange={setExcludedOpen}
        onConfirm={(ids) => {
          onChange((prev) => ({ ...prev, excludedPersonIds: ids }));
          setExcludedOpen(false);
        }}
      />

      <SettingsTopicWhitelistDialog
        open={topicPersonalOpen}
        kind="personal"
        selectedIds={settings.topicAnalysis.whitelistPersonal}
        onOpenChange={setTopicPersonalOpen}
        onConfirm={(ids) => {
          onChange((prev) => ({
            ...prev,
            topicAnalysis: { ...prev.topicAnalysis, whitelistPersonal: ids },
          }));
          setTopicPersonalOpen(false);
        }}
      />

      <SettingsTopicWhitelistDialog
        open={topicGroupOpen}
        kind="group"
        selectedIds={settings.topicAnalysis.whitelistGroups}
        onOpenChange={setTopicGroupOpen}
        onConfirm={(ids) => {
          onChange((prev) => ({
            ...prev,
            topicAnalysis: { ...prev.topicAnalysis, whitelistGroups: ids },
          }));
          setTopicGroupOpen(false);
        }}
      />
    </div>
  );
}

function SaveBanner({
  saving,
  error,
  onRetry,
}: {
  saving: boolean;
  error: string | null;
  onRetry: () => Promise<void> | void;
}) {
  if (!saving && !error) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-xs',
        error
          ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {error ? <AlertCircle className="size-3.5 shrink-0" /> : <Loader2 className="size-3.5 shrink-0 animate-spin" />}
        <span className="min-w-0 break-words">{error ? `保存失败：${error}` : '正在保存…'}</span>
      </span>
      {error ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onRetry()}
          className="h-7 shrink-0 px-2 text-xs text-current hover:bg-current/10 hover:text-current"
        >
          <RefreshCw className="size-3.5" />
          重试保存
        </Button>
      ) : null}
    </div>
  );
}

function ExcludedSection({
  excludedIds,
  onOpen,
  onRemove,
}: {
  excludedIds: string[];
  onOpen: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {excludedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {excludedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs"
            >
              <span className="max-w-[180px] truncate text-muted-foreground">
                {excludedLabel(id)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(id)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Button variant="outline" size="sm" onClick={onOpen} className="w-fit">
        <Plus className="size-3.5" />
        {excludedIds.length === 0 ? '选择对话' : '继续添加'}
      </Button>
    </div>
  );
}

function excludedLabel(id: string): string {
  return displayWechatName(null, id, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="border-b pb-3">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  align,
  children,
}: {
  label: string;
  hint?: string;
  align?: 'top';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 sm:grid-cols-[180px_1fr]',
        align === 'top' ? 'sm:items-start' : 'sm:items-center',
      )}
    >
      <Label className="flex flex-col gap-0.5 text-sm font-medium leading-tight">
        {label}
        {hint ? (
          <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </Label>
      <div>{children}</div>
    </div>
  );
}
