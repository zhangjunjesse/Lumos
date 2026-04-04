import { executeCodeCapability } from '@/lib/capability/executor';
import { initializeCapabilities } from '@/lib/capability/init';
import { getPromptCapability } from '@/lib/capability/prompt-loader';
import type { CapabilityStepInput, StepResult } from '../types';

export async function capabilityStep(input: CapabilityStepInput): Promise<StepResult> {
  const capabilityId = input.capabilityId?.trim();
  if (!capabilityId) {
    return {
      success: false,
      output: null,
      error: 'Capability step capabilityId is required',
    };
  }

  await initializeCapabilities();

  const promptContent = getPromptCapability(capabilityId);
  if (typeof promptContent === 'string') {
    return {
      success: true,
      output: {
        capabilityId,
        content: promptContent,
        summary: promptContent,
      },
      metadata: {
        capabilityId,
        capabilityType: 'prompt',
      },
    };
  }

  try {
    const result = await executeCodeCapability(capabilityId, input.input);
    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        capabilityId,
        capabilityType: 'code',
      },
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Capability execution failed',
      metadata: {
        capabilityId,
        capabilityType: 'code',
      },
    };
  }
}
