import { AgentPresetList } from '@/components/workflow/AgentPresetList';

export default function TeamPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <AgentPresetList />
    </div>
  );
}
