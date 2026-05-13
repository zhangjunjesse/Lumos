#!/usr/bin/env tsx
async function main() {
  const { fetchCreatorVideos } = await import('../src/lib/douyin-collector/scraper.ts');
  const secUid = process.argv[2] ?? 'MS4wLjABAAAASXSGMWQh18huP899aJt1oAeF8S7VhBugxfYUO3XTp-E';
  console.log(`fetching creator ${secUid}...`);
  const r = await fetchCreatorVideos(secUid);
  if (r.ok) {
    console.log('OK profile:', { nickname: r.profile.nickname, follower: r.profile.followerCount });
    console.log('videos:', r.profile.videos.length);
    for (const v of r.profile.videos.slice(0, 3)) {
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
