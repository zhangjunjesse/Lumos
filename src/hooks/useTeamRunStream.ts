import { useEffect, useState } from 'react';

interface TeamRunStreamStageDelta {
  stageId: string;
  status: string;
  latestResultSummary?: string;
}

interface TeamRunStreamEvent {
  type: 'connected' | 'snapshot' | 'run.updated' | 'stage.updated' | 'completed' | 'status_update';
  runId: string;
  projectionVersion?: number;
  runStatus?: string;
  status?: string;
  team?: {
    runStatus: string;
    stages: Array<{
      stageId: string;
      status: string;
      latestResultSummary?: string;
    }>;
  };
  stage?: TeamRunStreamStageDelta;
  stages?: Array<{
    id?: string;
    stageId?: string;
    status: string;
    name?: string;
  }>;
}

export function useTeamRunStream(runId: string | null) {
  const [status, setStatus] = useState<string>('pending');
  const [stages, setStages] = useState<TeamRunStreamStageDelta[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!runId) {
      setStatus('pending');
      setStages([]);
      setIsConnected(false);
      return undefined;
    }

    const eventSource = new EventSource(`/api/team-runs/${runId}/stream`);

    eventSource.onmessage = (event) => {
      const data: TeamRunStreamEvent = JSON.parse(event.data);

      if (data.type === 'connected') {
        setIsConnected(true);
        return;
      }

      if (data.type === 'snapshot') {
        if (data.team?.runStatus) setStatus(data.team.runStatus);
        if (data.team?.stages) {
          setStages(data.team.stages.map((stage) => ({
            stageId: stage.stageId,
            status: stage.status,
            ...(stage.latestResultSummary ? { latestResultSummary: stage.latestResultSummary } : {}),
          })));
        }
        return;
      }

      if (data.type === 'run.updated' || data.type === 'completed') {
        if (data.runStatus) setStatus(data.runStatus);
        return;
      }

      if (data.type === 'stage.updated' && data.stage) {
        const nextStage = data.stage;
        setStages((current) => {
          const next = current.filter((stage) => stage.stageId !== nextStage.stageId);
          next.push(nextStage);
          return next;
        });
        return;
      }

      if (data.type === 'status_update') {
        if (data.status) setStatus(data.status);
        if (data.stages) {
          setStages(data.stages.map((stage) => ({
            stageId: stage.stageId || stage.id || '',
            status: stage.status,
          })).filter((stage) => stage.stageId));
        }
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
    };

    return () => {
      setIsConnected(false);
      eventSource.close();
    };
  }, [runId]);

  return { status, stages, isConnected };
}
