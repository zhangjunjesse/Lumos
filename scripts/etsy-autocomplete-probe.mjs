#!/usr/bin/env node
// ③ 扩词 第 B 路 - 直接调 Etsy 真实 autocomplete API(公开,不需登录)
// endpoint: https://www.etsy.com/api/v3/ajax/public/search/suggestions?query=<kw>

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const KEYWORDS = (
  args.keywords ??
  // 取 ② preFilter+score 后 top 12 + 几个 niche-down 测试
  'autism pin,toothbrush holder,frutiger aero,4th of july png,couple ring,phone charm,mothers day gift,katana,california poppy,monster high doll,wedding sign,necklace,digital planner,phone case'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const OUT = path.resolve(args.out ?? './tmp/etsy-autocomplete');
await mkdir(OUT, { recursive: true });

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

// Node fetch 不走系统代理,直接 spawn curl(它会走 HTTPS_PROXY)
async function fetchSuggestions(kw) {
  const url = `https://www.etsy.com/api/v3/ajax/public/search/suggestions?query=${encodeURIComponent(kw)}&suggestion_count=20`;
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-s',
      '--max-time', '10',
      '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/147.0.0.0',
      '-H', 'Accept: application/json',
      url,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

const all = {};

for (const kw of KEYWORDS) {
  process.stdout.write(`▶ "${kw}" `);
  try {
    const data = await fetchSuggestions(kw);
    const suggestions = (data.results || []).map((r) => r.query);
    const simplified = data.simplified_queries || [];
    console.log(`→ ${suggestions.length} 条`);
    suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    all[kw] = { suggestions, simplified };
  } catch (e) {
    console.log(`✗ ${e.message}`);
    all[kw] = { error: e.message };
  }
  // 礼貌延迟,避免被限流
  await new Promise((r) => setTimeout(r, 300));
}

await writeFile(path.join(OUT, 'autocomplete-results.json'), JSON.stringify(all, null, 2));

// 汇总统计
const total = Object.values(all).reduce(
  (n, v) => n + (v.suggestions ? v.suggestions.length : 0),
  0,
);
const uniqueSet = new Set();
Object.values(all).forEach((v) => (v.suggestions || []).forEach((s) => uniqueSet.add(s)));
console.log(`\n汇总: ${KEYWORDS.length} 个种子 → ${total} 条建议(去重后 ${uniqueSet.size} 条)`);
console.log(`平均每种子 ${(total / KEYWORDS.length).toFixed(1)} 条`);
console.log(`✓ ${path.join(OUT, 'autocomplete-results.json')}`);
