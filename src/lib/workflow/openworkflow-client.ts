import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";
import path from "path";
import os from "os";
import { mkdirSync } from "fs";

let workflowInstance: OpenWorkflow | null = null;
let workflowBackend: BackendSqlite | null = null;

export function getWorkflowDataDir(): string {
  return process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
}

export async function getWorkflowEngine(): Promise<OpenWorkflow> {
  if (workflowInstance) {
    return workflowInstance;
  }

  const dataDir = getWorkflowDataDir();
  mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'workflows.db');
  workflowBackend = BackendSqlite.connect(dbPath);
  workflowInstance = new OpenWorkflow({ backend: workflowBackend });

  return workflowInstance;
}

export async function resetWorkflowClientForTests(): Promise<void> {
  if (workflowBackend) {
    await workflowBackend.stop();
  }

  workflowInstance = null;
  workflowBackend = null;
}
