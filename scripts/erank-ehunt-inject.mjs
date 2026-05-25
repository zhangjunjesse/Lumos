#!/usr/bin/env node
// 把 ⑥ 商业分析数据(analysis + raw)合并写入 mock-data.ts 的 EHUNT_ANALYSIS

import fs from 'node:fs';
import path from 'node:path';

const ANALYSIS_DIR = path.resolve('./tmp/erank-ehunt/analysis');
const RAW_DIR = path.resolve('./tmp/erank-ehunt/raw');
const MOCK_FILE = path.resolve('./src/components/apps/builtin/etsy-erank/mock-data.ts');

function cleanShopName(name) {
  if (!name) return '';
  return name
    .replace(/\s+Ad\s+from\s+shop\s+.+$/i, '')
    .replace(/\s+From\s+shop\s+.+$/i, '')
    .trim();
}

function buildLiteral() {
  const files = fs.readdirSync(ANALYSIS_DIR).filter((f) => f.endsWith('.json')).sort();
  const entries = [];

  for (const file of files) {
    const a = JSON.parse(fs.readFileSync(path.join(ANALYSIS_DIR, file), 'utf8'));
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));

    // listing 精简到 UI 实际渲染字段
    const listings = raw.listings.map((l) => ({
      listing_id: l.listing_id,
      title: l.title,
      img: `/etsy-images/${l.listing_id}.jpg`,
      price: l.price,
      shop_name: cleanShopName(l.shop_name),
      shop_rating: l.shop_rating,
      shop_review_count: l.shop_review_count,
      href: l.href,
      ehunt: l.ehunt,
    }));

    entries.push({
      keyword: a.keyword,
      data: { analysis: a, listings },
    });
  }

  return entries;
}

function serialize(entries) {
  const lines = entries.map(({ keyword, data }) => {
    return `  ${JSON.stringify(keyword)}: ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')},`;
  });
  return `export const EHUNT_ANALYSIS: Record<string, EhuntKeywordData> = {\n${lines.join('\n')}\n};`;
}

const entries = buildLiteral();
console.log('准备写入', entries.length, '个 EHUNT_ANALYSIS 条目');

const literal = serialize(entries);

// 替换 mock-data.ts 末尾的占位 EHUNT_ANALYSIS
let mock = fs.readFileSync(MOCK_FILE, 'utf8');
const m = mock.match(/(\/\/ ⑥ 商业分析[^\n]*\n\/\/ 数据来源[^\n]*\n)export const EHUNT_ANALYSIS: Record<string, EhuntKeywordData> = \{[^]*?\};/);
if (!m) {
  console.error('未找到 EHUNT_ANALYSIS 占位,请检查 mock-data.ts');
  process.exit(1);
}
mock = mock.replace(m[0], m[1] + literal);
fs.writeFileSync(MOCK_FILE, mock);
console.log('写入完成:', MOCK_FILE);
