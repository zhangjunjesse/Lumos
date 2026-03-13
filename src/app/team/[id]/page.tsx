import { notFound } from 'next/navigation';
import { TeamRunDetailView } from '@/components/conversations/team-run-detail-view';
import { getMainAgentTaskDirectoryItem, getMainAgentTeamDirectoryItem } from '@/lib/db/tasks';

export const dynamic = 'force-dynamic';

interface TeamDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;
  const team = getMainAgentTeamDirectoryItem(id);

  if (!team) {
    notFound();
  }

  const task = getMainAgentTaskDirectoryItem(team.relatedTaskId) || null;

  return <TeamRunDetailView team={team} task={task} />;
}
