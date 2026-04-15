#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 20000;

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

async function fetchText(url, options = {}) {
  const timeout = withTimeout(options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "lumos-deepsearch-feasibility/0.1",
        accept: options.accept ?? "*/*",
        ...options.headers,
      },
      signal: timeout.signal,
    });

    const text = await response.text();
    return { response, text };
  } finally {
    timeout.done();
  }
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, {
    ...options,
    accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid json from ${url}: ${error.message}`);
  }
  return { response, json, text };
}

function snippet(value, max = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function ok(result) {
  return { status: "ok", ...result };
}

function skipped(reason, extra = {}) {
  return { status: "skipped", reason, ...extra };
}

function failed(error, extra = {}) {
  return {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  };
}

function rateLimited(reason, extra = {}) {
  return {
    status: "rate_limited",
    reason,
    ...extra,
  };
}

async function verifyProjectGutenberg() {
  const url = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
  const { response, text } = await fetchText(url, { accept: "text/plain,*/*;q=0.8" });
  const looksValid =
    response.ok &&
    text.length > 100000 &&
    /Pride and Prejudice/i.test(text) &&
    /Project Gutenberg/i.test(text);

  if (!looksValid) {
    throw new Error(`unexpected Gutenberg payload: status=${response.status}, length=${text.length}`);
  }

  return ok({
    source: "project_gutenberg",
    category: "book_fulltext",
    format: "txt",
    auth: "none",
    sampleTitle: "Pride and Prejudice",
    contentLength: text.length,
    excerpt: snippet(text.slice(0, 500)),
    url,
  });
}

async function verifyWikisource() {
  const searchUrl =
    "https://en.wikisource.org/w/api.php?action=query&list=search&srsearch=Pride%20and%20Prejudice&format=json&srlimit=1";
  const {
    json: {
      query: { search = [] } = {},
    },
  } = await fetchJson(searchUrl);

  const title = search[0]?.title;
  if (!title) {
    throw new Error("no Wikisource search results");
  }

  const extractUrl =
    `https://en.wikisource.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const { json } = await fetchJson(extractUrl);
  const pages = Object.values(json.query?.pages ?? {});
  const page = pages[0];
  const extract = page?.extract ?? "";

  if (!extract || extract.length < 200) {
    throw new Error(`unexpected Wikisource extract length for ${title}: ${extract.length}`);
  }

  return ok({
    source: "wikisource",
    category: "book_fulltext",
    format: "plain_text_via_mediawiki_api",
    auth: "none",
    sampleTitle: title,
    contentLength: extract.length,
    excerpt: snippet(extract),
    url: extractUrl,
  });
}

async function verifyEuropePmc() {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=machine%20learning&format=json&pageSize=1&resultType=core";
  const { json } = await fetchJson(url);
  const result = json.resultList?.result?.[0];

  if (!result?.title) {
    throw new Error("no Europe PMC results");
  }

  return ok({
    source: "europe_pmc",
    category: "paper_search_and_links",
    format: "json",
    auth: "none",
    sampleTitle: result.title,
    hasAbstract: Boolean(result.abstractText),
    hasFullTextLink:
      Array.isArray(result.fullTextUrlList?.fullTextUrl) && result.fullTextUrlList.fullTextUrl.length > 0,
    excerpt: snippet(result.abstractText ?? result.title),
    url,
  });
}

async function verifyPmcBioc() {
  const url =
    "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/17299597/unicode";
  const { json } = await fetchJson(url);
  const collection = Array.isArray(json) ? json[0] : json;
  const document = collection?.documents?.[0];
  const passages = Array.isArray(document?.passages) ? document.passages : [];
  const firstText = passages.find((passage) => typeof passage?.text === "string" && passage.text.trim())?.text;

  if (!document || !firstText) {
    throw new Error("unexpected PMC BioC payload");
  }

  return ok({
    source: "pmc_bioc",
    category: "paper_fulltext",
    format: "bioc_json",
    auth: "none",
    sampleId: document.id ?? "17299597",
    passageCount: passages.length,
    excerpt: snippet(firstText),
    url,
  });
}

