import ChatSessionPage from '../../chat/[id]/page';
import { MainAgentHistoryPanel } from '@/components/main-agent/MainAgentHistoryPanel';
import { MainAgentRolloverWatcher } from '@/components/main-agent/MainAgentRolloverWatcher';

export default function MainAgentSessionPage(props: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MainAgentRolloverWatcher />
      <MainAgentHistoryPanel />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatSessionPage {...props} />
      </div>
    </div>
  );
}
