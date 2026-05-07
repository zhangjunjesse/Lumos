'use client';

import * as React from 'react';
import { Check, MessageSquareText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { safeSanitizedWechatText } from './display-helpers';
import type { Person, SuggestedFollowup } from './relations-types';
import { buildSuggestedFollowupSourceContext } from './suggested-followup-source';

export function SuggestedFollowupCards({
  items,
  people,
  onAccept,
  onDismiss,
}: {
  items: SuggestedFollowup[];
  people?: Person[];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-20 items-center justify-center text-xs text-muted-foreground">
          没有候选 · AI 找到值得跟进的事会出现在这
        </CardContent>
      </Card>
    );
  }
  const peopleById = new Map((people ?? []).map((person) => [person.id, person]));
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const source = buildSuggestedFollowupSourceContext(item, peopleById);
        return (
          <Card key={item.id}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-medium">
                    {safeSanitizedWechatText(item.draftTitle, '微信待跟进事项')}
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    <MessageSquareText className="size-3" />
                    {source.conversationKind}
                  </span>
                </div>
                <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                  {safeSanitizedWechatText(item.reason, '来自微信消息的待跟进线索')}
                </p>
                <div className="mt-3 grid gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                  <SourceLine label="会话" value={source.conversationName} />
                  <SourceLine label="发言人" value={source.speakerName} />
                  <div className="grid gap-1 sm:grid-cols-[52px_1fr]">
                    <span className="text-[10px] leading-5 text-muted-foreground">相关消息</span>
                    <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words leading-5 text-foreground [overflow-wrap:anywhere]">
                      {source.evidenceText}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1 sm:flex-col">
                <Button size="sm" variant="default" onClick={() => onAccept(item.id)}>
                  <Check className="size-3.5" />
                  加入跟进
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDismiss(item.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                  忽略
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function SourceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[52px_1fr]">
      <span className="text-[10px] leading-5 text-muted-foreground">{label}</span>
      <span className="break-words leading-5 text-foreground [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}
