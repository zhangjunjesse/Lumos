#!/usr/bin/env node
/**
 * Real-environment smoke test for the ecommerce URL-ingest pipeline.
 *
 * Usage:
 *   node scripts/verify-ecommerce-url-ingest.mjs <product-url> [--auto-start] [--base http://localhost:3000]
 *
 * Prereqs:
 *   1. Lumos desktop app is running locally (so the API route is reachable
 *      and the embedded browser bridge is up).
 *   2. AdsPower (or your preferred browser provider) is running and the
 *      profile is enabled in Settings → Browser. The ingest will use it
 *      automatically because discover-settings.ts reads the runtime preset.
 *   3. The ecommerce assistant has analysis + image providers configured if
 *      you pass --auto-start.
 *
 * What this script verifies:
 *   - URL → DOM adapter / LLM extracts title + main image.
 *   - Image is downloaded into the upload directory.
 *   - product_inputs row appears via GET /api/apps/builtin/ecommerce/inputs.
 *   - Optional: --auto-start kicks off a job and polls until it reaches a
 *     terminal status, then prints the produced image_outputs broken down
 *     by kind (so you can confirm the detail-set fired).
 */

import process from 'node:process';

function parseArgs(argv) {
  const args = { url: null, autoStart: false, base: 'http://localhost:3000', timeoutMs: 600_000 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--auto-start') args.autoStart = true;
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--timeout') args.timeoutMs = Number(argv[++i]) * 1000;
    else if (!args.url && !a.startsWith('--')) args.url = a;
  }
  if (!args.url) {
    console.error('Usage: node scripts/verify-ecommerce-url-ingest.mjs <product-url> [--auto-start] [--base http://localhost:3000]');
    process.exit(2);
  }
  return args;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body: json };
}

async function pollJob(base, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await getJson(`${base}/api/apps/builtin/ecommerce/jobs?outputs=1`);
    const job = body?.jobs?.find((j) => j.id === jobId);
    if (!job) {
      await sleep(2000);
      continue;
    }
    process.stderr.write(`\r[${new Date().toISOString()}] job ${jobId} status=${job.status} stage=${job.stage} progress=${job.progress}%   `);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      const outputs = (body?.outputs ?? []).filter((o) => o.job_id === jobId);
      process.stderr.write('\n');
      return { job, outputs };
    }
    await sleep(3000);
  }
  throw new Error(`Job ${jobId} did not reach terminal status within ${timeoutMs}ms.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeOutputs(outputs) {
  const groups = new Map();
  for (const o of outputs) {
    const list = groups.get(o.kind) ?? [];
    list.push(o);
    groups.set(o.kind, list);
  }
  const lines = [];
  for (const [kind, list] of groups) {
    lines.push(`  · ${kind}: ${list.length} 张`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[1/4] Hitting ${args.base}/api/apps/builtin/ecommerce/inputs/from-url …`);
  const ingest = await postJson(`${args.base}/api/apps/builtin/ecommerce/inputs/from-url`, {
    url: args.url,
    auto_start: args.autoStart,
  });
  if (!ingest.ok) {
    console.error('Ingest failed:', ingest.status, ingest.body);
    process.exit(1);
  }
  const { input_id, adapter, llm_fallback_used, gallery_count, parsed, job, job_start_error, warnings } = ingest.body;
  console.log(`[2/4] Ingest OK — adapter=${adapter}${llm_fallback_used ? ' + LLM' : ''}, gallery=${gallery_count}`);
  console.log(`     · title: ${parsed?.title}`);
  console.log(`     · price: ${parsed?.price ?? '(none)'} · bullets: ${parsed?.bullet_count ?? 0}`);
  console.log(`     · input_id: ${input_id}`);
  if (warnings?.length) console.log(`     · warnings: ${warnings.join(' | ')}`);

  console.log('[3/4] Verifying product_inputs row is queryable …');
  const list = await getJson(`${args.base}/api/apps/builtin/ecommerce/inputs`);
  const found = list.body?.items?.find((row) => row.id === input_id);
  if (!found) {
    console.error('Input row not visible via list API. Aborting.');
    process.exit(1);
  }
  console.log(`     · main_image_path: ${found.main_image_path}`);

  if (!args.autoStart) {
    console.log('[4/4] --auto-start not set; skipping SOP wait. Open the studio UI to run the job.');
    return;
  }

  if (!job?.id) {
    console.error('Auto-start requested but no job was returned:', job_start_error);
    process.exit(1);
  }
  console.log(`[4/4] Polling job ${job.id} (timeout ${(args.timeoutMs / 1000).toFixed(0)}s) …`);
  const { job: finalJob, outputs } = await pollJob(args.base, job.id, args.timeoutMs);
  console.log(`     · status: ${finalJob.status} · stage: ${finalJob.stage}`);
  console.log(`     · summary: ${finalJob.summary ?? '(empty)'}`);
  console.log('     · outputs by kind:');
  console.log(summarizeOutputs(outputs));

  const expectedKinds = ['cutout', 'detail-hero', 'detail-feature', 'detail-lifestyle', 'detail-scale'];
  const missing = expectedKinds.filter((k) => !outputs.some((o) => o.kind === k));
  if (missing.length > 0 && finalJob.status === 'completed') {
    console.warn(`     · ⚠️  expected kinds missing from output: ${missing.join(', ')}`);
  }
  if (finalJob.status !== 'completed') process.exit(1);
}

main().catch((err) => {
  console.error('FAIL:', err?.message ?? err);
  process.exit(1);
});
