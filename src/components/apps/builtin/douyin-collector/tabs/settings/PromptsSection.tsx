'use client';

import * as React from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { useCollectorSettings } from '../../use-collector-settings';
import { Section } from './Section';

type SaveFn = ReturnType<typeof useCollectorSettings>['save'];
type ClientSettings = NonNullable<ReturnType<typeof useCollectorSettings>['settings']>;

export function PromptsSection({
  settings,
  save,
}: {
  settings: ClientSettings;
  save: SaveFn;
}): React.ReactElement {
  const [drafts, setDrafts] = React.useState({
    summary: settings.aiSummaryPrompt,
    chapters: settings.aiChaptersPrompt,
    tags: settings.aiTagsPrompt,
  });
  return (
    <Section
      title="AI 提示词"
      description="决定 AI 怎么写摘要、切章节、建标签。改完按「保存提示词」生效。"
    >
      <Label>摘要提示词</Label>
      <Textarea
        rows={3}
        value={drafts.summary}
        onChange={(e) => setDrafts({ ...drafts, summary: e.target.value })}
      />
      <Label>章节切分提示词</Label>
      <Textarea
        rows={3}
        value={drafts.chapters}
        onChange={(e) => setDrafts({ ...drafts, chapters: e.target.value })}
      />
      <Label>标签建议提示词</Label>
      <Textarea
        rows={3}
        value={drafts.tags}
        onChange={(e) => setDrafts({ ...drafts, tags: e.target.value })}
      />
      <div>
        <Button
          variant="outline"
          onClick={() =>
            void save({
              aiSummaryPrompt: drafts.summary,
              aiChaptersPrompt: drafts.chapters,
              aiTagsPrompt: drafts.tags,
            })
          }
        >
          <Save className="size-3.5" />
          保存提示词
        </Button>
      </div>
    </Section>
  );
}

export function RiskSection({
  settings,
  save,
}: {
  settings: ClientSettings;
  save: SaveFn;
}): React.ReactElement {
  const [draft, setDraft] = React.useState(settings.riskNote);
  return (
    <Section
      title="风险边界"
      description="对外提到这个应用时的承诺。会出现在状态页和 IM 命令的 help 输出。"
    >
      <Textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <div>
        <Button variant="outline" onClick={() => void save({ riskNote: draft })}>
          <Save className="size-3.5" />
          保存
        </Button>
      </div>
    </Section>
  );
}
