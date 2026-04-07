'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

export interface WorkflowKnowledgeConfigDraft {
  enabled: boolean;
  defaultTagNames: string[];
  allowAgentTagSelection: boolean;
  topK?: number;
}

interface KbTagOption {
  id: string;
  name: string;
  category: string;
  color: string;
  usage_count: number;
}

interface WorkflowKnowledgePanelProps {
  value: WorkflowKnowledgeConfigDraft;
  onChange: (next: WorkflowKnowledgeConfigDraft) => void;
}

export function WorkflowKnowledgePanel({ value, onChange }: WorkflowKnowledgePanelProps) {
  const [tags, setTags] = useState<KbTagOption[] | null>(null);

  useEffect(() => {
    if (!value.enabled) return;
    let cancelled = false;
    fetch('/api/knowledge/tags')
      .then(r => r.json())
      .then((data: KbTagOption[] | { error?: string }) => {
        if (!cancelled && Array.isArray(data)) setTags(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [value.enabled]);

  const toggleTag = (name: string) => {
    const selected = new Set(value.defaultTagNames);
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    onChange({ ...value, defaultTagNames: Array.from(selected) });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-semibold">知识库访问</Label>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            启用后,agent 可调用 search_knowledge 检索本地知识库
          </p>
        </div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
        />
      </div>

      {value.enabled && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">默认标签范围</Label>
            <p className="text-[10px] text-muted-foreground">
              点击选择,不选则检索全部条目
            </p>
            {tags === null ? (
              <p className="text-[10px] text-muted-foreground">加载中...</p>
            ) : tags.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">暂无标签</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {tags.map(tag => {
                  const selected = value.defaultTagNames.includes(tag.name);
                  return (
                    <Badge
                      key={tag.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      variant={selected ? 'default' : 'outline'}
                      className="cursor-pointer text-[10px] font-normal focus:outline-none focus:ring-2 focus:ring-ring"
                      onClick={() => toggleTag(tag.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleTag(tag.name);
                        }
                      }}
                    >
                      {tag.name}
                      {tag.usage_count > 0 && (
                        <span className="ml-1 opacity-60">·{tag.usage_count}</span>
                      )}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">允许 agent 自选标签</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                开启后,agent 可根据问题动态覆盖默认标签
              </p>
            </div>
            <Switch
              checked={value.allowAgentTagSelection}
              onCheckedChange={(checked) => onChange({ ...value, allowAgentTagSelection: checked })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">单次返回条数 (topK)</Label>
            <Input
              type="number"
              value={value.topK ?? ''}
              onChange={e => {
                const raw = e.target.value.trim();
                const parsed = raw ? Math.floor(Number(raw)) : undefined;
                const next = Number.isFinite(parsed) && parsed! > 0
                  ? Math.min(10, parsed!)
                  : undefined;
                onChange({ ...value, topK: next });
              }}
              className="h-8 text-xs w-24"
              min={1}
              max={10}
              placeholder="5"
            />
            <p className="text-[10px] text-muted-foreground">默认 5,最大 10</p>
          </div>
        </>
      )}
    </div>
  );
}
