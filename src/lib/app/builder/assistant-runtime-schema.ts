import { z } from 'zod';

const requiredStringListFromModelSchema = (itemMaxLength: number, maxItems = 20) => z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      return splitModelListText(value);
    }
    return value;
  },
  z.array(z.string().trim().min(1).max(itemMaxLength)).max(maxItems),
);

const optionalStringListFromModelSchema = (itemMaxLength: number, maxItems = 20) => z.preprocess(
  (value) => {
    if (value === null) return undefined;
    return value;
  },
  requiredStringListFromModelSchema(itemMaxLength, maxItems).optional(),
);

const optionalStringFromModelSchema = (maxLength: number) => z.preprocess(
  (value) => {
    if (value === null) return undefined;
    if (typeof value === 'string' && value.trim().length === 0) return undefined;
    return value;
  },
  z.string().trim().min(1).max(maxLength).optional(),
);

const priorityFromModelSchema = z.preprocess(
  (value) => {
    if (value === null) return undefined;
    if (typeof value !== 'string') return value;
    const match = /^p?([0-3])$/i.exec(value.trim());
    return match ? Number(match[1]) : value;
  },
  z.number().int().min(0).max(3).optional(),
);

const storyStatusFromModelSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.enum([
    'draft',
    'pending_confirmation',
    'confirmed',
    'in_progress',
    'implemented',
    'accepted',
    'deferred',
  ]).optional(),
);

const writeFileActionSchema = z.object({
  type: z.literal('write_file'),
  path: z.string().trim().min(1).max(180),
  content: z.string().min(1).max(60000),
});

const writeFilesActionSchema = z.object({
  type: z.literal('write_files'),
  files: z.array(z.object({
    path: z.string().trim().min(1).max(180),
    content: z.string().min(1).max(60000),
  })).min(1).max(20),
  change_summary: z.string().trim().max(500).optional(),
});

const deleteFileActionSchema = z.object({
  type: z.literal('delete_file'),
  path: z.string().trim().min(1).max(180),
});

const upsertStoryActionSchema = z.object({
  type: z.literal('upsert_story'),
  id: optionalStringFromModelSchema(120),
  title: optionalStringFromModelSchema(160),
  storyText: optionalStringFromModelSchema(2000),
  actor: optionalStringFromModelSchema(120),
  goal: optionalStringFromModelSchema(500),
  benefit: optionalStringFromModelSchema(500),
  status: storyStatusFromModelSchema,
  priority: priorityFromModelSchema,
  acceptanceCriteria: optionalStringListFromModelSchema(500),
  relatedPages: optionalStringListFromModelSchema(160),
  relatedCollections: optionalStringListFromModelSchema(160),
}).superRefine((action, ctx) => {
  if (action.id) return;
  if (!action.title) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['title'],
      message: 'title is required when creating a new story',
    });
  }
  if (!action.storyText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['storyText'],
      message: 'storyText is required when creating a new story',
    });
  }
});

const setNonGoalsActionSchema = z.object({
  type: z.literal('set_non_goals'),
  items: requiredStringListFromModelSchema(120),
});

const finishActionSchema = z.object({
  type: z.literal('finish'),
  assistantMessage: z.string().trim().min(1),
  nextStatus: z.enum(['gathering', 'demo_review', 'final_build', 'iterating']).optional(),
});

const toolLoopActionSchema = z.discriminatedUnion('type', [
  writeFileActionSchema,
  writeFilesActionSchema,
  deleteFileActionSchema,
  upsertStoryActionSchema,
  setNonGoalsActionSchema,
  finishActionSchema,
]);

export const toolLoopResponseSchema = z.object({
  reasoning: z.string().optional(),
  actions: z
    .array(toolLoopActionSchema)
    .min(1)
    .max(24),
});

const singleActionEnvelopeSchema = z.object({
  reasoning: z.string().optional(),
  action: toolLoopActionSchema,
});

export const toolLoopResponseCandidateSchema = z.union([
  toolLoopResponseSchema,
  singleActionEnvelopeSchema,
  toolLoopActionSchema,
]);

export type ToolLoopResponse = z.infer<typeof toolLoopResponseSchema>;
export type ToolLoopResponseCandidate = z.infer<typeof toolLoopResponseCandidateSchema>;

export const EXPECTED_TOOL_LOOP_RESPONSE_HINT = [
  '工具循环响应必须是一个 JSON object，顶层必须包含 actions 数组。',
  '正确形状示例：{"actions":[{"type":"finish","assistantMessage":"已更新，请预览。","nextStatus":"demo_review"}]}',
  'upsert_story.acceptanceCriteria / relatedPages / relatedCollections 和 set_non_goals.items 必须写成 string[] 数组。',
  '不要返回 markdown，不要只返回纯文本，不要把 actions 放成顶层数组。',
].join('\n');

export function normalizeToolLoopResponse(candidate: ToolLoopResponseCandidate): ToolLoopResponse {
  if ('actions' in candidate) {
    return candidate;
  }
  if ('action' in candidate) {
    return {
      reasoning: candidate.reasoning,
      actions: [candidate.action],
    };
  }
  return { actions: [candidate] };
}

export function parseToolLoopResponseCandidate(value: unknown): ToolLoopResponse {
  return normalizeToolLoopResponse(toolLoopResponseCandidateSchema.parse(value));
}

function splitModelListText(value: string): string[] {
  const normalized = value.replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  return normalized
    .split(/\n+|[；;]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item
      .replace(/^[-*•]\s*/u, '')
      .replace(/^\d+[.)、]\s*/u, '')
      .trim())
    .filter(Boolean);
}
