'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { useCollectorSettings, TranscribePrefer } from '../../use-collector-settings';
import { Section } from './Section';

const PREFER_LABELS: Record<TranscribePrefer, string> = {
  'native-only': '只用原生字幕',
  'allow-asr': '允许 ASR 兜底',
  'force-local-asr': '强制语音 ASR',
};

type SaveFn = ReturnType<typeof useCollectorSettings>['save'];
type ClientSettings = NonNullable<ReturnType<typeof useCollectorSettings>['settings']>;

interface ProbeResult {
  ok: boolean;
  step: 'auth' | 'provider' | 'tts' | 'upload' | 'asr' | 'done' | 'unknown';
  reason?: string;
  provider?: string;
  bytes?: number;
  duration_seconds?: number | null;
  charged_amount?: number | null;
  transcript?: string;
  empty?: boolean;
}

const STEP_HINT: Record<ProbeResult['step'], string> = {
  auth: '没登录 Lumos 云账户。',
  provider: '没选语音服务商。',
  tts: '本机 TTS 合成失败（macOS 需 /usr/bin/say，Linux 需装 espeak）。',
  upload: '上传到 Lumos 云被拒（多半是反代 client_max_body_size 太小）。',
  asr: '火山 ASR 拒绝（resource_id 或账户余额问题）。',
  done: '链路通了。',
  unknown: '未知错误。',
};

export function TranscribeSection({
  settings,
  save,
}: {
  settings: ClientSettings;
  save: SaveFn;
}): React.ReactElement {
  const [probing, setProbing] = React.useState(false);
  const [probe, setProbe] = React.useState<ProbeResult | null>(null);

  const runProbe = React.useCallback(async () => {
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch('/api/apps/builtin/douyin-collector/transcribe/probe', {
        method: 'POST',
      });
      const json = (await res.json()) as ProbeResult;
      setProbe(json);
    } catch (err) {
      setProbe({
        ok: false,
        step: 'unknown',
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProbing(false);
    }
  }, []);

  return (
    <Section
      title="转写策略"
      description="字幕优先抖音原生 → 抖音 ASR → Lumos speech-to-text MCP。"
    >
      {/* "长视频分段(分钟)" 字段曾经在这里露出 — 它对应 settings 里
          `longVideoSplitMinutes`，但 transcribe.ts 实际并没有读这个值做
          ffmpeg 分段。露出会让用户误以为 30 分钟以上的视频会被自动切片，
          实际上是整段直接送 ASR。删掉这个 input 直到真有 chunking 实现，
          避免说谎。 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>来源优先级</Label>
          <Select
            value={settings.transcribePrefer}
            onValueChange={(v) => void save({ transcribePrefer: v as TranscribePrefer })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PREFER_LABELS) as TranscribePrefer[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PREFER_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>并发上限</Label>
          <Input
            type="number"
            min={1}
            max={8}
            value={settings.transcribeConcurrency}
            onChange={(e) =>
              void save({ transcribeConcurrency: Number(e.target.value) || 3 })
            }
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            合成一段中文测试音频，跑完整 ASR 链路（登录 → 上传 → 火山转写），10 秒内
            告诉你哪一步通了哪一步没通。第一次配置 / 服务商换密钥后建议跑一次。
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runProbe()}
            disabled={probing}
            className="shrink-0"
          >
            {probing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {probing ? '测试中…' : '测试 ASR 链路'}
          </Button>
        </div>
        {probe ? (
          <div
            className={
              'rounded-md border px-3 py-2 text-xs ' +
              (probe.ok
                ? 'border-emerald-300/40 bg-emerald-50 dark:border-emerald-300/20 dark:bg-emerald-950/30'
                : 'border-rose-300/40 bg-rose-50 dark:border-rose-300/20 dark:bg-rose-950/30')
            }
          >
            <div className="flex items-start gap-2">
              {probe.ok ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
              )}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {probe.ok
                    ? `链路通了 · ${probe.provider ?? '未知'}${
                        probe.charged_amount != null
                          ? ` · 计费 ¥${probe.charged_amount.toFixed(4)}`
                          : ''
                      }`
                    : `卡在「${STEP_HINT[probe.step]}」`}
                </p>
                {probe.ok && probe.transcript ? (
                  <p className="text-muted-foreground">
                    转写结果：「{probe.transcript}」
                    {probe.empty ? '（空，本机 TTS 输出可能太短或火山判为静音）' : ''}
                  </p>
                ) : null}
                {!probe.ok && probe.reason ? (
                  <p className="text-muted-foreground">{probe.reason}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
