import { z } from 'zod';
import { generateWorkflowFromDsl } from './compiler';
import type { AnyWorkflowDSL, GenerateWorkflowResult } from './types';

const generateWorkflowEnvelopeSchema = z.object({
  spec: z.record(z.string(), z.unknown()),
}).strict();

export function handleGenerateWorkflowTool(input: unknown): GenerateWorkflowResult {
  const parsed = generateWorkflowEnvelopeSchema.safeParse(input);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.map((segment) => String(segment)).join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid generate_workflow input: ${message}`);
  }

  return generateWorkflowFromDsl(parsed.data.spec as unknown as AnyWorkflowDSL);
}
