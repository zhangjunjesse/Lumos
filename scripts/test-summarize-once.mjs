#!/usr/bin/env tsx
async function main() {
  const id = process.argv[2] ?? '8SyERH14kN4prd9y';
  const { summarizeVideo } = await import('../src/lib/douyin-collector/ai-summary.ts');
  const r = await summarizeVideo(id);
  console.log(JSON.stringify(r, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
