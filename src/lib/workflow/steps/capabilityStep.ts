import { executeCodeCapability } from '@/lib/capability/executor';
import type { StepResult } from '../types';

export interface CapabilityStepInput {
  capabilityId: string;
  input: unknown;
}

export async function capabilityStep(input: CapabilityStepInput): Promise<StepResult> {
  const { capabilityId, input: capInput } = input;

  try {
    const result = await executeCodeCapability(capabilityId, capInput);
    return {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        capabilityId,
        executionMode: 'published-capability',
      },
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'Capability execution failed',
      metadata: {
        capabilityId,
        executionMode: 'published-capability',
      },
    };
  }
}
