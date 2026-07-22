'use client';

import * as React from 'react';
import { Loader2, Upload } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { api } from './api';
import { RunView } from './RunView';
import type { ParsedDto, StatusDto } from './types';

interface Props {
  status: StatusDto | null;
  onStatusChange: () => void;
}

export function QueryTab({ status, onStatusChange }: Props): React.ReactElement {
  const [viewRunId, setViewRunId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const repairHint = useRepairHint();

  const keywords = useParsedInput('keywords');
  const asins = useParsedInput('asins');

  const activeRunId = status?.activeRunId ?? null;
  const shownRunId = viewRunId ?? activeRunId;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const { run } = await api.startRun(keywords.parsed.items, asins.parsed.items);
      setViewRunId(run.id);
      onStatusChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  if (shownRunId) {
    return (
      <RunView
        runId={shownRunId}
        onBack={() => {
          setViewRunId(null);
          onStatusChange();
        }}
        backLabel="再查一次"
      />
    );
  }

  const canStart =
    keywords.parsed.items.length > 0 &&
    asins.parsed.items.length > 0 &&
    status?.bridge.connected === true &&
    !starting;

  return (
    <div className="max-w-3xl space-y-6">
      {repairHint ? (
        <Alert>
          <AlertDescription>{repairHint}</AlertDescription>
        </Alert>
      ) : null}
      <InputField
        label="关键词"
        hint="一行一个，最多 200 个；也可上传 Excel（放第一列）"
        placeholder={'例如：\nyoga mat\nwater bottle 32oz'}
        state={keywords}
        unit="个关键词"
      />
      <InputField
        label="ASIN"
        hint="10 位字母数字，空格、逗号或换行分隔；也可上传 Excel（放第一列）"
        placeholder={'例如：\nB0ABCD1234\nB0EFGH5678'}
        state={asins}
        unit="个 ASIN"
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <Button onClick={() => void start()} disabled={!canStart}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : null}
          开始查询
        </Button>
        <span className="text-sm text-muted-foreground">
          {keywords.parsed.items.length > 0 && asins.parsed.items.length > 0
            ? `将查询 ${keywords.parsed.items.length} 个关键词 × ${asins.parsed.items.length} 个 ASIN`
            : '两边都识别到内容后才能开始'}
        </span>
      </div>
    </div>
  );
}

/** 有未决修复工单/待确认草稿时，在查询页给一句指引（静默失败，不打扰主流程） */
function useRepairHint(): string | null {
  const [hint, setHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const [rules, settings] = await Promise.all([api.rules(), api.settings()]);
        if (rules.draft) {
          setHint('AI 已生成页面解析规则的修复草稿，去「设置」里确认采用后，代码引擎即可恢复。');
        } else if (rules.openTickets > 0 && settings.settings.executionMode === 'code') {
          setHint(
            `最近有 ${rules.openTickets} 个关键词页面解析失败。在「设置」里切换为 AI 操作再查一次，` +
            'AI 会顺带生成代码规则的修复草稿。',
          );
        }
      } catch {
        /* 提示是锦上添花，拿不到就不显示 */
      }
    })();
  }, []);

  return hint;
}

interface ParsedInputState {
  kind: 'keywords' | 'asins';
  text: string;
  setText: (v: string) => void;
  parsed: ParsedDto;
  parsing: boolean;
  uploadName: string | null;
  onUpload: (file: File) => void;
}

function useParsedInput(kind: 'keywords' | 'asins'): ParsedInputState {
  const [text, setText] = React.useState('');
  const [parsed, setParsed] = React.useState<ParsedDto>({ items: [], warnings: [] });
  const [parsing, setParsing] = React.useState(false);
  const [uploadName, setUploadName] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!text.trim()) {
      setParsed({ items: [], warnings: [] });
      return;
    }
    setParsing(true);
    const timer = setTimeout(() => {
      api
        .parseText(kind, text)
        .then(setParsed)
        .catch(() => setParsed({ items: [], warnings: ['解析失败，请重试'] }))
        .finally(() => setParsing(false));
    }, 500);
    return () => {
      clearTimeout(timer);
      setParsing(false);
    };
  }, [kind, text]);

  const onUpload = (file: File) => {
    setParsing(true);
    setUploadName(file.name);
    api
      .parseFile(kind, file)
      .then((result) => {
        setParsed(result);
        setText(result.items.join('\n'));
      })
      .catch((err) => {
        setParsed({ items: [], warnings: [err instanceof Error ? err.message : '文件解析失败'] });
      })
      .finally(() => setParsing(false));
  };

  return { kind, text, setText, parsed, parsing, uploadName, onUpload };
}

function InputField(props: {
  label: string;
  hint: string;
  placeholder: string;
  unit: string;
  state: ParsedInputState;
}): React.ReactElement {
  const { state } = props;
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{props.label}</Label>
        <div className="flex items-center gap-2">
          {state.uploadName ? (
            <span className="text-xs text-muted-foreground">来自 {state.uploadName}</span>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" />
            上传 Excel
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) state.onUpload(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <Textarea
        rows={5}
        value={state.text}
        placeholder={props.placeholder}
        onChange={(e) => state.setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {state.parsing
            ? '解析中…'
            : state.parsed.items.length > 0
              ? `识别到 ${state.parsed.items.length} ${props.unit}`
              : props.hint}
        </span>
        {state.parsed.warnings.map((w) => (
          <span key={w} className="text-amber-600 dark:text-amber-500">{w}</span>
        ))}
      </div>
      {state.parsed.items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {state.parsed.items.slice(0, 30).map((item) => (
            <Badge key={item} variant="secondary" className="font-normal">{item}</Badge>
          ))}
          {state.parsed.items.length > 30 ? (
            <span className="text-xs text-muted-foreground">…共 {state.parsed.items.length} 个</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
