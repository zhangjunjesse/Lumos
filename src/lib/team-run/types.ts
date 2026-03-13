export enum StageStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface TeamRunStage {
  id: string
  runId: string
  name: string
  status: StageStatus
  dependencies: string[]
  createdAt: string
  updatedAt: string
}
