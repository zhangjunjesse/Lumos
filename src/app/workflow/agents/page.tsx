import { AgentPresetList } from '@/components/workflow/AgentPresetList';
import { WorkflowAgentSettingsSection } from '@/components/conversations/workflow-agent-settings';

export default function WorkflowAgentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <AgentPresetList />
      <div className="border-t pt-8">
        <WorkflowAgentSettingsSection variant="standalone" />
      </div>
    </div>
  );
}