async function verifyArxiv() {
  const url =
    "https://export.arxiv.org/api/query?search_query=all:electron&start=0&max_results=1";
  const { response, text } = await fetchText(url, {
    accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8",
  });

  if (response.status === 429) {
    return rateLimited("arXiv API returned 429 from this machine/IP", {
      source: "arxiv",
      category: "paper_search",
      format: "atom_xml",
      auth: "none",
      url,
    });
  }

  if (!response.ok) {
    throw new Error(`arXiv returned ${response.status}`);
  }

  const title = text.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  const summary = text.match(/<entry>[\s\S]*?<summary>([\s\S]*?)<\/summary>/i)?.[1]?.replace(/\s+/g, " ").trim();

  if (!title) {
    throw new Error("could not parse arXiv Atom title");
  }

  return ok({
    source: "arxiv",
    category: "paper_search",
    format: "atom_xml",
    auth: "none",
    sampleTitle: title,
    excerpt: snippet(summary ?? title),
    url,
  });
}

async function verifyOpenLibrary() {
  const url =
    "https://openlibrary.org/search.json?q=pride%20and%20prejudice&limit=1&fields=key,title,author_name,has_fulltext,ia,public_scan_b";
  const { json } = await fetchJson(url);
  const doc = json.docs?.[0];

  if (!doc?.title) {
    throw new Error("no Open Library results");
  }

  return ok({
    source: "open_library",
    category: "book_discovery",
    format: "json",
    auth: "none",
    sampleTitle: doc.title,
    hasFullText: Boolean(doc.has_fulltext),
    hasPublicScan: Boolean(doc.public_scan_b),
    archiveIds: Array.isArray(doc.ia) ? doc.ia.slice(0, 3) : [],
    url,
  });
}

async function verifyOpenAlex() {
  const apiKey = process.env.OPENALEX_API_KEY;
  if (!apiKey) {
    return skipped("OPENALEX_API_KEY not set", {
      source: "openalex",
      category: "paper_discovery_and_content",
      auth: "api_key_required_by_docs",
    });
  }

  const url =
    `https://api.openalex.org/works?filter=has_content.pdf:true&per_page=1&api_key=${encodeURIComponent(apiKey)}`;
  const { response, json } = await fetchJson(url);
  const work = json.results?.[0];

  if (!response.ok || !work?.title) {
    throw new Error(`unexpected OpenAlex response: status=${response.status}`);
  }

  return ok({
    source: "openalex",
    category: "paper_discovery_and_content",
    format: "json",
    auth: "api_key",
    sampleTitle: work.title,
    hasPdfContent: Boolean(work.has_content?.pdf),
    contentUrl: work.content_url ?? null,
    url,
  });
}

async function verifyCore() {
  const apiKey = process.env.CORE_API_KEY;
  if (!apiKey) {
    return skipped("CORE_API_KEY not set", {
      source: "core",
      category: "paper_aggregator",
      auth: "registration_or_api_key_recommended",
    });
  }

  return skipped("CORE live verification placeholder not implemented yet", {
    source: "core",
    category: "paper_aggregator",
    auth: "api_key",
  });
}

const verifiers = [
  verifyProjectGutenberg,
  verifyWikisource,
  verifyEuropePmc,
  verifyPmcBioc,
  verifyArxiv,
  verifyOpenLibrary,
  verifyOpenAlex,
  verifyCore,
];

async function main() {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const verify of verifiers) {
    try {
      const result = await verify();
      results.push(result);
    } catch (error) {
      results.push(
        failed(error, {
          source: verify.name.replace(/^verify/, "").replace(/[A-Z]/g, (m, idx) => (idx ? `_${m.toLowerCase()}` : m.toLowerCase())),
        }),
      );
    }
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: results.filter((result) => result.status === "ok").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    rateLimited: results.filter((result) => result.status === "rate_limited").length,
    failed: results.filter((result) => result.status === "failed").length,
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
        status: "fatal",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
