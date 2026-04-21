/**
 * V2 → V3 迁移审计脚本（dry-run）。
 *
 * 从 ~/.lumos/lumos.db 读取 scheduled_workflows + workflows 两张表，
 * 跑 migrator + validator，打印成功 / 失败 / 警告 明细。
 * 不迁移 schedule_run_history.workflow_dsl_snapshot（历史快照应保留原样）。
 *
 * 用法: npx tsx scripts/migrate-real.ts
 */
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { migrateWorkflowV2ToV3 } from '../src/lib/workflow/migrate-v2-to-v3';
import { compileWorkflowDslV3 } from '../src/lib/workflow/compiler-v3';
import type { WorkflowDSLV2 } from '../src/lib/workflow/types';

interface Row { id: string; name: string; workflow_dsl: string }
interface Failure { table: string; name: string; errors: string[]; warnings: string[] }
interface Warning { table: string; name: string; warnings: string[] }

const dbPath = path.join(os.homedir(), '.lumos', 'lumos.db');
const db = new Database(dbPath, { readonly: true });

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function auditTable(table: string, dslColumn: string): { ok: number; bad: number; skipped: number; failures: Failure[]; warnings: Warning[] } {
  if (!tableExists(table)) return { ok: 0, bad: 0, skipped: 0, failures: [], warnings: [] };

  const rows = db.prepare(
    `SELECT id, name, ${dslColumn} AS workflow_dsl FROM ${table} WHERE ${dslColumn} IS NOT NULL`,
  ).all() as Row[];

  let ok = 0, bad = 0, skipped = 0;
  const failures: Failure[] = [];
  const warnings: Warning[] = [];

  for (const r of rows) {
    let dsl: { version?: string };
    try {
      dsl = JSON.parse(r.workflow_dsl);
    } catch {
      skipped++;
      continue;
    }
    if (dsl.version === 'v3') { skipped++; continue; }
    if (dsl.version !== 'v2') { skipped++; continue; }

    const result = migrateWorkflowV2ToV3(dsl as WorkflowDSLV2);
    if (!result.valid) {
      bad++;
      failures.push({ table, name: r.name, errors: result.errors, warnings: result.warnings });
      continue;
    }

    const compile = compileWorkflowDslV3(result.dsl);
    if (!compile.validation.valid) {
      bad++;
      failures.push({ table, name: r.name, errors: compile.validation.errors, warnings: result.warnings });
      continue;
    }

    ok++;
    if (result.warnings.length > 0) warnings.push({ table, name: r.name, warnings: result.warnings });
  }

  return { ok, bad, skipped, failures, warnings };
}

const sched = auditTable('scheduled_workflows', 'workflow_dsl');
const wf = auditTable('workflows', 'workflow_dsl');

console.log('======== V2 → V3 迁移审计 ========');
console.log(`scheduled_workflows: ${sched.ok} 成功 / ${sched.bad} 失败 / ${sched.skipped} 跳过(非 v2)`);
console.log(`workflows:           ${wf.ok} 成功 / ${wf.bad} 失败 / ${wf.skipped} 跳过(非 v2)`);

const allWarnings = [...sched.warnings, ...wf.warnings];
const allFailures = [...sched.failures, ...wf.failures];

if (allWarnings.length > 0) {
  console.log(`\n有警告的成功项 (${allWarnings.length}):`);
  for (const w of allWarnings) {
    console.log(`  ✓ [${w.table}] ${w.name}`);
    for (const msg of w.warnings) console.log(`      - ${msg}`);
  }
}

if (allFailures.length > 0) {
  console.log(`\n失败项 (${allFailures.length}) — 需要人工调整后再迁移:`);
  for (const f of allFailures) {
    console.log(`\n  ✗ [${f.table}] ${f.name}`);
    for (const e of f.errors) console.log(`      - ${e}`);
    if (f.warnings.length > 0) {
      console.log(`      警告:`);
      for (const w of f.warnings) console.log(`        - ${w}`);
    }
  }
}
