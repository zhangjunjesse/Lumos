#!/usr/bin/env tsx
async function main() {
  const { fetchVideoMetadata } = await import('../src/lib/douyin-collector/scraper.ts');
  const awemeId = process.argv[2] ?? '7634036956485143846';
  console.log(`fetching ${awemeId}...`);
  const r = await fetchVideoMetadata(awemeId);
  console.log(JSON.stringify(r, null, 2));
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
