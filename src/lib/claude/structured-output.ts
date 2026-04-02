import os from 'os';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ApiProvider, ChatSession } from '@/types';
import { getSession } from '@/lib/db/sessions';
import { buildClaudeSdkRuntimeBootstrap } from './sdk-runtime';
import { z, type ZodType } from 'zod';
import { ensureClaudeLocalAuthReady } from './local-auth';

interface ClaudeStructuredObjectParams<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  model?: string;
  provider?: ApiProvider;
  sessionId?: string;
  workingDirectory?: string;
  abortSignal?: AbortSignal;
}

type ClaudeStructuredOutputError = Error & {
  outputPreview?: string;
  structuredOutputPreview?: string;
};

type ClaudeSdkQueryOptions = NonNullable<Parameters<typeof query>[0]['options']>;
type ClaudeSdkQueryMessage = {
  text?: string;
  type?: string;
  result?: string;
  structured_output?: unknown;
};

function resolveRuntimeSession(sessionId?: string): ChatSession | undefined {
  const normalized = sessionId?.trim() || '';
  if (!normalized) {
    return undefined;
  }

  return getSession(normalized);
}

function resolveRuntimeCwd(params: {
  session?: ChatSession;
  workingDirectory?: string;
}): string {
  const explicit = params.workingDirectory?.trim();
  if (explicit) {
    return explicit;
  }

  const sessionCwd = params.session?.sdk_cwd?.trim() || params.session?.working_directory?.trim() || '';
  if (sessionCwd) {
    return sessionCwd;
  }

  return process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
}

function truncatePreview(value: string, maxLength = 1000): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function extractJsonTextCandidate(textOutput: string): string | undefined {
  const trimmed = textOutput.trim();
  if (!trimmed) {
    return undefined;
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    return candidate || undefined;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  return undefined;
}

function parseStructuredOutputFromText(textOutput: string): unknown {
  const candidate = extractJsonTextCandidate(textOutput);
  if (!candidate) {
    return undefined;
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    const wrapped = new Error(
      `Claude SDK returned text output but it was not valid JSON: ${parseError.message}`,
    ) as ClaudeStructuredOutputError;
    wrapped.outputPreview = truncatePreview(textOutput);
    throw wrapped;
  }
}

export async function generateObjectWithClaudeSdk<T>(
  params: ClaudeStructuredObjectParams<T>,
): Promise<T> {
  const session = resolveRuntimeSession(params.sessionId);
  const runtimeBootstrap = buildClaudeSdkRuntimeBootstrap({
    provider: params.provider,
    sessionId: params.sessionId,
  });
  await ensureClaudeLocalAuthReady(runtimeBootstrap.activeProvider);
  const abortController = new AbortController();
  let streamedTextOutput = '';
  let finalResultTextOutput = '';
  let structuredOutput: unknown;
  const getTextOutput = (): string => finalResultTextOutput.trim() || streamedTextOutput;

  const relayAbort = () => {
    abortController.abort();
  };

  if (params.abortSignal) {
    if (params.abortSignal.aborted) {
      abortController.abort();
    } else {
      params.abortSignal.addEventListener('abort', relayAbort, { once: true });
    }
  }

  try {
    const queryOptions: ClaudeSdkQueryOptions = {
      abortController,
      cwd: resolveRuntimeCwd({
        session,
        workingDirectory: params.workingDirectory,
      }),
      systemPrompt: params.system,
      permissionMode: 'plan',
      env: runtimeBootstrap.env,
      settingSources: runtimeBootstrap.settingSources,
      ...(params.model ? { model: params.model } : {}),
      ...(runtimeBootstrap.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: runtimeBootstrap.pathToClaudeCodeExecutable }
        : {}),
      outputFormat: {
        type: 'json_schema',
        schema: z.toJSONSchema(params.schema),
      },
    };

    const conversation = query({
      prompt: params.prompt,
      options: queryOptions,
    });

    try {
      for await (const message of conversation as AsyncIterable<ClaudeSdkQueryMessage>) {
        if (typeof message?.text === 'string') {
          streamedTextOutput += message.text;
        }

        if (message?.type === 'result' && typeof message?.result === 'string' && !message?.structured_output) {
          finalResultTextOutput = message.result;
        }

        if (message?.type === 'result' && message?.structured_output) {
          structuredOutput = message.structured_output;
        }
      }
    } catch (error) {
      if (params.abortSignal?.aborted) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        const abortReason = params.abortSignal.reason as { name?: unknown; message?: unknown } | undefined;
        const abortError = new Error(
          typeof abortReason?.message === 'string' && abortReason.message.trim()
            ? abortReason.message
            : wrapped.message,
        ) as ClaudeStructuredOutputError;

        abortError.name = typeof abortReason?.name === 'string' && abortReason.name.trim()
          ? abortReason.name
          : 'AbortError';

        const textOutput = getTextOutput();
        if (textOutput.trim()) {
          abortError.outputPreview = truncatePreview(textOutput);
        }

        throw abortError;
      }

      throw error;
    }

    if (structuredOutput === undefined) {
      structuredOutput = parseStructuredOutputFromText(getTextOutput());
    }

    if (structuredOutput === undefined) {
      const error = new Error('Claude SDK did not return structured output or parseable JSON text') as ClaudeStructuredOutputError;
      const textOutput = getTextOutput();
      if (textOutput.trim()) {
        error.outputPreview = truncatePreview(textOutput);
      }
      throw error;
    }

    try {
      return params.schema.parse(structuredOutput);
    } catch (error) {
      const schemaError = error instanceof Error ? error : new Error(String(error));
      const wrapped = new Error(`Claude SDK returned invalid structured output: ${schemaError.message}`) as ClaudeStructuredOutputError;
      wrapped.structuredOutputPreview = truncatePreview(JSON.stringify(structuredOutput, null, 2));
      const textOutput = getTextOutput();
      if (textOutput.trim()) {
        wrapped.outputPreview = truncatePreview(textOutput);
      }
      throw wrapped;
    }
  } finally {
    params.abortSignal?.removeEventListener('abort', relayAbort);
  }
}
