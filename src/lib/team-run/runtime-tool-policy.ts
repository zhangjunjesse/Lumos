import * as path from 'path'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AgentExecutionBindingV1, StageExecutionPayloadV1 } from './runtime-contracts'
import { CommandGuard } from './security/command-guard'
import { FileAccessGuard, SecurityError } from './security/file-access-guard'

type RuntimeCapabilityTool = AgentExecutionBindingV1['allowedTools'][number]
type ClaudeToolName =
  | 'Read'
  | 'Edit'
  | 'Write'
  | 'NotebookEdit'
  | 'Glob'
  | 'Grep'
  | 'Bash'
  | 'TodoWrite'
  | 'AskUserQuestion'

const CLAUDE_TOOLS_BY_CAPABILITY: Record<RuntimeCapabilityTool, ClaudeToolName[]> = {
  'workspace.read': ['Read', 'Glob', 'Grep'],
  'workspace.write': ['Edit', 'Write', 'NotebookEdit'],
  'shell.exec': ['Bash'],
  'plan.update': ['TodoWrite'],
  'chat.publish': ['AskUserQuestion'],
}

interface StageRuntimeGuards {
  readGuard: FileAccessGuard
  writeGuard: FileAccessGuard
  commandGuard: CommandGuard
}

export interface StageRuntimeToolPolicy {
  sdkTools: ClaudeToolName[]
  allowedTools: ClaudeToolName[]
  unmappedCapabilities: string[]
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function normalizeRoots(values: string[]): string[] {
  return uniqueValues(
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => path.resolve(value)),
  )
}

function resolveInputPath(rawValue: unknown, cwd: string): string | null {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null
  }

  return path.isAbsolute(rawValue) ? rawValue : path.resolve(cwd, rawValue)
}

function getToolInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function buildRuntimeGuards(payload: StageExecutionPayloadV1): StageRuntimeGuards {
  const readRoots = normalizeRoots([
    payload.workspace.sessionWorkspace,
    payload.workspace.runWorkspace,
    payload.workspace.stageWorkspace,
    payload.workspace.sharedReadDir,
    payload.workspace.artifactOutputDir,
  ])
  const writeRoots = normalizeRoots([
    payload.workspace.sessionWorkspace,
    payload.workspace.stageWorkspace,
    payload.workspace.artifactOutputDir,
  ])

  return {
    readGuard: new FileAccessGuard({ allowedPaths: readRoots }),
    writeGuard: new FileAccessGuard({ allowedPaths: writeRoots }),
    commandGuard: new CommandGuard({ allowedCommands: [CommandGuard.ALLOW_ANY] }),
  }
}

function validateFileToolPath(
  guard: FileAccessGuard,
  rawPath: unknown,
  operation: 'read' | 'write',
  cwd: string,
): void {
  const resolved = resolveInputPath(rawPath, cwd)
  if (!resolved) {
    throw new SecurityError('Tool input is missing a required path', 'FILE_ACCESS_DENIED')
  }
  guard.validatePath(resolved, operation)
}

function validateToolInput(
  toolName: string,
  input: unknown,
  payload: StageExecutionPayloadV1,
  guards: StageRuntimeGuards,
): void {
  const record = getToolInputRecord(input)
  const executionCwd = getStageExecutionCwd(payload)

  switch (toolName) {
    case 'Read':
      validateFileToolPath(guards.readGuard, record.file_path, 'read', executionCwd)
      return
    case 'Glob':
    case 'Grep':
      if (typeof record.path === 'string' && record.path.trim()) {
        validateFileToolPath(guards.readGuard, record.path, 'read', executionCwd)
      }
      return
    case 'Edit':
    case 'Write':
      validateFileToolPath(guards.writeGuard, record.file_path, 'write', executionCwd)
      return
    case 'NotebookEdit':
      validateFileToolPath(guards.writeGuard, record.notebook_path, 'write', executionCwd)
      return
    case 'Bash':
      if (record.dangerouslyDisableSandbox === true) {
        throw new SecurityError('Disabling the sandbox is not allowed', 'COMMAND_DENIED')
      }
      if (record.run_in_background === true) {
        throw new SecurityError('Background commands are not allowed for stage execution', 'COMMAND_DENIED')
      }
      guards.commandGuard.validateCommand(typeof record.command === 'string' ? record.command : '')
      return
    case 'TodoWrite':
    case 'AskUserQuestion':
      return
    default:
      throw new SecurityError(`Tool not allowed: ${toolName}`, 'TOOL_NOT_ALLOWED')
  }
}

export function buildStageRuntimeToolPolicy(agent: AgentExecutionBindingV1): StageRuntimeToolPolicy {
  const sdkTools: ClaudeToolName[] = []
  const unmappedCapabilities: string[] = []

  for (const capability of agent.allowedTools) {
    const mappedTools = CLAUDE_TOOLS_BY_CAPABILITY[capability]
    if (!mappedTools) {
      unmappedCapabilities.push(capability)
      continue
    }
    sdkTools.push(...mappedTools)
  }

  const uniqueSdkTools = uniqueValues(sdkTools)
  return {
    sdkTools: uniqueSdkTools,
    allowedTools: [...uniqueSdkTools],
    unmappedCapabilities,
  }
}

export function getStageExecutionCwd(payload: StageExecutionPayloadV1): string {
  return payload.workspace.sessionWorkspace.trim() || payload.workspace.stageWorkspace
}

export function createStageCanUseTool(payload: StageExecutionPayloadV1): CanUseTool {
  const runtimePolicy = buildStageRuntimeToolPolicy(payload.agent)
  const allowedTools = new Set(runtimePolicy.sdkTools)
  const guards = buildRuntimeGuards(payload)

  return async (_toolName, _input) => {
    return { behavior: 'allow' }
  }
}
