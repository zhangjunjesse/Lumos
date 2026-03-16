import type { AgentPresetDirectoryItem, TeamPlanRole, TeamPlanRoleKind } from '@/types'

export interface AgentDefinitionV1 {
  id: string
  agentType: string
  roleName: string
  responsibility: string
  systemPrompt: string
  allowedTools: string[]
  capabilityTags: string[]
  outputSchema: 'stage-execution-result/v1'
  memoryPolicy: 'ephemeral-stage' | 'sticky-run'
  concurrencyLimit: number
  presetId?: string
}

function normalizeKey(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

function defaultAgentType(roleKind: TeamPlanRoleKind): string {
  switch (roleKind) {
    case 'orchestrator':
      return 'orchestrator.default'
    case 'lead':
      return 'lead.default'
    case 'worker':
      return 'worker.default'
    case 'main_agent':
    default:
      return 'main_agent.control'
  }
}

export function getDefaultAllowedTools(roleKind: TeamPlanRoleKind): string[] {
  switch (roleKind) {
    case 'orchestrator':
      return ['workspace.read', 'workspace.write', 'shell.exec', 'plan.update']
    case 'lead':
      return ['workspace.read', 'workspace.write', 'shell.exec']
    case 'worker':
      return ['workspace.read', 'workspace.write', 'shell.exec']
    case 'main_agent':
    default:
      return ['workspace.read', 'workspace.write', 'shell.exec', 'chat.publish']
  }
}

function getDefaultCapabilityTags(roleKind: TeamPlanRoleKind): string[] {
  switch (roleKind) {
    case 'orchestrator':
      return ['coordination', 'planning', 'supervision']
    case 'lead':
      return ['coordination', 'execution-guidance', 'review']
    case 'worker':
      return ['execution', 'implementation']
    case 'main_agent':
    default:
      return ['user-facing', 'control-plane']
  }
}

function getDefaultMemoryPolicy(roleKind: TeamPlanRoleKind): 'ephemeral-stage' | 'sticky-run' {
  switch (roleKind) {
    case 'orchestrator':
    case 'lead':
      return 'sticky-run'
    case 'worker':
    case 'main_agent':
    default:
      return 'ephemeral-stage'
  }
}

function buildDefaultSystemPrompt(role: TeamPlanRole): string {
  const rolePrefix = `You are ${role.name}.`
  switch (role.kind) {
    case 'orchestrator':
      return [
        rolePrefix,
        `Responsibility: ${role.responsibility}`,
        'Coordinate the team run, preserve the execution contract, and keep work bounded to the assigned stage.',
        'Do not act as the user-facing main agent.',
      ].join('\n')
    case 'lead':
      return [
        rolePrefix,
        `Responsibility: ${role.responsibility}`,
        'Guide execution, synthesize upstream outputs, and keep downstream work unblocked.',
        'Stay within the assigned stage contract and return a structured summary.',
      ].join('\n')
    case 'worker':
      return [
        rolePrefix,
        `Responsibility: ${role.responsibility}`,
        'Execute the assigned stage precisely, using dependencies and workspace context only.',
        'Return a concise result that downstream stages can consume.',
      ].join('\n')
    case 'main_agent':
    default:
      return [
        rolePrefix,
        `Responsibility: ${role.responsibility}`,
        'Remain the user-facing control plane and do not become an internal sub-agent.',
      ].join('\n')
  }
}

function buildPresetSystemPrompt(role: TeamPlanRole, preset: AgentPresetDirectoryItem): string {
  const lines = [
    preset.systemPrompt.trim(),
    '',
    `Runtime Role Name: ${role.name}`,
    `Runtime Responsibility: ${role.responsibility}`,
  ]
  if (preset.collaborationStyle?.trim()) {
    lines.push(`Collaboration Style: ${preset.collaborationStyle.trim()}`)
  }
  if (preset.outputContract?.trim()) {
    lines.push(`Output Contract: ${preset.outputContract.trim()}`)
  }
  return lines.filter(Boolean).join('\n')
}

function pickPresetForRole(
  role: TeamPlanRole,
  presets: AgentPresetDirectoryItem[],
): AgentPresetDirectoryItem | null {
  const candidates = presets.filter((preset) => preset.roleKind === role.kind)
  if (candidates.length === 0) {
    return null
  }

  const roleNameKey = normalizeKey(role.name)
  const exactNameMatch = candidates.find((preset) => normalizeKey(preset.name) === roleNameKey)
  if (exactNameMatch) {
    return exactNameMatch
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  return null
}

export function resolveAgentDefinitionForRole(
  role: TeamPlanRole,
  presets: AgentPresetDirectoryItem[] = [],
): AgentDefinitionV1 {
  const preset = pickPresetForRole(role, presets)
  if (preset) {
    return {
      id: `agent-def:${preset.id}`,
      agentType: `preset.${preset.id}`,
      roleName: role.name,
      responsibility: role.responsibility,
      systemPrompt: buildPresetSystemPrompt(role, preset),
      allowedTools: getDefaultAllowedTools(role.kind),
      capabilityTags: [...getDefaultCapabilityTags(role.kind), 'preset'],
      outputSchema: 'stage-execution-result/v1',
      memoryPolicy: getDefaultMemoryPolicy(role.kind),
      concurrencyLimit: 1,
      presetId: preset.id,
    }
  }

  return {
    id: `agent-def:${defaultAgentType(role.kind)}`,
    agentType: defaultAgentType(role.kind),
    roleName: role.name,
    responsibility: role.responsibility,
    systemPrompt: buildDefaultSystemPrompt(role),
    allowedTools: getDefaultAllowedTools(role.kind),
    capabilityTags: getDefaultCapabilityTags(role.kind),
    outputSchema: 'stage-execution-result/v1',
    memoryPolicy: getDefaultMemoryPolicy(role.kind),
    concurrencyLimit: 1,
  }
}
