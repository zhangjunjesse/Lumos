'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WorkflowBuilderPanel } from '@/components/workflow/WorkflowBuilderPanel';

export default function NewWorkflowPage() {
  const router = useRouter();

  const handleSaved = useCallback((id: string) => {
    router.push(`/workflow/${id}`);
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/50 px-8 py-4">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
          <Link href="/workflow">← 工作流</Link>
        </Button>
        <span className="text-border/50">|</span>
        <h1 className="text-sm font-semibold">新建工作流</h1>
      </div>

      {/* Builder */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <WorkflowBuilderPanel onSaved={handleSaved} />
        </div>
      </div>
    </div>
  );
}
