import { notFound } from 'next/navigation';
import { TeamRunDetailView } from '@/components/conversations/team-run-detail-view';
import { getTaskViewProjection, getTeamRunDetailProjection } from '@/lib/team-run/projections';

export const dynamic = 'force-dynamic';

interface TeamDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;
  const taskView = getTaskViewProjection(id);

  if (!taskView || taskView.task.source !== 'team' || !taskView.workspace) {
    notFound();
  }

  const teamView = taskView.workspace.runId
    ? getTeamRunDetailProjection(taskView.workspace.runId) || null
    : null;

  return (
    <TeamRunDetailView
      taskId={id}
      initialTask={taskView.task}
      initialWorkspace={taskView.workspace}
      initialTeam={teamView}
    />
  );
}
