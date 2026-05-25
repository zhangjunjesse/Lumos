import { redirect } from 'next/navigation';
import NewChatPage from '../chat/page';
import { resolveMainAgentSession } from '@/lib/chat/main-agent-session';

export const dynamic = 'force-dynamic';

export default function MainAgentEntryPage() {
  // 访问入口兜底：今天没活跃 main agent session 时归档旧 + 建当日，再 redirect。
  // 跟 cron tick 是同一个幂等切日点；先到的那个生效，另一个 noop。
  const session = resolveMainAgentSession({ createIfMissing: true });
  if (session) {
    redirect(`/main-agent/${session.id}`);
  }
  return <NewChatPage />;
}
