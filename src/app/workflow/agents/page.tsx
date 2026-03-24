import { WorkflowAgentSettingsSection } from '@/components/conversations/workflow-agent-settings';

export default function WorkflowAgentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <WorkflowAgentSettingsSection variant="standalone" />
    </div>
  );
}
