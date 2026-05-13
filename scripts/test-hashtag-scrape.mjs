#!/usr/bin/env tsx
async function main() {
  const { fetchHashtagVideos } = await import('../src/lib/douyin-collector/scraper.ts');
  const tag = process.argv[2] ?? 'AI';
  console.log(`fetching hashtag ${tag}...`);
  const r = await fetchHashtagVideos(tag);
  if (r.ok) {
    console.log('OK videos:', r.result.videos.length);
    for (const v of r.result.videos.slice(0, 3)) {
      console.log('  -', v.awemeId, v.title?.slice(0, 50));
    }
  } else {
    console.log('FAIL', r);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
