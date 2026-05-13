#!/usr/bin/env tsx
async function main() {
  const videoId = process.argv[2] ?? '8SyERH14kN4prd9y';
  const collectionId = process.argv[3] ?? '8f3cd644fa9c4a96c70cba8fe5a9efdc';
  const { publishVideoToKnowledge } = await import('../src/lib/douyin-collector/publish.ts');
  const r = await publishVideoToKnowledge(videoId, collectionId);
  console.log(JSON.stringify(r, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
