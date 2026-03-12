import * as fs from 'fs'
import * as path from 'path'

interface WorkspaceConfig {
  stageWorkDir: string
  sharedReadDir: string
  outputDir: string
}

export class WorkspaceManager {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  prepareStageWorkspace(runId: string, stageId: string): WorkspaceConfig {
    const runDir = path.join(this.baseDir, runId)
    const stageDir = path.join(runDir, 'stages', stageId)

    // 创建目录结构
    fs.mkdirSync(path.join(stageDir, 'input'), { recursive: true })
    fs.mkdirSync(path.join(stageDir, 'output'), { recursive: true })
    fs.mkdirSync(path.join(stageDir, 'temp'), { recursive: true })
    fs.mkdirSync(path.join(runDir, 'shared'), { recursive: true })

    return {
      stageWorkDir: stageDir,
      sharedReadDir: path.join(runDir, 'shared'),
      outputDir: path.join(stageDir, 'output')
    }
  }

  cleanupStageWorkspace(runId: string, stageId: string): void {
    const stageDir = path.join(this.baseDir, runId, 'stages', stageId)
    if (fs.existsSync(stageDir)) {
      fs.rmSync(stageDir, { recursive: true, force: true })
    }
  }

  cleanupRun(runId: string): void {
    const runDir = path.join(this.baseDir, runId)
    if (fs.existsSync(runDir)) {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  }
}
