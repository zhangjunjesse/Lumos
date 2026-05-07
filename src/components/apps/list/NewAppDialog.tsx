'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface BuilderTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  highlights: string[];
}

export function NewAppDialog({
  open,
  onOpenChange,
  templates,
  newName,
  newDescription,
  selectedTemplateId,
  creating,
  createError,
  onNameChange,
  onDescriptionChange,
  onSelectTemplate,
  onSubmit,
  inputRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: BuilderTemplate[];
  newName: string;
  newDescription: string;
  selectedTemplateId: string;
  creating: boolean;
  createError: string | null;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSelectTemplate: (id: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}): React.ReactElement {
  const list = templates.length > 0 ? templates : fallbackTemplates();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!creating) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base font-medium tracking-tight">新建应用</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              起点
            </Label>
            <div className="grid gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-2">
              {list.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={cn(
                    'flex flex-col gap-1 bg-card p-3 text-left transition-colors',
                    selectedTemplateId === template.id
                      ? 'bg-foreground text-background'
                      : 'hover:bg-muted/50',
                  )}
                  onClick={() => onSelectTemplate(template.id)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{template.name}</span>
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wider',
                        selectedTemplateId === template.id
                          ? 'text-background/70'
                          : 'text-muted-foreground',
                      )}
                    >
                      {template.category}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'line-clamp-2 text-xs leading-5',
                      selectedTemplateId === template.id
                        ? 'text-background/80'
                        : 'text-muted-foreground',
                    )}
                  >
                    {template.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-name" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              应用名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="app-name"
              ref={inputRef}
              placeholder="如 客户管理 / 周报助手"
              value={newName}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !creating) onSubmit(); }}
              maxLength={64}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-description" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              描述
            </Label>
            <Textarea
              id="app-description"
              placeholder="一句话说明做什么"
              rows={2}
              value={newDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              maxLength={500}
            />
          </div>
          {createError ? (
            <p className="text-sm text-destructive">{createError}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={creating || !newName.trim()}>
            {creating ? '创建中…' : '下一步'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function fallbackTemplates(): BuilderTemplate[] {
  return [
    {
      id: 'blank',
      name: '空白应用',
      description: '从一句需求开始，由底部 AI 生成第一版。',
      category: '自由创建',
      highlights: ['AI 对话', '自由生成'],
    },
  ];
}
