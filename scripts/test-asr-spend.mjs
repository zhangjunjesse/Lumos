#!/usr/bin/env tsx
async function main() {
  const { aggregateAsrSpend } = await import('../src/lib/douyin-collector/storage.ts');
  console.log(JSON.stringify(aggregateAsrSpend(), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
