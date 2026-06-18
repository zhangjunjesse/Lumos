import { parseActionPlan, buildMeshActionPlanSchema } from '../mesh-action-schema'

describe('parseActionPlan', () => {
  it('keeps valid write_blackboard and emit_event actions', () => {
    const plan = parseActionPlan({
      thought: 'hot',
      actions: [
        { type: 'write_blackboard', key: 'decision', value: { action: 'buy' } },
        { type: 'emit_event', topic: 'quote_anomaly', payload: { code: 'x' } },
      ],
    })
    expect(plan.thought).toBe('hot')
    expect(plan.actions).toHaveLength(2)
  })

  it('drops unknown/forbidden action types (e.g. place_order)', () => {
    const plan = parseActionPlan({
      thought: '',
      actions: [
        { type: 'place_order', code: '600160', qty: 100 },
        { type: 'write_blackboard', key: 'k', value: 1 },
      ],
    })
    expect(plan.actions).toHaveLength(1)
    expect(plan.actions[0].type).toBe('write_blackboard')
  })

  it('drops malformed actions (missing required fields)', () => {
    const plan = parseActionPlan({ actions: [{ type: 'write_blackboard' }, { type: 'emit_event' }] })
    expect(plan.actions).toHaveLength(0)
  })

  it('tolerates non-object input', () => {
    expect(parseActionPlan(null).actions).toHaveLength(0)
    expect(parseActionPlan('x').thought).toBe('')
  })

  it('schema action 白名单 = write_blackboard / emit_event / order_intent（仍无任何直接下单工具）', () => {
    const schema = buildMeshActionPlanSchema() as {
      properties: { actions: { items: { properties: { type: { enum: string[] } } } } }
    }
    expect(schema.properties.actions.items.properties.type.enum).toEqual([
      'write_blackboard',
      'emit_event',
      'order_intent',
    ])
  })
})
