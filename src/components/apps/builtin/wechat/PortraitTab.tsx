'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import {
  PortraitGroupsCard,
  PortraitHighlightsCard,
  PortraitStyleCard,
} from './PortraitInsightCards';
import {
  PortraitRelationsCard,
  PortraitResponseCard,
} from './PortraitRelationCards';
import { PortraitRhythmCard } from './PortraitRhythmCard';
import type { PortraitData } from './portrait-types';

export type { PortraitData } from './portrait-types';

export function PortraitTab({
  ready,
  portrait,
  loading,
  error,
  onRefresh,
  onSetup,
}: {
  ready: boolean;
  portrait: PortraitData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSetup: () => void;
}): React.ReactElement {
  if (!ready) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">授权后展示画像</p>
          <Button onClick={onSetup} variant="outline" size="sm">去授权</Button>
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={onRefresh} disabled={loading} variant="outline" size="sm" className="w-fit">重试</Button>
      </div>
    );
  }
  if (!portrait || !portrait.generated) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          {loading ? '生成中...' : '点击右上角「开始分析」'}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PortraitRhythmCard rhythm={portrait.rhythm} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PortraitRelationsCard data={portrait.relationships} />
        <PortraitResponseCard data={portrait.responsiveness} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PortraitStyleCard data={portrait.style} />
        <PortraitGroupsCard data={portrait.groups} />
      </div>
      <PortraitHighlightsCard items={portrait.highlights} />
    </div>
  );
}
