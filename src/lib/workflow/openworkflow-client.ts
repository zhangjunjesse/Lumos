import { BackendSqlite } from "@openworkflow/backend-sqlite";
import { OpenWorkflow } from "openworkflow";
import path from "path";
import { mkdirSync } from "fs";
import { getLumosDataDir } from "./run-workspace-paths";

let workflowInstance: OpenWorkflow | null = null;
let workflowBackend: BackendSqlite | null = null;

export function getWorkflowDataDir(): string {
  return getLumosDataDir();
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
