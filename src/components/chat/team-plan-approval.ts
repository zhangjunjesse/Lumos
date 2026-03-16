'use client';

import type { TaskItem, TaskResponse, TeamPlanApprovalStatus } from '@/types';

interface TeamPlanApprovalActionInput {
  taskId: string;
  sessionId: string;
  approvalStatus: Exclude<TeamPlanApprovalStatus, 'pending'>;
  assistantMessage?: string;
}

interface TeamPlanApprovalActionResult {
  ok: boolean;
  task?: TaskItem;
  error?: string;
}

function getErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidate = (payload as { error?: unknown }).error;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

export async function applyTeamPlanApprovalAction({
  taskId,
  sessionId,
  approvalStatus,
  assistantMessage,
}: TeamPlanApprovalActionInput): Promise<TeamPlanApprovalActionResult> {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalStatus }),
    });
    const payload = await response.json().catch(() => null) as TaskResponse | { error?: string } | null;

    if (!response.ok) {
      return {
        ok: false,
        error: getErrorMessage(payload) || undefined,
      };
    }

    let messageCreated = false;
    const content = assistantMessage?.trim();
    if (content) {
      const messageResponse = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          role: 'assistant',
          content,
        }),
      });
      messageCreated = messageResponse.ok;
    }

    window.dispatchEvent(new CustomEvent('team-plan-refresh', { detail: { sessionId } }));
    window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: sessionId } }));
    if (messageCreated) {
      window.dispatchEvent(new CustomEvent('team-chat-message-created', { detail: { sessionId } }));
    }

    return {
      ok: true,
      task: (payload as TaskResponse | null)?.task,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update team plan',
    };
  }
}
