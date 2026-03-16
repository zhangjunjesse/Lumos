import type { AgentPresetDirectoryItem, TeamPlanRole } from '@/types'
import { resolveAgentDefinitionForRole } from '../agent-definitions'

function buildRole(partial: Partial<TeamPlanRole> = {}): TeamPlanRole {
  return {
    id: partial.id || 'role-1',
    name: partial.name || 'Worker Alpha',
    kind: partial.kind || 'worker',
    responsibility: partial.responsibility || 'Implement the assigned stage',
    ...(partial.parentRoleId ? { parentRoleId: partial.parentRoleId } : {}),
  }
}

function buildPreset(partial: Partial<AgentPresetDirectoryItem> & Pick<AgentPresetDirectoryItem, 'id' | 'name' | 'roleKind'>): AgentPresetDirectoryItem {
  return {
    id: partial.id,
    source: partial.source || 'user',
    name: partial.name,
    roleKind: partial.roleKind,
    responsibility: partial.responsibility || 'Preset responsibility',
    systemPrompt: partial.systemPrompt || `System prompt for ${partial.name}`,
    updatedAt: partial.updatedAt || '2026-03-14T00:00:00.000Z',
    templateCount: partial.templateCount ?? 0,
    ...(partial.description ? { description: partial.description } : {}),
    ...(partial.collaborationStyle ? { collaborationStyle: partial.collaborationStyle } : {}),
    ...(partial.outputContract ? { outputContract: partial.outputContract } : {}),
  }
}

describe('resolveAgentDefinitionForRole', () => {
  test('prefers exact role-name matches over other presets of the same role kind', () => {
    const role = buildRole({ name: 'Worker Alpha' })
    const definition = resolveAgentDefinitionForRole(role, [
      buildPreset({ id: 'preset-1', name: 'Worker Beta', roleKind: 'worker' }),
      buildPreset({ id: 'preset-2', name: 'Worker Alpha', roleKind: 'worker', systemPrompt: 'Exact match prompt.' }),
    ])

    expect(definition.presetId).toBe('preset-2')
    expect(definition.id).toBe('agent-def:preset-2')
    expect(definition.systemPrompt).toContain('Exact match prompt.')
  })

  test('uses the only preset candidate for a role kind when there is no exact name match', () => {
    const role = buildRole({ name: 'Implementation Worker' })
    const definition = resolveAgentDefinitionForRole(role, [
      buildPreset({ id: 'preset-worker', name: 'Worker Template', roleKind: 'worker' }),
    ])

    expect(definition.presetId).toBe('preset-worker')
    expect(definition.agentType).toBe('preset.preset-worker')
    expect(definition.allowedTools).toEqual(['workspace.read', 'workspace.write', 'shell.exec'])
  })

  test('falls back to the default role definition when preset resolution is ambiguous', () => {
    const role = buildRole({ name: 'Implementation Worker' })
    const definition = resolveAgentDefinitionForRole(role, [
      buildPreset({ id: 'preset-a', name: 'Worker Template A', roleKind: 'worker' }),
      buildPreset({ id: 'preset-b', name: 'Worker Template B', roleKind: 'worker' }),
    ])

    expect(definition.presetId).toBeUndefined()
    expect(definition.id).toBe('agent-def:worker.default')
    expect(definition.agentType).toBe('worker.default')
    expect(definition.systemPrompt).toContain('You are Implementation Worker.')
  })
})
