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

  return {
    success: false,
    output: null,
    error: `Capability "${capabilityId}" is not available. The capability system has been removed.`,
  };
}
