#!/usr/bin/env tsx
// One-shot: trigger the init-builtin-resources flow so douyin-collector
// gets installed without restarting the running dev server. Used after
// fixing a silent install failure that blocked the Settings UI.
//
// Run: LUMOS_DATA_DIR=$HOME/.lumos npx tsx scripts/install-douyin-once.mjs
async function main() {
  const mod = await import('../src/lib/init-builtin-resources.ts');
  await mod.initBuiltinResources();
  console.log('=== init done ===');
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
