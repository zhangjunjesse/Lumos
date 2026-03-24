import { getWorkflowEngine } from '../openworkflow-client';
import { agentStep } from '../steps/agentStep';
import { browserStep } from '../steps/browserStep';
import { notificationStep } from '../steps/notificationStep';

export async function runSimpleWorkflow() {
  const ow = await getWorkflowEngine();

  const workflow = ow.defineWorkflow(
    { name: 'simple-workflow' },
    async ({ step }) => {
      const agentResult = await step.run({ name: 'agent-task' }, () =>
        agentStep({ prompt: 'Analyze data' })
      );

      const browserResult = await step.run({ name: 'browser-task' }, () =>
        browserStep({ action: 'navigate', url: 'https://example.com' })
      );

      const notifyResult = await step.run({ name: 'notify-task' }, () =>
        notificationStep({ message: 'Workflow completed', level: 'info' })
      );

      return { agentResult, browserResult, notifyResult };
    }
  );

  return workflow;
}
