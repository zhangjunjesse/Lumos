#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 20000;
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    '-sS',
    '-L',
    '--compressed',
    '-A',
    'lumos-deepsearch-chinese-source-verifier/0.1',
  ];
  if (options.accept) {
    args.push('-H', `Accept: ${options.accept}`);
  }
  args.push(url);

  const timeout = withTimeout(timeoutMs);
  try {
    const { stdout } = await execFileAsync('curl', args, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      signal: timeout.signal,
    });
    return { response: { status: 200 }, text: stdout };
  } finally {
    timeout.done();
  }
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, {
    ...options,
    accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid json from ${url}: ${error.message}`);
  }
  return { response, json, text };
}

function snippet(value, max = 180) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function ok(result) {
  return { status: 'ok', ...result };
}

function failed(error, extra = {}) {
  return {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  };
}

function blocked(reason, extra = {}) {
  return {
    status: 'blocked',
    reason,
    ...extra,
  };
}

async function verifyZhWikisource() {
  const searchUrl =
    'https://zh.wikisource.org/w/api.php?action=query&list=search&srsearch=%E5%8F%B2%E8%A8%98&format=json&srlimit=1';
  const {
    json: {
      query: { search = [] } = {},
    },
  } = await fetchJson(searchUrl);
  const title = search[0]?.title;
  if (!title) {
    throw new Error('no zh wikisource search results');
  }

  const extractUrl =
    `https://zh.wikisource.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const { json } = await fetchJson(extractUrl);
  const page = Object.values(json.query?.pages ?? {})[0];
  const extract = page?.extract ?? '';
  if (extract.length < 200) {
    throw new Error(`unexpected extract length: ${extract.length}`);
  }

  return ok({
    source: 'wikisource_zh',
    verification: 'full_content',
    sampleTitle: title,
    contentLength: extract.length,
    excerpt: snippet(extract),
    url: extractUrl,
  });
}

async function verifyChineseTextProject() {
  const statusUrl = 'https://api.ctext.org/getstatus';
  const textUrl = 'https://api.ctext.org/gettext?urn=ctp:analects/xue-er';

  const { json: statusJson } = await fetchJson(statusUrl);
  const { json: textJson } = await fetchJson(textUrl);

  const lines = Array.isArray(textJson.fulltext) ? textJson.fulltext : [];
  if (!statusJson || lines.length < 5) {
    throw new Error('unexpected Chinese Text Project payload');
  }

  return ok({
    source: 'ctext',
    verification: 'full_content',
    loggedIn: statusJson.loggedin === 'true',
    subscriber: statusJson.subscriber === 'true',
    sampleTitle: textJson.title ?? 'unknown',
    lineCount: lines.length,
    excerpt: snippet(lines[0]),
    url: textUrl,
  });
}

async function verifyChinaXiv() {
  const homeUrl = 'https://www.chinaxiv.org/';
  const oaiUrl = 'https://www.chinaxiv.org/oai/OAIHandler?verb=Identify';

  const { response: homeResponse, text: homeText } = await fetchText(homeUrl);
  if (homeResponse.status === 403 || /no right to access this web/i.test(homeText)) {
    return blocked('homepage blocked by site access control', {
      source: 'chinaxiv',
      verification: 'access_denied',
      url: homeUrl,
    });
  }

  const { response: oaiResponse, text: oaiText } = await fetchText(oaiUrl);
  if (oaiResponse.status === 403 || /no right to access this web/i.test(oaiText)) {
    return blocked('oai endpoint blocked by site access control', {
      source: 'chinaxiv',
      verification: 'access_denied',
      url: oaiUrl,
    });
  }

  return ok({
    source: 'chinaxiv',
    verification: 'search_and_metadata',
    excerpt: snippet(oaiText),
    url: oaiUrl,
  });
}

async function verifyNcpssd() {
  const guideUrl = 'https://www.ncpssd.cn/service/guide';
  const journalUrl = 'https://www.ncpssd.cn/journal/index?nav=1&langType=1&s=-1';

  const { text: guideText } = await fetchText(guideUrl);
  const { text: journalText } = await fetchText(journalUrl);

  const hasGuide = /在线阅读|全文下载|注册|登录/.test(guideText);
  const hasJournal = /中文期刊|\/journal\/details|资源/.test(journalText);
  if (!hasGuide || !hasJournal) {
    throw new Error('unexpected ncpssd guide or journal page payload');
  }

  return ok({
    source: 'ncpssd',
    verification: 'search_and_metadata',
    confirmsLoginDownload: /在线阅读|全文下载/.test(guideText),
    excerpt: snippet(guideText),
    url: journalUrl,
  });
}

async function verifyPubScholar() {
  const url = 'https://pubscholar.cn/';
  const { text } = await fetchText(url);
  const looksValid = /PubScholar公益学术平台/.test(text) && /学术资源/.test(text);
  if (!looksValid) {
    throw new Error('unexpected pubscholar homepage payload');
  }

  return ok({
    source: 'pubscholar',
    verification: 'site_access_only',
    excerpt: snippet(text),
    url,
  });
}

async function verifyCadal() {
  const detailUrl = 'https://cadal.edu.cn/cardpage/bookCardPage?ssno=06850835';
  const { text } = await fetchText(detailUrl);
  const hasMetadata = /详情页|可控硅中频感应熔炼炉/.test(text);
  const requiresLoginOrBorrow = /请先登录|借阅后有7天阅读时长|试读/.test(text);
  if (!hasMetadata) {
    throw new Error('unexpected cadal detail page payload');
  }

  return ok({
    source: 'cadal',
    verification: 'search_and_metadata',
    requiresLoginOrBorrow,
    excerpt: snippet(text),
    url: detailUrl,
  });
}

async function verifyNlcGuji() {
  const introUrl = 'https://www.nlc.cn/pcab/zy/zhgj_zyk/index.shtml';
  const readListUrl = 'http://read.nlc.cn/allSearch/searchList?searchType=10024&showType=1&pageNo=1';
  const { text: introText } = await fetchText(introUrl);
  const { text: listText } = await fetchText(readListUrl);

  const introOk = /中华古籍资源库|在线阅览|影像/.test(introText);
  const listOk = /数字古籍|\/allSearch\/searchDetail|責任者|责任者/.test(listText);
  if (!introOk || !listOk) {
    throw new Error('unexpected nlc guji payload');
  }

  return ok({
    source: 'nlc_guji',
    verification: 'search_and_metadata',
    excerpt: snippet(listText),
    url: readListUrl,
  });
}

const verifiers = [
  verifyZhWikisource,
  verifyChineseTextProject,
  verifyChinaXiv,
  verifyNcpssd,
  verifyPubScholar,
  verifyCadal,
  verifyNlcGuji,
];

async function main() {
  const results = [];
  const startedAt = new Date().toISOString();
  for (const verify of verifiers) {
    try {
      results.push(await verify());
    } catch (error) {
      results.push(failed(error, { source: verify.name.replace(/^verify/, '').toLowerCase() }));
    }
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: results.filter((result) => result.status === 'ok').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'fatal',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
