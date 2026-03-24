import { getWorkflowEngine } from './openworkflow-client';
import { agentStep } from './steps/agentStep';
import { browserStep } from './steps/browserStep';
import { notificationStep } from './steps/notificationStep';

async function testSimpleWorkflow() {
  console.log('\n=== Testing Simple Workflow ===');

  const ow = await getWorkflowEngine();

  const workflow = ow.defineWorkflow(
    { name: 'simple-workflow-test' },
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

  const worker = ow.newWorker({ concurrency: 1 });
  await worker.start();

  const runHandle = await workflow.run({});
  const result = await runHandle.result();

  await worker.stop();

  console.log('✓ Simple workflow result:', result);
}

async function testParallelWorkflow() {
  console.log('\n=== Testing Parallel Workflow ===');

  const ow = await getWorkflowEngine();

  const workflow = ow.defineWorkflow(
    { name: 'parallel-workflow-test' },
    async ({ step }) => {
      const [agentResult, browserResult] = await Promise.all([
        step.run({ name: 'agent-task' }, () =>
          agentStep({ prompt: 'Analyze data' })
        ),
        step.run({ name: 'browser-task' }, () =>
          browserStep({ action: 'navigate', url: 'https://example.com' })
        )
      ]);

      const notifyResult = await step.run({ name: 'notify-task' }, () =>
        notificationStep({ message: 'Parallel workflow completed', level: 'info' })
      );

      return { agentResult, browserResult, notifyResult };
    }
  );

  const worker = ow.newWorker({ concurrency: 2 });
  await worker.start();

  const runHandle = await workflow.run({});
  const result = await runHandle.result();

  await worker.stop();

  console.log('✓ Parallel workflow result:', result);
}

async function main() {
  await testSimpleWorkflow();
  await testParallelWorkflow();
  console.log('\n=== All Tests Passed ===');
}

main().catch(console.error);
