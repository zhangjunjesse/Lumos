'use client';

import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import type { AnalysisContentInsights } from './wechat-types';

export function RelationshipGrid({
  signals,
}: {
  signals: AnalysisContentInsights['relationshipSignals'];
}): React.ReactElement | null {
  if (signals.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {signals.map((signal) => (
        <Card key={signal.label}>
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-tight">{signal.label}</CardTitle>
            <CardDescription className="text-xs leading-5">{signal.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col pt-2">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{signal.value}</p>
            <div className="mt-3 flex flex-col">
              {signal.contacts.map((contact) => (
                <div
                  key={contact.wxid}
                  className="flex items-baseline justify-between gap-2 py-2 [&:not(:first-child)]:border-t"
                >
                  <span className="min-w-0 truncate text-sm">{contact.display}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {contact.count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function DraftGrid({
  drafts,
}: {
  drafts: AnalysisContentInsights['drafts'];
}): React.ReactElement | null {
  if (drafts.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {drafts.map((draft) => (
        <Card key={draft.title} className="overflow-hidden">
          <CardHeader className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{draft.format}</p>
            <CardTitle className="break-words text-base font-semibold tracking-tight">{draft.title}</CardTitle>
            <CardDescription className="text-xs">来自 {draft.sourceTopic}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-2">
            <p className="break-words border-l-2 pl-3 text-sm leading-6">{draft.hook}</p>
            <ol className="flex flex-col gap-1 text-sm leading-6 text-muted-foreground">
              {draft.outline.map((item, idx) => (
                <li key={item} className="flex gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground/60">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
            <p className="rounded border bg-muted/30 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
              {draft.privacyNote}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ChannelGrid({
  suggestions,
}: {
  suggestions: AnalysisContentInsights['channelSuggestions'];
}): React.ReactElement | null {
  if (suggestions.length === 0) return null;
  return (
    <div className="grid gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-2 lg:grid-cols-4">
      {suggestions.map((suggestion) => (
        <div key={suggestion.channel} className="flex flex-col gap-2 bg-card p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {suggestion.channel}
          </p>
          <p className="break-words text-base font-semibold leading-6 tracking-tight">
            {suggestion.title}
          </p>
          <p className="break-words text-xs leading-5 text-muted-foreground">{suggestion.fit}</p>
          <p className="mt-auto break-words text-xs leading-5 text-muted-foreground/80">
            → {suggestion.nextAction}
          </p>
        </div>
      ))}
    </div>
  );
}
