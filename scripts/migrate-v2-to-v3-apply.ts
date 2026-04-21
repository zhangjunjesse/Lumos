/**
 * V2 → V3 真实迁移执行器（destructive）。
 *
 * 执行步骤：
 *   1. 备份 ~/.lumos/lumos.db → lumos.db.pre-v3-<timestamp>.bak
 *   2. 逐行迁移 scheduled_workflows.workflow_dsl 和 workflows.workflow_dsl
 *      - V2 → V3：调用 migrateWorkflowV2ToV3 + compileWorkflowDslV3 双重校验
 *      - 通过后更新 workflow_dsl + dsl_version 字段
 *      - 失败的行保留原样，列入失败清单
 *   3. schedule_run_history.workflow_dsl_snapshot 不迁移（历史快照保持原样）
 *
 * 用法:
 *   npx tsx scripts/migrate-v2-to-v3-apply.ts --dry-run   # 仅预演，不写库
 *   npx tsx scripts/migrate-v2-to-v3-apply.ts --apply     # 实际写库（含备份）
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { migrateWorkflowV2ToV3 } from '../src/lib/workflow/migrate-v2-to-v3';
import { compileWorkflowDslV3 } from '../src/lib/workflow/compiler-v3';
import type { WorkflowDSLV2 } from '../src/lib/workflow/types';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;

const dbPath = path.join(os.homedir(), '.lumos', 'lumos.db');

if (!fs.existsSync(dbPath)) {
  console.error(`DB not found: ${dbPath}`);
  process.exit(1);
}

if (apply) {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = path.join(os.homedir(), '.lumos', `lumos.db.pre-v3-${ts}.bak`);
  fs.copyFileSync(dbPath, backup);
  console.log(`[BACKUP] ${dbPath} → ${backup}`);
}

const db = new Database(dbPath, { readonly: dryRun });

interface Row { id: string; name: string; workflow_dsl: string }
interface Result { table: string; id: string; name: string; status: 'migrated' | 'skipped-v3' | 'skipped-non-v2' | 'failed'; errors?: string[] }

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name?: string } | undefined;
  return row?.name === name;
}

function hasColumn(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some(r => r.name === col);
}

function migrateTable(table: string): Result[] {
  if (!tableExists(table)) return [];
  const rows = db.prepare(
    `SELECT id, name, workflow_dsl FROM ${table} WHERE workflow_dsl IS NOT NULL`,
  ).all() as Row[];

  const hasDslVersion = hasColumn(table, 'dsl_version');
  const results: Result[] = [];
  const updateSql = hasDslVersion
    ? `UPDATE ${table} SET workflow_dsl = ?, dsl_version = 'v3', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    : `UPDATE ${table} SET workflow_dsl = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  const updateStmt = db.prepare(updateSql);

  for (const r of rows) {
    let dsl: { version?: string };
    try {
      dsl = JSON.parse(r.workflow_dsl);
    } catch {
      results.push({ table, id: r.id, name: r.name, status: 'failed', errors: ['JSON parse error'] });
      continue;
    }

    if (dsl.version === 'v3') {
      results.push({ table, id: r.id, name: r.name, status: 'skipped-v3' });
      continue;
    }
    if (dsl.version !== 'v2') {
      results.push({ table, id: r.id, name: r.name, status: 'skipped-non-v2' });
      continue;
    }

    const mig = migrateWorkflowV2ToV3(dsl as WorkflowDSLV2);
    if (!mig.valid) {
      results.push({ table, id: r.id, name: r.name, status: 'failed', errors: mig.errors });
      continue;
    }
    const compile = compileWorkflowDslV3(mig.dsl);
    if (!compile.validation.valid) {
      results.push({ table, id: r.id, name: r.name, status: 'failed', errors: compile.validation.errors });
      continue;
    }

    if (apply) updateStmt.run(JSON.stringify(mig.dsl), r.id);
    results.push({ table, id: r.id, name: r.name, status: 'migrated' });
  }

  return results;
}

const tx = apply ? db.transaction(() => [...migrateTable('scheduled_workflows'), ...migrateTable('workflows')]) : null;
const all: Result[] = tx ? tx() : [...migrateTable('scheduled_workflows'), ...migrateTable('workflows')];

const byStatus = all.reduce<Record<string, number>>((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});

console.log(`\n======== ${apply ? 'APPLIED' : 'DRY-RUN'} ========`);
console.log(`共 ${all.length} 条记录：`);
console.log(`  migrated:          ${byStatus.migrated ?? 0}`);
console.log(`  skipped-v3:        ${byStatus['skipped-v3'] ?? 0}`);
console.log(`  skipped-non-v2:    ${byStatus['skipped-non-v2'] ?? 0}`);
console.log(`  failed:            ${byStatus.failed ?? 0}`);

const failed = all.filter(r => r.status === 'failed');
if (failed.length > 0) {
  console.log(`\n失败项 (${failed.length}) — 保持原 V2 DSL 不动：`);
  for (const f of failed) {
    console.log(`  ✗ [${f.table}] ${f.name} (${f.id})`);
    for (const e of f.errors ?? []) console.log(`      - ${e}`);
  }
}

if (dryRun) {
  console.log(`\n此为 DRY-RUN，未修改数据库。加 --apply 执行真实迁移。`);
} else {
  console.log(`\n迁移完成，DB 已更新。`);
}
