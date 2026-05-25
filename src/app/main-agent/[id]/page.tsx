import ChatSessionPage from '../../chat/[id]/page';
import { MainAgentHistoryPanel } from '@/components/main-agent/MainAgentHistoryPanel';

export default function MainAgentSessionPage(props: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MainAgentHistoryPanel />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatSessionPage {...props} />
      </div>
    </div>
  );
}
