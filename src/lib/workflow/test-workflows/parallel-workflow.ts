import { getWorkflowEngine } from '../openworkflow-client';
import { agentStep } from '../steps/agentStep';
import { browserStep } from '../steps/browserStep';
import { notificationStep } from '../steps/notificationStep';

export async function runParallelWorkflow() {
  const ow = await getWorkflowEngine();

  const workflow = ow.defineWorkflow(
    { name: 'parallel-workflow' },
    async ({ step }) => {
      const [agentResult, browserResult] = await Promise.all([
        step.run({ name: 'agent-task' }, () =>
          agentStep({ prompt: 'Process data' })
        ),
        step.run({ name: 'browser-task' }, () =>
          browserStep({ action: 'screenshot' })
        ),
      ]);

      const notifyResult = await step.run({ name: 'notify-task' }, () =>
        notificationStep({
          message: `Parallel tasks completed: agent=${agentResult.success}, browser=${browserResult.success}`,
          level: 'info'
        })
      );

      return { agentResult, browserResult, notifyResult };
    }
  );

  return workflow;
}
