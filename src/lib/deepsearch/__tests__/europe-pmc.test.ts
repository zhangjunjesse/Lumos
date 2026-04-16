import type { AdapterContext } from '../adapter-types';
import { europePmcAdapter } from '../adapters/europe-pmc';

function createContextWithMap(map: Record<string, { status?: number; html: string; contentType?: string }>): AdapterContext {
  return {
    fetch: jest.fn(async (url: string) => {
      const hit = map[url];
      if (!hit) {
        throw new Error(`unexpected url: ${url}`);
      }
      return {
        status: hit.status ?? 200,
        html: hit.html,
        contentType: hit.contentType ?? 'application/json',
      };
    }),
    browserCapture: jest.fn(),
    siteEvaluate: jest.fn(),
  };
}

describe('europe pmc adapter', () => {
  test('parses official search results', async () => {
    const queryUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=machine+learning&format=json&pageSize=5&resultType=core';
    const ctx = createContextWithMap({
      [queryUrl]: {
        html: JSON.stringify({
          resultList: {
            result: [
              {
                id: '12345',
                source: 'MED',
                title: 'Machine learning in medicine',
                abstractText: 'A review of machine learning applications.',
                pmid: '12345',
                pmcid: 'PMC999999',
                doi: '10.1000/test',
                authorString: 'Doe J',
                fullTextUrlList: { fullTextUrl: [{ url: 'https://example.org/fulltext' }] },
              },
            ],
          },
        }),
      },
    });

    const result = await europePmcAdapter.search(ctx, 'machine learning', 5);
    expect(result.items).toEqual([
      {
        url: 'https://europepmc.org/article/MED/12345',
        title: 'Machine learning in medicine',
        snippet: 'A review of machine learning applications.',
        extra: {
          source: 'MED',
          id: '12345',
          pmid: '12345',
          pmcid: 'PMC999999',
          doi: '10.1000/test',
          hasFullTextLink: true,
        },
      },
    ]);
  });

  test('extracts full text via official fullTextXML when pmcid is present', async () => {
    const articleApi = 'https://www.ebi.ac.uk/europepmc/webservices/rest/article/MED/12345?format=json&resultType=core';
    const fullTextApi = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC999999/fullTextXML';
    const ctx = createContextWithMap({
      [articleApi]: {
        html: JSON.stringify({
          source: 'MED',
          id: '12345',
          title: 'Machine learning in medicine',
          abstractText: 'A review abstract.',
          pmid: '12345',
          pmcid: 'PMC999999',
          doi: '10.1000/test',
        }),
      },
      [fullTextApi]: {
        html: `<article><front><article-meta><title-group><article-title>Machine learning in medicine</article-title></title-group></article-meta></front><body><sec><p>Full text paragraph one.</p><p>Full text paragraph two.</p></sec></body></article>`,
        contentType: 'application/xml',
      },
    });

    const result = await europePmcAdapter.extract(ctx, 'https://europepmc.org/article/MED/12345');
    expect(result.title).toBe('Machine learning in medicine');
    expect(result.contentText).toContain('摘要：A review abstract.');
    expect(result.contentText).toContain('Full text paragraph one.');
    expect(result.contentState).toBe('partial');
    expect(result.structuredData).toMatchObject({
      adapter: 'europe_pmc',
      pageType: 'fulltext_xml',
      pmcid: 'PMC999999',
    });
  });

  test('falls back to abstract-only when full text is unavailable', async () => {
    const articleApi = 'https://www.ebi.ac.uk/europepmc/webservices/rest/article/MED/12345?format=json&resultType=core';
    const ctx = createContextWithMap({
      [articleApi]: {
        html: JSON.stringify({
          source: 'MED',
          id: '12345',
          title: 'Machine learning in medicine',
          abstractText: 'A review abstract.',
          pmid: '12345',
        }),
      },
    });

    const result = await europePmcAdapter.extract(ctx, 'https://europepmc.org/article/MED/12345');
    expect(result.contentText).toContain('摘要：A review abstract.');
    expect(result.contentState).toBe('partial');
    expect(result.structuredData).toMatchObject({
      adapter: 'europe_pmc',
      pageType: 'abstract_only',
      pmcid: null,
    });
  });
});
