interface TeamRunStage {
  id: string
  dependencies: string[]
  status?: string
}

interface ExecutionBatch {
  batchIndex: number
  stageIds: string[]
}

export class DependencyResolver {
  detectCycles(stages: TeamRunStage[]): boolean {
    const graph = new Map<string, string[]>()
    stages.forEach(s => graph.set(s.id, s.dependencies))

    const visited = new Set<string>()
    const recStack = new Set<string>()

    const hasCycle = (id: string): boolean => {
      visited.add(id)
      recStack.add(id)

      const deps = graph.get(id) || []
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true
        } else if (recStack.has(dep)) {
          return true
        }
      }

      recStack.delete(id)
      return false
    }

    for (const stage of stages) {
      if (!visited.has(stage.id)) {
        if (hasCycle(stage.id)) return true
      }
    }

    return false
  }

  buildBatches(stages: TeamRunStage[]): ExecutionBatch[] {
    const batches: ExecutionBatch[] = []
    const completed = new Set<string>()
    let batchIndex = 0

    while (completed.size < stages.length) {
      const ready = stages
        .filter(s => !completed.has(s.id))
        .filter(s => s.dependencies.every(dep => completed.has(dep)))
        .map(s => s.id)

      if (ready.length === 0) break

      batches.push({ batchIndex, stageIds: ready })
      ready.forEach(id => completed.add(id))
      batchIndex++
    }

    return batches
  }

  getReadyStages(stages: TeamRunStage[], completed: Set<string>): string[] {
    return stages
      .filter(s => !completed.has(s.id))
      .filter(s => s.dependencies.every(dep => completed.has(dep)))
      .map(s => s.id)
  }
}
