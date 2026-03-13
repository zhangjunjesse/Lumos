import { redirect } from 'next/navigation';
import NewChatPage from '../chat/page';
import { getAllSessions } from '@/lib/db';
import { isMainAgentSession } from '@/lib/chat/session-entry';

export const dynamic = 'force-dynamic';

export default function MainAgentEntryPage() {
  const latestMainAgentSession = getAllSessions().find((session) => isMainAgentSession(session));

  if (latestMainAgentSession) {
    redirect(`/main-agent/${latestMainAgentSession.id}`);
  }

  return <NewChatPage />;
}
