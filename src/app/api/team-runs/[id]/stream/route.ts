import { NextRequest } from 'next/server';
import { ensureRunScheduled } from '@/lib/team-run/runtime-manager';
import { getTeamRunDetailProjection } from '@/lib/team-run/projections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_TERMINAL_STATUSES = ['paused', 'cancelled', 'done', 'failed'] as const;

function sendEvent(encoder: TextEncoder, controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  ensureRunScheduled(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let current = getTeamRunDetailProjection(id);
      if (!current) {
        controller.close();
        return;
      }

      sendEvent(encoder, controller, {
        type: 'connected',
        runId: id,
        projectionVersion: current.projectionVersion,
      });

      sendEvent(encoder, controller, {
        type: 'snapshot',
        runId: id,
        projectionVersion: current.projectionVersion,
        team: current,
      });

      const interval = setInterval(() => {
        try {
          const next = getTeamRunDetailProjection(id);
          if (!next) {
            clearInterval(interval);
            controller.close();
            return;
          }

          if (next.projectionVersion === current?.projectionVersion) {
            if (STREAM_TERMINAL_STATUSES.includes(next.runStatus as (typeof STREAM_TERMINAL_STATUSES)[number])) {
              clearInterval(interval);
              controller.close();
            }
            return;
          }

          if (!current || next.runStatus !== current.runStatus) {
            sendEvent(encoder, controller, {
              type: 'run.updated',
              runId: id,
              projectionVersion: next.projectionVersion,
              runStatus: next.runStatus,
            });
          }

          const previousStageMap = new Map((current?.stages || []).map((stage) => [stage.stageId, stage]));
          for (const stage of next.stages) {
            const previous = previousStageMap.get(stage.stageId);
            if (
              !previous
              || previous.status !== stage.status
              || previous.latestResultSummary !== stage.latestResultSummary
              || previous.retryCount !== stage.retryCount
            ) {
              sendEvent(encoder, controller, {
                type: 'stage.updated',
                runId: id,
                projectionVersion: next.projectionVersion,
                stage: {
                  stageId: stage.stageId,
                  status: stage.status,
                  ...(stage.latestResultSummary ? { latestResultSummary: stage.latestResultSummary } : {}),
                },
              });
            }
          }

          if (STREAM_TERMINAL_STATUSES.includes(next.runStatus as (typeof STREAM_TERMINAL_STATUSES)[number])) {
            if (['cancelled', 'done', 'failed'].includes(next.runStatus)) {
              sendEvent(encoder, controller, {
                type: 'completed',
                runId: id,
                projectionVersion: next.projectionVersion,
                runStatus: next.runStatus,
              });
            }
            clearInterval(interval);
            controller.close();
            return;
          }

          current = next;
        } catch (error) {
          console.error('Team run stream error:', error);
          clearInterval(interval);
          controller.close();
        }
      }, 1000);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
