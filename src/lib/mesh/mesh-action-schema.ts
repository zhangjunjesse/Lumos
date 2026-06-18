/**
 * mesh agent 产出的 action plan —— agent 不直接产生副作用，只声明"要做什么"，
 * 由 MeshRuntime 在单事务里执行。
 *
 * action 是白名单：write_blackboard / emit_event / order_intent。
 * order_intent 只是"下单意图"，必经确定性 Risk Gate + OrderGateway 才可能成交——
 * agent 物理够不到撮合/券商写（第一道保险是 M1 的 canUseTool）。
 */
export interface WriteBlackboardAction {
  type: 'write_blackboard'
  key: string
  value: unknown
}

export interface EmitEventAction {
  type: 'emit_event'
  topic: string
  payload: unknown
}

export interface OrderIntentAction {
  type: 'order_intent'
  symbol: string
  side: 'buy' | 'sell'
  qty: number
}

export type MeshAction = WriteBlackboardAction | EmitEventAction | OrderIntentAction

export interface MeshActionPlan {
  thought: string
  actions: MeshAction[]
}

/** SDK structured output 的 JSON schema，强制 agent 返回此形状。 */
export function buildMeshActionPlanSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['thought', 'actions'],
    properties: {
      thought: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['write_blackboard', 'emit_event', 'order_intent'] },
            key: { type: 'string' },
            value: {},
            topic: { type: 'string' },
            payload: {},
            symbol: { type: 'string' },
            side: { type: 'string', enum: ['buy', 'sell'] },
            qty: { type: 'number' },
          },
        },
      },
    },
  }
}

/** 校验并归一化 agent 的结构化输出为 MeshActionPlan；非法/未知 action 一律丢弃。 */
export function parseActionPlan(raw: unknown): MeshActionPlan {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const thought = typeof obj.thought === 'string' ? obj.thought : ''
  const rawActions = Array.isArray(obj.actions) ? obj.actions : []
  const actions: MeshAction[] = []
  for (const a of rawActions) {
    const action = normalizeAction(a)
    if (action) actions.push(action)
  }
  return { thought, actions }
}

function normalizeAction(a: unknown): MeshAction | null {
  if (!a || typeof a !== 'object') return null
  const o = a as Record<string, unknown>
  if (o.type === 'write_blackboard' && typeof o.key === 'string') {
    return { type: 'write_blackboard', key: o.key, value: o.value ?? null }
  }
  if (o.type === 'emit_event' && typeof o.topic === 'string') {
    return { type: 'emit_event', topic: o.topic, payload: o.payload ?? null }
  }
  if (
    o.type === 'order_intent' &&
    typeof o.symbol === 'string' &&
    (o.side === 'buy' || o.side === 'sell') &&
    typeof o.qty === 'number'
  ) {
    return { type: 'order_intent', symbol: o.symbol, side: o.side, qty: Math.floor(o.qty) }
  }
  return null
}
