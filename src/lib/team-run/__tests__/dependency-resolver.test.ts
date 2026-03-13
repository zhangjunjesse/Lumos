import { DependencyResolver } from '../dependency-resolver'

describe('DependencyResolver', () => {
  let resolver: DependencyResolver

  beforeEach(() => {
    resolver = new DependencyResolver()
  })

  describe('detectCycles', () => {
    test('检测循环依赖', () => {
      const stages = [
        { id: 'stage-a-001', dependencies: ['stage-b-001'] },
        { id: 'stage-b-001', dependencies: ['stage-a-001'] }
      ]

      expect(resolver.detectCycles(stages as any)).toBe(true)
    })

    test('无循环依赖', () => {
      const stages = [
        { id: 'stage-a-001', dependencies: [] },
        { id: 'stage-b-001', dependencies: ['stage-a-001'] }
      ]

      expect(resolver.detectCycles(stages as any)).toBe(false)
    })
  })

  describe('buildBatches', () => {
    test('构建执行批次', () => {
      const stages = [
        { id: 'stage-a-001', dependencies: [] },
        { id: 'stage-b-001', dependencies: [] },
        { id: 'stage-c-001', dependencies: ['stage-a-001'] },
        { id: 'stage-d-001', dependencies: ['stage-a-001', 'stage-b-001'] }
      ]

      const batches = resolver.buildBatches(stages as any)

      expect(batches).toHaveLength(2)
      expect(batches[0].stageIds).toContain('stage-a-001')
      expect(batches[0].stageIds).toContain('stage-b-001')
      expect(batches[1].stageIds).toContain('stage-c-001')
      expect(batches[1].stageIds).toContain('stage-d-001')
    })
  })

  describe('getReadyStages', () => {
    test('获取可执行的stage', () => {
      const stages = [
        { id: 'stage-a-001', dependencies: [], status: 'pending' },
        { id: 'stage-b-001', dependencies: ['stage-a-001'], status: 'pending' },
        { id: 'stage-c-001', dependencies: ['stage-a-001'], status: 'pending' }
      ]

      const completed = new Set(['stage-a-001'])
      const ready = resolver.getReadyStages(stages as any, completed)

      expect(ready).toHaveLength(2)
      expect(ready).toContain('stage-b-001')
      expect(ready).toContain('stage-c-001')
    })
  })
})
