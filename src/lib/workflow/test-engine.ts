import { generateWorkflow } from './compiler';
import {
  submitWorkflow,
  getWorkflowStatus,
  cancelWorkflow,
  shutdownWorker,
} from './engine';

const testWorkflowArtifact = generateWorkflow({
  spec: {
    version: 'v1',
    name: 'test-workflow',
    steps: [
      {
        id: 'step1',
        type: 'agent',
        input: {
          prompt: 'Run smoke workflow',
        },
      },
    ],
  },
});

async function testSubmitWorkflow() {
  console.log('\\n=== Test 1: Submit Workflow ===');

  const result = await submitWorkflow(
    {
      taskId: 'task-123',
      workflowCode: testWorkflowArtifact.code,
      workflowManifest: testWorkflowArtifact.manifest,
      inputs: { testInput: 'hello' },
    },
    {
      onProgress: (event) => {
        console.log('Progress:', event);
      },
      onCompleted: (event) => {
        console.log('Completed:', event);
      },
      onFailed: (event) => {
        console.error('Failed:', event);
      }
    }
  );

  console.log('Submit result:', result);
  return result.workflowId;
}

async function testGetStatus(workflowId: string) {
  console.log('\\n=== Test 2: Get Workflow Status ===');

  // 等待一下让工作流执行
  await new Promise(resolve => setTimeout(resolve, 2000));

  const status = await getWorkflowStatus(workflowId);
  console.log('Status:', status);
}

async function testCancelWorkflow() {
  console.log('\\n=== Test 3: Cancel Workflow ===');

  const result = await submitWorkflow(
    {
      taskId: 'task-456',
      workflowCode: testWorkflowArtifact.code,
      workflowManifest: testWorkflowArtifact.manifest,
      inputs: { testInput: 'cancel-me' },
    }
  );

  console.log('Submitted:', result.workflowId);

  // 立即取消
  const cancelled = await cancelWorkflow(result.workflowId);
  console.log('Cancelled:', cancelled);

  // 检查状态
  const status = await getWorkflowStatus(result.workflowId);
  console.log('Status after cancel:', status);
}

async function main() {
  try {
    const workflowId = await testSubmitWorkflow();
    await testGetStatus(workflowId);
    await testCancelWorkflow();

    console.log('\\n=== All Tests Passed ===');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await shutdownWorker();
  }
}

main();
